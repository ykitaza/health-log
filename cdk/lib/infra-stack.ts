import * as path from 'path';
import * as cdk from 'aws-cdk-lib/core';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
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
// スマホアプリ（トレログ）が使う値。どれも秘密ではない
const APP_ISSUER_PARAM = `${PARAM_PREFIX}/app/issuer`;
const APP_CLIENT_ID_PARAM = `${PARAM_PREFIX}/app/client-id`;
const APP_COGNITO_DOMAIN_PARAM = `${PARAM_PREFIX}/app/cognito-domain`;
const APP_API_URL_PARAM = `${PARAM_PREFIX}/app/api-url`;

// アプリ用の API の名前（Cognito のリソースサーバーの識別子）。アクセストークンの scope は「torelog-api/meals.read」の形になる。
// scope は「対象.操作」にし、食事（meals.*）と筋トレ（training.*）を分ける
const APP_API_IDENTIFIER = 'torelog-api';

// HTTP API の流量の制限（認可API と MCP それぞれに）。超えた分は 429 で断る。
// 使うのは本人だけなので、1秒あたり1回・瞬間的に5回まで（Claude は接続のときに数回まとめて送る）。
// ずっと上限で叩かれても、月の費用に上限がかかる
const THROTTLE = { rateLimit: 1, burstLimit: 5 };
// アプリ用の API の流量の制限。アプリはまだ使っていないので、使い始めるまでは低くしておく（1秒2回・瞬間10回）。
// 使い始めたら、アプリを開いたときの送信（25件ずつ）と受け取りのページ送り（続けて数回から十数回）に合わせて上げる。
// トークンのない通信はオーソライザーが Lambda の前で断る
const APP_THROTTLE = { rateLimit: 2, burstLimit: 10 };

// 監視のスタック（monitoring-stack.ts）が読む、アクセスログのロググループ名の置き場所。
// 認可APIが書き込める /cognito-study/* の外に置く
const MONITORING_PARAM_PREFIX = '/cognito-study-monitoring';

export class InfraStack extends cdk.Stack {
  // API の ID（AuthzApi など）→ アクセスログのロググループ名を入れた SSM パラメータの名前。
  // 監視のスタックはこの名前でロググループを引く（スタックをまたぐ Export を作らないため）
  public readonly accessLogGroupParams: Record<string, string> = {};
  // Lambda の ID（AuthzFunction など）→ 関数名を入れた SSM パラメータの名前。監視のスタックが関数ごとのエラーを数える
  public readonly functionNameParams: Record<string, string> = {};

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ログイン画面のドメインのプレフィックス。プレフィックスに "cognito" は使えないので oidc-study にする
    const domainPrefix = `oidc-study-${this.account}`;

