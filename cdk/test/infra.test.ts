import * as fs from 'fs';
import * as path from 'path';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { newApp } from './app';
import { InfraStack } from '../lib/infra-stack';

// Lambda のコードは build-lambda.sh が作る。CI ではテストのために作らないので、空のフォルダで代える
for (const dir of ['authorization', 'mcp', 'app_api']) {
  fs.mkdirSync(path.join(__dirname, '..', 'build', dir), { recursive: true });
}

const ACCOUNT = '123456789012';
const REGION = 'ap-northeast-1';

const template = (() => {
  const app = newApp();
  const stack = new InfraStack(app, 'CognitoStudy', { env: { account: ACCOUNT, region: REGION } });
  return Template.fromStack(stack);
})();

const clientNamed = (name: string) => {
  const clients = template.findResources('AWS::Cognito::UserPoolClient', {
    Properties: { ClientName: name },
  });
  const values = Object.values(clients);
  expect(values).toHaveLength(1);
  return values[0].Properties;
};

describe('データを持つリソースを守る', () => {
  test('ユーザープールは削除の保護があり、スタックを消しても残る', () => {
    template.hasResource('AWS::Cognito::UserPool', {
      Properties: Match.objectLike({ DeletionProtection: 'ACTIVE' }),
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
    });
  });

  test('DynamoDB のテーブルは、どれも削除の保護とポイントインタイムリカバリがあり、スタックを消しても残る', () => {
    const tables = template.findResources('AWS::DynamoDB::GlobalTable');
    expect(Object.keys(tables).sort()).toEqual(
      expect.arrayContaining([expect.stringMatching(/^MealsTable/), expect.stringMatching(/^StateTable/)]));
    for (const table of Object.values(tables)) {
      expect(table.DeletionPolicy).toBe('Retain');
      expect(table.UpdateReplacePolicy).toBe('Retain');
      for (const replica of table.Properties.Replicas) {
        expect(replica.DeletionProtectionEnabled).toBe(true);
        // ポイントインタイムリカバリ（35日。既定の期間）
        expect(replica.PointInTimeRecoverySpecification).toEqual({ PointInTimeRecoveryEnabled: true });
      }
    }
  });

  test('DynamoDB のテーブルは、どれも AWS マネージドキー（aws/dynamodb）で暗号化する', () => {
    for (const table of Object.values(template.findResources('AWS::DynamoDB::GlobalTable'))) {
      // KMS で、鍵を指定しない（カスタマー管理キーではなく aws/dynamodb）
      expect(table.Properties.SSESpecification).toEqual({ SSEEnabled: true, SSEType: 'KMS' });
      for (const replica of table.Properties.Replicas) {
        expect(replica.SSESpecification).toBeUndefined();
      }
    }
  });

  test('既存のリソースの論理 ID が変わっていない（変わると作り直しになる）', () => {
    const ids = Object.keys(template.toJSON().Resources);
    for (const prefix of ['UserPool6BA7E5F2', 'UserPoolDomainD0EA232A', 'UserPoolRpClient06B6EADD', 'MealsTableCAABDBC9',
      'StateTable9728C7E5']) {
      expect(ids).toContain(prefix);
    }
  });
});

describe('パスキー', () => {
  test('パスワードとパスキーでログインでき、本人確認は必須、RP ID はプレフィックスのドメイン', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      Policies: Match.objectLike({ SignInPolicy: { AllowedFirstAuthFactors: ['PASSWORD', 'WEB_AUTHN'] } }),
      WebAuthnUserVerification: 'required',
      MfaConfiguration: 'OFF',
    });
    const pool = Object.values(template.findResources('AWS::Cognito::UserPool'))[0].Properties;
    expect(JSON.stringify(pool.WebAuthnRelyingPartyID)).toContain('.auth.ap-northeast-1.amazoncognito.com');
    expect(JSON.stringify(pool.WebAuthnRelyingPartyID)).toContain('oidc-study-');
  });

  test('メールでのパスワードの再設定はできない（管理者だけ）', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      AccountRecoverySetting: { RecoveryMechanisms: [{ Name: 'admin_only', Priority: 1 }] },
    });
  });

  test('新規登録はできない', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
    });
  });

  test('認可API 用のクライアントは、選択式のサインインだけを許す（SRP などの入口は開けない）', () => {
    const rp = clientNamed('authz-api');
    expect(rp.ExplicitAuthFlows).toEqual(['ALLOW_USER_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH']);
    expect(rp.GenerateSecret).toBe(true);
  });

  test('認可API 用のクライアントも、ユーザーの有無をエラーから知られないようにする', () => {
    expect(clientNamed('authz-api').PreventUserExistenceErrors).toBe('ENABLED');
  });
});

