# 監視

怪しいアクセスや異常を検知して、SNS のトピック `cognito-study-alerts`（東京）からメールで知らせます。
構成は `cdk/lib/monitoring-stack.ts` にあり、スタックは次の2つです。

| スタック | リージョン | 中身 |
|---|---|---|
| `CognitoStudyMonitoring` | ap-northeast-1 | SNS のトピック、CloudWatch のアラーム9個、CloudTrail の証跡（S3 と CloudWatch Logs）、EventBridge のルール6個 |
| `CognitoStudyMonitoringGlobal` | us-east-1 | IAM の操作を東京の既定のイベントバスに転送するルール |

`CognitoStudy` とは、SSM パラメータの名前（アクセスログのロググループ名 `/cognito-study-monitoring/<API>/access-log-group`、Lambda の関数名 `/cognito-study-monitoring/<関数>/function-name`、DynamoDB のテーブル名 `/cognito-study-monitoring/<テーブル>/table-name`、アプリ用の API の Lambda のロググループ名 `/cognito-study-monitoring/AppApiFunction/log-group`）だけでつないでいます。スタックをまたぐ Export は作りません。

## 何を検知するか

### API と Lambda（CloudWatch のアラーム）

しきい値は、2026-11-08 までの30日のアクセスログ（3つの API の合計。アプリ用の API はまだ使っていないので、数は認可API と MCP のもの）をもとに、本人1人の利用ではありえない量にしています。
スマホアプリ用の API（`AppApi`）のアクセスログも、同じメトリクスに合わせて数えます。アプリは開くたびに同期で数回から十数回送るので、使い始めたら `Requests` のしきい値を見直します。
どの API の数も、ディメンションのない1つのメトリクス（名前空間 `CognitoStudy/Monitoring`）に足し込みます。API ごとにアラームを作ると、アラームの無料枠（10個）を超えるためです。どの API で起きたかは、下の Logs Insights で見ます。

| アラーム | 数えるもの | しきい値 | 根拠 |
|---|---|---|---|
| `RequestsAlarm` | すべてのリクエスト（アクセスログ） | 1時間に300件以上 | これまでの最大は1時間32件、1日42件。300件は、多い日の7日分を1時間で使う量。費用の兆し |
| `ClientErrorsAlarm` | 4xx（アクセスログ） | 1時間に50件以上 | 普段はスキャンが月10件ほど。コネクタをつないだ日でも 401 は1日38件。スキャンや総当たりの兆し |
| `ServerErrorsAlarm` | 5xx（アクセスログ） | 1時間に3件以上 | 30日間0件。1件だけなら一時的な失敗のこともあるので、3件から |
| `ThrottledAlarm` | 429（流量の制限での拒否。認可API と MCP は1秒1回・瞬間5回、アプリ用の API は1秒2回・瞬間10回。アクセスログ） | 1時間に10件以上 | 30日間0件。Claude は接続のときに数回まとめて送るので、数件の 429 はありうる |
| `TokenFailuresAlarm` | 認可API の `/token` の 4xx（アクセスログ） | 1時間に10件以上 | これまでの最大は1時間1件。認可コードやリフレッシュトークンの総当たりの兆し |
| `LambdaErrorsAlarm` | このアプリの3つの Lambda（`AuthzFunction`・`MealsFunction`・`AppApiFunction`）の `Errors` の合計（`AWS/Lambda`。関数ごとのメトリクスを、メトリクスの計算 `SUM` でまとめる） | 1時間に3件以上 | 30日間0件。関数ごとにアラームを作らず、1つのアラームにまとめる。ほかのスタックの Lambda のエラーは数えない |

### DynamoDB とデータ（CloudWatch のアラーム）

