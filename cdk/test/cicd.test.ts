import * as cdk from 'aws-cdk-lib/core';
import { Template } from 'aws-cdk-lib/assertions';
import { newApp } from './app';
import { CiCdStack } from '../lib/cicd-stack';

const ACCOUNT = '123456789012';
const HOST = 'token.actions.githubusercontent.com';

const template = (() => {
  const app = newApp();
  // 差分とデプロイの対象。中身は要らないので、名前とリージョンだけのスタックで代える
  const tokyo = new cdk.Stack(app, 'CognitoStudy', { env: { account: ACCOUNT, region: 'ap-northeast-1' } });
  const global = new cdk.Stack(app, 'CognitoStudyMonitoringGlobal', { env: { account: ACCOUNT, region: 'us-east-1' } });
  // 空のスタックは合成の検証で断られるので、何もしないリソースを1つ置く
  for (const s of [tokyo, global]) new cdk.CfnWaitConditionHandle(s, 'Placeholder');
  const stack = new CiCdStack(app, 'CognitoStudyCiCd', {
    env: { account: ACCOUNT, region: 'ap-northeast-1' },
    repository: 'ykitaza/health-log',
    subjectPrefix: 'repo:ykitaza@104138874/health-log@1416443559',
    diffBranch: 'main',
    deployEnvironment: 'aws-prod',
    targetStacks: [tokyo, global],
  });
  return Template.fromStack(stack);
})();

const roleNamed = (name: string) => {
  const roles = Object.values(template.findResources('AWS::IAM::Role', { Properties: { RoleName: name } }));
  expect(roles).toHaveLength(1);
  return roles[0].Properties;
};

// ロールに付いたポリシーの文（インラインの DefaultPolicy）
const statementsOf = (roleName: string) => {
  const roleIds = Object.entries(template.findResources('AWS::IAM::Role', { Properties: { RoleName: roleName } }))
    .map(([id]) => id);
  const policies = Object.values(template.findResources('AWS::IAM::Policy'))
    .filter((p) => p.Properties.Roles.some((r: { Ref: string }) => roleIds.includes(r.Ref)));
  return policies.flatMap((p) => p.Properties.PolicyDocument.Statement);
};

test('GitHub の OIDC の ID プロバイダーは1つで、aud は sts.amazonaws.com だけ', () => {
  template.resourceCountIs('AWS::IAM::OIDCProvider', 1);
  template.hasResourceProperties('AWS::IAM::OIDCProvider', {
    Url: `https://${HOST}`,
    ClientIdList: ['sts.amazonaws.com'],
  });
});

test('ロールは差分用とデプロイ用の2つだけ', () => {
  template.resourceCountIs('AWS::IAM::Role', 2);
  template.resourceCountIs('AWS::IAM::ManagedPolicy', 0);
  for (const name of ['health-log-github-diff', 'health-log-github-deploy']) {
    expect(roleNamed(name).ManagedPolicyArns).toBeUndefined();
  }
});

describe.each([
  ['health-log-github-diff', 'repo:ykitaza@104138874/health-log@1416443559:ref:refs/heads/main'],
  ['health-log-github-deploy', 'repo:ykitaza@104138874/health-log@1416443559:environment:aws-prod'],
])('%s の信頼ポリシー', (name, sub) => {
  const statements = roleNamed(name).AssumeRolePolicyDocument.Statement;

  test('OIDC のプロバイダーからの AssumeRoleWithWebIdentity だけ', () => {
    expect(statements).toHaveLength(1);
    expect(statements[0].Effect).toBe('Allow');
    expect(statements[0].Action).toBe('sts:AssumeRoleWithWebIdentity');
    expect(statements[0].Principal).toEqual({ Federated: { Ref: expect.stringMatching(/^GitHubOidcProvider/) } });
  });

  test(`sub は ${sub} に、aud は sts.amazonaws.com に一致するときだけ（ワイルドカードなし）`, () => {
    expect(statements[0].Condition).toEqual({
      StringEquals: { [`${HOST}:aud`]: 'sts.amazonaws.com', [`${HOST}:sub`]: sub },
    });
  });
});

test('差分用のロールは、対象のスタックのテンプレートを読むことだけができる', () => {
  expect(statementsOf('health-log-github-diff')).toEqual([{
    Effect: 'Allow',
    Action: ['cloudformation:DescribeStacks', 'cloudformation:GetTemplate'],
    Resource: [
      `arn:aws:cloudformation:ap-northeast-1:${ACCOUNT}:stack/CognitoStudy/*`,
      `arn:aws:cloudformation:us-east-1:${ACCOUNT}:stack/CognitoStudyMonitoringGlobal/*`,
    ],
  }]);
});

test('デプロイ用のロールは、CDK のブートストラップの deploy-role と file-publishing-role を引き受けることだけができる', () => {
  const role = (kind: string, region: string) => `arn:aws:iam::${ACCOUNT}:role/cdk-hnb659fds-${kind}-${ACCOUNT}-${region}`;
  expect(statementsOf('health-log-github-deploy')).toEqual([{
    Effect: 'Allow',
    Action: 'sts:AssumeRole',
    Resource: [
      role('deploy-role', 'ap-northeast-1'), role('deploy-role', 'us-east-1'),
      role('file-publishing-role', 'ap-northeast-1'), role('file-publishing-role', 'us-east-1'),
    ],
  }]);
});
