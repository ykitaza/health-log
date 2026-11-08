#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { InfraStack } from '../lib/infra-stack';
import { MonitoringGlobalStack, MonitoringStack } from '../lib/monitoring-stack';

const app = new cdk.App();
const infra = new InfraStack(app, 'CognitoStudy', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'ap-northeast-1' },
  /* If you don't specify 'env', this stack will be environment-agnostic.
   * Account/Region-dependent features and context lookups will not work,
   * but a single synthesized template can be deployed anywhere. */

  /* Uncomment the next line to specialize this stack for the AWS Account
   * and Region that are implied by the current CLI configuration. */
  // env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },

  /* Uncomment the next line if you know exactly what Account and Region you
   * want to deploy the stack to. */
  // env: { account: '123456789012', region: 'us-east-1' },

  /* For more information, see https://docs.aws.amazon.com/cdk/latest/guide/environments.html */
});

// 監視（怪しいアクセスや異常を検知して SNS に送る）。CognitoStudy とは SSM パラメータの名前だけでつなぐ（Export を作らない）
const monitoring = new MonitoringStack(app, 'CognitoStudyMonitoring', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'ap-northeast-1' },
  accessLogGroupParams: infra.accessLogGroupParams,
  tokenEndpointApi: 'AuthzApi',
});
monitoring.addStackDependency(infra); // SSM パラメータができてから作る
// IAM の操作は us-east-1 にだけ届くので、そこから東京に転送する
new MonitoringGlobalStack(app, 'CognitoStudyMonitoringGlobal', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-east-1' },
  targetRegion: 'ap-northeast-1',
});
