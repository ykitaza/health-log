import * as fs from 'fs';
import * as path from 'path';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { newApp } from './app';
import { WordsStack } from '../lib/words-stack';

// Lambda のコードは build-lambda.sh が作る。CI ではテストのために作らないので、空のフォルダで代える
fs.mkdirSync(path.join(__dirname, '..', 'build', 'words'), { recursive: true });

const ACCOUNT = '123456789012';
const REGION = 'ap-northeast-1';
const stack = new WordsStack(newApp(), 'CognitoStudyWords', { env: { account: ACCOUNT, region: REGION } });
const template = Template.fromStack(stack);
const json = template.toJSON();
const paramArn = (name: string) => `arn:aws:ssm:${REGION}:${ACCOUNT}:parameter/cognito-study/${name}`;

const fnNamed = (prefix: string) => {
  const entry = Object.entries(json.Resources).find(
    ([id, r]: [string, any]) => r.Type === 'AWS::Lambda::Function' && id.startsWith(prefix));
  expect(entry).toBeDefined();
  return entry![1] as any;
};
const statementsOf = (fnPrefix: string) => Object.entries(json.Resources)
  .filter(([id, r]: [string, any]) => r.Type === 'AWS::IAM::Policy' && id.startsWith(`${fnPrefix}ServiceRoleDefaultPolicy`))
  .flatMap(([, r]: [string, any]) => r.Properties.PolicyDocument.Statement);
const actionsOf = (s: any) => [].concat(s.Action);

describe('WordsTable', () => {
  test('キーと LSI は MealsTable と同じ形（同期の部品をそのまま使う）', () => {
    template.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }, { AttributeName: 'sk', KeyType: 'RANGE' }],
      LocalSecondaryIndexes: [Match.objectLike({
        IndexName: 'by_day',
        KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }, { AttributeName: 'day_key', KeyType: 'RANGE' }],
      })],
      BillingMode: 'PAY_PER_REQUEST',
      SSESpecification: { SSEEnabled: true, SSEType: 'KMS' },
    });
  });

  test('削除の保護・ポイントインタイムリカバリがあり、スタックを消しても残る（RETAIN）', () => {
    const tables = template.findResources('AWS::DynamoDB::GlobalTable');
    expect(Object.keys(tables)).toHaveLength(1);
    const [id, table] = Object.entries(tables)[0] as [string, any];
    expect(id).toMatch(/^WordsTable/);
    expect(table.DeletionPolicy).toBe('Retain');
    expect(table.UpdateReplacePolicy).toBe('Retain');
    for (const replica of table.Properties.Replicas) {
      expect(replica.DeletionProtectionEnabled).toBe(true);
      expect(replica.PointInTimeRecoverySpecification).toEqual({ PointInTimeRecoveryEnabled: true });
    }
  });
});

describe('Lambda', () => {
  test('MCP は Lambda Web Adapter（KARADA の MealsFunction と同じ作り）', () => {
    const fn = fnNamed('WordsMcpFunction').Properties;
    expect([fn.Runtime, fn.Architectures, fn.Handler, fn.MemorySize, fn.Timeout])
      .toEqual(['python3.12', ['arm64'], 'run.sh', 512, 15]);
    expect(Object.keys(fn.Environment.Variables).sort())
      .toEqual(['AUTHZ_ISSUER', 'AWS_LAMBDA_EXEC_WRAPPER', 'AWS_LWA_PORT', 'MCP_URL_PARAM', 'WORDS_TABLE']);
    expect(fn.Environment.Variables.MCP_URL_PARAM).toBe('/cognito-study/words/url');
    expect(fn.Layers).toHaveLength(1);
  });

  test('アプリ用の同期は API Gateway のイベントを直接受ける', () => {
    const fn = fnNamed('WordsAppApiFunction').Properties;
    expect(fn.Handler).toBe('app_api.handler');
    expect(fn.Layers).toBeUndefined();
    expect(Object.keys(fn.Environment.Variables).sort()).toEqual(['APP_CLIENT_ID', 'WORDS_TABLE']);
  });

  test.each(['WordsMcpFunction', 'WordsAppApiFunction'])('%s の DynamoDB は WordsTable の4つの操作だけ', (fn) => {
    const [s, ...rest] = statementsOf(fn).filter((x: any) => actionsOf(x).some((a: string) => a.startsWith('dynamodb:')));
    expect(rest).toHaveLength(0);
    expect(actionsOf(s).sort()).toEqual(['dynamodb:BatchGetItem', 'dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:Query']);
    expect(JSON.stringify(s.Resource)).toContain('WordsTable');
    expect(JSON.stringify(s.Resource)).not.toContain('MealsTable');
  });

  test('Polly は、アプリ用の Lambda が音声を作る操作だけ（MCP には与えない）', () => {
    const polly = (fn: string) => statementsOf(fn).filter((x: any) => actionsOf(x).some((a: string) => a.startsWith('polly:')));
    expect(polly('WordsAppApiFunction').map((x: any) => [actionsOf(x), x.Resource]))
      .toEqual([[['polly:SynthesizeSpeech'], '*']]);
    expect(polly('WordsMcpFunction')).toHaveLength(0);
  });

  test('SSM は MCP が自分の URL を読むだけ', () => {
    const ssm = statementsOf('WordsMcpFunction').filter((x: any) => actionsOf(x).some((a: string) => a.startsWith('ssm:')));
    expect(ssm).toHaveLength(1);
    expect(actionsOf(ssm[0])).toEqual(['ssm:GetParameter']);
    expect(ssm[0].Resource).toBe(paramArn('words/url'));
    expect(statementsOf('WordsAppApiFunction').some((x: any) => actionsOf(x).some((a: string) => a.startsWith('ssm:'))))
      .toBe(false);
  });

  test('ログは90日', () => {
    const groups = Object.entries(json.Resources).filter(([id, r]: [string, any]) =>
      r.Type === 'AWS::Logs::LogGroup' && /Function/.test(id));
    expect(groups).toHaveLength(2);
    for (const [, g] of groups as [string, any][]) expect(g.Properties.RetentionInDays).toBe(90);
  });
});

