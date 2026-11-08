import * as cdk from 'aws-cdk-lib/core';
import * as cloudtrail from 'aws-cdk-lib/aws-cloudtrail';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

// 監視の仕組み。怪しいアクセスや異常を検知して、SNS のトピックに送る（メールの購読はコンソールで足す）。
// しきい値と根拠、通知が来たときに見るものは docs/monitoring.md にある

const METRIC_NAMESPACE = 'CognitoStudy/Monitoring';

// CDK のデプロイ（CloudFormation が使う cdk-*-cfn-exec-role）による変更は、デプロイのたびに通知が来ないように除く。
// ロールを新しく作る操作そのものは通知されるので、同じ名前のロールを作って紛れ込むことはできない
const CDK_EXEC_ROLE_PREFIX = 'cdk-hnb659fds-cfn-exec-role-';
const notByCdkDeploy = {
  // anything-but は、項目がない（IAM ユーザーやルートの操作）ときに一致しないので、「ない」も $or で足す
  $or: [
    { userIdentity: { sessionContext: { sessionIssuer: { userName: [{ 'anything-but': { prefix: CDK_EXEC_ROLE_PREFIX } }] } } } },
    { userIdentity: { sessionContext: { sessionIssuer: { userName: [{ exists: false }] } } } },
  ],
};

// IAM の変更（ユーザー、アクセスキー、ログインのパスワード、MFA、ポリシー、ロール、ID プロバイダー）。
// 読むだけの操作（Get・List）や、タグ・レポートの作成（Tag・Generate）は除く
export const IAM_CHANGE_PATTERN: events.EventPattern = {
  source: ['aws.iam'],
  detailType: ['AWS API Call via CloudTrail'],
  detail: {
    eventSource: ['iam.amazonaws.com'],
    eventName: ['Create', 'Delete', 'Update', 'Put', 'Attach', 'Detach', 'Add', 'Remove', 'Set', 'Enable',
      'Deactivate', 'Upload', 'Change', 'Resync'].map((prefix) => ({ prefix })),
    ...notByCdkDeploy,
  },
};

// Cognito のユーザーの作成・削除・パスワードの設定と、ユーザープール・アプリクライアントの変更
export const COGNITO_CHANGE_PATTERN: events.EventPattern = {
  source: ['aws.cognito-idp'],
  detailType: ['AWS API Call via CloudTrail'],
  detail: {
    eventSource: ['cognito-idp.amazonaws.com'],
    eventName: [
      'AdminCreateUser', 'SignUp', 'AdminDeleteUser', 'DeleteUser',
      'AdminSetUserPassword', 'AdminResetUserPassword', 'ChangePassword', 'ConfirmForgotPassword',
      'AdminAddUserToGroup', 'AdminUpdateUserAttributes', 'AdminSetUserMFAPreference', 'SetUserPoolMfaConfig',
      'CreateUserPool', 'UpdateUserPool', 'DeleteUserPool',
      'CreateUserPoolClient', 'UpdateUserPoolClient', 'DeleteUserPoolClient',
      'CreateIdentityProvider', 'UpdateIdentityProvider', 'DeleteIdentityProvider',
      'CreateUserPoolDomain', 'UpdateUserPoolDomain', 'DeleteUserPoolDomain',
    ],
    ...notByCdkDeploy,
  },
};

// CloudTrail の停止・削除・記録する対象の変更。めったに起きず、記録を消す攻撃の兆しなので、CDK のデプロイでも通知する
export const CLOUDTRAIL_TAMPER_PATTERN: events.EventPattern = {
  source: ['aws.cloudtrail'],
  detailType: ['AWS API Call via CloudTrail'],
  detail: {
    eventSource: ['cloudtrail.amazonaws.com'],
    eventName: ['StopLogging', 'DeleteTrail', 'UpdateTrail', 'PutEventSelectors'],
  },
};

