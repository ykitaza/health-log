import * as fs from 'fs';
import * as path from 'path';
import { Template } from 'aws-cdk-lib/assertions';
import { newApp } from './app';
import { InfraStack } from '../lib/infra-stack';

// 本番の CognitoStudy の論理 ID を固定する（docs/words-design.md の「スタックの組み替え」の守り）。
// 論理 ID が変わると、CloudFormation は資源を作り直す（ユーザープールなら sub が変わり、テーブルなら空のテーブルができる）。
// ことばを足したとき（WordsStack）も、CognitoStudy の資源は1つも増えず・減らず・名前も変わらないこと（変えてよいのは中身の更新だけ）。
// 意図して資源を足す・外すときは、このリストを直し、cdk diff で Replace・Delete がないことを確かめる

for (const dir of ['authorization', 'mcp', 'app_api']) {
  fs.mkdirSync(path.join(__dirname, '..', 'build', dir), { recursive: true });
}

const template = Template.fromStack(new InfraStack(newApp(), 'CognitoStudy', {
  env: { account: '123456789012', region: 'ap-northeast-1' },
})).toJSON();

// データを持つ資源と、作り直すと URL・ID が変わる資源（ユーザープール・ドメイン・クライアント・リソースサーバー・テーブル・HTTP API）
const STATEFUL: Record<string, string[]> = {
  'AWS::Cognito::UserPool': ['UserPool6BA7E5F2'],
  'AWS::Cognito::UserPoolDomain': ['UserPoolDomainD0EA232A'],
  'AWS::Cognito::UserPoolClient': ['UserPoolAppClientDD0407EC', 'UserPoolRpClient06B6EADD'],
  'AWS::Cognito::UserPoolResourceServer': ['UserPoolAppApiResourceServer1637F4C5'],
  'AWS::Cognito::ManagedLoginBranding': ['AppBranding', 'Branding'],
  'AWS::DynamoDB::GlobalTable': ['MealsTableCAABDBC9', 'StateTable9728C7E5'],
  'AWS::ApiGatewayV2::Api': ['AppApiE7BADA01', 'AuthzApi94450CF1', 'MealsApi8A415ADE'],
  'AWS::ApiGatewayV2::Stage': ['AppApiDefaultStageF9B7FA3B', 'AuthzApiDefaultStage20B7015F', 'MealsApiDefaultStage3BE40788'],
  'AWS::SSM::Parameter': [
    'AppApiAccessLogGroupParam8A2A6CBA', 'AppApiFunctionLogGroupParam6B4E180B', 'AppApiFunctionNameParamFF84FC92',
    'AppApiUrlParamD0FCDBC8', 'AppClientIdParam108A10A6', 'AppCognitoDomainParam32FF1491', 'AppIssuerParamA2520FF2',
    'AuthzApiAccessLogGroupParam6F01240B', 'AuthzFunctionNameParam843DF064', 'AuthzUrlParam654BE931',
    'CognitoClientIdParam3716DA97', 'MealsApiAccessLogGroupParam9A0E5325', 'MealsFunctionNameParamBEF748F2',
    'MealsTableNameParam29F61E8C', 'MealsUrlParam61E6AE59', 'StateTableNameParam635E02AE',
  ],
};

// ほかの資源（Lambda・IAM・ルート・ロググループなど）も、今の数と名前のまま（ことばの追加で増えない）
const OTHERS = [
  'AppApiAccessLogsFDD42BD7', 'AppApiAppJwtAuthorizerF274EAA8', 'AppApiFunction77FC9D7D',
  'AppApiFunctionLogGroupA294EE67', 'AppApiFunctionServiceRole79FED890', 'AppApiFunctionServiceRoleDefaultPolicy3C7528B3',
  'AppApiGETv1syncchangesAppApiIntegrationPermission56B529D5', 'AppApiGETv1syncchangesFCDB414B',
  'AppApiGETv1syncsnapshotAppApiIntegrationPermissionEBAD9EBE', 'AppApiGETv1syncsnapshotCBD85D9A',
  'AppApiPOSTv1mealsgoalsuggestions4E2CE35A', 'AppApiPOSTv1mealsgoalsuggestionsAppApiIntegrationPermissionC495B84A',
  'AppApiPOSTv1syncchanges44C6F270', 'AppApiPOSTv1syncchangesAppApiIntegration2E5ECCDF',
  'AppApiPOSTv1syncchangesAppApiIntegrationPermission65EB00B5', 'AuthzApiAccessLogsF612FB76',
  'AuthzApiDefaultRoute17059A74', 'AuthzApiDefaultRouteAuthzApiIntegration770FC144',
  'AuthzApiDefaultRouteAuthzApiIntegrationPermission67CBBD69', 'AuthzFunction47713724', 'AuthzFunctionLogGroup5336A532',
  'AuthzFunctionServiceRoleDefaultPolicyF69626C3', 'AuthzFunctionServiceRoleE49EE7AA', 'MealsApiAccessLogsE8DD4044',
  'MealsApiDefaultRoute18A11CAD', 'MealsApiDefaultRouteMealsApiIntegrationB7EAD201',
  'MealsApiDefaultRouteMealsApiIntegrationPermission049E917B', 'MealsFunction088BB4B0', 'MealsFunctionLogGroupAA05EA7B',
  'MealsFunctionServiceRoleD0E160A7', 'MealsFunctionServiceRoleDefaultPolicy4FCC740F',
];

describe('CognitoStudy の論理 ID を固定する', () => {
  test.each(Object.entries(STATEFUL))('%s の論理 ID', (type, ids) => {
    const found = Object.entries(template.Resources).filter(([, r]: [string, any]) => r.Type === type).map(([id]) => id);
    expect(found.sort()).toEqual([...ids].sort());
  });

  test('資源の全体（数と名前）が変わっていない', () => {
    const all = [...Object.values(STATEFUL).flat(), ...OTHERS].sort();
    expect(Object.keys(template.Resources).sort()).toEqual(all);
  });

  test('データを持つ資源は、スタックを消しても残る（RETAIN）', () => {
    for (const id of ['UserPool6BA7E5F2', 'MealsTableCAABDBC9', 'StateTable9728C7E5']) {
      expect(template.Resources[id].DeletionPolicy).toBe('Retain');
      expect(template.Resources[id].UpdateReplacePolicy).toBe('Retain');
    }
  });

  test('torelog-app のクライアントの、作り直しになる項目は今のまま（戻り先を足すのは置き換えのない更新）', () => {
    const client = template.Resources.UserPoolAppClientDD0407EC.Properties;
    expect(client.ClientName).toBe('torelog-app');
    expect(client.GenerateSecret).toBe(false); // GenerateSecret と UserPoolId が変わると作り直し
    expect(client.UserPoolId).toEqual({ Ref: 'UserPool6BA7E5F2' });
  });
});
