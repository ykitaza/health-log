import * as path from 'path';
import * as cdk from 'aws-cdk-lib/core';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

const LOCAL_AUTHZ_ORIGIN = 'http://localhost:3000'; // PC で動かす認可API（Cognito から見た RP）

// Lambda が起動時に読む SSM パラメータの名前
const PARAM_PREFIX = '/cognito-study';
const AUTHZ_URL_PARAM = `${PARAM_PREFIX}/authorization/url`;
const MEALS_URL_PARAM = `${PARAM_PREFIX}/meals/url`;
const COGNITO_CLIENT_ID_PARAM = `${PARAM_PREFIX}/authorization/cognito-client-id`;
const SIGNING_KEY_PARAM = `${PARAM_PREFIX}/authorization/signing-key`; // 認可APIが初回起動時に作る（SecureString）
const SESSION_SECRET_PARAM = `${PARAM_PREFIX}/authorization/session-secret`; // 同上。セッション Cookie の署名用

// HTTP API の流量の制限（3つの API それぞれに）。超えた分は 429 で断る。
// 使うのは本人だけなので、1秒あたり1回・瞬間的に5回まで（Claude は接続のときに数回まとめて送る）。
// ずっと上限で叩かれても、月の費用に上限がかかる
const THROTTLE = { rateLimit: 1, burstLimit: 5 };

// 監視のスタック（monitoring-stack.ts）が読む、アクセスログのロググループ名の置き場所。
// 認可APIが書き込める /cognito-study/* の外に置く
const MONITORING_PARAM_PREFIX = '/cognito-study-monitoring';

export class InfraStack extends cdk.Stack {
  // API の ID（AuthzApi など）→ アクセスログのロググループ名を入れた SSM パラメータの名前。
  // 監視のスタックはこの名前でロググループを引く（スタックをまたぐ Export を作らないため）
  public readonly accessLogGroupParams: Record<string, string> = {};

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ログイン画面のドメインのプレフィックス。プレフィックスに "cognito" は使えないので oidc-study にする
    const domainPrefix = `oidc-study-${this.account}`;

