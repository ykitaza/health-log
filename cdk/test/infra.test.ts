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

  test('scope は openid と、アプリ用の API の食事の読み書き', () => {
    const scopes = JSON.stringify(app().AllowedOAuthScopes);
    expect(app().AllowedOAuthScopes[0]).toBe('openid');
    expect(app().AllowedOAuthScopes).toHaveLength(3);
    expect(scopes).toContain('/meals.read');
    expect(scopes).toContain('/meals.write');
  });

  test('リソースサーバー torelog-api', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolResourceServer', {
      Identifier: 'torelog-api',
      Scopes: [
        { ScopeName: 'meals.read', ScopeDescription: Match.anyValue() },
        { ScopeName: 'meals.write', ScopeDescription: Match.anyValue() },
      ],
    });
  });

  test('マネージドログインのブランディングが、両方のクライアントにある', () => {
    template.resourceCountIs('AWS::Cognito::ManagedLoginBranding', 2);
  });

  test('アプリが使う値を SSM と出力に置く', () => {
    for (const name of ['/cognito-study/app/issuer', '/cognito-study/app/client-id', '/cognito-study/app/cognito-domain']) {
      template.hasResourceProperties('AWS::SSM::Parameter', { Name: name, Type: 'String' });
    }
    template.hasOutput('AppClientId', {});
  });
});