export interface MonitoringStackProps extends cdk.StackProps {
  // API の ID → アクセスログのロググループ名を入れた SSM パラメータの名前（InfraStack.accessLogGroupParams）
  readonly accessLogGroupParams: Record<string, string>;
  // /token の失敗を数える API の ID（認可API）
  readonly tokenEndpointApi: string;
}

// 東京に置く監視。通知の送り先（SNS）、アラーム、CloudTrail の証跡、東京で起きる操作の EventBridge のルール
export class MonitoringStack extends cdk.Stack {
  public readonly topic: sns.Topic;

  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);

    // ---- 通知の送り先 ----

    // 暗号化しない：AWS マネージドキー（aws/sns）はキーポリシーを変えられず、CloudWatch と EventBridge が発行できない。
    // カスタマー管理キーは月1ドルかかる。通知に秘密の値は入らない（CloudTrail はパスワードを伏せて記録する）
    this.topic = new sns.Topic(this, 'AlertTopic', {
      topicName: 'cognito-study-alerts',
      displayName: 'cognito-study alerts',
      enforceSSL: true, // TLS 以外での発行を拒否する
    });
    // 発行できるのは、このアカウントの、このリージョンのアラームとルールだけにする
    this.topic.addToResourcePolicy(new iam.PolicyStatement({
      sid: 'AllowCloudWatchAlarms',
      principals: [new iam.ServicePrincipal('cloudwatch.amazonaws.com')],
      actions: ['sns:Publish'],
      resources: [this.topic.topicArn],
      conditions: {
        StringEquals: { 'aws:SourceAccount': this.account },
        ArnLike: { 'aws:SourceArn': `arn:aws:cloudwatch:${this.region}:${this.account}:alarm:*` },
      },
    }));
    this.topic.addToResourcePolicy(new iam.PolicyStatement({
      sid: 'AllowEventBridgeRules',
      principals: [new iam.ServicePrincipal('events.amazonaws.com')],
      actions: ['sns:Publish'],
      resources: [this.topic.topicArn],
      conditions: {
        StringEquals: { 'aws:SourceAccount': this.account },
        ArnLike: { 'aws:SourceArn': `arn:aws:events:${this.region}:${this.account}:rule/*` },
      },
    }));
    // ルールの送り先。targets.SnsTopic は条件なしの許可を足すので使わず、上の条件付きの許可で発行させる
    const topicTarget: events.IRuleTarget = { bind: () => ({ arn: this.topic.topicArn }) };
    const alarmAction = new cwActions.SnsAction(this.topic);

    const alarm = (alarmId: string, metric: cloudwatch.IMetric, threshold: number, description: string) => {
      const a = new cloudwatch.Alarm(this, alarmId, {
        metric,
        threshold,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING, // 欠けたデータ（リクエストがない）は異常にしない
        alarmDescription: description,
      });
      a.addAlarmAction(alarmAction);
      return a;
    };
    const sumPerHour = (metricName: string) => new cloudwatch.Metric({
      namespace: METRIC_NAMESPACE, metricName, statistic: cloudwatch.Stats.SUM, period: cdk.Duration.hours(1),
    });

    // ---- API のアクセスログから数える ----

    // どの API のアクセスログも同じメトリクス（ディメンションなし）に足し込む。
    // API ごとにアラームを作るとアラームの無料枠（10個）を超えるため。どの API かは Logs Insights で見る
    const accessLogFilters: Record<string, string> = {
      Requests: '{ $.requestId = "*" }',
      ClientErrors: '{ $.status = "4*" }',
      ServerErrors: '{ $.status = "5*" }',
      Throttled: '{ $.status = "429" }',
    };
    for (const [apiId, paramName] of Object.entries(props.accessLogGroupParams)) {
      const logGroup = logs.LogGroup.fromLogGroupName(
        this, `${apiId}AccessLogs`, ssm.StringParameter.valueForStringParameter(this, paramName));
      const filters = { ...accessLogFilters };
      if (apiId === props.tokenEndpointApi) {
        filters.TokenFailures = '{ ($.path = "/token") && ($.status = "4*") }';
      }
      for (const [metricName, pattern] of Object.entries(filters)) {
        new logs.MetricFilter(this, `${apiId}${metricName}Filter`, {
          logGroup, metricNamespace: METRIC_NAMESPACE, metricName, metricValue: '1',
          filterPattern: logs.FilterPattern.literal(pattern),
        });
      }
    }

    // しきい値は、2026-11-08 までの30日のアクセスログ（2つの API の合計）をもとに、本人1人の利用ではありえない量にする
    alarm('RequestsAlarm', sumPerHour('Requests'), 300,
      'API へのリクエストが1時間に300件以上（これまでの最大は1時間32件）。費用の兆し。アクセスログで送信元 IP と path を見る');
    alarm('ClientErrorsAlarm', sumPerHour('ClientErrors'), 50,
      'API の 4xx が1時間に50件以上（コネクタをつないだ日でも1日38件）。スキャンや総当たりの兆し。アクセスログで送信元 IP と path を見る');
    alarm('ServerErrorsAlarm', sumPerHour('ServerErrors'), 3,
      'API の 5xx が1時間に3件以上（30日間0件）。Lambda のログでエラーを見る');
    alarm('ThrottledAlarm', sumPerHour('Throttled'), 10,
      '流量の制限（1秒1回・瞬間5回）での拒否（429）が1時間に10件以上（30日間0件）。叩かれている兆し。アクセスログで送信元 IP を見る');
    alarm('TokenFailuresAlarm', sumPerHour('TokenFailures'), 10,
      '認可API の /token の失敗（4xx）が1時間に10件以上（これまでの最大は1時間1件）。認可コードやリフレッシュトークンの総当たりの兆し');

    // このリージョンのすべての Lambda のエラー（ディメンションなしの集計）。関数ごとに作るとアラームが増えるため
    alarm('LambdaErrorsAlarm', new cloudwatch.Metric({
      namespace: 'AWS/Lambda', metricName: 'Errors', statistic: cloudwatch.Stats.SUM, period: cdk.Duration.hours(1),
    }), 3, '東京リージョンの Lambda のエラーが1時間に3件以上（30日間0件）。Lambda のログでエラーを見る');

    // ---- CloudTrail の証跡 ----

    // 置き場所の S3。公開をすべて止め、SSE-S3 で暗号化し、TLS を必須にする。証拠なので、スタックを消しても残す
    const trailBucket = new s3.Bucket(this, 'TrailBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          id: 'ExpireTrailLogs',
          // イベント履歴（無料）で90日は見られるので、証跡はそれより長く1年残す
          expiration: cdk.Duration.days(365),
          noncurrentVersionExpiration: cdk.Duration.days(30), // 上書き・削除されたものは30日で消す
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
        },
        { id: 'RemoveExpiredDeleteMarkers', expiredObjectDeleteMarker: true },
      ],
    });

    // ログイン（ConsoleLogin）は、利用者の種類や入口によって記録されるリージョンが変わる（ルートは us-east-1・us-east-2・us-west-2 のどれか）。
    // すべてのリージョンの記録を1つのロググループに集め、メトリクスフィルターで数える
    const trailLogGroup = new logs.LogGroup(this, 'TrailLogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // 管理イベントだけを記録する、1つ目の証跡（S3 への配信は無料）。すべてのリージョンと、グローバルなサービス（IAM など）を記録する
    const trailName = 'cognito-study-management-events';
    // Trail が足す書き込みの許可には送り主の条件がないので、この証跡以外からの書き込みを拒否する
    trailBucket.addToResourcePolicy(new iam.PolicyStatement({
      sid: 'DenyOtherTrails',
      effect: iam.Effect.DENY,
      principals: [new iam.ServicePrincipal('cloudtrail.amazonaws.com')],
      actions: ['s3:PutObject'],
      resources: [trailBucket.arnForObjects('*')],
      conditions: {
        StringNotEquals: { 'aws:SourceArn': `arn:aws:cloudtrail:${this.region}:${this.account}:trail/${trailName}` },
      },
    }));
    new cloudtrail.Trail(this, 'Trail', {
      trailName,
      bucket: trailBucket,
      isMultiRegionTrail: true,
      includeGlobalServiceEvents: true,
      enableFileValidation: true, // ログファイルの改ざんを確かめられるようにする
      managementEvents: cloudtrail.ReadWriteType.ALL,
      sendToCloudWatchLogs: true,
      cloudWatchLogGroup: trailLogGroup,
    });

    // ルートでのログインと、MFA なしのログイン（失敗も含む）
    new logs.MetricFilter(this, 'SuspiciousConsoleLoginFilter', {
      logGroup: trailLogGroup, metricNamespace: METRIC_NAMESPACE, metricName: 'SuspiciousConsoleLogins', metricValue: '1',
      filterPattern: logs.FilterPattern.literal(
        '{ ($.eventName = "ConsoleLogin") && (($.userIdentity.type = "Root") || ($.additionalEventData.MFAUsed = "No")) }'),
    });
    alarm('SuspiciousConsoleLoginAlarm', new cloudwatch.Metric({
      namespace: METRIC_NAMESPACE, metricName: 'SuspiciousConsoleLogins', statistic: cloudwatch.Stats.SUM,
      period: cdk.Duration.minutes(5),
    }), 1, 'ルートでのログイン、または MFA なしのログイン（失敗も含む）があった。CloudTrail の ConsoleLogin を見る');

    // ---- AWS の操作（EventBridge） ----

    // IAM の操作は us-east-1 で記録されるので、MonitoringGlobalStack がこのリージョンのイベントバスに転送する
    new events.Rule(this, 'IamChangeRule', {
      description: 'IAM の変更（us-east-1 から転送されたもの）', eventPattern: IAM_CHANGE_PATTERN, targets: [topicTarget],
    });
    new events.Rule(this, 'CognitoChangeRule', {
      description: 'Cognito のユーザーとユーザープールの変更', eventPattern: COGNITO_CHANGE_PATTERN, targets: [topicTarget],
    });
    new events.Rule(this, 'CloudTrailTamperRule', {
      description: 'CloudTrail の停止・削除・変更', eventPattern: CLOUDTRAIL_TAMPER_PATTERN, targets: [topicTarget],
    });

    new cdk.CfnOutput(this, 'AlertTopicArn', { value: this.topic.topicArn });
    new cdk.CfnOutput(this, 'TrailBucketName', { value: trailBucket.bucketName });
  }
}

