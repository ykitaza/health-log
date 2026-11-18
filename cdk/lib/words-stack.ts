import * as path from 'path';
import * as cdk from 'aws-cdk-lib/core';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import {
  APP_API_IDENTIFIER, APP_CLIENT_ID_PARAM, APP_ISSUER_PARAM, APP_THROTTLE, AUTHZ_URL_PARAM, MONITORING_PARAM_PREFIX,
  PARAM_PREFIX, THROTTLE, WORDS_URL_PARAM,
} from './infra-stack';

// ことばのアプリが使う同期の API の URL（issuer・クライアント ID・ドメインは KARADA の /cognito-study/app/* をそのまま使う）
export const WORDS_APP_API_URL_PARAM = `${PARAM_PREFIX}/words/app/api-url`;

// ことば（docs/words-design.md）のサーバー：MCP の Lambda とアプリ用の同期の Lambda、HTTP API 2つ、テーブル1つ。
// CloudFormation のスタックの名前は CognitoStudyWords。共有の資源（認可API の URL、Cognito の issuer、torelog-app のクライアント ID）は
// SSM パラメータの名前で参照し、スタックをまたぐ Export は作らない（今の監視のスタックと同じ）。
// 認可API は、このスタックが置く /cognito-study/words/url を名前で読む（なければ、ことばを足さずに起動する）
export class WordsStack extends cdk.Stack {
  // 監視のスタックが読む、アクセスログのロググループ名・関数名・テーブル名の SSM パラメータの名前（InfraStack と同じ形）
  public readonly accessLogGroupParams: Record<string, string> = {};
  public readonly functionNameParams: Record<string, string> = {};
  public readonly tableNameParams: Record<string, string> = {};
  // アプリ用の同期の Lambda のロググループ名（監視が、delete の多い送信を数える）
  public readonly appApiLogGroupParam = `${MONITORING_PARAM_PREFIX}/WordsAppApiFunction/log-group`;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 共有の資源は、デプロイのときに SSM パラメータから読む（CloudFormation のパラメータになる）
    const authzUrl = ssm.StringParameter.valueForStringParameter(this, AUTHZ_URL_PARAM);
    const cognitoIssuer = ssm.StringParameter.valueForStringParameter(this, APP_ISSUER_PARAM);
    const appClientId = ssm.StringParameter.valueForStringParameter(this, APP_CLIENT_ID_PARAM);

    // 表現・出会い・タグ・振り返りの記録を、利用者ごとに1つのテーブルに置く。キーと LSI は MealsTable と同じ形
    // （pk EATER#<sub>、sk SYNC#…、LSI by_day・day_key）にし、同期の部品（services/sync）をそのまま使う。
    // ことばでは、並びのキー（day_key）に表現の normalized_key を入れ、同じ表現を範囲の検索で探す
    const table = new dynamodb.TableV2(this, 'WordsTable', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      localSecondaryIndexes: [{
        indexName: 'by_day',
        sortKey: { name: 'day_key', type: dynamodb.AttributeType.STRING },
      }],
      billing: dynamodb.Billing.onDemand(),
      // 記録は本人のデータなので、スタックを消しても残し（RETAIN）、テーブルの削除も止める（削除の保護）
      deletionProtection: true,
      // 35日前までの任意の時点に戻せるようにする。テーブルごとなので、KARADA（MealsTable）とは別に戻せる
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      encryption: dynamodb.TableEncryptionV2.awsManagedKey(), // AWS マネージドキー（aws/dynamodb）
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ---- MCP サーバー（ことば。KARADA とは別の URL・別のコネクタ） ----

    const webAdapter = lambda.LayerVersion.fromLayerVersionArn(
      this, 'LambdaWebAdapter', `arn:aws:lambda:${this.region}:753240598075:layer:LambdaAdapterLayerArm64:30`);
    // MCP の Lambda とアプリ用の Lambda は、同じもの（cdk/build-lambda.sh の build/words）を載せ、入口だけを変える
    const code = lambda.Code.fromAsset(path.join(__dirname, '..', 'build', 'words'));
    const mcpFn = new lambda.Function(this, 'WordsMcpFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      architecture: lambda.Architecture.ARM_64,
      code,
      handler: 'run.sh', // Lambda Web Adapter が uvicorn で mcp_main:app を起動する
      layers: [webAdapter],
      memorySize: 512,
      timeout: cdk.Duration.seconds(15),
      environment: {
        AWS_LAMBDA_EXEC_WRAPPER: '/opt/bootstrap', AWS_LWA_PORT: '8080',
        AUTHZ_ISSUER: authzUrl, // 信頼関係：信じる認可API（共有）
        MCP_URL_PARAM: WORDS_URL_PARAM,
        WORDS_TABLE: table.tableName,
      },
    });
    const mcpApi = new apigw.HttpApi(this, 'WordsMcpApi', {
      defaultIntegration: new HttpLambdaIntegration('WordsMcpApiIntegration', mcpFn),
      createDefaultStage: false, // 流量の制限を付けるため、ステージは自分で作る
    });
    this.loggedStage('WordsMcpApi', mcpApi, THROTTLE);
    const mcpUrl = mcpApi.apiEndpoint;
    new ssm.StringParameter(this, 'WordsUrlParam', { parameterName: WORDS_URL_PARAM, stringValue: mcpUrl });