| アラーム | 数えるもの | しきい値 | 根拠 |
|---|---|---|---|
| `DynamoDbWritesAlarm` | `MealsTable` と `StateTable` の `ConsumedWriteCapacityUnits` の合計（`AWS/DynamoDB`。メトリクスの計算 `SUM` でまとめる） | 1時間に 3,000 WCU 以上 | 2026-11-08 までの30日で、2つのテーブルの合計の最大は1時間886（11-08 の18時台。同期の仕組みへの移行の書き込み）、ほかの時間は206以下。普段の最大の10倍以上、移行の3倍ほど。盗まれたトークンで送信を続けると費用が膨らむ（Denial of Wallet）ので、その兆し。予算の通知は月の合計でしか知らせないので、1時間ごとに見る。3,000 WCU は $0.002 ほど（東京のオンデマンドの書き込みは100万で $0.715 ほど）。アプリで大きな取り込み（CSV など）をした時間には鳴ることがある。Health Connect の初めての取り込み（過去30日。体重計を毎日使って体重・体脂肪率・除脂肪体重で約90件、あとで足す睡眠と心拍の日のまとめを合わせて約120件）は、1件が数 WCU（変更の記録・印・状態）なので数百 WCU で、このしきい値より下の見込み |
| `BulkDeletesAlarm` | アプリ用の API の1回の送信で、消される「親」が10以上あった回数。親は種目（`workout_entry`）・食事（`meal`）・体組成の記録などで、親といっしょに消える子（セット `workout_set`・品目 `meal_item`）は親ごとに1つに数える（品目は `parent_id`、セットは保存してある `entry_id` でまとめる。親がわからない子はそれぞれを1つに数える）。Lambda（`AppApiFunction`）がログに `bulk_delete deletes=<親の数> delete_changes=<delete の件数> changes=<数>` を出し（`services/sync/sync/presentation/http_api.py` の `BULK_DELETE_THRESHOLD` と `_delete_groups`）、メトリクスフィルター `BulkDeletes` が数える | 1時間に1回以上 | アプリは種目を1つずつ消し（種目を外すと、その種目とセットの delete が1回の送信で届く）、1日の記録をまとめて消す機能はない。親が10以上になるのは、続けて保存したものをまとめる3秒のあいだや、つながらないあいだに10種目以上を消したときだけで、ふつうはない。1日に10種目以上を記録して全部消すことはありうるが、まれで、鳴っても1回の通知なので、しきい値は10のままにする（下げると見逃しが減るが、ふつうの操作で鳴りやすくなる）。9セット以上ある種目を外しただけで鳴っていたので、2026-11-08 に件数から親の数に変えた。データを壊す操作の兆し。ログには数だけを出す（利用者の ID と中身は出さない）。Health Connect で一度に10件以上の記録を消すと（体重計のアプリで記録をまとめて消した、など）、次の取り込みでその delete（`origin = import`）がまとめて送られて鳴る。そのときは、Health Connect で消したかどうかを本人に確かめる |

送信の本文は 64KB まで（超えると 413）にして、1回の送信で書ける量も抑えています（`MAX_PUSH_BYTES`）。品目50件のいつもの（名前が最大の200文字）でも、1件は 40KB ほどに収まります。

- 欠けたデータ（リクエストがない時間）は、異常として扱いません（`notBreaching`）
- 通知はアラームの状態が「アラーム」になったときだけ送ります（戻ったときは送りません）

### AWS の操作

| 検知するもの | 仕組み | 除くもの |
|---|---|---|
| ルートでのログイン、MFA なしのログイン（失敗も含む） | CloudTrail → CloudWatch Logs のメトリクスフィルター → アラーム `SuspiciousConsoleLoginAlarm`（5分に1件以上） | なし |
| IAM の変更（ユーザー、アクセスキー、パスワード、MFA、ポリシー、ロール、ID プロバイダー。名前が Create・Delete・Update・Put・Attach・Detach・Add・Remove・Set・Enable・Deactivate・Upload・Change・Resync で始まる操作） | us-east-1 の EventBridge → 東京の既定のイベントバス → `IamChangeRule` | CDK のデプロイ |
| Cognito の変更（名前が Admin・Create・Update・Delete・Set・Add・Start・Complete で始まる操作と、SignUp・ChangePassword・ConfirmForgotPassword）。パスキーの登録と削除（`StartWebAuthnRegistration`・`CompleteWebAuthnRegistration`・`DeleteWebAuthnCredential`）と、マネージドログインの画面からのパスキーの登録（`passkeys_add_POST`）を含む | 東京の EventBridge `CognitoChangeRule` | CDK のデプロイ |
| CloudTrail の停止・削除・変更（StopLogging、DeleteTrail、UpdateTrail、PutEventSelectors） | 東京の EventBridge `CloudTrailTamperRule` | なし（CDK のデプロイでも通知する） |
| 自分のスタック以外への CloudFormation の変更（名前が Create・Update・Delete・Execute・Set・Import・Continue・Cancel・Rollback・Signal・Activate・Deactivate・Register・Deregister・Publish で始まる操作） | 東京の EventBridge `CloudFormationChangeRule` | `stackName` が `CognitoStudy`・`CognitoStudyMonitoring`・`CognitoStudyMonitoringGlobal`・`CDKToolkit` のもの。CDK のデプロイのロールによる、`stackName` のない操作 |
| 監視の改ざん（アラームの削除と通知の無効化 `DeleteAlarms`・`DisableAlarmActions`、EventBridge のルールの削除・無効化・送り先の取り外し `DeleteRule`・`DisableRule`・`RemoveTargets`、SNS のトピックと購読の削除 `DeleteTopic`・`Unsubscribe`、アラームのもとになるメトリクスフィルターの削除 `DeleteMetricFilter`） | 東京の EventBridge `MonitoringTamperRule` | CDK のデプロイ |
| データを壊す操作（DynamoDB の `DeleteTable`、削除の保護を外す `UpdateTable`、ポイントインタイムリカバリを外す `UpdateContinuousBackups`、Cognito の `DeleteUserPool`、削除の保護を外す `UpdateUserPool`） | 東京の EventBridge `DataDestructionRule` | なし（CDK のデプロイでも通知する） |

