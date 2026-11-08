#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { InfraStack } from '../lib/infra-stack';
import { MonitoringGlobalStack, MonitoringStack } from '../lib/monitoring-stack';

// スタックは3つ。アカウントは CLI の認証情報（AWS_PROFILE など）から決まり、リージョンはスタックごとに固定する
const app = new cdk.App();
// Cognito（パスキー、認可API 用とアプリ用のクライアント）、認可API・MCP サーバー・アプリ用の API の
// API Gateway と Lambda、DynamoDB、SSM パラメータ
const infra = new InfraStack(app, 'CognitoStudy', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'ap-northeast-1' },
});

// 監視（怪しいアクセスや異常を検知して SNS に送る）。CognitoStudy とは SSM パラメータの名前だけでつなぐ（Export を作らない）
const monitoring = new MonitoringStack(app, 'CognitoStudyMonitoring', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'ap-northeast-1' },
  accessLogGroupParams: infra.accessLogGroupParams,
  functionNameParams: infra.functionNameParams,
  tokenEndpointApi: 'AuthzApi',
});
monitoring.addStackDependency(infra); // SSM パラメータができてから作る
// IAM の操作は us-east-1 にだけ届くので、そこから東京に転送する
new MonitoringGlobalStack(app, 'CognitoStudyMonitoringGlobal', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-east-1' },
  targetRegion: 'ap-northeast-1',
});
