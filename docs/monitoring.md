# 監視

怪しいアクセスや異常を検知して、SNS のトピック `cognito-study-alerts`（東京）からメールで知らせます。
構成は `cdk/lib/monitoring-stack.ts` にあり、スタックは次の2つです。

| スタック | リージョン | 中身 |
|---|---|---|
| `CognitoStudyMonitoring` | ap-northeast-1 | SNS のトピック、CloudWatch のアラーム7個、CloudTrail の証跡（S3 と CloudWatch Logs）、EventBridge のルール3個 |
| `CognitoStudyMonitoringGlobal` | us-east-1 | IAM の操作を東京の既定のイベントバスに転送するルール |

`CognitoStudy` とは、SSM パラメータの名前（アクセスログのロググループ名 `/cognito-study-monitoring/<API>/access-log-group` と、Lambda の関数名 `/cognito-study-monitoring/<関数>/function-name`）だけでつないでいます。スタックをまたぐ Export は作りません。

## 何を検知するか

### API と Lambda（CloudWatch のアラーム）

しきい値は、2026-11-08 までの30日のアクセスログ（2つの API の合計）をもとに、本人1人の利用ではありえない量にしています。
スマホアプリ用の API（`AppApi`）のアクセスログも、同じメトリクスに合わせて数えます。アプリは開くたびに同期で数回から十数回送るので、使い始めたら `Requests` のしきい値を見直します。
どの API の数も、ディメンションのない1つのメトリクス（名前空間 `CognitoStudy/Monitoring`）に足し込みます。API ごとにアラームを作ると、アラームの無料枠（10個）を超えるためです。どの API で起きたかは、下の Logs Insights で見ます。

| アラーム | 数えるもの | しきい値 | 根拠 |
|---|---|---|---|
| `RequestsAlarm` | すべてのリクエスト（アクセスログ） | 1時間に300件以上 | これまでの最大は1時間32件、1日42件。300件は、多い日の7日分を1時間で使う量。費用の兆し |
| `ClientErrorsAlarm` | 4xx（アクセスログ） | 1時間に50件以上 | 普段はスキャンが月10件ほど。コネクタをつないだ日でも 401 は1日38件。スキャンや総当たりの兆し |
| `ServerErrorsAlarm` | 5xx（アクセスログ） | 1時間に3件以上 | 30日間0件。1件だけなら一時的な失敗のこともあるので、3件から |
| `ThrottledAlarm` | 429（流量の制限での拒否。アクセスログ） | 1時間に10件以上 | 30日間0件。Claude は接続のときに数回まとめて送るので、数件の 429 はありうる |
| `TokenFailuresAlarm` | 認可API の `/token` の 4xx（アクセスログ） | 1時間に10件以上 | これまでの最大は1時間1件。認可コードやリフレッシュトークンの総当たりの兆し |
| `LambdaErrorsAlarm` | このアプリの3つの Lambda（`AuthzFunction`・`MealsFunction`・`AppApiFunction`）の `Errors` の合計（`AWS/Lambda`。関数ごとのメトリクスを、メトリクスの計算 `SUM` でまとめる） | 1時間に3件以上 | 30日間0件。関数ごとにアラームを作らず、1つのアラームにまとめる。ほかのスタックの Lambda のエラーは数えない |

- 欠けたデータ（リクエストがない時間）は、異常として扱いません（`notBreaching`）
- 通知はアラームの状態が「アラーム」になったときだけ送ります（戻ったときは送りません）

### AWS の操作

| 検知するもの | 仕組み | 除くもの |
|---|---|---|
| ルートでのログイン、MFA なしのログイン（失敗も含む） | CloudTrail → CloudWatch Logs のメトリクスフィルター → アラーム `SuspiciousConsoleLoginAlarm`（5分に1件以上） | なし |
| IAM の変更（ユーザー、アクセスキー、パスワード、MFA、ポリシー、ロール、ID プロバイダー。名前が Create・Delete・Update・Put・Attach・Detach・Add・Remove・Set・Enable・Deactivate・Upload・Change・Resync で始まる操作） | us-east-1 の EventBridge → 東京の既定のイベントバス → `IamChangeRule` | CDK のデプロイ |
| Cognito の変更（名前が Admin・Create・Update・Delete・Set・Add・Start・Complete で始まる操作と、SignUp・ChangePassword・ConfirmForgotPassword）。パスキーの登録と削除（`StartWebAuthnRegistration`・`CompleteWebAuthnRegistration`・`DeleteWebAuthnCredential`）と、マネージドログインの画面からのパスキーの登録（`passkeys_add_POST`）を含む | 東京の EventBridge `CognitoChangeRule` | CDK のデプロイ |
| CloudTrail の停止・削除・変更（StopLogging、DeleteTrail、UpdateTrail、PutEventSelectors） | 東京の EventBridge `CloudTrailTamperRule` | なし（CDK のデプロイでも通知する） |

