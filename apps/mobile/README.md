# トレログ（仮）

筋トレと体組成を記録するスマホのアプリです。Expo（SDK 58）と expo-router で作り、Pixel（Android）で使う前提です。

今は第1段階で、記録は端末の SQLite にだけ保存します。サーバーとはつながりません。アプリを消すと記録も消えるので、残したいときは設定の画面から CSV で書き出します。

## できること

- 筋トレの記録：種目を選び、重量・回数・メモを入れる。前回の表示とコピー、自己ベスト、種目の並べ替え
- ホーム：総負荷量（7日・28日・総合計）、週ごとの棒、カレンダー、推定1RM
- 履歴と分析：カレンダー、種目ごとのグラフ、自己ベスト
- 体組成：体重・体脂肪率・筋肉率・ウエスト、BMI などの計算、推移、目標体重までのペース
- 設定：kg と lb、セット数の初期値、身長と目標体重、CSV の書き出し
- RM計算機、種目と部位の追加・非表示

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
- ブラウザで見るときは `npx expo start --web` です。web でも expo-sqlite が動くよう、`metro.config.js` に設定を足しています（[E2E テスト](e2e/README.md#expo-sqlite-を-web-で動かすための設定)）

## テスト

```sh
npx tsc --noEmit   # 型チェック
npx jest           # 計算の関数（lib/__tests__）と、DB のリポジトリ（db/__tests__）
npx expo-doctor    # Expo の設定と依存の版を確かめる
```

jest の DB のテストは、expo-sqlite の代わりに Node の `node:sqlite`（メモリー上）を使います（`test-utils/nodeDb.ts`）。

画面の E2E テストは、Expo の web 向けの書き出しを Playwright で操作します。動かし方と書き方の決まりは [e2e/README.md](e2e/README.md) にあります。

CI（`.github/workflows/test.yml`）では、型チェック・jest・E2E を動かします。

## Pixel への配信

EAS Build で APK を作って Pixel に入れ、JS の変更は EAS Update で配信します（Play ストアには出しません）。設定の中身と、Expo のアカウントの作り方からの手順は [docs/eas.md](docs/eas.md) にあります。

- `.github/workflows/eas-update.yml`：main の test が通ったあと、`apps/mobile/` が変わっていれば `preview` のチャンネルに配信する
- `.github/workflows/eas-build.yml`：手動で APK を作る（ネイティブを変えたとき）

## フォルダの構成

| フォルダ | 中身 |
|---|---|
| `app/` | 画面。expo-router がファイルの名前で道を決める（`(tabs)/` は下のタブ、`workout/` は筋トレの記録、`exercises/` は種目の管理） |
| `components/` | 画面で使う部品（文字、カード、アイコン、カレンダー、グラフ） |
| `hooks/` | 画面から DB を読む処理（`data.ts`）、入力の途中で戻るときの確認（`confirmDiscard.tsx`） |
| `db/` | SQLite。表の定義（`migrations.ts`）、初期の部位と種目（`seed.ts`）、読み書き（`repositories/`）。書き込みは1つずつ順に行う（`serial.ts`） |
| `lib/` | 計算と変換（負荷量、推定1RM、体組成、単位、日付、入力の範囲、CSV）。画面や DB に依存しない |
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

- ログイン（Cognito）とサーバーとの同期
- 食事の記録と目標（MCP の食事記録と同じデータを使う）
- 体重計の記録の取り込み（Health Connect）。体組成の表の `source`・`external_id`・`origin_package`・`lean_mass_kg` は、そのために置いています