    // 同期の仕組み（services/sync/sync/store.py）が使う操作だけ。消す・書き換える（Delete・Update）・全体を読む（Scan）は与えない。
    // TransactWriteItems は、中の操作（Put）の権限で許される
    const tableAccess = new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:BatchGetItem', 'dynamodb:Query', 'dynamodb:PutItem'],
      resources: [table.tableArn, `${table.tableArn}/index/*`],
    });
    mcpFn.addToRolePolicy(tableAccess);
    mcpFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter${WORDS_URL_PARAM}`],
    }));

    // ---- アプリ用の同期の API（ことばのアプリ。仕様は docs/api/words-app-api.yaml） ----

    const appFn = new lambda.Function(this, 'WordsAppApiFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      architecture: lambda.Architecture.ARM_64,
      code,
      handler: 'app_api.handler', // API Gateway のイベントを直接受け取る（オーソライザーが確かめたクレームを読む）
      memorySize: 512,
      timeout: cdk.Duration.seconds(15),
      environment: { WORDS_TABLE: table.tableName, APP_CLIENT_ID: appClientId },
    });
    appFn.addToRolePolicy(tableAccess);

    const appApi = new apigw.HttpApi(this, 'WordsAppApi', { createDefaultStage: false });
    this.loggedStage('WordsAppApi', appApi, APP_THROTTLE);
    // issuer は Cognito、audience は KARADA と同じ torelog-app のクライアント（ログインの情報を共通にする）
    const authorizer = new HttpJwtAuthorizer('WordsAppJwtAuthorizer', cognitoIssuer, { jwtAudience: [appClientId] });
    const integration = new HttpLambdaIntegration('WordsAppApiIntegration', appFn);
    // ことばの種類の scope は筋トレと同じ torelog-api/training.*（新しい scope は作らない）。Lambda がもう一度確かめる
    const scopeOf = (name: string) => `${APP_API_IDENTIFIER}/${name}`;
    const routes: [string, apigw.HttpMethod, string][] = [
      ['/v1/sync/changes', apigw.HttpMethod.POST, 'training.write'],
      ['/v1/sync/changes', apigw.HttpMethod.GET, 'training.read'],
      ['/v1/sync/snapshot', apigw.HttpMethod.GET, 'training.read'],
    ];
    for (const [routePath, method, s] of routes) {
      appApi.addRoutes({
        path: routePath, methods: [method], integration, authorizer, authorizationScopes: [scopeOf(s)],
      });
    }
    new ssm.StringParameter(this, 'WordsAppApiUrlParam', {
      parameterName: WORDS_APP_API_URL_PARAM, stringValue: appApi.apiEndpoint,
    });

    // ---- ログと監視 ----

    // Lambda のログは90日（InfraStack と同じ）
    for (const fn of [mcpFn, appFn]) {
      (fn.node.findChild('LogGroup').node.defaultChild as logs.CfnLogGroup).retentionInDays = logs.RetentionDays.THREE_MONTHS;
    }
    for (const [fnId, fn] of Object.entries({ WordsMcpFunction: mcpFn, WordsAppApiFunction: appFn })) {
      const parameterName = `${MONITORING_PARAM_PREFIX}/${fnId}/function-name`;
      new ssm.StringParameter(this, `${fnId}NameParam`, { parameterName, stringValue: fn.functionName });
      this.functionNameParams[fnId] = parameterName;
    }
    new ssm.StringParameter(this, 'WordsAppApiFunctionLogGroupParam', {
      parameterName: this.appApiLogGroupParam,
      stringValue: (appFn.node.findChild('LogGroup') as logs.ILogGroup).logGroupName,
    });
    const tableParam = `${MONITORING_PARAM_PREFIX}/WordsTable/table-name`;
    new ssm.StringParameter(this, 'WordsTableNameParam', { parameterName: tableParam, stringValue: table.tableName });
    this.tableNameParams.WordsTable = tableParam;

    // Claude・ChatGPT に登録するカスタムコネクタの URL と、ことばのアプリに入れる同期の API の URL
    new cdk.CfnOutput(this, 'WordsMcpServerUrl', { value: `${mcpUrl}/mcp` });
    new cdk.CfnOutput(this, 'WordsAppApiUrl', { value: appApi.apiEndpoint });
  }

  // ステージ（流量の制限）とアクセスログ。ロググループ名は、監視のスタックが読む SSM パラメータにも置く（InfraStack と同じ形）
  private loggedStage(id: string, api: apigw.HttpApi, throttle: apigw.ThrottleSettings) {
    const accessLogs = new logs.LogGroup(this, `${id}AccessLogs`, {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const accessLogGroupParam = `${MONITORING_PARAM_PREFIX}/${id}/access-log-group`;
    new ssm.StringParameter(this, `${id}AccessLogGroupParam`, {
      parameterName: accessLogGroupParam, stringValue: accessLogs.logGroupName,
    });
    this.accessLogGroupParams[id] = accessLogGroupParam;
    new apigw.HttpStage(this, `${id}DefaultStage`, {
      httpApi: api, stageName: '$default', autoDeploy: true, throttle,
      accessLogSettings: {
        destination: new apigw.LogGroupLogDestination(accessLogs),
        format: apigateway.AccessLogFormat.custom(JSON.stringify({
          requestId: '$context.requestId',
          time: '$context.requestTime',
          sourceIp: '$context.identity.sourceIp',
          userAgent: '$context.identity.userAgent',
          method: '$context.httpMethod',
          path: '$context.path',
          status: '$context.status',
        })),
      },
    });
  }
}