- **ログインをアラームで見る理由**：`ConsoleLogin` が記録されるリージョンは、利用者の種類と入口で変わります。ルートは us-east-1・us-east-2・us-west-2 のどれか、IAM ユーザーは us-east-1・us-east-2・eu-north-1・ap-southeast-2 のどれか、リージョンの入口を使えばそのリージョンです（[AWS Management Console sign-in events](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-aws-console-sign-in-events.html)）。このアカウントでも、直近のログインは5つのリージョンに記録されていました。EventBridge のルールはリージョンごとに要るので、すべてのリージョンを1つのロググループに集める証跡で数えます
- **IAM を us-east-1 から転送する理由**：IAM はグローバルなサービスで、操作は us-east-1 にだけ記録され、us-east-1 の EventBridge にだけ届きます。送り先を東京の1つのトピックにまとめ、メールの購読を1回で済ませるために、東京のイベントバスに転送します
- **CDK のデプロイを除く方法**：CloudFormation が使うロール `cdk-hnb659fds-cfn-exec-role-*` による操作を、`userIdentity.sessionContext.sessionIssuer.userName` の前方一致（`anything-but`）で除きます。`anything-but` は項目がない（IAM ユーザーやルートの操作）と一致しないので、`exists: false` と `$or` でつなぎます。その名前のロールを新しく作る操作は通知されるので、同じ名前で紛れ込むことはできません
- **マネージドログインでのパスキーの登録**：画面（`/passkeys/add`）からの登録は API の呼び出しではなく、エンドポイントへのリクエストとして CloudTrail に記録されます（`eventType` が `AwsServiceEvent`、`eventName` が `passkeys_add_POST`。このアカウントの記録でも確かめた）。EventBridge には detail-type `AWS Service Event via CloudTrail` で届くはずなので、ルールに両方の detail-type を入れています。届くかはデプロイのあとに試して確かめます（下の「デプロイと、メールの購読の足し方」の手順4）
- 読むだけの操作（`AdminGetUser`、`ListWebAuthnCredentials` など）は、前方一致に当たっても、EventBridge の既定の状態（`ENABLED`）のルールには届かないので、通知されません
- 通知の中身は CloudTrail のイベントそのもの（JSON）です。パスワードは CloudTrail が伏せて記録します

### CloudTrail の証跡

- 管理イベント（読み取りと書き込み）だけを、すべてのリージョンから記録します。IAM などのグローバルなサービスも含みます
- 置き場所は S3 のバケット（スタックを消しても残す）です。公開をすべて止め、SSE-S3 で暗号化し、TLS を必須にし、バージョニングを有効にしています。この証跡以外からの書き込みは拒否します
- ログは1年で消えます（イベント履歴で90日は見られるので、それより長く残す）。上書き・削除されたものは30日で消えます
- ログファイルの検証を有効にしています。改ざんを確かめるには `aws cloudtrail validate-logs --trail-arn <証跡の ARN> --start-time <時刻>` を使います
- CloudWatch Logs のロググループ（`CognitoStudyMonitoring-TrailLogGroup...`）にも送り、30日残します

## 通知が来たときに見るもの

| 通知 | 見るもの |
|---|---|
| API のアラーム（Requests・ClientErrors・Throttled・TokenFailures） | アクセスログ `CognitoStudy-AuthzApiAccessLogs...`、`CognitoStudy-MealsApiAccessLogs...`、`CognitoStudy-AppApiAccessLogs...` |
| ServerErrors・LambdaErrors | Lambda のログ `/aws/lambda/CognitoStudy-AuthzFunction...`、`/aws/lambda/CognitoStudy-MealsFunction...`（MCP サーバー）、`/aws/lambda/CognitoStudy-AppApiFunction...`（アプリ用の API） |
| SuspiciousConsoleLogin | 証跡のロググループ、または CloudTrail のイベント履歴（記録されたリージョンで開く） |
| IAM・Cognito・CloudTrail の操作 | メールの JSON の `userIdentity`、`sourceIPAddress`、`eventName`。続けて証跡のロググループで、同じ人の前後の操作を見る |

Logs Insights のクエリの例です（CloudWatch → Logs Insights で、ロググループを選んで実行します）。

送信元 IP と path ごとの 4xx（アクセスログを3つとも選ぶ）：

```
fields @timestamp, sourceIp, method, path, status, userAgent
| filter status like /^4/
| stats count(*) as n by sourceIp, path, status
| sort n desc
| limit 50
```

どの API で増えたか（アクセスログを3つとも選ぶ）：

```
stats count(*) as n by @log, bin(10m)
| sort n desc
```

`/token` の失敗（認可API のアクセスログ）：

```
fields @timestamp, sourceIp, userAgent, status
| filter path = "/token" and status like /^4/
| sort @timestamp desc
```

Lambda のエラー（Lambda のロググループ）：

```
fields @timestamp, @message
| filter @message like /(?i)(error|exception|traceback|timed out)/
| sort @timestamp desc
| limit 50
```

ログイン（証跡のロググループ）：

```
fields eventTime, awsRegion, userIdentity.type, userIdentity.arn, sourceIPAddress,
  responseElements.ConsoleLogin, additionalEventData.MFAUsed
| filter eventName = "ConsoleLogin"
| sort eventTime desc
```