describe('HTTP API', () => {
  test('流量の制限：MCP は1秒1回・瞬間5回、アプリ用は1秒2回・瞬間10回。アクセスログは30日', () => {
    template.resourceCountIs('AWS::ApiGatewayV2::Stage', 2);
    template.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      DefaultRouteSettings: { ThrottlingRateLimit: 1, ThrottlingBurstLimit: 5 },
    });
    template.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      DefaultRouteSettings: { ThrottlingRateLimit: 2, ThrottlingBurstLimit: 10 },
    });
    template.allResourcesProperties('AWS::Logs::LogGroup', Match.anyValue());
  });

  test('アプリ用は torelog-app の JWT と、ルートごとの training の scope', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Authorizer', {
      AuthorizerType: 'JWT',
      JwtConfiguration: { Audience: [{ Ref: Match.stringLikeRegexp('SsmParameterValue.*appclientid') }],
        Issuer: { Ref: Match.stringLikeRegexp('SsmParameterValue.*appissuer') } },
    });
    const routes = Object.values(template.findResources('AWS::ApiGatewayV2::Route')).map((r: any) => r.Properties)
      .filter((r: any) => r.AuthorizationType === 'JWT');
    expect(routes.map((r: any) => [r.RouteKey, r.AuthorizationScopes]).sort()).toEqual([
      ['GET /v1/sync/changes', ['torelog-api/training.read']],
      ['GET /v1/sync/snapshot', ['torelog-api/training.read']],
      ['POST /v1/audio', ['torelog-api/training.read']],
      ['POST /v1/sync/changes', ['torelog-api/training.write']],
    ]);
  });
});

describe('共有の資源の参照', () => {
  test('SSM パラメータの名前で読み、スタックをまたぐ Export・Import は作らない', () => {
    for (const name of ['/cognito-study/authorization/url', '/cognito-study/app/issuer', '/cognito-study/app/client-id']) {
      template.hasParameter('*', { Type: 'AWS::SSM::Parameter::Value<String>', Default: name });
    }
    expect(JSON.stringify(json)).not.toContain('Fn::ImportValue');
    expect(Object.values(json.Outputs ?? {}).some((o: any) => o.Export)).toBe(false);
  });

  test('認可API とアプリが読む URL と、監視が読む名前を SSM に置く', () => {
    const names = Object.values(template.findResources('AWS::SSM::Parameter')).map((p: any) => p.Properties.Name).sort();
    expect(names).toEqual([
      '/cognito-study-monitoring/WordsAppApi/access-log-group',
      '/cognito-study-monitoring/WordsAppApiFunction/function-name',
      '/cognito-study-monitoring/WordsAppApiFunction/log-group',
      '/cognito-study-monitoring/WordsMcpApi/access-log-group',
      '/cognito-study-monitoring/WordsMcpFunction/function-name',
      '/cognito-study-monitoring/WordsTable/table-name',
      '/cognito-study/words/app/api-url',
      '/cognito-study/words/url',
    ]);
    expect(stack.accessLogGroupParams).toEqual({
      WordsMcpApi: '/cognito-study-monitoring/WordsMcpApi/access-log-group',
      WordsAppApi: '/cognito-study-monitoring/WordsAppApi/access-log-group',
    });
    expect(Object.keys(stack.functionNameParams)).toEqual(['WordsMcpFunction', 'WordsAppApiFunction']);
    expect(Object.keys(stack.tableNameParams)).toEqual(['WordsTable']);
  });

  test('コネクタに登録する URL を出力する', () => {
    template.hasOutput('WordsMcpServerUrl', Match.anyValue());
    template.hasOutput('WordsAppApiUrl', Match.anyValue());
  });
});
