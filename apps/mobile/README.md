# トレログ（仮）

筋トレと体組成を記録するスマホのアプリです。Expo（SDK 58）と expo-router で作り、Pixel（Android）で使う前提です。

記録は端末の SQLite にだけ保存します。第2段階の最初として、設定の画面からログイン（任意）できるようになりました。ログインしても、同期はまだしません（次に入れます）。アプリを消すと記録も消えるので、残したいときは設定の画面から CSV で書き出します。

## できること

- 筋トレの記録：種目を選び、重量・回数・メモを入れる。前回の表示とコピー、自己ベスト、種目の並べ替え
- ホーム：総負荷量（7日・28日・総合計）、週ごとの棒、カレンダー、推定1RM
- 履歴と分析：カレンダー、種目ごとのグラフ、自己ベスト
- 体組成：体重・体脂肪率・筋肉率・ウエスト、BMI などの計算、推移、目標体重までのペース
- 設定：kg と lb、セット数の初期値、身長と目標体重、CSV の書き出し
- RM計算機、種目と部位の追加・名前の変更・非表示
- ログイン（任意）：設定 → ログイン。Cognito のマネージドログインにパスキーで入り、アプリ用の API に1回つないで確かめる（下の「ログイン」）

画面ごとにできることは次のとおりです。

| 画面 | できること |
|---|---|
| ホーム | 合計負荷量（7日間・28日間・総合計）、今日の記録と推定1RM。「本日のトレーニングを追加」と RM計算機への入口。カレンダーで今月の過去の日を押すと、その日の記録を見て「〇月〇日のトレーニングを追加」で足せる（「今日に戻る」で戻す。未来の日は押せない） |
| トレーニング（その日の記録） | その日の種目の一覧（種目数・セット数・合計負荷量）。種目の追加、↑↓ での並べ替え、種目を押して記録を直す・消す。過去の日なら、その日に記録していることを上に出す（種目の選択・記録の入力も同じ。前回・自己ベスト・何種目目はその日を基準にする） |
| 種目を選ぶ | 検索、部位で絞る、部位ごとの一覧、種目ごとの前回の記録。種目の追加 |
| 記録の入力 | セットごとの重量・回数・完了。前回の記録の表示とコピー、上のセットのコピー、セットの追加、元に戻す |
| 履歴／分析 | 月のカレンダー（部位・種目で絞る。選んだ日に種目を足せる）、種目ごとの総負荷量と推定1RM のグラフ、週ごとの総負荷量、種目ごとの自己ベスト（推定1RM） |
| 体組成 | 日ごとに体重・体脂肪率・筋肉率・ウエストを入れる。BMI などの計算（身長を設定したとき）、目標体重までの残り、1か月の体重の推移 |
| 体組成の推移 | 項目ごとの推移のグラフと記録の一覧 |
| RM計算機 | 重量と回数から推定1RM（重量 ×（1 ＋ 回数 ÷ 30））と、割合ごとの重量・回数の目安 |
| 種目と部位の管理 | 種目と部位の追加、名前の変更（種目は部位も、種目を押して編集の画面で）。使わなくなった種目・部位は消さずに非表示にする（記録は残る。部位の非表示はアプリだけでできる） |
| 設定 | 重さの単位（kg・lb）、セット数の初期値、身長と目標体重、筋トレの記録の CSV の書き出し、ログインへの入口 |
| アカウント（ログイン） | パスキーでのログイン（任意）、アプリ用の API とのつながりの確認、ログアウト |
| 食事 | 準備中（タブだけあり、第2段階で使えるようにする） |

## 動かし方