    // ユーザープール（Cognito＝IdP）：ログインIDはメールアドレス。使うのは本人だけなので、
    // ログイン画面からの新規登録はできなくし、ユーザーは管理者の操作（docs/design.md の「パスキーを作る手順」）でだけ作る
    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'cognito-study',
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
      signInAliases: { email: true },
      selfSignUpEnabled: false,
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: true } },
      // パスキーでログインする。パスワードは CloudFormation の決まりで外せないので残し、
      // 運用で長いランダムな値にして捨てる（docs/design.md の「パスキーを作る手順」）
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
      // 誤って消したり書き換えたりしたときに、35日前までの任意の時点に戻せるようにする（費用はテーブルの大きさで決まり、数十 KB なのでほぼ0）
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      // AWS マネージドキー（aws/dynamodb）で暗号化する。鍵の使用が CloudTrail に残る。鍵の月額はかからない
      encryption: dynamodb.TableEncryptionV2.awsManagedKey(),
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
      loggedStage(id, api, THROTTLE);
      return api.apiEndpoint;
    };
    // ステージ（流量の制限）とアクセスログ。ロググループ名は、監視のスタックが読む SSM パラメータにも置く
    const loggedStage = (id: string, api: apigw.HttpApi, throttle: apigw.ThrottleSettings) => {
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
    // ログインの途中の状態とリフレッシュトークンの系列を、置く・読む・取り出して消す（services/authorization/infrastructure/stores.py）
    authzFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:PutItem', 'dynamodb:GetItem', 'dynamodb:DeleteItem'],
      resources: [stateTable.tableArn],
    }));
    // パラメータの資源を直接参照すると循環するので、名前から ARN を組み立てる
    const paramArn = (name: string) => `arn:aws:ssm:${this.region}:${this.account}:parameter${name}`;
    // 読むのは、起動時に読む5つだけ（services/authorization/infrastructure/settings.py の load_lambda_settings）
    authzFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: [COGNITO_CLIENT_ID_PARAM, AUTHZ_URL_PARAM, MEALS_URL_PARAM, SIGNING_KEY_PARAM, SESSION_SECRET_PARAM].map(paramArn),
    }));
    // 書けるのは、署名鍵とセッションの秘密を初めて作るときだけ。上書き（Overwrite=true）は許さないので、
    // 関数が乗っ取られても、鍵を差し替えたり、URL のパラメータを書き換えたりはできない。
    // 認可API は Overwrite=False で作る。Overwrite を付けない呼び出しは条件キーがないことがあるので、
    // 「true でない」（キーがないときも一致する StringNotEquals）で書く
    authzFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ssm:PutParameter'],
      resources: [SIGNING_KEY_PARAM, SESSION_SECRET_PARAM].map(paramArn),
      conditions: { StringNotEquals: { 'ssm:Overwrite': 'true' } },
    }));
    authzFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cognito-idp:DescribeUserPoolClient'], // クライアントシークレットを起動時に読む
      resources: [userPool.userPoolArn],
    }));


    // ---- MCPサーバー（食事と筋トレ） ----

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
      // 誤って消したり書き換えたりした記録を、35日前までの任意の時点に戻せるようにする（戻すと別のテーブルができる）
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      // AWS マネージドキー（aws/dynamodb）で暗号化する。鍵の使用が CloudTrail に残る。鍵の月額はかからない
      encryption: dynamodb.TableEncryptionV2.awsManagedKey(),
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // 食事と筋トレのツールを1つにまとめた MCP サーバー（services/mcp）。論理 ID と URL は、食事記録だけだったときのまま。
    // 筋トレも同じテーブルの同期の項目（SYNC#…）を読み書きする
    const mealsFn = new lambda.Function(this, 'MealsFunction', pythonWebApp('mcp', {
      AUTHZ_ISSUER: authzUrl, // 信頼関係（手で設定する）：信じる認可API
      MCP_URL_PARAM: MEALS_URL_PARAM,
      MEALS_TABLE: mealsTable.tableName,
    }));
    const mealsUrl = publicApi('MealsApi', mealsFn);
    // 同期の仕組み（services/sync/sync/store.py）が使う操作だけ（体重も筋トレの体組成として、同期の項目に書く）。
    // 同期の変更は追記なので、消す・書き換える（Delete・Update）・全体を読む（Scan）は与えない。
    // TransactWriteItems は、中の操作（Put。条件は Put に付ける）の権限で許される
    mealsFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:BatchGetItem', 'dynamodb:Query', 'dynamodb:PutItem'],
      resources: [mealsTable.tableArn, `${mealsTable.tableArn}/index/*`],
    }));
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
      preventUserExistenceErrors: true, // ユーザーがいるかどうかを、ログイン画面のエラーの違いから知られないようにする
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

    // ---- スマホアプリ（トレログ）のログイン ----

    // アプリ用の API の scope。ルートごとに必須にし、ID トークンや認可API 用のクライアントのトークンを断る
    const mealsRead = new cognito.ResourceServerScope({ scopeName: 'meals.read', scopeDescription: '食事の記録を読む' });
    const mealsWrite = new cognito.ResourceServerScope({ scopeName: 'meals.write', scopeDescription: '食事の記録を書く' });
    const trainingRead = new cognito.ResourceServerScope({ scopeName: 'training.read', scopeDescription: '筋トレの記録を読む' });
    const trainingWrite = new cognito.ResourceServerScope({ scopeName: 'training.write', scopeDescription: '筋トレの記録を書く' });
    const appApi = userPool.addResourceServer('AppApiResourceServer', {
      identifier: APP_API_IDENTIFIER,
      userPoolResourceServerName: 'torelog-api',
      scopes: [mealsRead, mealsWrite, trainingRead, trainingWrite],
    });

    // アプリクライアント（スマホアプリ）：端末に秘密を置けないので、シークレットなしのパブリッククライアントにし、
    // 認可コード＋PKCE だけを許す。戻り先はアプリのカスタムスキーム
    const appClient = userPool.addClient('AppClient', {
      userPoolClientName: 'torelog-app',
      generateSecret: false,
      authFlows: { user: true }, // マネージドログインで、パスキーとパスワードを選べるようにする
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [
          cognito.OAuthScope.OPENID,
          ...[mealsRead, mealsWrite, trainingRead, trainingWrite].map((s) => cognito.OAuthScope.resourceServer(appApi, s)),
        ],
        callbackUrls: ['torelog://callback'],
        logoutUrls: ['torelog://signout'],
      },
      // 盗まれたときの被害を小さくするため、アクセストークンと ID トークンは短くする
      accessTokenValidity: cdk.Duration.minutes(15),
      idTokenValidity: cdk.Duration.minutes(15),
      // 30日アプリを開かなければ、ログインし直し（パスキーなので手間は小さい）
      refreshTokenValidity: cdk.Duration.days(30),
      // リフレッシュトークンを使うたびに新しくする。通信が切れて取り直すときのために、古いものも10秒だけ使える
      refreshTokenRotationGracePeriod: cdk.Duration.seconds(10),
      enableTokenRevocation: true, // ログアウトのときに /oauth2/revoke で消せるようにする
      preventUserExistenceErrors: true, // ユーザーがいるかどうかを、エラーの違いから知られないようにする
    });

    // アプリのクライアントのログイン画面のデザイン（既定のもの）
    new cognito.CfnManagedLoginBranding(this, 'AppBranding', {
      userPoolId: userPool.userPoolId,
      clientId: appClient.userPoolClientId,
      useCognitoProvidedValues: true,
    });

    new ssm.StringParameter(this, 'AppIssuerParam', { parameterName: APP_ISSUER_PARAM, stringValue: cognitoIssuer });
    new ssm.StringParameter(this, 'AppClientIdParam', {
      parameterName: APP_CLIENT_ID_PARAM, stringValue: appClient.userPoolClientId,
    });
    new ssm.StringParameter(this, 'AppCognitoDomainParam', {
      parameterName: APP_COGNITO_DOMAIN_PARAM, stringValue: domain.baseUrl(),
    });

    // ---- スマホアプリ用の API（同期）。仕様は docs/api/app-api.yaml ----

    // MCP の Lambda とは別の関数にする（services/app_api：同期の入口に、食事と筋トレを登録したもの）。
    // Lambda Web Adapter は通さず、API Gateway のイベントを直接受け取り、オーソライザーが確かめたクレームをイベントから読む
    const appApiFn = new lambda.Function(this, 'AppApiFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      architecture: lambda.Architecture.ARM_64,
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'build', 'app_api')),
      handler: 'main.handler',
      memorySize: 512,
      timeout: cdk.Duration.seconds(15),
      environment: { MEALS_TABLE: mealsTable.tableName, APP_CLIENT_ID: appClient.userPoolClientId },
    });
    // 食事のテーブルの読み書きだけ。変更の記録は追記だけなので、消す・書き換える（Delete・Update）・全体を読む（Scan）は与えない。
    // TransactWriteItems は、中の操作（Put。条件は Put に付ける）の権限で許される
    appApiFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:BatchGetItem', 'dynamodb:Query', 'dynamodb:PutItem'],
      resources: [mealsTable.tableArn, `${mealsTable.tableArn}/index/*`],
    }));

    const appHttpApi = new apigw.HttpApi(this, 'AppApi', {
      createDefaultStage: false, // 流量の制限を付けるため、ステージは自分で作る
    });
    loggedStage('AppApi', appHttpApi, APP_THROTTLE);
    // issuer は Cognito、audience はアプリのクライアントだけ（認可API 用のクライアントのトークンを断る）。
    // Cognito のアクセストークンには aud がなく、API Gateway は client_id を audience として確かめる
    const appAuthorizer = new HttpJwtAuthorizer('AppJwtAuthorizer', cognitoIssuer, {
      jwtAudience: [appClient.userPoolClientId],
    });
    const appIntegration = new HttpLambdaIntegration('AppApiIntegration', appApiFn);
    // ルートごとに scope を必須にする（並べたもののどれか1つで通る）。ID トークンには scope がないので断られる。
    // 種類ごとの scope（食事か筋トレか）は Lambda がもう一度確かめる
    const scopeOf = (s: cognito.ResourceServerScope) => `${APP_API_IDENTIFIER}/${s.scopeName}`;
    const appRoutes: [string, apigw.HttpMethod, cognito.ResourceServerScope[]][] = [
      ['/v1/sync/changes', apigw.HttpMethod.POST, [mealsWrite, trainingWrite]],
      ['/v1/sync/changes', apigw.HttpMethod.GET, [mealsRead, trainingRead]],
      ['/v1/sync/snapshot', apigw.HttpMethod.GET, [mealsRead, trainingRead]],
      ['/v1/meals/goal-suggestions', apigw.HttpMethod.POST, [mealsRead]],
    ];
    for (const [routePath, method, scopes] of appRoutes) {
      appHttpApi.addRoutes({
        path: routePath, methods: [method], integration: appIntegration,
        authorizer: appAuthorizer, authorizationScopes: scopes.map(scopeOf),
      });
    }
    new ssm.StringParameter(this, 'AppApiUrlParam', { parameterName: APP_API_URL_PARAM, stringValue: appHttpApi.apiEndpoint });

    // Lambda のログ（CDK が関数ごとに作るロググループ。機能フラグ @aws-cdk/aws-lambda:useCdkManagedLogGroup）は90日残す。
    // 既定の2年は長すぎる。90日は、CloudTrail のイベント履歴と同じで、DynamoDB のポイントインタイムリカバリ（35日）より長い。
    // 量は月に数百 KB なので、費用はほぼ0。スタックを消しても残る（RETAIN。README の「片付け」）
    for (const fn of [authzFn, mealsFn, appApiFn]) {
      (fn.node.findChild('LogGroup').node.defaultChild as logs.CfnLogGroup).retentionInDays = logs.RetentionDays.THREE_MONTHS;
    }

    // 監視のスタックが読む、関数名の置き場所（アクセスログのロググループ名と同じく、Export を作らない）
    for (const [fnId, fn] of Object.entries({ AuthzFunction: authzFn, MealsFunction: mealsFn, AppApiFunction: appApiFn })) {
      const parameterName = `${MONITORING_PARAM_PREFIX}/${fnId}/function-name`;
      new ssm.StringParameter(this, `${fnId}NameParam`, { parameterName, stringValue: fn.functionName });
      this.functionNameParams[fnId] = parameterName;
    }

    // services/authorization/.env に入れる値（クライアントシークレットは出力しない）
    new cdk.CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new cdk.CfnOutput(this, 'CognitoIssuer', { value: cognitoIssuer });
    new cdk.CfnOutput(this, 'CognitoDomain', { value: domain.baseUrl() });
    new cdk.CfnOutput(this, 'ClientId', { value: client.userPoolClientId });
    // アプリ（apps/mobile/）に入れる値。issuer とドメインは上の CognitoIssuer・CognitoDomain と同じ
    new cdk.CfnOutput(this, 'AppClientId', { value: appClient.userPoolClientId });
    new cdk.CfnOutput(this, 'AppApiUrl', { value: appHttpApi.apiEndpoint });
    // Lambda で動かしている認可API と MCPサーバーの URL
    new cdk.CfnOutput(this, 'AuthzUrl', { value: authzUrl });
    new cdk.CfnOutput(this, 'MealsMcpServerUrl', { value: `${mealsUrl}/mcp` });
  }
}
