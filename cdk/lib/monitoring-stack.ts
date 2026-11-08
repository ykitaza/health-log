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

// Cognito の変更。IAM と同じく、操作の名前の前方一致で広く捕まえる（読むだけの操作 Get・List・Describe は除く。
// AdminGetUser のような読み取りは、EventBridge の既定のルールには届かない）。
// - Admin：管理者の操作（ユーザーの作成・削除、パスワードの設定、全セッションのサインアウトなど）
// - Create・Update・Delete・Set・Add：ユーザープール、クライアント、ドメイン、IdP、グループ、ユーザー自身の削除、パスキーの削除（DeleteWebAuthnCredential）
// - Start・Complete：パスキーの登録（StartWebAuthnRegistration・CompleteWebAuthnRegistration）、ユーザーのインポート
// - 前方一致で拾えない、ユーザー自身の操作（新規登録、パスワードの変更・再設定）は名前で足す
// マネージドログインの画面からのパスキーの登録（passkeys_add_POST）は、API の呼び出しではなく
// エンドポイントへのリクエストとして、CloudTrail に AwsServiceEvent で記録されるので、detail-type も足す
export const COGNITO_CHANGE_PATTERN: events.EventPattern = {
  source: ['aws.cognito-idp'],
  detailType: ['AWS API Call via CloudTrail', 'AWS Service Event via CloudTrail'],
  detail: {
    eventSource: ['cognito-idp.amazonaws.com'],
    eventName: [
      ...['Admin', 'Create', 'Update', 'Delete', 'Set', 'Add', 'Start', 'Complete'].map((prefix) => ({ prefix })),
      'SignUp', 'ChangePassword', 'ConfirmForgotPassword',
      'passkeys_add_POST',
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

// 自分のスタック。CloudFormation の操作は、これ以外のスタックへのものを通知する（CDK のデプロイ・cdk diff で鳴らないように）。
// 前方一致（CognitoStudy*）にすると、CognitoStudyEvil のような名前のスタックで紛れ込めるので、名前を並べる
export const OWN_STACK_NAMES = ['CognitoStudy', 'CognitoStudyMonitoring', 'CognitoStudyMonitoringGlobal', 'CDKToolkit'];

// CDK のデプロイと cdk diff で、変更セットを作る・実行する・消すロール（cdk-*-deploy-role）
const CDK_DEPLOY_ROLE_PREFIX = 'cdk-hnb659fds-deploy-role-';

// 自分のスタック以外への CloudFormation の変更（作成・更新・削除・変更セット・スタックセットなど）。
// 読むだけの操作（Describe・List・Get）は、EventBridge の既定のルールには届かない。
// - stackName が自分のスタックの名前でなければ通知する。ARN の形のときは、自分のスタックでも通知する（CDK は名前で呼ぶ）
// - stackName がない操作（スタックセット、拡張の登録など）も通知する。ただし、CDK のデプロイの CreateChangeSet は
//   CloudTrail に requestParameters が記録されない（テンプレートが大きいため。このアカウントの記録で確かめた）ので、
//   CDK のデプロイのロールによる、stackName のない操作は除く（そのあとの ExecuteChangeSet には stackName があるので、
//   ほかのスタックへのデプロイはそこで通知される）
export const CLOUDFORMATION_CHANGE_PATTERN: events.EventPattern = {
  source: ['aws.cloudformation'],
  detailType: ['AWS API Call via CloudTrail'],
  detail: {
    eventSource: ['cloudformation.amazonaws.com'],
    eventName: ['Create', 'Update', 'Delete', 'Execute', 'Set', 'Import', 'Continue', 'Cancel', 'Rollback', 'Signal',
      'Activate', 'Deactivate', 'Register', 'Deregister', 'Publish'].map((prefix) => ({ prefix })),
    $or: [
      { requestParameters: { stackName: [{ 'anything-but': OWN_STACK_NAMES }] } },
      {
        requestParameters: { stackName: [{ exists: false }] },
        userIdentity: { sessionContext: { sessionIssuer: { userName: [{ 'anything-but': { prefix: CDK_DEPLOY_ROLE_PREFIX } }] } } },
      },
      {
        requestParameters: { stackName: [{ exists: false }] },
        userIdentity: { sessionContext: { sessionIssuer: { userName: [{ exists: false }] } } },
      },
    ],
  },
};

// 監視の改ざん：アラームの削除・無効化、EventBridge のルールの削除・無効化・送り先の取り外し、
// SNS のトピックと購読の削除、アラームのもとになるメトリクスフィルターの削除。
// 監視のスタックを直すデプロイでアラームやルールを作り直すことがあるので、CDK のデプロイは除く
export const MONITORING_TAMPER_PATTERN: events.EventPattern = {
  source: ['aws.monitoring', 'aws.events', 'aws.sns', 'aws.logs'],
  detailType: ['AWS API Call via CloudTrail'],
  detail: {
    eventSource: ['monitoring.amazonaws.com', 'events.amazonaws.com', 'sns.amazonaws.com', 'logs.amazonaws.com'],
    eventName: ['DeleteAlarms', 'DisableAlarmActions', 'DeleteRule', 'DisableRule', 'RemoveTargets',
      'DeleteTopic', 'Unsubscribe', 'DeleteMetricFilter'],
    ...notByCdkDeploy,
  },
};

// データを壊す操作：DynamoDB のテーブルの削除、削除の保護やポイントインタイムリカバリを外す変更、
// Cognito のユーザープールの削除と、その削除の保護を外す変更。
// CDK のデプロイがこれをすることはない（テーブルとユーザープールは RETAIN で、保護を外す変更もしない）ので、
// CDK のデプロイでも通知する。CDK のデプロイの UpdateTable などは、保護を有効のまま送るので一致しない
export const DATA_DESTRUCTION_PATTERN: events.EventPattern = {
  source: ['aws.dynamodb', 'aws.cognito-idp'],
  detailType: ['AWS API Call via CloudTrail'],
  detail: {
    $or: [
      { eventSource: ['dynamodb.amazonaws.com'], eventName: ['DeleteTable'] },
      { eventSource: ['dynamodb.amazonaws.com'], eventName: ['UpdateTable'],
        requestParameters: { deletionProtectionEnabled: [false] } },
      { eventSource: ['dynamodb.amazonaws.com'], eventName: ['UpdateContinuousBackups'],
        requestParameters: { pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: [false] } } },
      { eventSource: ['cognito-idp.amazonaws.com'], eventName: ['DeleteUserPool'] },
      { eventSource: ['cognito-idp.amazonaws.com'], eventName: ['UpdateUserPool'],
        requestParameters: { deletionProtection: ['INACTIVE'] } },
    ],
  },
};

export interface MonitoringStackProps extends cdk.StackProps {
  // API の ID → アクセスログのロググループ名を入れた SSM パラメータの名前（InfraStack.accessLogGroupParams）
  readonly accessLogGroupParams: Record<string, string>;
  // /token の失敗を数える API の ID（認可API）
  readonly tokenEndpointApi: string;
  // Lambda の ID → 関数名を入れた SSM パラメータの名前（InfraStack.functionNameParams）。エラーを数える関数
  readonly functionNameParams: Record<string, string>;
  // テーブルの ID → テーブル名を入れた SSM パラメータの名前（InfraStack.tableNameParams）。書き込みの量を数えるテーブル
  readonly tableNameParams: Record<string, string>;
  // アプリ用の API の Lambda のロググループ名を入れた SSM パラメータの名前（InfraStack.appApiLogGroupParam）
  readonly appApiLogGroupParam: string;
}

// 東京に置く監視。通知の送り先（SNS）、アラーム、CloudTrail の証跡、東京で起きる操作の EventBridge のルール
export class MonitoringStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);

    // ---- 通知の送り先 ----

    // 暗号化しない：AWS マネージドキー（aws/sns）はキーポリシーを変えられず、CloudWatch と EventBridge が発行できない。
    // カスタマー管理キーは月1ドルかかる。通知に秘密の値は入らない（CloudTrail はパスワードを伏せて記録する）
    const topic = new sns.Topic(this, 'AlertTopic', {
      topicName: 'cognito-study-alerts',
      displayName: 'cognito-study alerts',
      enforceSSL: true, // TLS 以外での発行を拒否する
    });
    // 発行できるのは、このアカウントの、このリージョンのアラームとルールだけにする
    topic.addToResourcePolicy(new iam.PolicyStatement({
      sid: 'AllowCloudWatchAlarms',
      principals: [new iam.ServicePrincipal('cloudwatch.amazonaws.com')],
      actions: ['sns:Publish'],
      resources: [topic.topicArn],
      conditions: {
        StringEquals: { 'aws:SourceAccount': this.account },
        ArnLike: { 'aws:SourceArn': `arn:aws:cloudwatch:${this.region}:${this.account}:alarm:*` },
      },
    }));
    topic.addToResourcePolicy(new iam.PolicyStatement({
      sid: 'AllowEventBridgeRules',
      principals: [new iam.ServicePrincipal('events.amazonaws.com')],
      actions: ['sns:Publish'],
      resources: [topic.topicArn],
      conditions: {
        StringEquals: { 'aws:SourceAccount': this.account },
        ArnLike: { 'aws:SourceArn': `arn:aws:events:${this.region}:${this.account}:rule/*` },
      },
    }));
    // ルールの送り先。targets.SnsTopic は条件なしの許可を足すので使わず、上の条件付きの許可で発行させる
    const topicTarget: events.IRuleTarget = { bind: () => ({ arn: topic.topicArn }) };
    const alarmAction = new cwActions.SnsAction(topic);

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

    // しきい値は、2026-11-08 までの30日のアクセスログ（3つの API の合計。アプリ用の API はまだ使っていないので、
    // 数は認可API と MCP のもの）をもとに、本人1人の利用ではありえない量にする
    alarm('RequestsAlarm', sumPerHour('Requests'), 300,
      'API へのリクエストが1時間に300件以上（これまでの最大は1時間32件）。費用の兆し。アクセスログで送信元 IP と path を見る');
    alarm('ClientErrorsAlarm', sumPerHour('ClientErrors'), 50,
      'API の 4xx が1時間に50件以上（コネクタをつないだ日でも1日38件）。スキャンや総当たりの兆し。アクセスログで送信元 IP と path を見る');
    alarm('ServerErrorsAlarm', sumPerHour('ServerErrors'), 3,
      'API の 5xx が1時間に3件以上（30日間0件）。Lambda のログでエラーを見る');
    alarm('ThrottledAlarm', sumPerHour('Throttled'), 10,
      '流量の制限（認可API と MCP は1秒1回・瞬間5回、アプリ用の API は1秒2回・瞬間10回）での拒否（429）が1時間に10件以上（30日間0件）。叩かれている兆し。アクセスログで送信元 IP と API を見る');
    alarm('TokenFailuresAlarm', sumPerHour('TokenFailures'), 10,
      '認可API の /token の失敗（4xx）が1時間に10件以上（これまでの最大は1時間1件）。認可コードやリフレッシュトークンの総当たりの兆し');

    // このアプリの Lambda（3つ）のエラーの合計。関数ごとの Errors をメトリクスの計算（SUM）でまとめ、アラームは1つにする。
    // アラームの料金と無料枠は、式の中のメトリクスの数（ここでは3）で数える（docs/monitoring.md の「費用の見込み」）
    const functionErrors = Object.fromEntries(Object.entries(props.functionNameParams).map(([fnId, paramName], i) => [
      `e${i}`, new cloudwatch.Metric({
        namespace: 'AWS/Lambda', metricName: 'Errors', statistic: cloudwatch.Stats.SUM, period: cdk.Duration.hours(1),
        dimensionsMap: { FunctionName: ssm.StringParameter.valueForStringParameter(this, paramName) },
        label: fnId,
      }),
    ]));
    alarm('LambdaErrorsAlarm', new cloudwatch.MathExpression({
      expression: `SUM([${Object.keys(functionErrors).join(', ')}])`, usingMetrics: functionErrors,
      period: cdk.Duration.hours(1), label: 'Errors',
    }), 3, 'このアプリの Lambda（認可API・MCP・アプリ用の API）のエラーが1時間に3件以上（30日間0件）。Lambda のログでエラーを見る');

    // ---- DynamoDB とデータ ----

    // 書き込みの量（MealsTable と StateTable の ConsumedWriteCapacityUnits の合計）。盗まれたトークンで送信を続けられ、
    // 費用が膨らむ（Denial of Wallet）兆し。予算の通知は月の合計でしか知らせないので、1時間ごとに見る。
    // しきい値は、2026-11-08 までの30日の実際の量（2つのテーブルの合計で、最大は11-08 の18時台の1時間886。ほかの時間は206以下）から余裕をとる
    const tableWrites = Object.fromEntries(Object.entries(props.tableNameParams).map(([tableId, paramName], i) => [
      `w${i}`, new cloudwatch.Metric({
        namespace: 'AWS/DynamoDB', metricName: 'ConsumedWriteCapacityUnits', statistic: cloudwatch.Stats.SUM,
        period: cdk.Duration.hours(1),
        dimensionsMap: { TableName: ssm.StringParameter.valueForStringParameter(this, paramName) },
        label: tableId,
      }),
    ]));
    alarm('DynamoDbWritesAlarm', new cloudwatch.MathExpression({
      expression: `SUM([${Object.keys(tableWrites).join(', ')}])`, usingMetrics: tableWrites,
      period: cdk.Duration.hours(1), label: 'ConsumedWriteCapacityUnits',
    }), 3000, 'DynamoDB（MealsTable と StateTable）の書き込みが1時間に3,000 WCU 以上（これまでの最大は1時間886）。費用を膨らませる攻撃の兆し。アプリ用の API のアクセスログで送信元 IP と回数を見る');

    // 1回の送信で delete が多い（services/sync の BULK_DELETE_THRESHOLD 件以上）。データを壊す操作の兆し。
    // アプリ用の API の Lambda が「bulk_delete deletes=<数> changes=<数>」をログに出す
    const appApiLogGroup = logs.LogGroup.fromLogGroupName(
      this, 'AppApiFunctionLogs', ssm.StringParameter.valueForStringParameter(this, props.appApiLogGroupParam));
    new logs.MetricFilter(this, 'BulkDeletesFilter', {
      logGroup: appApiLogGroup, metricNamespace: METRIC_NAMESPACE, metricName: 'BulkDeletes', metricValue: '1',
      filterPattern: logs.FilterPattern.literal('"bulk_delete deletes="'),
    });
    alarm('BulkDeletesAlarm', sumPerHour('BulkDeletes'), 1,
      'アプリからの1回の送信で、delete が10件以上あった。データを壊す操作の兆し。Lambda のログの bulk_delete と、変更の記録を見る（戻し方は docs/monitoring.md）');

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
      description: 'Cognito のユーザー・パスキー・ユーザープールの変更', eventPattern: COGNITO_CHANGE_PATTERN, targets: [topicTarget],
    });
    new events.Rule(this, 'CloudTrailTamperRule', {
      description: 'CloudTrail の停止・削除・変更', eventPattern: CLOUDTRAIL_TAMPER_PATTERN, targets: [topicTarget],
    });
    new events.Rule(this, 'CloudFormationChangeRule', {
      description: '自分のスタック以外への CloudFormation の変更', eventPattern: CLOUDFORMATION_CHANGE_PATTERN, targets: [topicTarget],
    });
    new events.Rule(this, 'MonitoringTamperRule', {
      description: 'アラーム・EventBridge のルール・SNS・メトリクスフィルターの削除や無効化', eventPattern: MONITORING_TAMPER_PATTERN,
      targets: [topicTarget],
    });
    new events.Rule(this, 'DataDestructionRule', {
      description: 'DynamoDB のテーブルと Cognito のユーザープールの削除、削除の保護・ポイントインタイムリカバリを外す変更',
      eventPattern: DATA_DESTRUCTION_PATTERN, targets: [topicTarget],
    });

    new cdk.CfnOutput(this, 'AlertTopicArn', { value: topic.topicArn });
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
    // 転送のロール。下の転送のルールだけが使え、転送先のバスにだけ PutEvents できる（権限は targets.EventBus が足す）。
    // ルールの ARN を参照するとロールとルールが循環するので、ルールに名前を付けて ARN を組み立てる
    const forwardRuleName = 'cognito-study-iam-change-forward';
    const forwardRole = new iam.Role(this, 'ForwardRole', {
      assumedBy: new iam.ServicePrincipal('events.amazonaws.com', {
        conditions: {
          StringEquals: { 'aws:SourceAccount': this.account },
          ArnEquals: { 'aws:SourceArn': `arn:aws:events:${this.region}:${this.account}:rule/${forwardRuleName}` },
        },
      }),
    });
    new events.Rule(this, 'IamChangeForwardRule', {
      ruleName: forwardRuleName,
      description: `IAM の変更を ${props.targetRegion} に転送する`,
      eventPattern: IAM_CHANGE_PATTERN,
      targets: [new targets.EventBus(targetBus, { role: forwardRole })],
    });
  }
}
