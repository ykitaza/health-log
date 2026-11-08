# 同期の設計

スマホアプリ（hlog）と MCP（Claude・ChatGPT）が、同じ記録を読み書きするための仕組みです。
API の形は [docs/api/app-api.yaml](api/app-api.yaml)（OpenAPI）にあります。
サーバーの側（アプリ用の API、同期の仕組み、MCP からの書き込み）はデプロイ済みです。アプリの側は、ログインと、筋トレ・体組成・設定・食事の同期が入りました（下の「アプリの同期」）。流れは [シーケンス図](sequence.md#アプリの同期) にあります。

## 方針

- アプリは、筋トレも食事も、端末の SQLite に先に保存し、つながったときにサーバーと同期します。正本はサーバー（DynamoDB）です
- MCP は、サーバーを直接読み書きします。MCP からの変更も、アプリと同じ「変更の記録」を通します（同期でアプリに降りてくるようにするため）
- 変更の記録は追記だけで、消しません。サーバーは、変更の記録を当てはめた「今の状態」も保存し、MCP と表示は今の状態を読みます
- 食事の目標は、サーバーで計算して保存し、同期で配ります

## 対象

同期する記録を「対象」と呼び、種類（`entity_type`）と ID（`entity_id`）で指します。ID は端末が作る UUID です（MCP が作るものは今の形のまま、12桁の16進数）。
どの対象も、アプリの SQLite と同じく、作成・更新の時刻と論理削除（`deleted_at`）を持ちます。

| 種類 | 中身 | ID | scope |
|---|---|---|---|
| `meal` | 食事（日付・区分・時刻・説明・記録の仕方） | UUID | `meals.*` |
| `meal_item` | 食事の中の品目（名前・量・単位・栄養・確かさ・並び順） | 食事の中で一意。`parent_id` に食事の ID を入れる | `meals.*` |
| `meal_template` | いつもの（名前、品目の一覧） | 名前から決める（下の注） | `meals.*` |
| `nutrition_goal` | 食事の目標（1人に1つ） | `current` だけ | `meals.*` |
| `day_type` | 日の種類（筋トレの日／休みの日） | 日付（`YYYY-MM-DD`） | `meals.*` |
| `body_part` | 部位 | UUID（初期のものは固定の UUID） | `training.*` |
| `exercise` | 種目 | UUID（同上） | `training.*` |
| `workout_entry` | トレーニングの中の種目（1日の1種目ぶん） | UUID | `training.*` |
| `workout_set` | セット | UUID | `training.*` |
| `body_record` | 体組成 | UUID | `training.*` |
| `setting` | 設定 | 設定の名前（`weight_unit` など） | `training.*` |
| `sleep_session` | 睡眠（Health Connect の取り込みだけ。起きた日・寝た時刻・起きた時刻・眠っていた分・起きていた分） | 取り込みの ID（下の「Health Connect の取り込み」） | `training.*` |

- 筋トレの項目は、アプリのマイグレーション（`apps/mobile/db/migrations.ts`）の列に合わせます。真偽値（`hidden`・`done`）は、SQLite では 0/1、API では `true`/`false` です
- 「トレーニング」は、SQLite に表がありません（同じ日の `workout_entry` のまとまり）。表が足されたら `workout` を足します
- 品目（`meal_item`）は、食事の中でだけ一意です。今の MCP は、複製（`copy_meal`）といつもの（`record_template`）で、元の品目の ID をそのまま使うためです。そこで、品目は `parent_id`（食事の ID）と `entity_id`（品目の ID）の組で指します。`parent_id` が違えば別の品目です（品目を別の食事に移すことはできない）
- いつもの（`meal_template`）は、今は名前で上書きします（同じ名前は1つ）。同期でもそうなるように、ID は名前から決めます（`uuid5(6f1d3c52-6a1e-4f5f-9d0b-2c7a8e0f4b61, 名前)`。`services/meals/meals/infrastructure/sync_entities.py` の `template_id`）。名前を含む変更で ID が合わなければ断ります。名前を変えるときは、古い名前のものを消して、新しい名前で作ります。品目の一覧は1つの項目（一覧ごと置き換わる）で、品目ごとに `item_id` を持ちます（省くとサーバーが並び順から決める）
- 日の種類（`day_type`）は、本人が決めたものだけを保存します。筋トレの日かどうかは、のちに筋トレの記録から求め、本人が決めた日の種類があればそちらを使います
- 体重は、体組成（`body_record`）に一本化しています。MCP の `record_weight` も体組成の記録を書きます（[design.md](design.md#mcp-サーバーの組み立て)）

## 変更の記録

1件の変更は、次の形です。

| 項目 | 中身 | 決める人 |
|---|---|---|
| `change_id` | 変更の ID（UUID）。同じ変更を何度送っても、1回分として扱う | 送る側 |
| `entity_type`・`entity_id`・`parent_id` | 対象 | 送る側 |
| `op` | `create`・`update`・`delete`・`restore`（消したものを戻す） | 送る側 |
| `fields` | 変えた項目と値（`create`・`update` のとき）。送らなかった項目は変えない | 送る側 |
| `changed_at` | 変えた時刻（ミリ秒まで、UTC）。アプリは端末で変えた時刻、MCP はサーバーが受け付けた時刻 | 送る側（MCP はサーバー） |
| `origin` | `app`（手入力）・`import`（Health Connect の取り込み）・`mcp`・`migration`（移行） | アプリは `app` か `import`。ほかはサーバー |
| `device_id` | 端末の ID（MCP は null） | 送る側 |
| `received_at` | 受け付けた時刻 | サーバー |
| `seq` | 利用者ごとの通し番号（1から増える）。受け取るときのカーソルに使う | サーバー |

変更の記録には、当てはめで負けた変更も残します。

## 今の状態への当てはめ

項目ごとに、いちばん「強い」変更の値を残します。強さは次の順に比べます。

1. **手入力か**：`app`・`mcp`・`migration` は、`import`（取り込み）より強い。取り込み直しで手入力の値を上書きしないため
2. **時刻**：`min(changed_at, received_at)` が新しい方。端末の時計が進んでいても、未来の時刻で勝ち続けないように、受け付けた時刻で切ります
3. **同じ時刻のとき**：あとに受け付けた方（`seq` の大きい方）。MCP は同じミリ秒の中で「記録 → 修正」と続けて書くことがあり、修正の方を残すためです

時刻が違う変更どうしは、届いた順番によらず同じ結果になります（項目ごとに最大のものが残る）。同じ変更（同じ `change_id`）は2回目から当てはめません。
当てはめるのはサーバーだけで、端末はサーバーが返した状態で上書きするので、時刻が同じときも、どの端末も同じ状態になります。

- **新しく足す**：ID が違うので、両方残ります
- **同じ記録の違う項目**：項目ごとに当てはめるので、両方が残ります
- **同じ項目**：上の順で強い方が残ります
- **削除と変更**：削除が勝ちます。削除のあとに届いた変更も、項目の値には当てはめますが、消えたままです（戻したときに新しい値が見える）
  - 消えているかどうかは、`delete` と `restore` だけで決めます（上の順で強い方）。`update` や `create` では戻りません
- **取り込みと手入力**：手入力が勝ちます（順位の1）。取り込みの `create` で、消した記録は戻りません

今の状態は、項目ごとに「値・勝った変更の時刻と ID と順位」を持ちます。サーバーの外（API）には、値と `deleted`、最後に当てはめた `seq` だけを出します。

### 確かめること

`create`・`update` の `fields` は、種類ごとに決めた項目と型と範囲（OpenAPI の `*Fields`）で確かめます。
合わない変更は、その変更だけを断ります（`rejected`、理由つき）。同じ送信の中のほかの変更は受け付けます。断った変更は、変更の記録に残しません。

- 知らない項目、型の違い、範囲の外（例：量が0以下、栄養が負）
- `parent_id` が要る種類で、ないとき。要らない種類にあるとき
- 送った人の scope で扱えない種類（例：`meals.write` だけで `workout_set`）
- `origin` に `mcp`・`migration` を入れたとき

ほかの記録を指す項目（`exercise_id` など）が、まだない対象を指していても断りません。端末の送る順番によっては、子が親より先に届くためです。

## 受け取り（カーソル）

`GET /v1/sync/changes?after=<seq>` は、`seq` が `after` より大きい変更を、`seq` の順に返します。
1件ごとに、変更そのもの（`change`）と、当てはめたあとの対象の状態（`state`）を返します。端末は `state` で自分の表を上書きします（当てはめの決まりを端末に持たせないため）。
送ったけれど、まだサーバーに届いていない端末の変更は、上書きのあとにもう一度当てはめて送ります。

- `has_more` が true なら、`next_cursor` を `after` にして続きを取ります
- 初めての端末は、`GET /v1/sync/snapshot` で今の状態を全部取ります（消えたものも含む）。最初のページの `cursor` を覚え、全部取れたらそこから `changes` を取ります。スナップショットを取っている間の変更は、`changes` でもう一度届きます。対象ごとに `seq` の大きい方を残せば、重なっても同じ結果になります
- 読める種類は scope で決まります。`meals.read` だけなら、筋トレの変更は飛ばし、カーソルは進めます

## 送信（冪等）

`POST /v1/sync/changes` は、変更をまとめて（1回に25件まで）送ります。応答は1件ごとに `accepted`（新しい `seq`）・`duplicate`（前に受け付けた。そのときの `seq`）・`rejected`（理由）のどれかです。
通信が切れて応答を受け取れなかったときは、同じ `change_id` のまま送り直します。2回目は `duplicate` になり、状態は変わりません。

サーバーは、利用者ごとに1つずつ順に書きます（楽観的ロック）。

1. 変更を確かめ、すでに受け付けた `change_id` を除く
2. 利用者の先頭（今の `seq`）と、変わる対象の今の状態を読む
3. 送られた順に当てはめ、`seq` を振る
4. 1つのトランザクションで、先頭の `seq`（読んだ値のままのときだけ）、変更の記録、`change_id` の印、今の状態を書く
5. ほかの書き込みと重なってトランザクションが断られたら、1から3回までやり直す

先頭の `seq` を進めるのと、変更の記録を書くのが同時なので、受け取る側が番号を飛ばすことはありません。
1つのトランザクションは100件までなので、1回の送信を25件（先頭1＋変更の記録25＋印25＋状態25以下＋`SYNC#APP` 1）にしています。
本文は 64KB まで（超えると 413。1件も受け付けない）です。盗まれたトークンで大きな書き込みを続けられ、費用が膨らむのを抑えます。品目の多いいつものを送るときは、25件より少なく分けて送ります。
1回の送信で `delete` が10件以上あると、Lambda のログに数を出し、通知します（`docs/monitoring.md` の `BulkDeletesAlarm`。戻し方も同じ文書にある）。

## DynamoDB のキー

利用者ごとに pk を分け、どの読み書きも本人の項目にしか届かないようにします（pk の値は、下の「決めたこと」の1のとおり、今の `EATER#<sub>` です）。

| sk | 中身 |
|---|---|
| `SYNC#HEAD` | 今の `seq` |
| `SYNC#LOG#<seq を12桁>` | 変更の記録と、当てはめたあとの対象の状態。sk が `seq` の順に並ぶので、カーソルで読める |
| `SYNC#CHANGE#<change_id>` | 受け付けた印と `seq`（冪等のため） |
| `SYNC#APP` | アプリ（`app`・`import`）からの変更を最後に受け付けた時刻。その変更と同じトランザクションで書く。MCP の応答の `last_app_sync_at` に使う |
| `SYNC#STATE#<種類>#<ID>` | 今の状態。品目は、親の食事の項目の中に入れる（食事は品目と一緒に読むので） |

- 食事の今の状態には `day_key`（日付＋区分の順番）を入れ、今の LSI `by_day` で期間を探します（今の `MEAL#` の項目と同じ）
- 品目を食事の項目に入れるので、品目の変更を記録すると、親の食事の状態を書き換えます。親の食事がまだ届いていなければ、中身のない食事の状態を作り、食事が届いたら埋まります。日付か区分がない食事、生きている品目がない食事は、一覧や今日の合計に出しません

## MCP からの書き込み

`application` の層は変えません。リポジトリの実装（`infrastructure/`）を、今の状態を読み、保存のときに変更の記録を作るものに差し替えます。

- `save(meal)`：今の状態と比べ、違う項目だけを `update`（新しい食事は `create`）にします。品目は、足したもの・変えたもの・消したものを、それぞれ `meal_item` の変更にします
- `delete(meal)`：`meal` の `delete` にします（品目は食事と一緒に見えなくなる）
- 消えたいつもの・目標・日の種類を MCP が保存し直すときは、`restore` してから書きます
- 初期の種目（同期にまだないものも含む）を MCP が変えるとき（`update_exercise`）は、初期の値に同期の値を重ねたものと比べ、違う項目だけを `update` にします（変えていない項目で、アプリのまだ届いていない変更を負かさないため）
- `changed_at` と `received_at` はサーバーの時刻、`origin` は `mcp` です。食事の時刻は `HH:MM`（秒は持たない。MCP の出力も `HH:MM`）
- 1回のトランザクションに入れる変更は30件までで、それより多いとき（写真をまとめて記録したとき）は分けて書きます
- MCP のツールの入力と出力、今のテストは変えません。今のテスト（リポジトリ・サービス・MCP のツール）は、同期の実装でも同じものを流しています（`services/meals/tests/sync/test_existing_suites.py`）

## アプリの同期（apps/mobile）

アプリは、筋トレ・種目・部位・体組成・設定（`body_part`・`exercise`・`workout_entry`・`workout_set`・`body_record`・`setting`）と、食事の5つの種類（`meal`・`meal_item`・`meal_template`・`nutrition_goal`・`day_type`。版3のマイグレーション）を同期します。体組成には、Health Connect から取り込んだ記録も入ります（版4）。Health Connect から取り込んだ睡眠（`sleep_session`。版5）も同期します（下の「Health Connect の取り込み」）。
種類と端末の表の対応は `apps/mobile/db/syncSpec.ts`、保存先は `db/repositories/sync.ts`、1回分の流れは `lib/sync/engine.ts`、いつ動かすかは `lib/sync/scheduler.ts` と `hooks/sync.tsx` にあります。

### 端末の変更の記録（outbox）

- 表ごとの SQLite のトリガーが、記録・編集・削除のたびに `sync_outbox` に変更を積みます。書き込みの入口（リポジトリのメソッド）がいくつあっても、積み忘れが起きないようにするためです
  - 行を足したら `create`（全部の項目）、変えたら `update`（値が変わった項目だけ）、`deleted_at` を入れたら `delete`、消したものを戻したら `restore`。`updated_at` だけが変わった書き込みは積みません
  - `change_id` は SQLite で作る UUID（v4 の形）、`changed_at` は行の `updated_at`（削除は `deleted_at`）。`origin` は、Health Connect の取り込みが書くあいだ（`sync_meta` に `importing` があるあいだ）は `import`、ほかは `app` です（版4で `sync_outbox.origin` を足した。下の「Health Connect の取り込み」）
  - 真偽値は SQLite の 0/1 のまま積み、送るときに `true`/`false` にします
- **ログインの前の記録**：マイグレーション（版2）で、それまでの行を outbox に積みます。初期の部位と種目は、初期の値から変えた項目だけを `update` で積みます（変えていないものを送ると、ほかの端末や MCP で変えた値を、この端末を入れた時刻で上書きするため）。同期の前に消した行は、サーバーが知らないので積みません
- 端末の ID（`device_id`）は、版2のマイグレーションで作る UUID です

### 1回分の流れ

ログインしているときだけ動かします。起動したとき、前面に戻ったとき、記録を保存したあと（3秒待ち、続けて保存したら1回にまとめる）、アカウントの画面の「今すぐ同期」で動きます。

0. **アカウントを確かめる**：アクセストークンの `sub` が、前に同期したアカウントと同じかを見ます（下の「アカウントが変わったとき」）。違えば、ここで止めます
1. **送る**：outbox を積んだ順に、1回に25件まで、本文が 60KB（サーバーの上限 64KB より少し小さく）を超えないように分けて送ります。`accepted`・`duplicate` は outbox から消し、`rejected` は `status = 'rejected'` にして、送り直しません（outbox で止まり続けないように）。本文ごと断られたら（400・409・413・422）、その回は1件ずつ送り直し、断られた1件だけに印を付けます
2. **受け取る**：初めての端末はスナップショット（全ページ）から始め、最初のページの `cursor` を覚えます。そのあと `GET /v1/sync/changes` を `has_more` が false になるまで読みます。受け取りの位置は、当てはめと同じトランザクションで保存します
3. **当てはめる**：端末は衝突の決まりを持たず、サーバーが返した状態（`state`）で表を上書きします。トリガーが積まないように、当てはめるあいだは `sync_meta` に `applying` を置きます
   - 対象ごとに当てはめた `seq` を `sync_seen` に持ち、それより古い状態では上書きしません（スナップショットと変更が重なったとき）
   - まだ送っていない端末の変更がある項目と削除は、端末の値を残します（上書きのあとに、その変更をもう一度当てはめたのと同じ。次の送信でサーバーに届く）
   - 端末にまだ行がなく、create に要る項目か、指す親（種目の部位、トレーニングの種目、セットのトレーニング）がそろっていない状態は `sync_held` に取っておき、そろったら当てはめます（外部キーがあるため）。消えている記録で項目がそろっていないものは、作りません
   - 当てはめたら、開いている画面を読み直します（`lib/sync/events.ts`）

### 失敗したとき

| 失敗 | 扱い |
|---|---|
| つながらない・時間切れ、429、5xx、思っていない返事 | 5秒・10秒・20秒…と倍にして（上限10分、半分から全部のあいだでゆらす）やり直す。outbox は残る。待っているあいだは、保存のたびには送らない（「今すぐ同期」は待たずに動く） |
| 前に同期したのと違うアカウント（`accountChanged`） | 上の「アカウントが変わったとき」。選ぶまで同期しない |
| 401 | API のクライアントが1回だけトークンを更新して送り直す。それでも 401 か、リフレッシュトークンが切れていたら、ログインの層がログインしていない状態に戻す。同期はやり直さない |
| 403 | 権限が足りない。エラーを出し、間をあけてやり直す |
| 変更ごとの `rejected`、本文ごとの 400・409・413・422 | 上の「送る」のとおり、印を付けて飛ばす。アカウントの画面に件数を出す |
| 応答を受け取れなかった | outbox に残り、次に同じ `change_id` で送る。サーバーは `duplicate` を返し、二重にならない |

アカウントの画面には、最後に同期した時刻、送っていない件数、断られた件数、最後の失敗を出します。

### アカウントが変わったとき

ログアウトしても、outbox（送っていない変更）と受け取りの位置は消しません（同じアカウントでログインし直したら、続きから同期するため）。そのままだと、別のアカウントでログインしたときに、前のアカウントの記録（受け取ったものも含む）を新しいアカウントに送ってしまいます。そこで、同期した相手を端末に覚えておきます。

- 初めて同期するときに、アクセストークンの `sub` を `sync_meta` の `account` に置きます。`sub` は JWT の本体から読むだけで、署名は確かめません（確かめるのはサーバー。ここは見分けるためだけ）。画面・ログ・本文・URL には出しません
- 同期のたびに、送る前に今の `sub` と比べます。同じなら今までどおり同期します
- 違えば、送りも受け取りもせずに止めます（失敗 `accountChanged`、やり直さない）。outbox と受け取りの位置はそのまま残すので、前のアカウントでログインし直せば続きから同期します。アカウントの画面に、次の3つを出し、選ぶまで止めたままにします（どれも選ばないのが既定）
  - **この端末の記録を新しいアカウントに送る**：受け取りの位置・`sync_seen`・`sync_held`・outbox（断られたものも）を消し、端末の今の記録を、ログインの前の記録と同じ決まり（`backfillOutbox`。初期の部位と種目は変えた項目だけ、消した行は積まない。食事の品目は親の ID を付け、消した食事の品目は積まない）で outbox に積み直します。新しいアカウントを覚えて同期すると、送ったあとにスナップショットから受け取ります。前のアカウントのサーバーの記録はそのまま残ります
  - **端末の記録を消して、新しいアカウントから受け取り直す**：同期の表と、同期する種類の表（`ENTITIES`）をすべて消し、初期の部位と種目を入れ直します（入れたばかりの端末と同じ）。新しいアカウントを覚えて同期すると、スナップショットから受け取ります。前のアカウントに送っていない変更は消えるので、確認の画面に件数を出します
  - **ログアウトする**：何も変えずにログアウトします
- 消す・積み直すあいだは `applying` を置き、トリガーが outbox に積まないようにします。どちらもトランザクションの中で行います
- この仕組みを入れる前に同期していた端末は、`account` がないので、次に同期したアカウントを覚えます（それより前のアカウントが同じだったかは、見分けられません）

### Health Connect の取り込み

Android の端末で、Health Connect から体組成（体重・体脂肪率・除脂肪体重）と睡眠を取り込みます（`lib/healthConnect/importer.ts`、`db/repositories/healthConnect.ts`、`hooks/healthConnect.tsx`）。
権限は読み取りだけ（`READ_WEIGHT`・`READ_BODY_FAT`・`READ_LEAN_BODY_MASS`・`READ_SLEEP`・`READ_HEART_RATE`・`READ_RESTING_HEART_RATE`）で、書き込み・過去のデータ（HISTORY）・バックグラウンドの権限は求めません。睡眠と心拍の権限は、あとで取り込みを足したときに APK を作り直さないよう、先に求めています。

- **いつ読むか**：連携しているとき（設定 → Health Connect →「連携する」）だけ、アプリを開いたとき・前面に戻ったとき・「今すぐ取り込む」で読みます。web と iOS では呼びません（`lib/healthConnect/client.web.ts`、`Platform.OS`）
- **差分**：型ごとに `getChanges` の `changesToken` を `sync_meta` に持ち、変わったものだけを読みます。初めての型は、先にトークンを取ってから過去30日を `readRecords` で全ページ読みます（読んでいるあいだの変更は、次の差分で届く）。トークンが切れていたら、最後に読んだ時刻（なければ30日前）から読み直します
- **書き込みの入口は1つ**：取り込みは `healthConnectStore` の `write` だけで書きます。書き込みの列（`oneAtATime`）に並び、トランザクションの中で `sync_meta` に `importing` を置いて書くので、トリガーは `origin = import` で積みます。トークンと読んだ時刻も同じトランザクションで書き、書けなかったら次は同じところから読みます
- **ID**：`id = uuid5(08e139e3-1bcd-47c7-af17-1a18a473f1c3, "hc:" + Health Connect の記録の ID)`、`external_id` は Health Connect の記録の ID、`origin_package` は記録を書いたアプリ。同じ記録を別の端末で取り込んでも同じ行になり、`body_records` の `UNIQUE (source, external_id)` ともぶつかりません
- **体組成**：Health Connect の1件を `body_records` の1行にします（体重と体脂肪率は別の行。`source = 'health_connect'`）。日付は記録の `zoneOffset` でのその土地の日付です。値は `lib/limits.ts`（サーバーの範囲と同じ）で確かめ、範囲の外は取り込みません。筋肉率は Health Connect に型がないので、手入力だけです
- **睡眠**：Health Connect の `SleepSession` の1件を `sleep_sessions` の1行（`sleep_session`。版5）にします。`date` は起きた日（終わりの時刻の `zoneOffset` でのその土地の日付）、`asleep_min` は全体から段階の「起きていた・ベッドの外・ベッドで起きていた」を引いた分、`awake_min` はその引いた分です（段階がなければ全部を眠っていたとする）。段階の詳細は持ちません。24時間を超えるもの、終わりが始まりより前のものは取り込みません（サーバーも 0〜1440 分で確かめる）。手入力はなく、ほかの記録を指す項目（refs）もありません。体組成のタブに、その日の睡眠（合計と、いちばん長い睡眠の時刻）を小さく出します
- **消したもの**：Health Connect で消えた記録は、端末の行も消します（`delete`、`import`）。アプリで消した取り込みの行（体組成の画面の ×）は、Health Connect で直されても戻しません（同じ `external_id` の行が消えたまま残るため。サーバーでも、取り込みの `create` で消えた記録は戻らない）
- **手入力が先**：1日の値は、項目ごとに手入力の記録（いちばん新しいもの）を使い、手入力がない項目だけ取り込みを使います（`lib/body.ts` の `dailyBodyValues`、サーバーの `daily_body_values`、`testdata/training/body.json`）。体組成の画面では、取り込みの値に「取り込み」の印を付けます。同じ記録の同じ項目を手（アプリ・MCP）で直した値も、サーバーで取り込みより強く当てはめるので、次の取り込みで負けません
- **ログインの前の記録・アカウントを変えたとき**：`backfillOutbox` は、`source = 'health_connect'` の行を `import` で積みます。「端末の記録を消して受け取り直す」では、Health Connect のトークンと読んだ時刻も消し、次の取り込みで過去30日から読み直します。ログアウトではトークンを残します
- **連携を切る**：`revokeAllPermissions` を呼び（Health Connect の決まりで、効くのはアプリを起動し直したとき）、連携の印・トークン・読んだ時刻を消して、すぐに取り込みをやめます。取り込んだ記録は残します
- **権限の説明の画面**：Health Connect の権限の画面の「プライバシー ポリシー」は、`react-native-health-connect` の config plugin が MainActivity に登録する intent（Android 13 までは `ACTION_SHOW_PERMISSIONS_RATIONALE`、14 からは `VIEW_PERMISSION_USAGE` の alias）で開きます。どちらも URL を持たないので、`plugins/withHealthPrivacyIntent.js` が MainActivity でそれを `torelog://health-privacy` に変え、expo-router が `app/health-privacy.tsx` を開きます
- **確かめ方**：取り込み（ID、`import` で積まれる、差分と削除、トークンが切れたとき、範囲の外、手で直した値が負けない、アカウントを変えたとき）は jest（`db/__tests__/healthConnect.test.ts`。Health Connect は `test-utils/fakeHealthConnect.ts` の偽物）。`testdata/sync/conflicts.json` の取り込みの場合は、端末を通すテストで、端末で取り込んで送ります。E2E は、web で Health Connect の画面が壊れないことだけを見ます

### 食事

- 端末の表と列の名前は、同期の項目と同じです（`meals`・`meal_items`・`meal_templates`・`nutrition_goals`・`day_types`）。いつものの品目の一覧と目標の `targets` は、SQLite では JSON の文字列、API ではその値です（`db/syncSpec.ts` の `json`）
- 品目（`meal_item`）は食事の中でだけ一意なので、端末の表は `(meal_id, id)` を主キーにし、outbox に `parent_id` を足しました（版3。品目の変更にだけ付け、送るときに `parent_id` に入れる）。`sync_seen`・`sync_held` では「食事の ID/品目の ID」で指します。食事が端末にないうちは、品目を `sync_held` に取っておきます
- 一覧と合計に出す食事は、サーバー（`meal_from_doc`）と同じ決まりで選びます（`apps/mobile/lib/meals.ts` の `readableMeals`：消えた食事・品目がない食事は出さない、品目は並び順と ID の順）
- 版2までの端末は、食事の状態を当てはめずに受け取りの位置だけ進めていました。版3のマイグレーションで受け取りの位置を消し、次の同期でスナップショットを1回取り直します（サーバーが正本で、消えたものも含めて全部返る。筋トレなどは、当てはめた `seq` より古い状態では上書きしない）
- アプリ → MCP：アプリが送る食事の本文（`testdata/meals/app_push.json`。`apps/mobile/db/__tests__/meals.test.ts` が作る）を、pytest（`services/meals/tests/sync/test_app_push.py`）が本物の `SyncHttpApi` に送り、MCP の `list_meals`・`today_status`・`record_template` から見えることと、2回送っても二重にならないことを確かめます
- 確かめ方：`testdata/meals/summaries.json` の変更を、サーバー（`services/meals/tests/test_shared_testdata.py`）が当てはめた状態（同じ項目は新しい方、削除が勝つ）と、そこからの1日のまとめ・週のふり返りを、アプリ（`apps/mobile/lib/__tests__/meals-shared.test.ts`、`db/__tests__/meals.test.ts`。端末に当てはめて読む）でも同じになることを確かめます

### 確かめ方

- 衝突の決まり：`testdata/sync/conflicts.json` を、サーバー（`services/training/tests/test_shared_sync_testdata.py`）と、アプリ（`apps/mobile/db/__tests__/sync-shared.test.ts`）で流します。アプリでは、偽のサーバー（`test-utils/fakeSyncServer.ts`。当てはめの決まりをサーバーと同じに書いたもの）と、端末を通したもの（端末の変更は端末の表を変えてトリガーで送り、最後に受け取った表を見る）の両方で、同じ結果になることを確かめます
- アプリ → MCP：アプリが送る本文（`testdata/sync/app_push.json`。jest が作る）を、pytest（`services/training/tests/test_app_sync.py`）が本物の `SyncHttpApi` に送り、MCP の `get_workout`・`list_exercises`・`body_progress` から見えることと、2回送っても二重にならないことを確かめます
- MCP → アプリ：pytest が MCP の `record_workout`・`record_body` のあとの受け取りのページを `testdata/sync/mcp_pull.json` と比べ、jest と E2E（`apps/mobile/e2e/sync.spec.ts`）が同じページを端末に当てはめて、画面に出ることを確かめます
- アカウントが変わったとき：止める・送り直す・消して受け取り直すの決まりは jest（`apps/mobile/db/__tests__/sync.test.ts`）、確認の画面が出る流れだけを E2E（`e2e/sync.spec.ts`）で確かめます
- E2E は本物の API に当てず、`execute-api` への通信を偽のサーバーに向けます

## 今あるデータの移行

今の食事・いつもの・目標・日の種類（`MEAL#`・`TEMPLATE#`・`GOAL`・`DAYTYPE#`）には、変更の記録がありません。
移行のスクリプト（`services/meals/scripts/migrate_to_sync.py`）で、1件ずつ `create` の変更に変えて書きます。Lambda には載せません。
本番のテーブルは、2026-11-08 に移行を済ませています。この節の手順は、同期の仕組みを入れる前のデータが残っている環境に、デプロイし直すときのためのものです。

- `origin` は `migration`、`changed_at` はスクリプトを動かした時刻です
- `change_id` は `uuid5(移行の名前空間, pk + sk + 中身のハッシュ + 何番目か)` にします。何度動かしても、中身が同じものは `duplicate` になります
- 古い項目は消しません（もとに戻すときのため）。読む側は `SYNC#STATE#` だけを読みます
- 体重（`WEIGHT#`）は移しません（体重は体組成に一本化し、`WEIGHT#` はもう読みません。一本化の前の体重はテストのデータだけでした）
- 画面に出すのは件数だけです（利用者の ID や記録の中身は出さない）

手順（**デプロイの前に**移します。デプロイのあとに古いコードは動かないので、古い項目はもう変わりません）：

1. 読み取りだけで動かし、件数を確かめる
   ```sh
   cd services/meals
   AWS_PROFILE=yuki AWS_REGION=ap-northeast-1 PYTHONPATH=. uv run python scripts/migrate_to_sync.py --table <MealsTable の名前>
   ```
2. 同じコマンドに `--apply` を付けて書く。ここからデプロイが終わるまで、MCP（Claude・ChatGPT）で食事を記録・修正しない（古いコードで変えたものは、新しいコードから見えないため）。変えてしまったら、デプロイの前にもう一度 `--apply` で動かす
3. デプロイする（MCP が今の状態を読むようになる）
4. 確かめるために、もう一度 `--apply` で動かす。全部 `duplicate` になれば、移し残しはない

`MealsTable` の名前は、`aws cloudformation describe-stack-resources --stack-name CognitoStudy --logical-resource-id MealsTableCAABDBC9` で調べます。
スクリプトはテーブルの全体を読む（`Scan`）ので、管理者の資格情報で動かします（Lambda には `Scan` を与えていません）。

## API と認可

- 入口は新しい HTTP API です。JWT のオーソライザーで、issuer は Cognito、audience はアプリのクライアント ID だけにします（認可API 用のクライアントのトークンを断る）
- ルートごとに scope を必須にします（API Gateway は、並べた scope のどれか1つがあれば通す）。Cognito の ID トークンには `scope` がないので、ここで断られます

| ルート | scope（どれか） |
|---|---|
| `POST /v1/sync/changes` | `torelog-api/meals.write`・`torelog-api/training.write` |
| `GET /v1/sync/changes`、`GET /v1/sync/snapshot` | `torelog-api/meals.read`・`torelog-api/training.read` |
| `POST /v1/meals/goal-suggestions` | `torelog-api/meals.read` |

- 種類ごとの scope は、Lambda がもう一度確かめます（上の表のどれか1つで通るため）
- 利用者は、オーソライザーを通ったあとに API Gateway が渡すクレームの `sub` だけで決めます。本文や URL に利用者の ID は入れません
  - アプリ用の Lambda（`AppApiFunction`、`services/app_api/main.py` の `handler`）は、Lambda Web Adapter を通さず、API Gateway のイベント（`requestContext.authorizer.jwt.claims`）からクレームを読みます。利用者が送るヘッダーは読みません
  - Lambda でも、`token_use` が `access`、`client_id` がアプリのクライアントであることを、もう一度確かめます
  - スナップショットの `page_token` には sk の位置しか入れません。どの pk を読むかはクレームで決まるので、ほかの人の `page_token` を使っても自分の分しか読めません
- Lambda の権限は、食事のテーブル（とその LSI）の `GetItem`・`BatchGetItem`・`Query`・`PutItem` だけです。変更の記録は追記だけなので、`DeleteItem`・`UpdateItem`・`Scan` は与えません
- MCP の認可API のアクセストークンの `sub` は、Cognito の ID トークンの `sub` そのものです（`services/authorization/infrastructure/cognito_login.py`）。アプリのアクセストークンの `sub` も同じ Cognito のユーザーの `sub` なので、同じ人は同じ pk になります
- 流量の制限は、アプリが使い始めるまで1秒2回・瞬間10回にしています。使い始めたら、アプリを開いたときに送信と受け取りのページ送りが続けて数回から十数回届くのに合わせて上げます（MCP は1秒1回・瞬間5回のまま）
- アクセスログは30日残します

## 決めたこと（2026-11-08、本人と合意）

1. **保存先のテーブル**：今の食事のテーブル（`MealsTable`）に `SYNC#…` の項目を足す。pk は今の `EATER#<sub>`。今の LSI `by_day` をそのまま使い、テーブルは変えない（置き換えなし）。筋トレの記録も、名前は「MealsTable」のテーブルに入る（論理 ID は変えられない）
2. **目標の計算**：`POST /v1/meals/goal-suggestions` は計算だけ（MCP の `suggest_goals` と同じ）。保存は同期（`nutrition_goal` の `update`）で行う
3. **日の種類**：本人が決めた日だけを保存する。のちに筋トレの記録から求める結果より、本人が決めたものを優先する
4. **同期のコードの置き場所**：はじめは `services/meals/sync/` に置く案だったが、境界づけられたコンテキストの考え方に合わせて変えた（下の「コードの置き場所」）
5. **アプリのリフレッシュトークンの猶予**：10秒

## コードの置き場所

| 場所 | 中身 | 知っているもの |
|---|---|---|
| `services/sync/`（パッケージ `sync`） | 変更の記録と当てはめ（`model.py`）、種類の登録と変更の確かめ（`registry.py`、`fields.py`）、冪等とカーソル（`engine.py`）、保存先（`store.py`）、同期の API の入口（`presentation/http_api.py`） | どのコンテキストも知らない |
| `services/meals/meals/infrastructure/sync_entities.py` | 食事の5つの種類を登録する | 食事、sync |
| `services/meals/meals/infrastructure/sync_repositories.py` | MCP の読み書き（今の状態を読み、変更の記録を通して書く） | 食事、sync |
| `services/meals/meals/presentation/app_routes.py` | `POST /v1/meals/goal-suggestions` | 食事、sync の入口の型 |
| `services/training/training/infrastructure/` | 筋トレの6つの種類を登録する、MCP の読み書き（今の状態を読み、変更の記録を通して書く） | 筋トレ、sync |
| `services/app_api/main.py` | アプリ用の Lambda の組み立て。登録とルートをまとめる | すべて |
| `services/mcp/main.py` | MCP サーバーの Lambda の組み立て。食事と筋トレのツールをまとめる | すべて |

依存の向きは、コンテキスト（食事・筋トレ）→ sync です。sync はコンテキストを import しません。

### パッケージの分け方と、Lambda へのまとめ方

- **uv の path の依存**（`[tool.uv.sources] sync = { path = "../sync", editable = true }`）にしました。[uv の資料](https://docs.astral.sh/uv/concepts/projects/dependencies/#path)の書き方どおりで、`editable` にすると、`sync` を直したらすぐ meals・training のテストに効きます
  - uv のワークスペースにすると、ロックファイルが1つになり、CI のジョブ（サービスごとに `uv sync --locked` と、`uv.lock` でのキャッシュ）を作り直すことになります。サービスごとのロックと CI の形を保つため、path の依存にしました
- `sync`・`meals`・`training` はパッケージ（ビルドのバックエンドは `uv_build`）にし、インポートの名前に `sync`・`meals`・`training` を付けます。トップレベルの名前がぶつからないよう、食事は `meals.domain`、筋トレは `training.domain` のように名前空間の下に置きます
- `services/app_api`・`services/mcp` は、`sync`・`meals`・`training` を path の依存で入れます（MCP のツールを使う `services/mcp` だけ、extra の `mcp` も入れる）
- Lambda（`cdk/build-lambda.sh`）では、外部の依存を `uv export --no-emit-local` で書き出して Lambda 用の wheel を入れ、同じリポジトリのパッケージ（`sync`・`meals`・`training`）はソースをコピーします。wheel を作るより速く、中身がそのまま見えます。`__pycache__` は載せません