- **ログインをアラームで見る理由**：`ConsoleLogin` が記録されるリージョンは、利用者の種類と入口で変わります。ルートは us-east-1・us-east-2・us-west-2 のどれか、IAM ユーザーは us-east-1・us-east-2・eu-north-1・ap-southeast-2 のどれか、リージョンの入口を使えばそのリージョンです（[AWS Management Console sign-in events](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-aws-console-sign-in-events.html)）。このアカウントでも、直近のログインは5つのリージョンに記録されていました。EventBridge のルールはリージョンごとに要るので、すべてのリージョンを1つのロググループに集める証跡で数えます
- **IAM を us-east-1 から転送する理由**：IAM はグローバルなサービスで、操作は us-east-1 にだけ記録され、us-east-1 の EventBridge にだけ届きます。送り先を東京の1つのトピックにまとめ、メールの購読を1回で済ませるために、東京のイベントバスに転送します
- **CDK のデプロイを除く方法**：CloudFormation が使うロール `cdk-hnb659fds-cfn-exec-role-*` による操作を、`userIdentity.sessionContext.sessionIssuer.userName` の前方一致（`anything-but`）で除きます。`anything-but` は項目がない（IAM ユーザーやルートの操作）と一致しないので、`exists: false` と `$or` でつなぎます。その名前のロールを新しく作る操作は通知されるので、同じ名前で紛れ込むことはできません
- **マネージドログインでのパスキーの登録**：画面（`/passkeys/add`）からの登録は API の呼び出しではなく、エンドポイントへのリクエストとして CloudTrail に記録されます（`eventType` が `AwsServiceEvent`、`eventName` が `passkeys_add_POST`。このアカウントの記録でも確かめた）。EventBridge には detail-type `AWS Service Event via CloudTrail` で届くはずなので、ルールに両方の detail-type を入れています。届くかはデプロイのあとに試して確かめます（下の「デプロイと、メールの購読の足し方」の手順4）
- **自分のスタックを名前で並べる理由**：前方一致（`CognitoStudy*`）にすると、`CognitoStudyEvil` のような名前のスタックで紛れ込めるためです。スタックを足したら `OWN_STACK_NAMES`（`cdk/lib/monitoring-stack.ts`）に足します。`stackName` が ARN の形のときは、自分のスタックでも通知します（CDK は名前で呼びます）
- **CDK のデプロイの `CreateChangeSet` を除く方法**：CDK のデプロイと `cdk diff` の `CreateChangeSet` は、CloudTrail に `requestParameters` が記録されません（テンプレートが大きいため。このアカウントの記録で確かめました）。`stackName` のない操作（スタックセットや拡張の登録など）も通知したいので、`stackName` がなく、かつ CDK のデプロイのロール `cdk-hnb659fds-deploy-role-*` によるものだけを除きます。そのあとの `ExecuteChangeSet` には `stackName` があるので、ほかのスタックへのデプロイはそこで通知されます
- **データを壊す操作を CDK のデプロイでも通知する理由**：テーブルとユーザープールは RETAIN で、CDK のデプロイが消したり保護を外したりすることはありません。CDK のデプロイの `UpdateTable`・`UpdateContinuousBackups`・`UpdateUserPool` は保護を有効のまま送るので、一致しません（このアカウントの記録で確かめました）。Cognito の `DeleteUserPool` は `CognitoChangeRule` にも当たるので、CDK のデプロイ以外では2通届きます
- **パターンの確かめ方**：合成したテンプレートのパターンを、`aws events test-event-pattern` で、CDK のデプロイの操作（除く）とほかの操作（通知する）の例に当てて確かめました（2026-11-08）
- **見ていないもの**：CloudFormation・監視の改ざん・データを壊す操作のルールは東京だけです。ほかのリージョンでの操作は通知されません（証跡には残ります）。また、ルールを消したり無効にしたりする操作は、そのルール自身では通知されません（CloudTrail のイベントが届く前にルールがなくなるため）。`MonitoringTamperRule` が消されたときは通知が来ないので、ほかのルールは `MonitoringTamperRule` が、`MonitoringTamperRule` は証跡で見ます
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
| ServerErrors・LambdaErrors | Lambda のログ `/aws/lambda/CognitoStudy-AuthzFunction...`、`/aws/lambda/CognitoStudy-MealsFunction...`（MCP サーバー）、`/aws/lambda/CognitoStudy-AppApiFunction...`（アプリ用の API）。90日残す |
| DynamoDbWrites | アプリ用の API のアクセスログ `CognitoStudy-AppApiAccessLogs...` で、`POST /v1/sync/changes` の送信元 IP と回数。MCP のアクセスログも見る。トークンが盗まれていそうなら、下の「データを壊されたときの戻し方」の手順1でトークンを止める |
| BulkDeletes | Lambda のログ `/aws/lambda/CognitoStudy-AppApiFunction...` の `bulk_delete` と、同じ時刻のアクセスログの送信元 IP。本人の操作でなければ、下の「データを壊されたときの戻し方」 |
| SuspiciousConsoleLogin | 証跡のロググループ、または CloudTrail のイベント履歴（記録されたリージョンで開く） |
| IAM・Cognito・CloudTrail・CloudFormation・監視の改ざん・データを壊す操作 | メールの JSON の `userIdentity`、`sourceIPAddress`、`eventName`。続けて証跡のロググループで、同じ人の前後の操作を見る |

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

