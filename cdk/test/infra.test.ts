import * as fs from 'fs';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib/core';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { InfraStack } from '../lib/infra-stack';

// Lambda のコードは build-lambda.sh が作る。CI ではテストのために作らないので、空のフォルダで代える
for (const dir of ['authorization', 'meals']) {
  fs.mkdirSync(path.join(__dirname, '..', 'build', dir), { recursive: true });
}

const ACCOUNT = '123456789012';
const REGION = 'ap-northeast-1';

const template = (() => {
  const app = new cdk.App();
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

  test('DynamoDB のテーブルは、どれも削除の保護があり、スタックを消しても残る', () => {
    const tables = template.findResources('AWS::DynamoDB::GlobalTable');
    expect(Object.keys(tables).sort()).toEqual(
      expect.arrayContaining([expect.stringMatching(/^MealsTable/), expect.stringMatching(/^StateTable/)]));
    for (const table of Object.values(tables)) {
      expect(table.DeletionPolicy).toBe('Retain');
      expect(table.UpdateReplacePolicy).toBe('Retain');
      for (const replica of table.Properties.Replicas) {
        expect(replica.DeletionProtectionEnabled).toBe(true);
      }
    }
  });

  test('既存のリソースの論理 ID が変わっていない（変わると作り直しになる）', () => {
    const ids = Object.keys(template.toJSON().Resources);
    for (const prefix of ['UserPool6BA7E5F2', 'UserPoolDomainD0EA232A', 'UserPoolRpClient06B6EADD']) {
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

  test('戻り先はアプリのカスタムスキームだけ', () => {
    expect(app().CallbackURLs).toEqual(['torelog://callback']);
    expect(app().LogoutURLs).toEqual(['torelog://signout']);
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

  test('流量の制限は1秒10回・瞬間20回。MCP と認可API は1秒1回・瞬間5回のまま', () => {
    const stages = Object.entries(resources).filter(([, r]) => r.Type === 'AWS::ApiGatewayV2::Stage');
    const throttle = Object.fromEntries(stages.map(([id, r]) => [id.replace(/DefaultStage.*/, ''), r.Properties.DefaultRouteSettings]));
    expect(throttle).toEqual({
      AuthzApi: { ThrottlingRateLimit: 1, ThrottlingBurstLimit: 5 },
      MealsApi: { ThrottlingRateLimit: 1, ThrottlingBurstLimit: 5 },
      AppApi: { ThrottlingRateLimit: 10, ThrottlingBurstLimit: 20 },
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
    expect(fn.Handler).toBe('app_api_main.handler');
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