ある送信元 IP やアクセスキーでの操作（証跡のロググループ）：

```
fields eventTime, awsRegion, eventSource, eventName, userIdentity.arn, errorCode
| filter sourceIPAddress = "192.0.2.1" or userIdentity.accessKeyId = "AKIA..."
| sort eventTime desc
```

## デプロイと、メールの購読の足し方

1. us-east-1 を CDK の bootstrap をする（1回だけ。東京は済んでいる）

   ```sh
   cd cdk && npx cdk bootstrap aws://<アカウント ID>/us-east-1
   ```

2. デプロイする（`CognitoStudy` が先で、監視のスタックはそのあとに作られる）

   ```sh
   ./build-lambda.sh && npx cdk deploy --all
   ```

3. メールの購読を足す（メールアドレスはコードに書かない）
   1. 東京リージョンの SNS のコンソールで、トピック `cognito-study-alerts` を開く
   2. 「サブスクリプションの作成」を押し、プロトコルに「E メール」、エンドポイントに受け取るメールアドレスを入れて作成する
   3. 届いた「AWS Notification - Subscription Confirmation」のメールの「Confirm subscription」のリンクを押す
   4. サブスクリプションの状態が「確認済み」になったことを確かめる
4. 届くかを確かめる（どれも1通ずつ届く）
   - アラーム：`aws cloudwatch set-alarm-state --region ap-northeast-1 --alarm-name <RequestsAlarm の名前> --state-value ALARM --state-reason test`（次の評価で元に戻る）
   - IAM の転送：何も付けないポリシーを作って消す（`aws iam create-policy --policy-name monitoring-test --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Deny","Action":"none:none","Resource":"*"}]}'` のあと `aws iam delete-policy --policy-arn <ARN>`）。2通届く
   - マネージドログインでのパスキーの登録：パスキーを作る手順（[design.md](design.md#パスキーを作る手順)）で、パスキーを足したときに `passkeys_add_POST` の通知が届くかを見る。届かなければ、EventBridge にはこのイベントが来ていない。そのときは、証跡のロググループ（`TrailLogGroup`）にメトリクスフィルター（`{ $.eventName = "passkeys_add_POST" }`）を足して、アラームで知らせる。ただし、アラームのメトリクスは無料枠（10個）をすでに使い切っているので、アラームを1個足すと月 $0.10 かかる（または、`SuspiciousConsoleLoginAlarm` を、ログインとパスキーの登録をまとめた式にする。これも式の中のメトリクスの数で数えるので、1個増える）

初めてデプロイするときは、証跡を作る操作（PutEventSelectors など）で、CloudTrail のルールから通知が来ます。

## 費用の見込み

月に数十円ほどです（多くは S3 のリクエスト）。

| もの | 量 | 費用 |
|---|---|---|
| CloudWatch のアラーム | 7個。料金と無料枠はアラームの中のメトリクスの数で数え、`LambdaErrorsAlarm` は3つの関数の3個なので、合わせて9個（ほかに us-east-1 の請求のアラームが1個で、全部で10個） | 無料枠（標準の解像度のアラームのメトリクス10個）の中。**これ以上アラームやメトリクスを足すと、1個ごとに月 $0.10 かかる** |
| カスタムメトリクス（メトリクスフィルター） | 6個 | 無料枠（10個）の中 |
| CloudTrail の証跡 | 管理イベントの1つ目の写し | 無料 |
| CloudTrail → CloudWatch Logs | 管理イベントは1日 1,200件ほど（東京 1,070件、us-east-1 126件）。月 60MB ほど | 取り込みと保存は無料枠（5GB）の中。CloudTrail の配信の料金（$0.25/GB）が月 $0.02 ほど |
| S3 | 17のリージョンのダイジェスト（1時間ごと）とログのファイルで、PUT が月 2〜3万回。保存は1GB 未満 | PUT は $0.0047/1,000回で月 $0.10〜0.15。保存は $0.025/GB |
| EventBridge | AWS の管理イベント | 無料。東京への転送は、カスタムイベント（100万件で $1）として数えるが、月に数件 |
| SNS | 通知は月に数件 | 無料枠（発行100万件、メール1,000通）の中 |

出典：[CloudWatch の料金](https://aws.amazon.com/cloudwatch/pricing/)、[CloudTrail の料金](https://aws.amazon.com/cloudtrail/pricing/)、[EventBridge の料金](https://aws.amazon.com/eventbridge/pricing/)、[SNS の FAQ](https://aws.amazon.com/sns/faqs/)、[S3 の料金](https://aws.amazon.com/s3/pricing/)。東京の単価は AWS Price List API で確かめました（2026-11-08）。

API が増えても、アラームとカスタムメトリクスの数は増えません（同じメトリクスに足し込むため）。

## 片付け

```sh
cd cdk && npx cdk destroy CognitoStudyMonitoring CognitoStudyMonitoringGlobal
```

証跡のバケットは残るので、要らなければ中身を消してからコンソールで消します。`CognitoStudy` の SSM パラメータ（`/cognito-study-monitoring/*`）は、監視のスタックがなくても害はありません。