delete の多い送信（アプリ用の API の Lambda のロググループ）：

```
fields @timestamp, @message
| filter @message like /bulk_delete/
| sort @timestamp desc
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

## データを壊されたときの戻し方

同期の項目（`SYNC#`）は、消しても項目が残ります（`delete` は「消えた」の印を付けるだけで、値は残る）。変更の記録（`SYNC#LOG#`）も追記だけで、アプリ用の API と MCP の Lambda には、消す・書き換える権限（`DeleteItem`・`UpdateItem`）がありません。
そのため、アプリや MCP から壊されたものは、変更の記録から戻せます。変更の記録ごと壊された（管理者の資格情報が盗まれた）ときは、ポイントインタイムリカバリ（35日前まで）から戻します。

### 1. 止める

1. トークンを止める。リフレッシュトークンが無効になり、新しいアクセストークンは出なくなる（今のアクセストークンは期限が来るまで使える）

   ```sh
   aws cognito-idp admin-user-global-sign-out --profile yuki --region ap-northeast-1 \
     --user-pool-id <UserPoolId> --username <ユーザー名>
   ```

2. 壊され始めた時刻を調べる。上の「delete の多い送信」のクエリで `bulk_delete` の時刻を、アクセスログで送信元 IP を見る。Lambda のログには利用者の ID が出ないので、対象の利用者（sub）は Cognito で調べる

### 2. 変更の記録から戻す（消されたもの）

消されたもの（`delete`）は、`restore` の変更を足せば戻ります。消した変更の端末（`device_id`）が分かれば、それで絞ります。
管理者の資格情報で、`services/app_api` で動かします（Lambda には載せない）。`APPLY = False` のまま動かして件数を確かめ、合っていれば `True` にして動かします。

```sh
cd services/app_api
AWS_PROFILE=yuki AWS_REGION=ap-northeast-1 MEALS_TABLE=<MealsTable の名前> PYTHONPATH=../composition uv run python - <<'EOF'
import os, uuid
from composition.registry import create_registry
from sync.engine import SyncEngine
from sync.model import Change, utc_now
from sync.store import DynamoDBSyncStore

USER = "<利用者の sub>"
SINCE = "2026-11-08T09:00:00.000Z"  # 壊され始めた時刻（UTC）。bulk_delete のログの時刻より少し前にする
DEVICE = None  # 消した端末の device_id が分かれば入れる（None なら端末で絞らない）
APPLY = False

registry = create_registry()
engine = SyncEngine(DynamoDBSyncStore(os.environ["MEALS_TABLE"], registry.index_key), registry)
deleted, after, more = {}, 0, True
while more:
    entries, after, more = engine.pull(USER, after, 500, set(registry.specs))
    for e in entries:
        c = e.change
        if c.op == "delete" and c.received_at >= SINCE and DEVICE in (None, c.device_id):
            deleted[(c.entity_type, c.entity_id)] = c
print(f"{len(deleted)} 件の delete")
if APPLY:
    now = utc_now()
    engine.append(USER, [Change(str(uuid.uuid4()), c.entity_type, c.entity_id, c.parent_id, "restore", None, now, "mcp")
                         for c in deleted.values()])
    print("restore を書いた")
EOF
```