    // ユーザープール（Cognito＝IdP）：ログインIDはメールアドレス。使うのは本人だけなので、
    // ログイン画面からの新規登録はできなくし、ユーザーは管理者の操作（setup-local.sh）でだけ作る
    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'cognito-study',
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
      signInAliases: { email: true },
      selfSignUpEnabled: false,
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: true } },
      // パスキーでログインする。パスワードは CloudFormation の決まりで外せないので残し、
      // 運用で長いランダムな値にして捨てる（docs/design.md の「パスキーへの移行」）
      signInPolicy: { allowedFirstAuthFactors: { password: true, passkey: true } },
      // RP ID は今のプレフィックスのドメイン。あとで独自ドメインを足すと、パスキーは全部作り直しになる
      passkeyRelyingPartyId: `${domainPrefix}.auth.${this.region}.amazoncognito.com`,
      passkeyUserVerification: cognito.PasskeyUserVerification.REQUIRED, // 指紋や PIN での本人確認を必須にする
      mfa: cognito.Mfa.OFF, // パスキーの本人確認で代える
      // メールでのパスワードの再設定を止める（捨てたパスワードを、メールを読める人が作り直せないように）。
      // パスキーをなくしたときは、管理者がパスワードを設定し直す
      accountRecovery: cognito.AccountRecovery.NONE,
      // ユーザーが消えると、sub（食べた人の ID）が変わり、記録がたどれなくなる。
      // スタックを消しても残し（RETAIN）、コンソールや API からの削除も止める（削除の保護）
      deletionProtection: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ログイン画面のドメイン（/authorize, /token, /logout の入口）
    const domain = userPool.addDomain('Domain', {
      cognitoDomain: { domainPrefix },
      managedLoginVersion: cognito.ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });
    const cognitoIssuer = `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`;

    // ---- Lambda で動かす認可API と MCPサーバー ----

    // ログイン途中の状態（Cognitoでログイン中・同意待ち・認可コード）。期限が来たら TTL で消える
    const stateTable = new dynamodb.TableV2(this, 'StateTable', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      timeToLiveAttribute: 'expires_at',
      // 中身は期限つきの状態だけだが、リフレッシュトークンの系列も入るので、消えると全員がログインし直しになる
      deletionProtection: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Flask（認可API）・Starlette（食事記録）のアプリを、そのまま Lambda で動かすための仕組み（AWS 公式）
    const webAdapter = lambda.LayerVersion.fromLayerVersionArn(
      this, 'LambdaWebAdapter', `arn:aws:lambda:${this.region}:753240598075:layer:LambdaAdapterLayerArm64:30`);
    // cdk/build-lambda.sh で作ったものを載せる
    const pythonWebApp = (dir: string, environment: Record<string, string>): lambda.FunctionProps => ({
      runtime: lambda.Runtime.PYTHON_3_12,
      architecture: lambda.Architecture.ARM_64,
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'build', dir)),
      handler: 'run.sh',
      layers: [webAdapter],
      memorySize: 512,
      timeout: cdk.Duration.seconds(15),
      environment: { AWS_LAMBDA_EXEC_WRAPPER: '/opt/bootstrap', AWS_LWA_PORT: '8080', ...environment },
    });

    // 入口は API Gateway の HTTP API（関数 URL は使わない。外から Lambda に届く道を API Gateway だけにする）。
    // すべてのパスを Lambda に渡し、URL は API のルート（https://xxxx.execute-api.<region>.amazonaws.com）になる
    const publicApi = (id: string, fn: lambda.IFunction): string => {
      const api = new apigw.HttpApi(this, id, {
        defaultIntegration: new HttpLambdaIntegration(`${id}Integration`, fn),
        createDefaultStage: false, // 流量の制限を付けるため、ステージは自分で作る
      });
      // 送信元 IP を記録し、ChatGPT・Claude の通信が公開されている IP の範囲から来るかを確かめる
      const accessLogs = new logs.LogGroup(this, `${id}AccessLogs`, {
        retention: logs.RetentionDays.ONE_MONTH, // 30日
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });
      const accessLogGroupParam = `${MONITORING_PARAM_PREFIX}/${id}/access-log-group`;
      new ssm.StringParameter(this, `${id}AccessLogGroupParam`, {
        parameterName: accessLogGroupParam, stringValue: accessLogs.logGroupName,
      });
      this.accessLogGroupParams[id] = accessLogGroupParam;
      new apigw.HttpStage(this, `${id}DefaultStage`, {
        httpApi: api, stageName: '$default', autoDeploy: true, throttle: THROTTLE,
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
      return api.apiEndpoint;
    };

    // 自分の URL は作成後に決まるので、環境変数ではなく SSM パラメータで渡す。
    // 認可APIは Cognito のアプリクライアント（戻り先に認可APIの URL を含む）より先に作るので、
    // クライアント ID も SSM で渡す
    const authzFn = new lambda.Function(this, 'AuthzFunction', pythonWebApp('authorization', {
      COGNITO_ISSUER: cognitoIssuer,
      COGNITO_USER_POOL_ID: userPool.userPoolId,
      COGNITO_CLIENT_ID_PARAM,
      STATE_TABLE: stateTable.tableName,
      SIGNING_KEY_PARAM,
      SESSION_SECRET_PARAM,
      AUTHZ_URL_PARAM,
      MEALS_URL_PARAM,
    }));
    const authzUrl = publicApi('AuthzApi', authzFn);
    stateTable.grantReadWriteData(authzFn);
    authzFn.addToRolePolicy(new iam.PolicyStatement({
      // パラメータの資源を直接参照すると循環するので、名前から ARN を組み立てる
      actions: ['ssm:GetParameter', 'ssm:PutParameter'],
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter${PARAM_PREFIX}/*`],
    }));
    authzFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cognito-idp:DescribeUserPoolClient'], // クライアントシークレットを起動時に読む
      resources: [userPool.userPoolArn],
    }));


    // ---- 食事記録の MCPサーバー ----

    // 食事・いつもの・目標・日の種類を、食べた人ごとに1つのテーブルに置く（pk は食べた人、sk は種類と ID）。
    // 期間で食事を探すために、食べた日＋区分の順番（day_key）で並べる LSI を付ける（LSI はテーブルを作るときにしか足せない）
    const mealsTable = new dynamodb.TableV2(this, 'MealsTable', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      localSecondaryIndexes: [{
        indexName: 'by_day',
        sortKey: { name: 'day_key', type: dynamodb.AttributeType.STRING },
      }],
      billing: dynamodb.Billing.onDemand(),
      // 記録は本人のデータなので、スタックを消しても残し（RETAIN）、テーブルの削除も止める（削除の保護）
      deletionProtection: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const mealsFn = new lambda.Function(this, 'MealsFunction', pythonWebApp('meals', {
      AUTHZ_ISSUER: authzUrl, // 信頼関係（手で設定する）：信じる認可API
      MCP_URL_PARAM: MEALS_URL_PARAM,
      MEALS_TABLE: mealsTable.tableName,
    }));
    const mealsUrl = publicApi('MealsApi', mealsFn);
    mealsTable.grantReadWriteData(mealsFn);
    mealsFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter${MEALS_URL_PARAM}`],
    }));

    new ssm.StringParameter(this, 'AuthzUrlParam', { parameterName: AUTHZ_URL_PARAM, stringValue: authzUrl });
    new ssm.StringParameter(this, 'MealsUrlParam', { parameterName: MEALS_URL_PARAM, stringValue: mealsUrl });

    // アプリクライアント（RP＝認可APIの登録）：認可コードフロー、クライアントシークレットあり
    // PC で動かす認可APIと、Lambda の認可APIの両方の戻り先を登録する
    const client = userPool.addClient('RpClient', {
      userPoolClientName: 'authz-api',
      generateSecret: true,
      // マネージドログインで、パスキーとパスワードを選べるようにする（選択式のサインイン ALLOW_USER_AUTH）。
      // 指定すると、既定で付いていた SRP・カスタム認証の入口は外れる（認可API は使っていない）
      authFlows: { user: true },
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL],
        callbackUrls: [`${LOCAL_AUTHZ_ORIGIN}/cognito/callback`, `${authzUrl}/cognito/callback`], // redirect_uri
        // logout_uri：ログアウトのあとの画面と、「別のアカウントで入り直す」のあとにログイン画面へ戻る入口
        logoutUrls: [LOCAL_AUTHZ_ORIGIN, authzUrl].flatMap((origin) => [`${origin}/logged-out`, `${origin}/relogin`]),
      },
    });
    new ssm.StringParameter(this, 'CognitoClientIdParam', {
      parameterName: COGNITO_CLIENT_ID_PARAM, stringValue: client.userPoolClientId,
    });

    // マネージドログインの画面デザイン（既定のものを使う。これがないとログイン画面が出ない）
    new cognito.CfnManagedLoginBranding(this, 'Branding', {
      userPoolId: userPool.userPoolId,
      clientId: client.userPoolClientId,
      useCognitoProvidedValues: true,
    });

    // services/authorization/.env に入れる値（クライアントシークレットは出力しない）
    new cdk.CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new cdk.CfnOutput(this, 'CognitoIssuer', { value: cognitoIssuer });
    new cdk.CfnOutput(this, 'CognitoDomain', { value: domain.baseUrl() });
    new cdk.CfnOutput(this, 'ClientId', { value: client.userPoolClientId });
    // Lambda で動かしている認可API と MCPサーバーの URL
    new cdk.CfnOutput(this, 'AuthzUrl', { value: authzUrl });
    new cdk.CfnOutput(this, 'MealsMcpServerUrl', { value: `${mealsUrl}/mcp` });
  }
}