Node の版は `.node-version` で決めています。[fnm](https://github.com/Schniz/fnm) で合わせます。

```sh
cd apps/mobile
fnm install && fnm use   # .node-version の版を入れて使う
npm ci
npx expo start
```

スマホに Expo Go を入れ、画面に出た QR コードを読み取ると開きます。PC とスマホは同じ Wi-Fi につないでおきます。

- **同じ Wi-Fi でもつながらないとき**：ルーターが端末どうしの通信を止めている（ゲスト用の Wi-Fi など）か、PC のファイアウォールが Metro のポート（8081）を止めていることがあります。`npx expo start --tunnel` なら、インターネット経由でつなげます（初めてのときは `@expo/ngrok` を入れるか聞かれます）
- **ログインは Expo Go ではできません**（戻り先の `torelog://callback` を Expo Go が受け取れないため）。開発ビルド（`eas build --profile development`）か、配った APK で使います
- ブラウザで見るときは `npx expo start --web` です。web でも expo-sqlite が動くよう、`metro.config.js` に設定を足しています（[E2E テスト](e2e/README.md#expo-sqlite-を-web-で動かすための設定)）

## ログイン

Cognito のマネージドログイン（MCP と同じユーザーのパスキー）に、認可コード＋PKCE でつなぎます。設計は [docs/design.md](../../docs/design.md#スマホアプリトレログのログイン) にあります。

1. 設定 → ログイン →「パスキーでログイン」で、Chrome Custom Tabs にログインの画面が開く（毎回 `prompt=login`）
2. パスキーで入ると `torelog://callback` に戻り、認可コードをトークンに換える（`lib/auth/session.ts`。シークレットは使わない）
3. 換えたあと（うまくいかなくても）、同じブラウザで Cognito の `/logout` を開いてセッションの Cookie を消し、`torelog://signout` で自動で閉じる。Cookie が残る1時間のあいだ、`torelog://` を登録した別のアプリが画面なしでコードを受け取れてしまうため
4. 確認として、アプリ用の API（`GET /v1/sync/changes?after=0&limit=1`）を1回呼んで「つながりました」と出す（`lib/api.ts`）

- トークンは expo-secure-store（Android の Keystore で暗号化。自動バックアップから外す）にだけ置く。ID トークンは求めない（scope は `torelog-api/` の4つだけ）。web は安全な保存先がないので、メモリーにだけ置く
- アクセストークンは15分。切れる1分前から、リフレッシュトークン（30日、使うたびに新しくなる）で更新する。リフレッシュトークンが切れていたら、ログインしていない状態に戻して知らせる
- ログアウト：端末のトークンを消してから、Cognito の `/oauth2/revoke` でリフレッシュトークンを取り消す
- 値（クライアント ID、Cognito のドメイン、API の URL）は `app.json` の `extra.torelog`。どれも秘密ではない（`cdk deploy` の出力 `AppClientId`・`CognitoDomain`・`AppApiUrl`）。変えたあと web で確かめるときは `npx expo export --platform web --clear`（Metro の変換のキャッシュに古い値が残る）
- 画面の道：`app/account.tsx`（ログイン）、`app/callback.tsx`（web の戻り先）、`app/+native-intent.tsx`（`torelog://callback`・`torelog://signout` で画面を動かさない）。状態は `hooks/auth.tsx` がアプリ全体で持ち、次の段階の同期もこれを使う

## テスト

```sh
npx tsc --noEmit   # 型チェック
npx expo lint      # ESLint（eslint-config-expo。設定は eslint.config.js）
npx jest           # 計算の関数（lib/__tests__）と、DB のリポジトリ（db/__tests__）
npx expo-doctor    # Expo の設定と依存の版を確かめる
```

jest の DB のテストは、expo-sqlite の代わりに Node の `node:sqlite`（メモリー上）を使います（`test-utils/nodeDb.ts`）。

画面の E2E テストは、Expo の web 向けの書き出しを Playwright で操作します。動かし方と書き方の決まりは [e2e/README.md](e2e/README.md) にあります。

CI（`.github/workflows/test.yml`）では、型チェック・lint・jest・E2E を動かします。

## Pixel への配信

EAS Build で APK を作って Pixel に入れ、JS の変更は EAS Update で配信します（Play ストアには出しません）。設定の中身と、Expo のアカウントの作り方からの手順は [docs/eas.md](docs/eas.md) にあります。

- `.github/workflows/eas-update.yml`：main の test が通ったあと、`apps/mobile/` が変わっていれば `preview` のチャンネルに配信する
- `.github/workflows/eas-build.yml`：手動で APK を作る（ネイティブを変えたとき）

## フォルダの構成

| フォルダ | 中身 |
|---|---|
| `app/` | 画面。expo-router がファイルの名前で道を決める（`(tabs)/` は下のタブ、`workout/` は筋トレの記録、`exercises/` は種目の管理） |
| `components/` | 画面で使う部品（文字、カード、アイコン、カレンダー、グラフ） |
| `hooks/` | 画面から DB を読む処理（`data.ts`）、入力の途中で戻るときの確認（`confirmDiscard.tsx`）、ログインの状態（`auth.tsx`） |
| `db/` | SQLite。表の定義（`migrations.ts`）、初期の部位と種目（`seed.ts`）、読み書き（`repositories/`）。書き込みは1つずつ順に行う（`serial.ts`） |
| `lib/` | 計算と変換（負荷量、推定1RM、体組成、単位、日付、入力の範囲、CSV）、ログインのトークンの扱い（`auth/`）、アプリ用の API のクライアント（`api.ts`）。画面や DB に依存しない |
| `theme/` | 色と文字 |
| `e2e/` | 画面の E2E テスト（Playwright） |
| `docs/` | Pixel への配信（EAS）の手順 |
| `test-utils/` | jest で使う、メモリー上の DB |
| `assets/` | アイコンとスプラッシュの画像 |

どの表も、のちにサーバーと同期できるように、ID（UUID）、作成・更新の時刻、論理削除の列を持ちます（`db/migrations.ts`）。

## 依存の更新

- Expo の SDK が版を決めるもの（`node_modules/expo/bundledNativeModules.json` に載っているもの。`expo-*`、`react`、`react-native`、`react-native-*` など）は、`npm install` で版を指定せず、`npx expo install <名前>` で入れます。SDK を上げるときは `npx expo install --fix` で揃えます
- Dependabot（`.github/dependabot.yml`）も同じ考え方で、これらの版の更新の PR を作りません。依存を足すときは、`bundledNativeModules.json` に載っていれば、Dependabot の ignore にも足します
- それ以外（jest、Playwright など）は、Dependabot の PR で上げます
- 上げたあとは `npx expo-doctor` で、版が SDK と合っているかを確かめます

## 次の段階で入れるもの

- サーバーとの同期。端末に先に保存し、つながったときに変更を送り合う（サーバーの側はデプロイ済み。ログインは入った）
- 食事の記録と目標（MCP の食事記録と同じデータを使う）
- Health Connect からの取り込み（睡眠・心拍・体重計（体重・体脂肪など））。体組成の表の `source`・`external_id`・`origin_package`・`lean_mass_kg` は、そのために置いています
