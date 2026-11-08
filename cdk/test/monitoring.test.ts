import { Match, Template } from 'aws-cdk-lib/assertions';
import { newApp } from './app';
import { MonitoringGlobalStack, MonitoringStack } from '../lib/monitoring-stack';

// InfraStack は Lambda のビルド（build-lambda.sh）が要るので、ここでは SSM パラメータの名前だけを渡す
const env = { account: '123456789012', region: 'ap-northeast-1' };
const accessLogGroupParams = {
  AuthzApi: '/cognito-study-monitoring/AuthzApi/access-log-group',
  MealsApi: '/cognito-study-monitoring/MealsApi/access-log-group',
};
const functionNameParams = {
  AuthzFunction: '/cognito-study-monitoring/AuthzFunction/function-name',
  MealsFunction: '/cognito-study-monitoring/MealsFunction/function-name',
  AppApiFunction: '/cognito-study-monitoring/AppApiFunction/function-name',
};

const synth = () => {
  const app = newApp();
  const stack = new MonitoringStack(app, 'Monitoring', {
    env, accessLogGroupParams, functionNameParams, tokenEndpointApi: 'AuthzApi',
  });
  return { stack, template: Template.fromStack(stack) };
};

describe('アラーム', () => {
  const { template } = synth();

  test('無料枠（10個。既存の請求のアラームが1個ある）に収まる7個', () => {
    template.resourceCountIs('AWS::CloudWatch::Alarm', 7);
  });

  test.each([
    ['Requests', 300, 3600],
    ['ClientErrors', 50, 3600],
    ['ServerErrors', 3, 3600],
    ['Throttled', 10, 3600],
    ['TokenFailures', 10, 3600],
    ['SuspiciousConsoleLogins', 1, 300],
  ])('%s：%d 件以上で通知する', (metricName, threshold, period) => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      Namespace: 'CognitoStudy/Monitoring', MetricName: metricName, Statistic: 'Sum', Period: period,
      Threshold: threshold, EvaluationPeriods: 1, ComparisonOperator: 'GreaterThanOrEqualToThreshold',
    });
  });

  test('Lambda のエラーは、このアプリの3つの関数の Errors の合計（メトリクスの計算）', () => {
    const alarms = Object.values(template.findResources('AWS::CloudWatch::Alarm'))
      .filter((a) => a.Properties.Metrics !== undefined).map((a) => a.Properties);
    expect(alarms).toHaveLength(1);
    const [a] = alarms;
    expect(a.Threshold).toBe(3);
    expect(a.EvaluationPeriods).toBe(1);
    const expression = a.Metrics.filter((m: any) => m.Expression !== undefined);
    expect(expression).toHaveLength(1);
    expect(expression[0].ReturnData).not.toBe(false);
    const metrics = a.Metrics.filter((m: any) => m.MetricStat !== undefined);
    expect(metrics).toHaveLength(3);
    expect(expression[0].Expression).toBe(`SUM([${metrics.map((m: any) => m.Id).join(', ')}])`);
    for (const m of metrics) {
      expect(m.ReturnData).toBe(false);
      expect(m.MetricStat).toMatchObject({
        Metric: { Namespace: 'AWS/Lambda', MetricName: 'Errors' }, Period: 3600, Stat: 'Sum',
      });
      // 関数名は SSM パラメータから読む（CloudFormation のパラメータ）
      expect(m.MetricStat.Metric.Dimensions).toEqual([{ Name: 'FunctionName', Value: { Ref: expect.any(String) } }]);
    }
    for (const paramName of Object.values(functionNameParams)) {
      template.hasParameter('*', { Type: 'AWS::SSM::Parameter::Value<String>', Default: paramName });
    }
  });

  test('アラームのメトリクスは、無料枠（10個。既存の請求のアラームが1個ある）に収まる9個', () => {
    const count = Object.values(template.findResources('AWS::CloudWatch::Alarm')).reduce((n, a) => n
      + (a.Properties.Metrics ? a.Properties.Metrics.filter((m: any) => m.MetricStat).length : 1), 0);
    expect(count).toBe(9);
  });

  test('どのアラームも、欠けたデータを異常にせず、SNS に送る', () => {
    const alarms = Object.values(template.findResources('AWS::CloudWatch::Alarm'));
    for (const a of alarms) {
      expect(a.Properties.TreatMissingData).toBe('notBreaching');
      expect(a.Properties.AlarmActions).toHaveLength(1);
      expect(a.Properties.AlarmActions[0].Ref).toMatch(/^AlertTopic/);
    }
  });

  test('カスタムメトリクスは無料枠（10個）に収まる6個', () => {
    const names = new Set(Object.values(template.findResources('AWS::Logs::MetricFilter'))
      .map((f) => f.Properties.MetricTransformations[0].MetricName));
    expect([...names].sort()).toEqual(
      ['ClientErrors', 'Requests', 'ServerErrors', 'SuspiciousConsoleLogins', 'Throttled', 'TokenFailures']);
    // ディメンションを付けない（API ごとに別のメトリクスにしない）
    for (const f of Object.values(template.findResources('AWS::Logs::MetricFilter'))) {
      expect(f.Properties.MetricTransformations[0].Dimensions).toBeUndefined();
    }
  });

  test('/token の失敗は、認可API のアクセスログだけで数える', () => {
    const tokenFilters = Object.values(template.findResources('AWS::Logs::MetricFilter'))
      .filter((f) => f.Properties.MetricTransformations[0].MetricName === 'TokenFailures');
    expect(tokenFilters).toHaveLength(1);
    expect(tokenFilters[0].Properties.FilterPattern).toBe('{ ($.path = "/token") && ($.status = "4*") }');
    expect(JSON.stringify(tokenFilters[0].Properties.LogGroupName)).toContain('AuthzApi');
  });

  test('アクセスログのロググループ名は SSM パラメータから読む（Export を使わない）', () => {
    template.hasParameter('*', {
      Type: 'AWS::SSM::Parameter::Value<String>', Default: accessLogGroupParams.MealsApi,
    });
    expect(JSON.stringify(template.toJSON())).not.toContain('Fn::ImportValue');
  });
});

