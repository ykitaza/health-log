# 全体の設計

食事記録そのもの（ドメイン、ツール、目標の計算）の設計は [meals-design.md](meals-design.md)、ログインからツールの呼び出しまでの流れは [シーケンス図](sequence.md) にあります。
スマホアプリ（hlog）とサーバーの同期は [sync-design.md](sync-design.md)、アプリ用の API の仕様は [api/app-api.yaml](api/app-api.yaml)（OpenAPI）にあります。

## 背景

食生活を見直そうと思い、まずは記録から始めることにしました。
ただ、そのために食事記録のアプリを新しく入れるのは気が進まず、有料のものも多くあります。
普段から使っている Claude や ChatGPT なら、写真から料理と量を推定できます。
そこで、推定は AI に任せ、記録と集計だけをサーバーが受け持つ形にしました。サーバーは AI を呼ばないので、AI の利用料はかかりません。かかるのは Lambda・DynamoDB・API Gateway の従量課金だけです。
その後、筋トレと体組成をスマホでも記録したくなり、アプリ（hlog）を足しました。

もう1つの目的は、MCP の認可（OAuth 2.1、CIMD、PKCE、リフレッシュトークン）を理解することです。
ログイン画面は Cognito に任せ、その前に認可API を置いています。
OAuth の中心（認可コード、PKCE、リフレッシュトークン、失効、JWT のアクセストークン）は保守されているライブラリ（Authlib）に任せ、
Authlib にない CIMD と RFC 8707（resource）、同意画面を自分で書いています。

## 制限

