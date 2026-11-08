import * as cdk from 'aws-cdk-lib/core';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

// GitHub Actions（.github/workflows/deploy.yml）から AWS に入るための、OIDC の ID プロバイダーとロール2つ。
// 長期のアクセスキーは置かない。このスタック自身はワークフローからはデプロイせず、手でデプロイする（docs/cd.md）

const GITHUB_OIDC_URL = 'https://token.actions.githubusercontent.com';
const GITHUB_OIDC_HOST = 'token.actions.githubusercontent.com';
const AUDIENCE = 'sts.amazonaws.com';
// CDK のブートストラップ（既定の qualifier）
const CDK_QUALIFIER = 'hnb659fds';

export interface CiCdStackProps extends cdk.StackProps {
  /** `owner/name` の形 */
  readonly repository: string;
  /** 差分用のロールを使えるブランチ */
  readonly diffBranch: string;
  /** デプロイ用のロールを使える GitHub の environment（承認が必要なもの） */
  readonly deployEnvironment: string;
  /** ワークフローが差分を見て、デプロイするスタック */
  readonly targetStacks: cdk.Stack[];
}

export class CiCdStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: CiCdStackProps) {
    super(scope, id, props);

    const provider = new iam.OidcProviderNative(this, 'GitHubOidcProvider', {
      url: GITHUB_OIDC_URL,
      clientIds: [AUDIENCE],
    });

    // トークンの sub で、どこから来たかを絞る。aud はこの用途（STS）だけ
    const principalFor = (sub: string) => new iam.WebIdentityPrincipal(provider.oidcProviderArn, {
      StringEquals: {
        [`${GITHUB_OIDC_HOST}:aud`]: AUDIENCE,
        [`${GITHUB_OIDC_HOST}:sub`]: sub,
      },
    });

    // 差分用：main のブランチのジョブ（environment なし）だけ。CloudFormation のテンプレートを読むことだけができる。
    // cdk diff --method template は、ブートストラップの lookup ロール（ReadOnlyAccess。DynamoDB の中身も読める）を
    // 引き受けようとして断られ、このロールのままで続ける。ここでは lookup ロールを引き受けさせない
    const diffRole = new iam.Role(this, 'DiffRole', {
      roleName: 'meal-log-mcp-github-diff',
      description: `Read-only role for cdk diff from GitHub Actions (${props.repository}, branch ${props.diffBranch})`,  // IAM の説明は ASCII だけ
      assumedBy: principalFor(`repo:${props.repository}:ref:refs/heads/${props.diffBranch}`),
      maxSessionDuration: cdk.Duration.hours(1),
    });
    diffRole.addToPolicy(new iam.PolicyStatement({
      actions: ['cloudformation:DescribeStacks', 'cloudformation:GetTemplate'],
      resources: props.targetStacks.map((s) => cdk.Arn.format({
        service: 'cloudformation', region: s.region, resource: 'stack', resourceName: `${s.stackName}/*`,
      }, this)),
    }));

    // デプロイ用：承認が必要な environment のジョブだけ。できるのは、CDK のブートストラップのロールを引き受けることだけ
    // （CloudFormation の変更は deploy-role、Lambda のコードのアップロードは file-publishing-role が行う）
    const regions = [...new Set(props.targetStacks.map((s) => s.region))].sort();
    const deployRole = new iam.Role(this, 'DeployRole', {
      roleName: 'meal-log-mcp-github-deploy',
      description: `Role for cdk deploy from GitHub Actions (${props.repository}, environment ${props.deployEnvironment})`,
      assumedBy: principalFor(`repo:${props.repository}:environment:${props.deployEnvironment}`),
      maxSessionDuration: cdk.Duration.hours(1),
    });
    deployRole.addToPolicy(new iam.PolicyStatement({
      actions: ['sts:AssumeRole'],
      resources: ['deploy-role', 'file-publishing-role'].flatMap((kind) => regions.map((region) => cdk.Arn.format({
        service: 'iam', region: '', resource: 'role',
        resourceName: `cdk-${CDK_QUALIFIER}-${kind}-${this.account}-${region}`,
      }, this))),
    }));

    new cdk.CfnOutput(this, 'DiffRoleArn', { value: diffRole.roleArn });
    new cdk.CfnOutput(this, 'DeployRoleArn', { value: deployRole.roleArn });
  }
}