describe('SNS のトピック', () => {
  const { template } = synth();

  test('暗号化しない（aws/sns では CloudWatch と EventBridge が発行できない）', () => {
    template.hasResourceProperties('AWS::SNS::Topic', { KmsMasterKeyId: Match.absent() });
  });

  test('TLS 以外の発行を拒否し、このアカウントのアラームとルールだけに発行を許す', () => {
    template.hasResourceProperties('AWS::SNS::TopicPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Deny', Principal: '*', Action: 'sns:Publish',
            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
          }),
          Match.objectLike({
            Effect: 'Allow', Principal: { Service: 'cloudwatch.amazonaws.com' }, Action: 'sns:Publish',
            Condition: {
              StringEquals: { 'aws:SourceAccount': env.account },
              ArnLike: { 'aws:SourceArn': `arn:aws:cloudwatch:${env.region}:${env.account}:alarm:*` },
            },
          }),
          Match.objectLike({
            Effect: 'Allow', Principal: { Service: 'events.amazonaws.com' }, Action: 'sns:Publish',
            Condition: {
              StringEquals: { 'aws:SourceAccount': env.account },
              ArnLike: { 'aws:SourceArn': `arn:aws:events:${env.region}:${env.account}:rule/*` },
            },
          }),
        ]),
      },
    });
  });

  test('条件なしの許可を持たない', () => {
    const policy = Object.values(template.findResources('AWS::SNS::TopicPolicy'))[0];
    for (const s of policy.Properties.PolicyDocument.Statement) {
      if (s.Effect === 'Allow') expect(s.Condition).toBeDefined();
    }
  });

  test('メールの購読はコードに書かない', () => {
    template.resourceCountIs('AWS::SNS::Subscription', 0);
  });
});