describe('スマホアプリ用のクライアント', () => {
  const app = () => clientNamed('torelog-app');

  test('シークレットなしで、認可コードのフローだけ', () => {
    expect(app().GenerateSecret).toBe(false);
    expect(app().AllowedOAuthFlows).toEqual(['code']);
    expect(app().AllowedOAuthFlowsUserPoolClient).toBe(true);
    expect(app().SupportedIdentityProviders).toEqual(['COGNITO']);
    expect(app().ExplicitAuthFlows).toEqual(['ALLOW_USER_AUTH']);
  });

  test('戻り先はアプリのカスタムスキームだけ（torelog-dev は開発用の KARADA (dev)）', () => {
    expect(app().CallbackURLs).toEqual(['torelog://callback', 'torelog-dev://callback']);
    expect(app().LogoutURLs).toEqual(['torelog://signout', 'torelog-dev://signout']);
  });

  test('トークンの期限、ローテーション、失効、ユーザーの有無を隠す', () => {
    expect(app().AccessTokenValidity).toBe(15);
    expect(app().IdTokenValidity).toBe(15);
    expect(app().RefreshTokenValidity).toBe(30 * 24 * 60);
    expect(app().TokenValidityUnits).toEqual({ AccessToken: 'minutes', IdToken: 'minutes', RefreshToken: 'minutes' });
    expect(app().RefreshTokenRotation).toEqual({ Feature: 'ENABLED', RetryGracePeriodSeconds: 10 });
    expect(app().EnableTokenRevocation).toBe(true);
    expect(app().PreventUserExistenceErrors).toBe('ENABLED');
  });

  test('scope は openid と、アプリ用の API の食事と筋トレの読み書き', () => {
    const scopes = JSON.stringify(app().AllowedOAuthScopes);
    expect(app().AllowedOAuthScopes[0]).toBe('openid');
    expect(app().AllowedOAuthScopes).toHaveLength(5);
    for (const s of ['/meals.read', '/meals.write', '/training.read', '/training.write']) {
      expect(scopes).toContain(s);
    }
  });

  test('リソースサーバー torelog-api', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolResourceServer', {
      Identifier: 'torelog-api',
      Scopes: ['meals.read', 'meals.write', 'training.read', 'training.write'].map(
        (name) => ({ ScopeName: name, ScopeDescription: Match.anyValue() })),
    });
  });

  test('マネージドログインのブランディングが、両方のクライアントにある', () => {
    template.resourceCountIs('AWS::Cognito::ManagedLoginBranding', 2);
  });

  test('ブランディングは KARADA のもの（ダークモード、ロゴとファビコン）で、両方のクライアントに同じものが付く', () => {
    const resources = template.toJSON().Resources as Record<string, any>;
    const clientIds = Object.entries(resources)
      .filter(([, r]) => r.Type === 'AWS::Cognito::UserPoolClient')
      .map(([id, r]) => [r.Properties.ClientName, id]);
    const brandings = Object.values(resources).filter((r) => r.Type === 'AWS::Cognito::ManagedLoginBranding');
    // 付くクライアントが torelog-app と authz-api の2つであること
    const byClient = Object.fromEntries(clientIds.map(([name, id]) =>
      [name, brandings.find((b) => b.Properties.ClientId?.Ref === id)]));
    expect(byClient['torelog-app']).toBeDefined();
    expect(byClient['authz-api']).toBeDefined();
    const app = byClient['torelog-app'].Properties;
    const authz = byClient['authz-api'].Properties;
    expect(app.UseCognitoProvidedValues).toBe(false);
    expect(app.Settings.categories.global.colorSchemeMode).toBe('DARK');
    expect(app.Settings.components.pageBackground.darkMode.color).toBe('0e1013ff');
    expect(app.Settings.components.primaryButton.darkMode.defaults).toEqual(
      { backgroundColor: '5be49bff', textColor: '08130dff' });
    expect(app.Assets.map((a: any) => a.Category).sort()).toEqual(['FAVICON_ICO', 'FAVICON_SVG', 'FORM_LOGO']);
    for (const a of app.Assets) {
      expect(a.ColorMode).toBe('DARK');
      expect(a.Bytes.length).toBeLessThanOrEqual(1000000); // AssetType の Bytes の上限
    }
    // 両方とも同じ設定と画像
    expect(authz.Settings).toEqual(app.Settings);
    expect(authz.Assets).toEqual(app.Assets);
  });

  test('Lambda のロググループは、3つとも CDK が作り、90日残す（論理 ID は今のまま）', () => {
    for (const id of ['AuthzFunctionLogGroup5336A532', 'MealsFunctionLogGroupAA05EA7B', 'AppApiFunctionLogGroupA294EE67']) {
      const logGroup = (template.toJSON().Resources as Record<string, any>)[id];
      expect(logGroup.Type).toBe('AWS::Logs::LogGroup');
      expect(logGroup.Properties.RetentionInDays).toBe(90);
      expect(logGroup.DeletionPolicy).toBe('Retain');
    }
  });

  test('監視のスタックが読む関数名を、3つの Lambda について SSM に置く', () => {
    for (const fnId of ['AuthzFunction', 'MealsFunction', 'AppApiFunction']) {
      template.hasResourceProperties('AWS::SSM::Parameter', {
        Name: `/cognito-study-monitoring/${fnId}/function-name`, Type: 'String',
        Value: { Ref: Match.stringLikeRegexp(`^${fnId}`) },
      });
    }
  });

  test('監視のスタックが読むテーブル名と、アプリ用の API の Lambda のロググループ名を SSM に置く', () => {
    for (const tableId of ['MealsTable', 'StateTable']) {
      template.hasResourceProperties('AWS::SSM::Parameter', {
        Name: `/cognito-study-monitoring/${tableId}/table-name`, Type: 'String',
        Value: { Ref: Match.stringLikeRegexp(`^${tableId}`) },
      });
    }
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/cognito-study-monitoring/AppApiFunction/log-group', Type: 'String',
      Value: { Ref: 'AppApiFunctionLogGroupA294EE67' },
    });
  });

  test('アプリが使う値を SSM と出力に置く', () => {
    for (const name of ['/cognito-study/app/issuer', '/cognito-study/app/client-id', '/cognito-study/app/cognito-domain',
      '/cognito-study/app/api-url']) {
      template.hasResourceProperties('AWS::SSM::Parameter', { Name: name, Type: 'String' });
    }
    template.hasOutput('AppClientId', {});
    template.hasOutput('AppApiUrl', {});
  });
});