- `restore` は消したときより新しい時刻なので、消したものが戻ります（`docs/sync-design.md` の「今の状態への当てはめ」）。変更として記録されるので、端末にも次の同期で届きます
- 値を書き換えられたもの（`update`）は、変更の記録の `state`（当てはめたあとの状態）で、壊される前の値が分かります。同じように、その値の `update` の変更を足して戻します
- 項目を直接書き換えない（端末はカーソルで変更を受け取るので、変更の記録にないものは届かない）

### 3. ポイントインタイムリカバリから戻す（変更の記録ごと壊されたとき）

1. 壊される前の時刻で、別のテーブルに戻す（もとのテーブルは変わらない）

   ```sh
   aws dynamodb restore-table-to-point-in-time --profile yuki --region ap-northeast-1 \
     --source-table-name <MealsTable の名前> --target-table-name <MealsTable の名前>-restored \
     --restore-date-time 2026-11-08T09:00:00Z
   ```

   戻したテーブルには、ポイントインタイムリカバリと削除の保護が付きません。中身を見るだけに使い、終わったら消す
2. 戻したテーブルの `pk = EATER#<sub>` の `SYNC#STATE#` を読み、今のテーブルと比べる
3. 違うものを、上の手順2と同じやり方で、`restore`・`update` の変更として今のテーブルに書く（テーブルを差し替えない。テーブル名は CDK が決めていて、差し替えると端末のカーソルも合わなくなるため）
4. 戻したテーブルを消す（`aws dynamodb delete-table`。`DataDestructionRule` から通知が来る）

`StateTable`（ログイン途中の状態とリフレッシュトークンの系列）は戻しません。消えても、ログインし直せば作り直されます。

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

月に数十円ほどです（多くは S3 のリクエストと、無料枠を超えたアラーム）。

| もの | 量 | 費用 |
|---|---|---|
| CloudWatch のアラーム | 9個。料金と無料枠はアラームの中のメトリクスの数で数え、`LambdaErrorsAlarm` は3つの関数の3個、`DynamoDbWritesAlarm` は2つのテーブルの2個なので、合わせて12個（ほかに us-east-1 の請求のアラームが1個で、全部で13個） | 無料枠（標準の解像度のアラームのメトリクス10個）を3個超えるので、月 $0.30。アラームやメトリクスを足すと、1個ごとに月 $0.10 かかる |
| カスタムメトリクス（メトリクスフィルター） | 7個 | 無料枠（10個）の中 |
| CloudTrail の証跡 | 管理イベントの1つ目の写し | 無料 |
| CloudTrail → CloudWatch Logs | 管理イベントは1日 1,200件ほど（東京 1,070件、us-east-1 126件）。月 60MB ほど | 取り込みと保存は無料枠（5GB）の中。CloudTrail の配信の料金（$0.25/GB）が月 $0.02 ほど |
| S3 | 17のリージョンのダイジェスト（1時間ごと）とログのファイルで、PUT が月 2〜3万回。保存は1GB 未満 | PUT は $0.0047/1,000回で月 $0.10〜0.15。保存は $0.025/GB |
| EventBridge | AWS の管理イベント（ルール6個） | 無料。東京への転送は、カスタムイベント（100万件で $1）として数えるが、月に数件 |
| SNS | 通知は月に数件 | 無料枠（発行100万件、メール1,000通）の中 |

出典：[CloudWatch の料金](https://aws.amazon.com/cloudwatch/pricing/)、[CloudTrail の料金](https://aws.amazon.com/cloudtrail/pricing/)、[EventBridge の料金](https://aws.amazon.com/eventbridge/pricing/)、[SNS の FAQ](https://aws.amazon.com/sns/faqs/)、[S3 の料金](https://aws.amazon.com/s3/pricing/)。東京の単価は AWS Price List API で確かめました（2026-11-08）。

API が増えても、アラームとカスタムメトリクスの数は増えません（同じメトリクスに足し込むため）。

## 片付け

```sh
cd cdk && npx cdk destroy CognitoStudyMonitoring CognitoStudyMonitoringGlobal
```

証跡のバケットは残るので、要らなければ中身を消してからコンソールで消します。`CognitoStudy` の SSM パラメータ（`/cognito-study-monitoring/*`）は、監視のスタックがなくても害はありません。