describe('CloudTrail の証跡', () => {
  const { template } = synth();

  test('S3 のバケット：公開をすべて止め、SSE-S3、バージョニング、古いログを消す', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true,
      },
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }],
      },
      VersioningConfiguration: { Status: 'Enabled' },
      LifecycleConfiguration: {
        Rules: Match.arrayWith([Match.objectLike({ ExpirationInDays: 365, Status: 'Enabled' })]),
      },
    });
  });

  test('スタックを消してもバケットは残す', () => {
    template.hasResource('AWS::S3::Bucket', { DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain' });
  });

  test('バケット：TLS を必須にし、この証跡以外からの書き込みを拒否する', () => {
    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({ Effect: 'Deny', Condition: { Bool: { 'aws:SecureTransport': 'false' } } }),
          Match.objectLike({
            Effect: 'Deny', Principal: { Service: 'cloudtrail.amazonaws.com' }, Action: 's3:PutObject',
            Condition: {
              StringNotEquals: {
                'aws:SourceArn': `arn:aws:cloudtrail:${env.region}:${env.account}:trail/cognito-study-management-events`,
              },
            },
          }),
        ]),
      },
    });
  });

  test('マルチリージョン、グローバルなサービスを含む、ログファイルの検証あり、KMS なし、管理イベントだけ', () => {
    template.resourceCountIs('AWS::CloudTrail::Trail', 1);
    template.hasResourceProperties('AWS::CloudTrail::Trail', {
      IsMultiRegionTrail: true,
      IncludeGlobalServiceEvents: true,
      EnableLogFileValidation: true,
      IsLogging: true,
      KMSKeyId: Match.absent(),
      CloudWatchLogsLogGroupArn: Match.anyValue(),
      EventSelectors: [{ IncludeManagementEvents: true, ReadWriteType: 'All', DataResources: Match.absent() }],
    });
  });

  test('ルートと MFA なしのログインを、証跡のロググループで数える', () => {
    template.hasResourceProperties('AWS::Logs::MetricFilter', {
      LogGroupName: { Ref: Match.stringLikeRegexp('TrailLogGroup') },
      FilterPattern: '{ ($.eventName = "ConsoleLogin") && (($.userIdentity.type = "Root") || ($.additionalEventData.MFAUsed = "No")) }',
    });
  });
});

describe('EventBridge のルール', () => {
  const { template } = synth();
  const notByCdk = {
    $or: [
      { userIdentity: { sessionContext: { sessionIssuer: { userName: [{ 'anything-but': { prefix: 'cdk-hnb659fds-cfn-exec-role-' } }] } } } },
      { userIdentity: { sessionContext: { sessionIssuer: { userName: [{ exists: false }] } } } },
    ],
  };

  test('IAM の変更（CDK のデプロイを除く）', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: {
        source: ['aws.iam'],
        'detail-type': ['AWS API Call via CloudTrail'],
        detail: Match.objectLike({
          eventName: Match.arrayWith([{ prefix: 'Create' }, { prefix: 'Delete' }, { prefix: 'Put' }, { prefix: 'Attach' }]),
          ...notByCdk,
        }),
      },
      Targets: [Match.objectLike({ Arn: { Ref: Match.stringLikeRegexp('AlertTopic') } })],
    });
  });

  test('Cognito のユーザーとユーザープールの変更（CDK のデプロイを除く）', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: {
        source: ['aws.cognito-idp'],
        detail: Match.objectLike({
          eventName: Match.arrayWith(['AdminCreateUser', 'AdminDeleteUser', 'AdminSetUserPassword', 'UpdateUserPool']),
          ...notByCdk,
        }),
      },
    });
  });

  test('CloudTrail の停止と削除（CDK のデプロイでも通知する）', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: {
        source: ['aws.cloudtrail'],
        detail: {
          eventSource: ['cloudtrail.amazonaws.com'],
          eventName: Match.arrayWith(['StopLogging', 'DeleteTrail']),
        },
      },
    });
  });

  test('us-east-1 の IAM の変更を、東京の既定のイベントバスに転送する', () => {
    const app = newApp();
    const global = new MonitoringGlobalStack(app, 'Global', {
      env: { account: env.account, region: 'us-east-1' }, targetRegion: 'ap-northeast-1',
    });
    const t = Template.fromStack(global);
    const tokyoBus = `arn:aws:events:ap-northeast-1:${env.account}:event-bus/default`;
    t.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: { source: ['aws.iam'], detail: Match.objectLike(notByCdk) },
      Targets: [Match.objectLike({ Arn: tokyoBus, RoleArn: Match.anyValue() })],
    });
    t.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: [Match.objectLike({
          Principal: { Service: 'events.amazonaws.com' },
          Condition: { StringEquals: { 'aws:SourceAccount': env.account } },
        })],
      },
    });
    // 転送のロールは、東京の既定のバスに PutEvents できるだけ
    t.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: { Statement: [{ Effect: 'Allow', Action: 'events:PutEvents', Resource: tokyoBus }] },
    });
  });
});