describe('アプリ用の API（同期）', () => {
  const resources = template.toJSON().Resources as Record<string, any>;
  const logicalId = (type: string, prefix: string) => {
    const ids = Object.keys(resources).filter((k) => resources[k].Type === type && k.startsWith(prefix));
    expect(ids).toHaveLength(1);
    return ids[0];
  };
  const apiId = logicalId('AWS::ApiGatewayV2::Api', 'AppApi');
  const ofApi = (type: string) => Object.values(resources)
    .filter((r) => r.Type === type && JSON.stringify(r.Properties.ApiId) === JSON.stringify({ Ref: apiId }));
  const appClientId = logicalId('AWS::Cognito::UserPoolClient', 'UserPoolAppClient');

  test('JWT のオーソライザー：issuer は Cognito、audience はアプリのクライアントだけ', () => {
    const [authorizer] = ofApi('AWS::ApiGatewayV2::Authorizer');
    expect(authorizer.Properties.AuthorizerType).toBe('JWT');
    expect(authorizer.Properties.IdentitySource).toEqual(['$request.header.Authorization']);
    expect(authorizer.Properties.JwtConfiguration.Audience).toEqual([{ Ref: appClientId }]);
    expect(JSON.stringify(authorizer.Properties.JwtConfiguration.Issuer)).toContain('cognito-idp.ap-northeast-1.amazonaws.com/');
    expect(JSON.stringify(authorizer.Properties.JwtConfiguration.Issuer)).toContain('UserPool6BA7E5F2');
  });

  test('ルートは4つだけで、どれも JWT と scope が要る（$default のルートはない）', () => {
    const routes: Record<string, any> = Object.fromEntries(
      ofApi('AWS::ApiGatewayV2::Route').map((r) => [r.Properties.RouteKey, r.Properties]));
    expect(Object.keys(routes).sort()).toEqual([
      'GET /v1/sync/changes', 'GET /v1/sync/snapshot', 'POST /v1/meals/goal-suggestions', 'POST /v1/sync/changes']);
    for (const route of Object.values(routes)) {
      expect(route.AuthorizationType).toBe('JWT');
    }
    expect(routes['POST /v1/sync/changes'].AuthorizationScopes).toEqual(['torelog-api/meals.write', 'torelog-api/training.write']);
    expect(routes['GET /v1/sync/changes'].AuthorizationScopes).toEqual(['torelog-api/meals.read', 'torelog-api/training.read']);
    expect(routes['GET /v1/sync/snapshot'].AuthorizationScopes).toEqual(['torelog-api/meals.read', 'torelog-api/training.read']);
    expect(routes['POST /v1/meals/goal-suggestions'].AuthorizationScopes).toEqual(['torelog-api/meals.read']);
  });

  test('流量の制限は、アプリが使い始めるまで1秒2回・瞬間10回。MCP と認可API は1秒1回・瞬間5回のまま', () => {
    const stages = Object.entries(resources).filter(([, r]) => r.Type === 'AWS::ApiGatewayV2::Stage');
    const throttle = Object.fromEntries(stages.map(([id, r]) => [id.replace(/DefaultStage.*/, ''), r.Properties.DefaultRouteSettings]));
    expect(throttle).toEqual({
      AuthzApi: { ThrottlingRateLimit: 1, ThrottlingBurstLimit: 5 },
      MealsApi: { ThrottlingRateLimit: 1, ThrottlingBurstLimit: 5 },
      AppApi: { ThrottlingRateLimit: 2, ThrottlingBurstLimit: 10 },
    });
  });

  test('アクセスログは30日。監視のスタックが読む SSM パラメータにも置く', () => {
    const logGroup = resources[logicalId('AWS::Logs::LogGroup', 'AppApiAccessLogs')];
    expect(logGroup.Properties.RetentionInDays).toBe(30);
    const [stage] = ofApi('AWS::ApiGatewayV2::Stage');
    expect(stage.Properties.AccessLogSettings.DestinationArn['Fn::GetAtt'][0]).toMatch(/^AppApiAccessLogs/);
    template.hasResourceProperties('AWS::SSM::Parameter', { Name: '/cognito-study-monitoring/AppApi/access-log-group' });
  });

  test('Lambda は MCP とは別の関数で、Web Adapter を通さない', () => {
    const fn = resources[logicalId('AWS::Lambda::Function', 'AppApiFunction')].Properties;
    expect(fn.Handler).toBe('main.handler');
    expect(fn.Layers).toBeUndefined();
    expect(Object.keys(fn.Environment.Variables).sort()).toEqual(['APP_CLIENT_ID', 'MEALS_TABLE']);
    expect(fn.Environment.Variables.APP_CLIENT_ID).toEqual({ Ref: appClientId });
  });

  test('Lambda の権限は、食事のテーブルの読み書き（追記）だけ', () => {
    const fnRole = resources[logicalId('AWS::Lambda::Function', 'AppApiFunction')].Properties.Role['Fn::GetAtt'][0];
    const policies = Object.values(resources).filter((r) => r.Type === 'AWS::IAM::Policy'
      && r.Properties.Roles.some((role: any) => role.Ref === fnRole));
    const statements = policies.flatMap((p) => p.Properties.PolicyDocument.Statement);
    expect(statements).toHaveLength(1);
    expect(statements[0].Effect).toBe('Allow');
    expect([...statements[0].Action].sort()).toEqual([
      'dynamodb:BatchGetItem', 'dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:Query']);
    const mealsTable = logicalId('AWS::DynamoDB::GlobalTable', 'MealsTable');
    expect(JSON.stringify(statements[0].Resource)).toContain(mealsTable);
    expect(JSON.stringify(statements[0].Resource)).not.toContain('StateTable');
    // 管理ポリシーはログを書くものだけ
    const role = resources[fnRole].Properties;
    expect(JSON.stringify(role.ManagedPolicyArns)).toContain('AWSLambdaBasicExecutionRole');
    expect(role.ManagedPolicyArns).toHaveLength(1);
  });

  test('API Gateway からだけ呼べる（関数 URL はない）', () => {
    template.resourceCountIs('AWS::Lambda::Url', 0);
    const fnId = logicalId('AWS::Lambda::Function', 'AppApiFunction');
    const permissions = Object.values(resources).filter((r) => r.Type === 'AWS::Lambda::Permission'
      && JSON.stringify(r.Properties.FunctionName).includes(fnId));
    expect(permissions.length).toBeGreaterThan(0);
    for (const p of permissions) {
      expect(p.Properties.Principal).toBe('apigateway.amazonaws.com');
      expect(JSON.stringify(p.Properties.SourceArn)).toContain(apiId);
    }
  });
});