- 本人だけで使う前提です。ログイン画面からの新規登録はできません
- 栄養の値は AI の推定なので、だいたいの目安として使ってください
- `tools/inspector/` の CIMD の文書は localhost にあるので、Lambda の認可API からは取りに行けません（MCP Inspector で試せるのは PC で動かすときだけです。[開発・テスト](development.md#pc-で動かす)）

## なぜ Cognito の前に認可API を置くのか

MCP の仕様は、クライアント（Claude・ChatGPT）を事前登録せずに使える OAuth を求めています。Cognito だけを認可サーバーにすると、次の点が足りません。

- client_id に URL を使い、そこからクライアント情報を取る方式（CIMD）
- トークンの宛先を MCP サーバーに限る `resource` パラメータ（RFC 8707）
- 認可サーバーの情報を返す `/.well-known/oauth-authorization-server`（RFC 8414）

そのため、本人確認（ログイン画面）だけを Cognito に任せ、どのクライアントに何を許すかは認可API が決めます。

## 境界づけられたコンテキスト

```
本人確認（Cognito）──IDトークン──► 認可（services/authorization/）──アクセストークン──► MCP の組み立て（services/mcp/）──► 食事記録・筋トレのツール
        │
        └──アクセストークン（アプリ用のクライアント）──► アプリ用の API の組み立て（services/app_api/）──► 同期の入口（services/sync/）──► 食事記録・筋トレの種類
```

| コンテキスト・部品 | 扱う問い・役割 | 担当 | 依存する先 |
|---|---|---|---|
| 本人確認 | この人は誰か | 外部のシステム（Cognito） | なし |
| 認可 | どのクライアントに、誰の、何を許したか | `services/authorization/` | なし（Cognito とは OIDC だけでつなぐ） |
| 食事記録 | この人は何を食べ、目標とどれだけ違うか | `services/meals/`（MCP のツールは `meals/presentation/mcp_server.py`） | 同期 |
| 筋トレ | この人は何をどれだけ挙げ、体はどう変わったか | `services/training/`（MCP のツールは `training/presentation/mcp_tools.py`） | 同期 |
| レポート | AI が記録を読んで書いたまとめを、どう残してアプリで読むか | `services/reports/`（MCP のツールは `reports/presentation/mcp_tools.py`） | 同期 |
| 同期 | 変更をどう記録し、端末とサーバーで同じ状態にするか | `services/sync/`。どのコンテキストにも属さない共通の部品（変更の記録、当てはめ、冪等、カーソル、DynamoDB への保存、同期の API の入口） | なし |
| アプリ用の API の組み立て | アプリ用の Lambda（`AppApiFunction`）に、何を載せるか | `services/app_api/main.py` | 食事記録、筋トレ、レポート、同期 |
| MCP サーバーの組み立て | MCP の Lambda（`MealsFunction`）に、何を載せるか。MCP の入口の部品（トークンの検証、`logout`） | `services/mcp/` | 食事記録、筋トレ、レポート、同期 |

依存の向きは、組み立て → コンテキスト → 同期 です。逆向きの import はありません。

- 同期は、食事や筋トレのドメインを import しません。対象の種類ごとの決まり（項目、確かめ方、親の種類、並びのキー）は、各コンテキストが `infrastructure/sync_entities.py` で同期の `Registry` に登録します
- 食事・筋トレ・レポートは、互いを import しません。レポートは記録の数字を読まず、AI が記録のツールで読んで書いたものを保存するだけです。またぐもの（筋トレの日、アプリの最後の同期の時刻）は、使う側のポートを組み立てがつなぎます（下の「MCP サーバーの組み立て」）
- 食事の MCP が変更の記録を通して書く処理は、食事の `meals/infrastructure/sync_repositories.py` に、筋トレの分は `training/infrastructure/sync_repository.py` にあります（同期の部品を使う）
- 食事・筋トレ・レポート・同期を組み合わせるのは、2つの組み立て（`services/app_api/main.py`、`services/mcp/main.py`）だけです
- 筋トレの計算（推定1RM、負荷量、週ごとの集計、体組成）は、アプリ（`apps/mobile/lib/`）と同じ結果になるようにし、入力と期待する結果を `testdata/training/*.json` に置いて、pytest とアプリの jest の両方で確かめます

- 本人確認 → 認可：`services/authorization/infrastructure/cognito_login.py`（腐敗防止層、Authlib）が IDトークンを `Subject` に変えます
- 認可 → MCP の入口：受け渡すのはアクセストークン（JWT）だけです。MCP の入口（`services/mcp/connector/access_token_verifier.py`）は、認可API の iss と JWKS を手で設定して信じます
- 本人確認 → アプリ用の API：アプリは認可API を通さず、Cognito のアクセストークンをそのまま使います（下の「スマホアプリ（hlog）のログイン」）
- scope はリソースサーバーごとに持ちます（MCP サーバーは `meals:read`・`meals:write`・`training:read`・`training:write`、アプリ用の API は `torelog-api/meals.read` など）
- MCP は各コンテキストを外に出す通信の形式なので、ツールは各コンテキストの `presentation/` に置き、1つのサーバーへの組み立ては `services/mcp/` で行います（下の「MCP サーバーの組み立て」）

## MCP サーバーの組み立て

Claude・ChatGPT のコネクタは1つ（URL は `MealsMcpServerUrl` のまま）で、食事・筋トレ・レポートのツールを持ちます。

| 場所 | 中身 | 知っているもの |
|---|---|---|
| `services/meals/meals/presentation/mcp_server.py` | 食事のツール17個を登録する関数（`register_meal_tools`） | 食事 |
| `services/training/training/presentation/mcp_tools.py` | 筋トレのツール22個（睡眠・心拍・歩数のまとめ、ケガの記録、フェーズを読む list_phases を含む）を登録する関数（`register_training_tools`）。scope をツールごとに確かめる | 筋トレ |
| `services/reports/reports/presentation/mcp_tools.py` | レポートのツール4個を登録する関数（`register_report_tools`）。筋トレの scope をツールごとに確かめる（筋トレと食事の両方をまとめるので、接続の食事の scope と合わせて両方が要る） | レポート |
| `services/mcp/connector/` | MCP の入口の部品：アクセストークンの検証（`AuthzApiTokenVerifier`）、連携の取り消しと `logout` のツール、アイコン、診断用のログ、設定。期間の材料を1回で読む `period_overview`（筋トレ・食事・設定をまたぐので、組み立ての場所に置く。中身は各コンテキストのユースケースと出力の形を使う） | MCP の SDK、認可API との約束（JWT）、食事・筋トレのユースケース |
| `services/mcp/main.py` | サーバー（`MCPServer`）と認証を作り、3つの登録の関数を呼ぶ。コンテキストをまたぐもののポートをつなぐ | すべて |

- 食事と筋トレは互いを import しません。またぐものは、使う側のコンテキストがポート（インターフェース）を持ち、`services/mcp/main.py` がつなぎます
  - **筋トレの日**：食事のポート `TrainingDayProvider`（`services/meals/meals/domain/ports.py`）。本人が `set_day_type` で決めた日はそれを、決めていない日は、その日に筋トレのセットの記録があれば筋トレの日にします。実装（`WorkoutTrainingDays`）は筋トレの読み取りのユースケースを呼びます
  - **体重**：食事のポート `WeightRepository`（`services/meals/meals/domain/ports.py`）。体重は筋トレの体組成（`body_record`）に一本化していて、食事は保存しません。実装（`BodyRecordWeights`）は、`record_weight` を体組成の手入力（`record_body` と同じく、その日の手入力の記録の体重を書き換え、なければ作る）に、`goal_progress` の体重の推移を体組成の日ごとの値（その日の手入力のいちばん新しい記録。手入力がない日は Health Connect の取り込みのいちばん新しい記録。`body_progress` と同じ）に変えます。`record_weight`・`goal_progress` は食事のツールなので、scope も食事の2つのままです
  - **アプリの最後の同期の時刻**：食事と筋トレの `presentation` の `AppSyncStatus`。同期の仕組みが、アプリ（`app`・`import`）からの変更を受け付けたときの時刻を `SYNC#APP` に残し、ツールの応答の `last_app_sync_at`（日本時間）に出します。それより後にアプリで記録した分は、まだ見えていない可能性があることを、AI が伝えられるようにするためです
- **認証の部品を `services/mcp/connector/` に置いた理由**：アクセストークンの検証・ログアウト・アイコンは、どのコンテキストのドメインでもなく、Claude・ChatGPT とつなぐ入口の話です。食事に置いたままだと、筋トレのツールが食事のコードに頼ることになります。使うのは MCP の組み立てだけなので、共通の部品（`services/sync` のようなパッケージ）にはせず、組み立ての場所に置きました
- **scope**：接続（HTTP）のところで必須にするのは、食事の2つ（今までどおり、SDK が足りなければ 403）。筋トレの2つは、筋トレのツールが1つずつ確かめ、なければ「つなぎ直してください」と返します。接続で4つとも必須にすると、筋トレの scope を持たない今のコネクタが、食事のツールまで使えなくなるためです。RFC 9728 の文書（`/.well-known/oauth-protected-resource/mcp`）の `scopes_supported` には4つとも並べ、つなぎ直すと筋トレの scope も求められるようにしています（SDK は必須の scope をそのまま `scopes_supported` にするので、この文書のルートだけ、SDK の同じ関数で作って先に置きます）
- **今日の筋トレと食事をまとめるツール（`today_overview`）は置きません**：どちらのコンテキストにも属さず、置くなら組み立ての場所にツールの中身を書くことになるためです（組み立ての場所は、つなぐだけにしています）。食事の目標に筋トレの日を反映する部分は、上のポートで `today_status` に入っており、AI は `today_status` と `get_workout` を続けて呼べばまとめて見せられます
- **種目の名前**：名前の完全一致（全角半角・大文字小文字・空白は同じに扱う）か ID でだけ選びます。「ベンチ」のような略した名前は、候補（「ベンチプレス」など）を添えて断り、AI に選び直させます（違う種目を推測で選んで記録が混ざるのを防ぐため）
- **種目の変更（`update_exercise`）**：名前・部位を変える、隠す（`hidden`）・表示に戻すを1つのツールで行います。記録（`workout_entry`）は種目の ID でつながっているので、過去の記録・推移・週のふり返りも新しい名前と部位で出ます。同じ部位に同じ名前は断ります（`add_exercise` と同じく、比べる形で）。部位を変えたら、新しい部位の最後に並べます。種目を消すツールは作りません（過去の記録を残すため、代わりに隠す）。記録のしかた（`record_type`）は、今のセットと合わなくなるので変えられません
  - 初期の種目で、同期にまだ届いていないもの（アプリが送っていない）は、変えた項目だけを `update` で送ります。変えていない項目まで今の時刻で書くと、アプリがまだ送っていない変更（例：隠した）に、項目ごとの当てはめで勝ってしまうためです
  - アプリでは、種目と部位の管理の画面で種目を押すと、編集の画面（`apps/mobile/app/exercises/[id].tsx`：名前・部位・選択に表示するか）が開きます。部位の名前は、管理の画面の部位の名前の横の鉛筆から変えます
- **自重の種目の負荷量**：回数だけ（`reps_only`）の種目も総負荷量に入れます。セットごとに、その日の体重 × 種目の割合（`exercise.bodyweight_ratio`、0〜1）× 回数です（`training/domain/bodyweight.py`、アプリは `apps/mobile/lib/bodyweight.ts`。`testdata/training/bodyweight.json` で両方を確かめる）
  - 体重は体組成の日ごとの値（手入力を先に、なければ Health Connect の取り込み）。その日になければ、その前のいちばん近い日（30日以内）。それもなければ、その日の自重の分は入れず、アプリは「体重の記録がないので自重の種目は入っていません」、MCP は `note` で知らせます
  - 負荷量は保存せず、読むたびに計算します。体重や割合を直すと、過去の記録の総負荷量も変わります
  - 割合を持たない種目（割合を足す前の種目、割合を省いて足した種目）は、名前から決めます：懸垂・チンニング 1、ディップス 0.95、スクワット（自重）0.7、腕立て伏せ 0.65、膝つき腕立て 0.5、腹筋（クランチ・レッグレイズ・アブローラーなど）0.3、プランク 0（入れない）、それ以外 0.65。初期の種目は割合を持たず、名前から決めます。アプリも版8のマイグレーションで列を足すだけで、今までの種目は NULL（読むときに同じ決まりで名前から決める）にしています（入れたばかりの端末に初期の種目の変更を送らせないため、また値を入れて送らないと名前を変えたときに食い違うため）。アプリの種目の追加・編集の画面で割合を保存すると、その値を送ります（編集で保存すると、名前を変えても割合はそのまま）
  - 推定1RM と自己ベストは、今までどおり重量のあるセットだけで出します
- **BIG3 の役**：種目に BIG3 の役（`exercise.big3`：`bench`・`squat`・`deadlift`）を持たせます。アプリの種目の追加・編集で選び、1つの役は1つの種目だけです（別の種目に付けると、前の種目から外す）。筋トレの推移の「BIG3 の推定1RM（合計）」と、名前の横の「BIG3」の印に使います
  - どの種目にも役がないあいだは、名前で決めます：名前に「ベンチプレス」「スクワット」「デッドリフト」を含み、インクライン・ダンベル・ルーマニアン・ブルガリアンなど別の種目を表す言葉を含まない、表示中の重量×回数の種目（いくつもあれば、名前がちょうど同じもの、短いもの、ID の小さいもの）。アプリ（`apps/mobile/lib/exercises.ts`）とサーバー（`training/domain/big3.py`）で同じ決まりにし、`testdata/training/big3.json` で両方を確かめます
  - 名前で決めた役は保存しません（初期の種目の変更を送らないため。割合と同じ）。アプリで初めて役を変えたときに、名前で決めていたほかの役も保存して送ります（保存した役が1つでもあると、名前では決めないため）。端末どうしの同期で同じ役が2つの種目に付いたときは、ID の小さいほうを使います
  - MCP の `list_exercises` は、役のある種目に `big3` を付けます（名前で決めた役も）。MCP からは変えません
- **フォームの動画のリンク**：種目に `exercise.form_video_url`（`https://` で始まり空白を含まない、2000文字まで）を持たせます。アプリの種目の追加・編集で入れ、記録の入力の画面の右上の「フォーム」で外のアプリ（YouTube など）を開きます。MCP の `list_exercises` は、リンクのある種目に `form_video_url` を付けます
- **初期の部位と種目**：アプリ（`apps/mobile/db/seed.ts`）と同じ固定の ID で、筋トレのドメイン（`training/domain/catalog.py`）にも持ちます。アプリがまだ同期で送っていなくても、MCP から同じ ID で記録できるようにするためです（同じ内容かはテストで確かめる）

## 認可API の作り

認可API は Flask と Authlib の認可サーバー（`authlib.integrations.flask_oauth2`）で作っています。
FastAPI と Starlette には、Authlib の認可サーバーの公式な統合がないためです（MCP サーバーは別の Lambda なので、Starlette のままです）。
OAuth の中心は、保守されているライブラリに任せて、自分で書くのは Authlib にないものと、保存先とのやり取りだけにしています。

| 担当 | 中身 | 場所 |
|---|---|---|
| Authlib | 認可コードのグラント、PKCE（RFC 7636）、リフレッシュトークンのローテーション、失効（RFC 7009）、`iss`（RFC 9207）、JWT のアクセストークン（RFC 9068）、クライアント認証（`none`）、OAuth のエラー応答 | `oauth/server.py` で組み立てる |
| 自分で書く | RFC 8707（`resource` を確かめて `aud` に入れる。scope をリソースサーバーごとに狭める。受け入れられなければ `invalid_target`） | `oauth/resource_indicators.py` |
| 自分で書く | CIMD（client_id の URL から文書を取る。https だけ・リダイレクトをたどらない・5秒・5KB まで。Lambda では `claude.ai` と `chatgpt.com` だけに取りに行き、PC で動かすときは絞らない（`main.py` の `CIMD_ALLOWED_HOSTS`）。Muse は文書を自分で公開しないので、認可API が `/clients/muse.json` で決まった1つの文書を公開し、その client_id は取りに行かずに手元の文書を使う） | `infrastructure/cimd_client_directory.py` |
| 自分で書く | Cognito でのログイン（Authlib の OIDC クライアント）、同意画面、アカウントの切り替え、ログアウト | `infrastructure/cognito_login.py`、`presentation/` |
| 自分で書く | 保存（認可の途中の状態、認可コード、リフレッシュトークンの系列）。方針として、PKCE は S256 だけ、認可コードは取り出すと同時に消す、古いリフレッシュトークンが再び届いたら系列ごと無効にする | `infrastructure/stores.py`、`oauth/server.py` |

- 認可の途中の状態（DynamoDB の `request#…`）には、`/authorize` のパラメータとクライアントの情報を保存し、同意のあと Authlib にもう一度確かめさせてから認可コードを出します
- リフレッシュトークンは「系列ID.ランダムな値」の形で、保存するのは最新の値のハッシュだけです。アクセストークンの `sid` は系列ID で、`/revoke` はどちらのトークンでも系列ごと消します
- アクセストークンの形（iss、aud、scope、client_id、sid、5分で切れる、`typ: at+jwt`、鍵 ID `authz-key-1`）は、MCP の入口の確かめ方（`services/mcp/connector/access_token_verifier.py`）に合わせています

## フォルダ

組み立て（DI）は `main.py` で行います（認可API は `services/authorization/main.py`、Lambda に載せる2つは `services/mcp/main.py` と `services/app_api/main.py`、筋トレの中の組み立ては `training/main.py`）。食事記録（パッケージ `meals`）には `main.py` がなく、層だけを置いています。
食事記録と筋トレは DDD の層（`presentation` → `application` → `domain` ← `infrastructure`）に分けています。

| フォルダ | 中身 |
|---|---|
| `services/authorization/` | 認可API（Flask ＋ Authlib）。`oauth/`（Authlib の認可サーバーの組み立て、RFC 8707）、`infrastructure/`（CIMD、Cognito、保存先、設定）、`presentation/`（入口、同意画面、プライバシーポリシー `/privacy`） |
| `services/meals/` | 食事記録（パッケージ `meals`）。MCP のツール（記録・修正・いつもの・目標・今日の残り・週のふり返り・体重と目標までの進み具合の17個）、同期への登録（`meals/infrastructure/sync_entities.py`）、アプリ用の目標の案のルート（`meals/presentation/app_routes.py`）、移行のスクリプト（`scripts/`） |
| `services/training/` | 筋トレ（パッケージ `training`）。部位・種目・トレーニング・体組成・設定と、その計算。同期への登録、同期された記録の読み書き、MCP のツール（ケガの記録とフェーズを含めて22個） |
| `services/mcp/` | MCP サーバーの組み立て（`main.py`、Lambda の `MealsFunction`）と、MCP の入口の部品（`connector/`） |
| `services/sync/` | 同期の共通の部品（パッケージ `sync`）。変更の記録、当てはめ、冪等、カーソル、DynamoDB、同期の API の入口 |
| `services/app_api/` | スマホアプリ用の Lambda の組み立て（`main.py`）。同期の入口に、食事と筋トレの種類とルートを登録する |
| `services/composition/` | 組み立ての場所（`services/mcp` と `services/app_api`）が共有するもの。同期で扱う種類の登録（`create_registry`） |
| `apps/mobile/` | 筋トレのアプリ（hlog、Expo）。今は端末の SQLite だけで動く（下の「筋トレのアプリとの関係」、[apps/mobile/README.md](../apps/mobile/README.md)） |
| `testdata/training/` | 筋トレの計算の、入力と期待する結果（サーバーとアプリで共有） |
| `cdk/` | AWS の構成（CDK）。Cognito（新規登録は不可、パスキー、認可API 用とスマホアプリ用のクライアント）、Lambda 3つ（入口は API Gateway の HTTP API、流量の制限付き）、DynamoDB 2つ、SSM パラメータ。監視（[monitoring.md](monitoring.md)） |
| `tools/inspector/` | MCP Inspector 用の CIMD の文書（PC で MCP サーバーを試すとき） |
| `docs/` | 設計書と図、アプリ用の API の仕様（`api/app-api.yaml`） |
| `.github/` | GitHub Actions（`workflows/test.yml` はテスト、`eas-build.yml`・`eas-update.yml` はアプリの配信）と Dependabot の設定 |

## 外から届く道を絞る

本人だけで使うので、次のように絞っています。

- 入口は API Gateway の HTTP API だけにしています（Lambda の関数 URL は使いません）
- 流量の制限は、認可API と MCP が 1秒1回・瞬間5回、スマホアプリ用の API が 1秒2回・瞬間10回です（アプリが使い始めるまで低くしておき、使い始めたら上げます）。超えた分は 429 で断るので、叩かれ続けても月の費用に上限がかかります
- スマホアプリ用の API は、Cognito のアプリのクライアントのアクセストークンだけを受け付けます（下の「スマホアプリ用の API」）
- Cognito のログイン画面からの新規登録はできません。ユーザーは管理者の操作（下の「パスキーを作る手順」）でだけ作ります。パスワードでログインできるテスト用のユーザーは置きません
- ユーザープールと DynamoDB のテーブルは、削除の保護を有効にし、`cdk destroy` でも消えない（RETAIN）ようにしています。ユーザーが消えると `sub`（食べた人の ID）が変わり、記録がたどれなくなるためです
- DynamoDB のテーブルは、ポイントインタイムリカバリを有効にしています。誤って消したり書き換えたりしても、35日前までの任意の時点に戻せます（戻すと別の名前のテーブルができるので、中身を写し戻します）。費用はテーブルの大きさで決まり、今の大きさ（数十 KB）ではほぼ0円です
- DynamoDB のテーブルは、AWS マネージドキー（`aws/dynamodb`）で暗号化しています。鍵の使用が CloudTrail に残ります。鍵の月額はかかりません（KMS への呼び出しは DynamoDB がまとめるので、少ない）

## パスキー

ログインはパスキーで行います。設定はユーザープールにあり、どれも CloudFormation では置き換えにならない変更です。

| 設定 | 値 | 理由 |
|---|---|---|
| 最初の要素（`SignInPolicy`） | パスワード、パスキー | パスワードは CloudFormation の決まりで外せない。下の手順で、長いランダムな値にして捨てる |
| RP ID | `oidc-study-<アカウント>.auth.ap-northeast-1.amazoncognito.com` | 今のプレフィックスのドメイン。**あとで独自ドメインを足すと、パスキーはすべて作り直しになる** |
| 本人確認 | 必須（`required`） | 端末の指紋や PIN を必ず通す |
| MFA | OFF | パスキーの本人確認で代える |
| パスワードの再設定 | 管理者だけ（`AccountRecovery.NONE`） | 捨てたパスワードを、メールを読める人が作り直せないようにする |
| クライアントの認証フロー | `ALLOW_USER_AUTH`（選択式のサインイン） | マネージドログインでパスキーを選ばせるのに要る |

認可API 用のクライアント（`authz-api`）にも `ALLOW_USER_AUTH` を付けています。
AWS の資料（[Configure authentication methods for managed login](https://docs.aws.amazon.com/cognito/latest/developerguide/authentication-flows-selection-managedlogin.html)）では、マネージドログインがサインインの方法（パスキーなど）を選ばせるのは、クライアントに `ALLOW_USER_AUTH` があるときです。
CDK の `AuthFlow` の資料も、パスキーを有効にしたら `authFlows: { user: true }` を付けるように書いています。
付けないと、Claude・ChatGPT からの接続（MCP）のログインでパスキーが使えません。
`authFlows` を指定すると、既定で開いていた SRP とカスタム認証の入口（`ALLOW_USER_SRP_AUTH`・`ALLOW_CUSTOM_AUTH`）は閉じます。認可API はマネージドログインだけを使うので、影響はありません。

### パスキーを作る手順

初めてのときと、パスキーを足すときに行います（なくしたときは、下の「パスキーをなくしたとき」を先に行います）。パスワードを使うのは、この手順と、下の「パスキーをなくしたとき」の中だけです。管理者の操作は、AWS の個人のアカウントで行います。パスワードは画面に出さず、ファイルにも残しません。

0. 初めてのときだけ、**管理者**が本人のユーザーを作る（招待のメールは送らない）
   ```sh
   aws cognito-idp admin-create-user --user-pool-id <UserPoolId> --username <メールアドレス> \
     --user-attributes Name=email,Value=<メールアドレス> Name=email_verified,Value=true --message-action SUPPRESS
   ```
1. **管理者**が、本人のパスワードを、一時的な長いランダムな値にする（この値は本人に渡し、手順4で捨てる）
   ```sh
   PW="$(openssl rand -base64 33 | tr -d '/+=')Aa1!"
   aws cognito-idp admin-set-user-password --user-pool-id <UserPoolId> --username <メールアドレス> --password "$PW" --permanent
   ```
2. **本人**が、PC かスマホのブラウザで次の URL（ログイン画面）を開き、メールアドレスと手順1のパスワードでログインする
   ```
   https://<CognitoDomain>/login?response_type=code&client_id=<ClientId>&redirect_uri=<AuthzUrl>/cognito/callback
   ```
   - `<CognitoDomain>`・`<ClientId>`・`<AuthzUrl>` は `cdk deploy` の出力です
   - ログインのあと認可API に戻り、エラーの画面が出ます（認可API のログインの途中の状態がないため）。Cognito のログインはできているので、そのまま次に進みます
3. **本人**が、同じブラウザで次の URL（パスキーの追加の画面）を開き、端末のパスキー（Google パスワード マネージャーや iCloud キーチェーンなど）を作る
   ```
   https://<CognitoDomain>/passkeys/add?client_id=<ClientId>&redirect_uri=<AuthzUrl>/cognito/callback
   ```
   - 管理者が作ったユーザーには、マネージドログインがパスキーの登録を勧めないので、この URL を直接開きます
   - ログインしていないと、パスキーの画面を出さずに、`redirect_uri` へ `result=invalid_session` を付けて戻ります。そのときは手順2からやり直します
   - 作ったあと認可API に戻り、エラーの画面が出ることがあります。パスキーは作れているので、そのまま閉じてかまいません
   - Mac の Chrome で、iCloud パスワードの拡張機能がパスキーの保存先になっていると、パスキーは「このデバイスのみ」に保存されます（ほかの端末では使えません）。ほかの端末でも使うときは、その端末でもこの手順でパスキーを作ります
4. **管理者**が、パスワードを別のランダムな値に変え、その値はどこにも残さない（手順1のコマンドを、もう一度実行して `PW` を捨てる）
5. **本人**が、Claude か ChatGPT のコネクタをつなぎ直し、ログイン画面で「パスキーでサインイン」を選んで、パスワードなしで入れることを確かめる

スマホアプリのログイン（第2段階）も、同じユーザーのパスキーで入ります。

### パスキーをなくしたとき

端末をなくしたり、盗まれたりして、パスキーが他人の手にあるかもしれないときの手順です。ユーザーは消さずに残します（消すと `sub` が変わり、記録がたどれなくなるため）。

1. **管理者**が、Cognito のトークンをすべて失効させる
   ```sh
   aws cognito-idp admin-user-global-sign-out --user-pool-id <UserPoolId> --username <メールアドレス>
   ```
   - Cognito が出した ID トークン・アクセストークン・リフレッシュトークンが失効します（スマホアプリのログインも切れます）
   - マネージドログインのセッションの Cookie は消えません。なくした端末のブラウザで、Cookie が切れるまではログイン画面を通らずに入れることがあります
   - 認可API が Claude・ChatGPT に出したトークンは、Cognito のものではないので、これでは失効しません（手順3）
2. なくした方のパスキーを、Cognito と Google パスワード マネージャーの両方から消す（下の「[パスキーを消す手順](#パスキーを消す手順)」。一時的なパスワードの設定から、パスワードを捨てるまでを含む）
3. **本人**が、Claude・ChatGPT のコネクタの連携を解除する。連携の解除だけでは認可API に取り消しが届くとは限らないので、**管理者**が、認可API のリフレッシュトークンの系列も消す
   - 系列は StateTable に、`pk` が `refresh#<系列 ID>` の項目として入っています（`services/authorization/oauth/server.py` の `save_token`、`infrastructure/stores.py`）。項目の `data`（JSON）に、本人の `sub`（`subject.id`）が入っています
   - 項目を消すと、その系列のリフレッシュトークンは使えなくなります。アクセストークン（JWT）は MCP が署名だけで確かめるので、期限（5分）までは使えます
   ```sh
   TABLE=<StateTable のテーブル名>   # CognitoStudy-StateTable...
   aws dynamodb scan --table-name "$TABLE" --projection-expression pk \
     --filter-expression 'begins_with(pk, :p) AND contains(#d, :sub)' --expression-attribute-names '{"#d":"data"}' \
     --expression-attribute-values '{":p":{"S":"refresh#"},":sub":{"S":"<sub>"}}' --query 'Items[].pk.S' --output text \
     | tr '\t' '\n' | while read -r pk; do
         aws dynamodb delete-item --table-name "$TABLE" --key "{\"pk\":{\"S\":\"$pk\"}}"
       done
   ```
   - 使うのは本人だけなので、`:sub` の条件を外して、`refresh#` の項目をすべて消してもかまいません
   - 消したあと、コネクタをつなぎ直します（新しい系列ができます）

### パスキーを消す手順

なくしたときのほか、使わなくなった端末のパスキーを消すときにも使います。パスキーは、Cognito（サーバー）と端末（Google パスワード マネージャー）の両方にあり、片方を消しても、もう片方は残ります。**両方を消します**。

#### Cognito から消す（案 A：API の `USER_AUTH` でログインする）

Cognito には、管理者がパスキーを消す API（Admin の付くもの）がありません。`ListWebAuthnCredentials`・`DeleteWebAuthnCredential` は、本人のアクセストークン（scope `aws.cognito.signin.user.admin`）でだけ呼べます。
マネージドログインのトークンにはこの scope が付かない（`authz-api`・`torelog-app` のクライアントが出さない）ので、API の `InitiateAuth`（認証フロー `USER_AUTH`）でログインし、そのアクセストークンを使います。
クライアントは、シークレットのない `torelog-app` を使います（`ALLOW_USER_AUTH` が付いていて、管理者の端末から CLI で呼べる）。CLI ではパスキーで答えにくいので、一時的なパスワードで入ります。

`<AppClientId>` は `cdk deploy` の出力の `AppClientId`、または SSM パラメータ `/cognito-study/app/client-id` です。`<UserPoolId>` も `cdk deploy` の出力です。
コマンドは、同じシェルで続けて実行します。パスワードとトークンは、変数にだけ置き、画面やファイルに出しません。

1. **管理者**が、一時的な長いランダムなパスワードを設定する（[パスキーを作る手順](#パスキーを作る手順)の手順1と同じ）
   ```sh
   PW="$(openssl rand -base64 33 | tr -d '/+=')Aa1!"
   aws cognito-idp admin-set-user-password --user-pool-id <UserPoolId> --username <メールアドレス> --password "$PW" --permanent
   ```
2. そのパスワードで `USER_AUTH` のログインをし、アクセストークンを変数に入れる（有効なのは15分）
   ```sh
   TOKEN=$(aws cognito-idp initiate-auth --region ap-northeast-1 --no-sign-request \
     --auth-flow USER_AUTH --client-id <AppClientId> \
     --auth-parameters "USERNAME=<メールアドレス>,PREFERRED_CHALLENGE=PASSWORD,PASSWORD=$PW" \
     --query AuthenticationResult.AccessToken --output text)
   ```
   - `--no-sign-request`：この API は AWS の資格情報ではなく、ユーザーのパスワードやトークンで認証します
   - 失敗すると `TOKEN` は空になります。`[ -n "$TOKEN" ] && echo ok` で確かめます（トークンそのものは出さない）
3. パスキーを一覧する
   ```sh
   aws cognito-idp list-web-authn-credentials --region ap-northeast-1 --no-sign-request --access-token "$TOKEN" \
     --query 'Credentials[].[CredentialId,FriendlyCredentialName,AuthenticatorAttachment,CreatedAt]' --output table
   ```
   - `FriendlyCredentialName`（パスキーを作った端末やパスワード マネージャーの名前）と `CreatedAt`（作った日時）で、消すものを決めます
4. 消す（消すパスキーごとに）
   ```sh
   aws cognito-idp delete-web-authn-credential --region ap-northeast-1 --no-sign-request --access-token "$TOKEN" \
     --credential-id <消すパスキーの CredentialId>
   ```
   もう一度手順3を実行し、消えたことを確かめます
5. **管理者**が、後片付けをする
   ```sh
   aws cognito-idp admin-set-user-password --user-pool-id <UserPoolId> --username <メールアドレス> \
     --password "$(openssl rand -base64 33 | tr -d '/+=')Aa1!" --permanent   # パスワードを別の値にして捨てる
   aws cognito-idp admin-user-global-sign-out --user-pool-id <UserPoolId> --username <メールアドレス>   # 手順2のトークンも失効させる
   unset PW TOKEN
   ```
   - パスキーが1つも残っていなければ、この手順の前に、[パスキーを作る手順](#パスキーを作る手順)の手順2・3（手順1のパスワードでログインする）で新しいパスキーを作ります

- 監視のメール（[monitoring.md](monitoring.md) の `CognitoChangeRule`）が、`AdminSetUserPassword`・`DeleteWebAuthnCredential`・`AdminUserGlobalSignOut` で届きます。自分の操作であることを、`sourceIPAddress` で確かめます
- コマンドの引数にパスワードとトークンが入るので、ほかの人が使っている PC では実行しません（実行中のコマンドの一覧から見えるため）
- 確かめたこと（2026-11-08）：AWS CLI 2.34 に `list-web-authn-credentials`・`delete-web-authn-credential` があり、引数は `--access-token` と `--credential-id`。`torelog-app` はシークレットがなく、認証フローは `ALLOW_USER_AUTH` だけ。`USER_AUTH` で選べるものに `PASSWORD` がある（いないユーザーで呼んで、返ってきた選択肢を見た）。本人のユーザーでの消す操作は、まだ試していません

#### 端末から消す（Google パスワード マネージャー）

Cognito から消したパスキーは、端末に残っていても、もうログインには使えません。ただ、残っていると、ログインのときに選べてしまい、失敗して紛らわしいので、消します。パスキーは Google アカウントで同期されるので、どれか1つの端末で消せば、ほかの端末からも消えます。なくした端末からは消せないので、ほかの端末か PC で消します。

- **Android（Pixel）**：設定 → Google → 自動入力 → Google パスワード マネージャー（またはパスワード、パスキー、アカウント）を開き、`oidc-study-<アカウント ID>.auth.ap-northeast-1.amazoncognito.com` を選んで、パスキーを削除する
- **PC**：ブラウザで [passwords.google.com](https://passwords.google.com) を開き、同じ名前のサイトを選んで、パスキーを削除する（Chrome なら `chrome://password-manager/passwords` でも同じ）
- サイトにパスキーが複数あるときは、作った日時で、Cognito から消したものと同じものを選びます
- iCloud キーチェーンなど、ほかの場所に作ったパスキーは、そちらのパスワードの管理の画面で消します

## スマホアプリ（hlog）のログイン

アプリは Cognito のマネージドログインに、OIDC（認可コード＋PKCE）でつなぎます。MCP の認可API は通しません。
同じ Cognito のユーザーなので、アクセストークンの `sub` は MCP と同じです（認可API は Cognito の ID トークンの `sub` を、そのまま自分のアクセストークンの `sub` にしています。`services/authorization/infrastructure/cognito_login.py`）。

| 設定 | 値 | 理由 |
|---|---|---|
| クライアント | `torelog-app`。シークレットなし（パブリック） | 端末に秘密を置けない。PKCE で守る |
| フロー | 認可コードだけ。`ALLOW_USER_AUTH`（パスキー） | |
| 戻り先 | `torelog://callback`、ログアウトは `torelog://signout` | |
| アクセストークン・ID トークン | 15分 | 盗まれたときの被害を小さくする |
| リフレッシュトークン | 30日。使うたびに新しくする（古いものは10秒だけ使える） | 10秒は、通信が切れて取り直すとき用 |
| 失効・ユーザーの有無 | 失効を有効、ユーザーの有無をエラーから知られないようにする | |
| scope | `openid`、`torelog-api/meals.read`・`meals.write`・`training.read`・`training.write` | アプリ用の API のルートで必須にし、ID トークンや認可API 用のクライアントのトークンを断る |

scope はリソースサーバー `torelog-api` に置き、名前は「対象.操作」にして、食事（`meals.*`）と筋トレ（`training.*`）を分けています（MCP の認可API の scope `meals:read` とは別の名前空間です）。
アプリの側（`apps/mobile/lib/auth/`、`hooks/auth.tsx`、`app/account.tsx`）：

- ログインは任意で、設定の画面から入ります。expo-auth-session（PKCE・state）で認可の画面を Chrome Custom Tabs に開き、毎回 `prompt=login` を付けます
- アプリが求める scope は `torelog-api/` の4つだけです（ID トークンもユーザー情報も使わないので、`openid` は求めない）
- **カスタムスキームの横取りの対策**：マネージドログインは、画面でログインすると、ブラウザにセッションの Cookie を置きます。Cookie は1時間有効で、Cookie でのログインでは延びません（[AWS の資料](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-managed-login.html)の「The one-hour managed login and hosted UI session cookie」）。そのあいだ、同じ端末で `torelog://` を登録した別のアプリが、自分の PKCE で `/oauth2/authorize` を開くと、画面なしでコードを受け取り、トークンに換えられます（`prompt=login` は正規のアプリの要求にしか付かない）。そこで、認可コードをトークンに換えたあと（うまくいってもいかなくても）、同じ Custom Tabs で `/logout`（`client_id`、`logout_uri=torelog://signout`）を開いて Cookie を消します。`/logout` はすぐ `torelog://signout` に戻すので、利用者の操作は増えません。根本の対策（https の戻り先と Android App Links）は、まだ入れていません
- トークンは expo-secure-store に置き、自動バックアップから外します。アクセストークンは切れる1分前から更新し、リフレッシュトークンが切れていたら、ログインしていない状態に戻します。ログアウトでは端末のトークンを消してから `/oauth2/revoke` を呼びます
- ログインしたら同期を始めます。つながったかどうかは、アカウントの画面の同期の表示（最後に同期した時刻、エラー）で分かります。本人の情報を返すルートは足していません（API とインフラを変えずに済むため）。同期の仕組みは [sync-design.md](sync-design.md#アプリの同期appsmobile)

アプリが使う値（issuer、クライアント ID、Cognito のドメイン、API の URL）は、`cdk deploy` の出力（`CognitoIssuer`・`AppClientId`・`CognitoDomain`・`AppApiUrl`）と SSM パラメータ（`/cognito-study/app/*`）にあります。どれも秘密ではありません。

## スマホアプリ用の API

アプリは端末の SQLite に先に保存し、つながったときに変更の記録を送り合って同期します。仕組みは [sync-design.md](sync-design.md)、API の仕様は [api/app-api.yaml](api/app-api.yaml) にあります。

```
アプリ ──アクセストークン（Cognito）──► HTTP API（JWT のオーソライザー）──► AppApiFunction ─┐
                                                                                            ├─► MealsTable（変更の記録と今の状態）
Claude・ChatGPT ──アクセストークン（認可API）──► HTTP API ──► MealsFunction（MCP）───────────┘
```

| 項目 | 中身 |
|---|---|
| ルート | `POST /v1/sync/changes`（送る）、`GET /v1/sync/changes`（受け取る）、`GET /v1/sync/snapshot`（初回の全件）、`POST /v1/meals/goal-suggestions`（目標の案） |
| オーソライザー | issuer は Cognito、audience はアプリのクライアント ID だけ。ルートごとに scope を必須にする |
| 利用者 | オーソライザーが確かめたクレームの `sub`。MCP のアクセストークンの `sub` も Cognito の `sub` そのものなので、同じ人は同じデータになる |
| Lambda | MCP と別の関数。Lambda Web Adapter を通さない。権限は食事のテーブルの読み取りと追記だけ |
| 流量の制限・ログ | 1秒2回・瞬間10回（アプリが使い始めるまで。使い始めたら上げる）。アクセスログは30日（監視のスタックも読む） |

体重は体組成（`body_record`）として同期します。MCP の `record_weight` で記録した体重も、体組成の記録としてアプリに届きます。

## 筋トレのアプリとの関係

筋トレのアプリ（hlog、`apps/mobile/`）と MCP は、同じ人の筋トレと体組成の記録を扱います。アプリでログインすると、同期でつながります。

| 段階 | アプリ | サーバー |
|---|---|---|
| 今（第1段階） | 記録を端末の SQLite にだけ保存する。ログインも同期もない | アプリ用のクライアント（`torelog-app`）、アプリ用の API、同期の仕組みはデプロイ済み。MCP の筋トレのツールは、MCP から記録した分だけを読み書きする |
| 第2段階 | Cognito にパスキーでログインし、変更の記録を送り合って同期する（筋トレ・体組成・設定は入った）。食事の記録と目標も扱う | 変わらない（同じ API と同じテーブルの `SYNC#` の項目） |

- 記録の置き場所は、アプリから送られた分も MCP から書いた分も、食事のテーブル（`MealsTable`）の同期の項目（`SYNC#…`）です。どちらの変更も同じ「変更の記録」を通るので、同期でもう一方に届きます（[sync-design.md](sync-design.md)）
- 同じ人かどうかは、Cognito の `sub` で決まります（上の「スマホアプリ（hlog）のログイン」）
- 計算（総負荷量、推定1RM、自己ベスト、体組成）は、アプリの `apps/mobile/lib/` と筋トレのドメインで同じ式にし、`testdata/training/*.json` で両方を確かめます
- 初期の部位と種目は、アプリの `apps/mobile/db/seed.ts` と同じ固定の ID です（上の「MCP サーバーの組み立て」）
- アプリの表の列（ID、作成・更新の時刻、論理削除）は、同期の対象の項目と同じにしています（`apps/mobile/db/migrations.ts`）