export interface MonitoringGlobalStackProps extends cdk.StackProps {
  // 転送先（MonitoringStack を置くリージョン）
  readonly targetRegion: string;
}

// us-east-1 に置く監視。IAM のようなグローバルなサービスの操作は us-east-1 の EventBridge にだけ届くので、
// 東京の既定のイベントバスに転送し、通知の送り先を東京の1つのトピックにまとめる
export class MonitoringGlobalStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MonitoringGlobalStackProps) {
    super(scope, id, props);

    const targetBus = events.EventBus.fromEventBusArn(
      this, 'TargetBus', `arn:aws:events:${props.targetRegion}:${this.account}:event-bus/default`);
    // 転送のロール。このアカウントの EventBridge のルールだけが使え、転送先のバスにだけ PutEvents できる（権限は targets.EventBus が足す）
    const forwardRole = new iam.Role(this, 'ForwardRole', {
      assumedBy: new iam.ServicePrincipal('events.amazonaws.com', {
        conditions: { StringEquals: { 'aws:SourceAccount': this.account } },
      }),
    });
    new events.Rule(this, 'IamChangeForwardRule', {
      description: `IAM の変更を ${props.targetRegion} に転送する`,
      eventPattern: IAM_CHANGE_PATTERN,
      targets: [new targets.EventBus(targetBus, { role: forwardRole })],
    });
  }
}