describe('Lambda の権限', () => {
  const resources = template.toJSON().Resources as Record<string, any>;
  const statementsOf = (fnPrefix: string) => {
    const [fnId] = Object.keys(resources).filter((k) => resources[k].Type === 'AWS::Lambda::Function' && k.startsWith(fnPrefix));
    const fnRole = resources[fnId].Properties.Role['Fn::GetAtt'][0];
    return Object.values(resources)
      .filter((r) => r.Type === 'AWS::IAM::Policy' && r.Properties.Roles.some((role: any) => role.Ref === fnRole))
      .flatMap((p) => p.Properties.PolicyDocument.Statement);
  };
  const paramArn = (name: string) => `arn:aws:ssm:${REGION}:${ACCOUNT}:parameter/cognito-study/${name}`;
  const actionsOf = (s: any) => [s.Action].flat().sort();

  test('認可API の SSM：読むのは起動時の5つ、書けるのは2つの秘密を初めて作るときだけ', () => {
    const ssm = statementsOf('AuthzFunction').filter((s) => actionsOf(s).some((a: string) => a.startsWith('ssm:')));
    expect(ssm).toHaveLength(2);
    const get = ssm.find((s) => actionsOf(s).includes('ssm:GetParameter'));
    expect(actionsOf(get)).toEqual(['ssm:GetParameter']);
    expect([...get.Resource].sort()).toEqual([
      'authorization/cognito-client-id', 'authorization/session-secret', 'authorization/signing-key',
      'authorization/url', 'meals/url'].map(paramArn).sort());
    const put = ssm.find((s) => actionsOf(s).includes('ssm:PutParameter'));
    expect(actionsOf(put)).toEqual(['ssm:PutParameter']);
    expect([...put.Resource].sort()).toEqual(
      ['authorization/session-secret', 'authorization/signing-key'].map(paramArn));
    expect(put.Condition).toEqual({ StringNotEquals: { 'ssm:Overwrite': 'true' } });
  });

  const dynamodbOf = (fnPrefix: string) =>
    statementsOf(fnPrefix).filter((s) => actionsOf(s).some((a: string) => a.startsWith('dynamodb:')));

  test('認可API の DynamoDB：StateTable の PutItem・GetItem・DeleteItem だけ', () => {
    const [s, ...rest] = dynamodbOf('AuthzFunction');
    expect(rest).toHaveLength(0);
    expect(actionsOf(s)).toEqual(['dynamodb:DeleteItem', 'dynamodb:GetItem', 'dynamodb:PutItem']);
    expect(s.Resource).toEqual({ 'Fn::GetAtt': [expect.stringMatching(/^StateTable/), 'Arn'] });
  });

  test('MCP の DynamoDB：MealsTable（と LSI）の読み取りと PutItem だけ', () => {
    const [s, ...rest] = dynamodbOf('MealsFunction');
    expect(rest).toHaveLength(0);
    expect(actionsOf(s)).toEqual(['dynamodb:BatchGetItem', 'dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:Query']);
    expect(JSON.stringify(s.Resource)).toContain('MealsTable');
    expect(JSON.stringify(s.Resource)).not.toContain('StateTable');
  });
});
