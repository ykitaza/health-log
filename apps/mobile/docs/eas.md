# Pixel への配信（EAS）

hlog を、Expo の EAS（Expo Application Services）で APK にして、自分の Pixel に入れます。Play ストアには出しません。

- **EAS Build**：APK を Expo のサーバーで作る。ネイティブの部分（ライブラリ、Expo の SDK）を変えたときに作り直す
- **EAS Update**：JS と画像だけを、入っている APK に配信する。main に入った変更は、GitHub Actions が自動で配信する

この文書は2026年11月8日に、Expo と Google の公式の情報で確かめて書きました。

## 設定の中身

| ファイル | 設定 | 理由 |
|---|---|---|
| `app.json` | `android.package`：`com.ykitaza.torelog` | アプリの ID。[最初のビルドのあとは変えない](#androidpackage-は変えない) |
| `app.json` | `scheme`：`torelog` | 第2段階のログインの戻り先（`torelog://callback`）に使う |
| `app.json` | `runtimeVersion`：`{"policy": "fingerprint"}` | [下を参照](#runtimeversion-の方針) |
| `app.json` | `updates`：`checkAutomatically` は `ON_LOAD`、`fallbackToCacheTimeout` は `0` | 起動のたびに新しい JS を確かめ、取ってきたものは次の起動で使う（どちらも既定の値。起動を待たせない） |
| `app.json` | `extra.eas.projectId`、`updates.url` | まだ書いていない。手順3で、Expo の CLI が書き足す |
| `eas.json` | `preview` | APK・内部配信。チャンネルは `preview`。普段使うもの |
| `eas.json` | `development` | 開発ビルド・内部配信。第2段階のログインや Health Connect を試すときに使う（開発ビルドは APK になり、どのチャンネルの配信も読めるので、`buildType` と `channel` は書かない） |
| `eas.json` | `cli.version`：`>= 27.5.0` | 確かめた EAS CLI の版より古いものでは動かさない |
| `eas.json` | `cli.appVersionSource`：`remote` | `versionCode` を Expo のサーバーで数え、`preview` のビルドのたびに1つ上げる（`autoIncrement`）。公式が勧める方法 |
| `.github/workflows/eas-update.yml` | JS の配信 | main の test が通ったあと、`apps/mobile/` が変わっていれば `preview` に配信する |
| `.github/workflows/eas-build.yml` | APK のビルド | 手動で動かす |

`production` のプロファイルは作っていません。公式では、`production` はストアに出すためのもので、既定で AAB（ストアからしか入れられない形式）になります。ストアに出さないので要りません。

### runtimeVersion の方針

`runtimeVersion` は、APK のネイティブの部分と、配信する JS が合っているかを見分けるための値です。合わない JS を配信すると、APK にないネイティブのコードを呼んで落ちます。

`fingerprint` を選びました。ネイティブに関わるもの（ネイティブのライブラリ、Expo の SDK、`app.json` のネイティブの設定）が変わると、値が自動で変わります（[Runtime versions](https://docs.expo.dev/eas-update/runtime-versions/)、[expo-updates](https://docs.expo.dev/versions/latest/sdk/updates/#fingerprint)）。

- `appVersion` と手で決める値は、ネイティブを変えたのに上げ忘れると、合わない JS が配信される。公式も、合わない配信を「ほぼ起こさない」ためには `fingerprint` を挙げている
- `fingerprint` の短所は、ビルドを作り直す回数が増えること。1人で使うアプリで、無料の枠（月15回）に十分おさまる
- 値の材料は、`app.json` の中身（と、そこから参照するアイコンなどの画像）、ネイティブのライブラリの自動リンクの結果、`package.json` の `scripts`、`.gitignore` です（`npx expo-updates runtimeversion:resolve --platform android` で見られる）。`scripts` や `.gitignore` を変えただけでも値が変わり、APK を作り直すまで配信が届かなくなります。`docs/` や `eas.json`、画面のコードは材料に入りません
- ネイティブを変えた JS が main に入ると、CI は新しい `runtimeVersion` に向けて配信する。入っている APK とは値が違うので、その配信は届かない（落ちない）。APK を作り直すと届く

## ユーザーがすること

### 1. Expo のアカウントを作る

[expo.dev/signup](https://expo.dev/signup) で作ります（無料）。2段階認証を有効にします。

### 2. CLI でログインする

```sh
cd apps/mobile
npx eas-cli login
npx eas-cli whoami   # ログインできたかを確かめる
```

### 3. プロジェクトを作り、`app.json` に ID と配信先を入れる（PR にする）

```sh
git switch -c eas-init
cd apps/mobile
npx eas-cli init               # Expo にプロジェクトを作り、app.json の extra.eas.projectId に ID を書く
npx eas-cli update:configure   # app.json の updates.url に https://u.expo.dev/<projectId> を書く
git diff                       # 下の3つだけが変わっているかを確かめる
```

`app.json` に入るのは次のものです。

- `expo.extra.eas.projectId`：プロジェクトの ID（`eas init`）
- `expo.updates.url`：`https://u.expo.dev/<projectId>`（`eas update:configure`。`checkAutomatically` などはそのまま残る）
- `expo.owner`：Organization のアカウントでプロジェクトを作ったときだけ

`runtimeVersion` は `{"policy": "fingerprint"}` のまま変わらないはずです（`update:configure` は、すでにあれば書き換えません）。変わっていたら戻します。

`projectId` は秘密の値ではありません（配信の URL にも入ります）。コミットして PR にし、main に入れます。

**`updates.url` がないまま APK を作ると、その APK は配信を受け取りません**（`eas build` は `updates.url` を書き足しません）。手順4の前に、必ずこの手順を済ませます。

### 4. 最初の APK を作る

```sh
cd apps/mobile
npx eas-cli build --profile preview --platform android
```

- 署名の鍵（keystore）を聞かれたら、EAS に作らせます（`Generate a new Android Keystore?` に Yes）。鍵は Expo のサーバーに置かれ、リポジトリには入りません
- 無料のプランは順番待ちの列が後回しで、ビルドの時間は45分までです
- 終わると、APK のダウンロードの URL と QR コードが出ます。[expo.dev](https://expo.dev) のプロジェクトの Builds からも見られます

### 5. Pixel に入れる

1. Pixel で、手順4の URL を開くか、QR コードを読み取り、APK をダウンロードする
2. 開くと「不明なアプリのインストール」の許可を求められるので、ダウンロードに使ったアプリ（Chrome など）に許可を与える（設定 → アプリ → 特別なアプリアクセス → 不明なアプリのインストール）
3. Play プロテクトの警告が出たら、内容を確かめてインストールする
4. 入れ終わったら、ダウンロードに使ったアプリの許可は戻してよい

PC と USB でつなぐなら、`adb install <ファイル>.apk` でも入れられます。

### 6. CI 用のトークンを作り、GitHub に置く

#### 6-1. トークンを作る（権限を絞る）

Expo のダッシュボードの [Access tokens](https://expo.dev/settings/access-tokens) で作ります。

- **ロボット用のユーザー（Robot users）を作り、ロールを `Developer` にして、そのトークンを作ります**。ロボット用のユーザーは、Expo の製品にサインインできず、トークンでしか使えません（[Programmatic access](https://docs.expo.dev/accounts/programmatic-access/)）
- `Developer` は、ビルド・配信・署名の鍵の管理ができるロールです。1つ下の `Runner` は「プロジェクトを見て、危険の小さい操作をする」ロールで、ビルドや配信ができるとは書かれていません。なので `Developer` にします（[ロールの表](https://docs.expo.dev/accounts/account-types/#manage-access)）
- ロボット用のユーザーの画面が個人のアカウントに出ないときは、個人用のトークンを **Limit access** を付けて作ります（Only selected accounts で自分のアカウントだけを選び、ロールを `Developer` にする）。この文書を書いたときは、個人のアカウントでロボット用のユーザーを作れるかを、公式の文書で確かめられませんでした
- トークンは作ったときに1回だけ表示されます。手順6-2で GitHub に入れたら、手元には残しません

#### 6-2. GitHub の environment に置く

リポジトリの Settings → Environments で、environment `expo` を作ります（ワークフローがすでに1回動いていれば、保護なしで作られています。その場合は開いて設定します）。

1. **Deployment branches and tags** を `Selected branches and tags` にし、`main` だけを足す（main 以外のブランチから動かしたワークフローは、この environment の秘密を読めない）
2. **Environment secrets** に `EXPO_TOKEN` として、手順6-1のトークンを入れる
3. 必要なら **Required reviewers** に自分を入れる（配信とビルドのたびに承認が要るようになる）

リポジトリ全体の secret（Settings → Secrets and variables → Actions の Repository secrets）には置きません。

`EXPO_TOKEN` がないあいだ、ワークフローは失敗せずに、理由を出して飛ばします。

### 7. 以後の流れ

| 変えたもの | すること |
|---|---|
| JS・画像だけ（画面、計算など） | PR を main に入れるだけ。test が通ると `eas-update` のワークフローが `preview` に配信する。Pixel でアプリを2回起動し直すと入る（1回目の起動で取ってきて、次の起動で使う） |
| ネイティブ（ライブラリを足す、`npx expo install --fix` で SDK を上げる、`app.json` のネイティブの設定） | main に入れたあと、GitHub の Actions → `eas-build` → Run workflow（main）で APK を作り、手順5と同じように入れる。上書きで入るので、記録は消えない |

- `eas-update` は、手動でも動かせます（Actions → `eas-update` → Run workflow。main だけ）。そのときは `apps/mobile/` が変わったかを見ずに配信します
- 自動の配信は、main の最新のコミットとその1つ前（first parent）の差で `apps/mobile/` の変更を見ます。PR のマージコミットなら PR の全部の変更が入ります。いくつものコミットを main に直接 push したときは最後のコミットだけを見るので、漏れたら手動で動かします
- ネイティブを変えたかどうかが分からないときは、`npx expo-doctor` のあとに APK を作り直せば確実です。作り直さなくても、`fingerprint` のおかげで合わない JS は届きません

## 気をつけること

### android.package は変えない

`android.package`（`com.ykitaza.torelog`）は、Android がアプリを見分ける ID です。変えると、別のアプリとして入ります。

- 記録は端末の SQLite にだけあるので、ID を変えると、前のアプリの記録は新しいアプリから見えません
- EAS の署名の鍵も ID ごとに作られます

変えるなら、設定の画面から CSV で書き出してからにします。

### アンインストールしない・署名の鍵を作り直さない

記録は端末の中にだけあります。APK は、同じ鍵で署名したものなら上書きで入り、記録は残ります。

- 鍵を作り直す（`eas credentials` で消す）と、上書きで入らなくなり、アンインストールが要ります。そのときは記録が消えます
- アンインストールする前は、必ず CSV で書き出します

### 開発ビルド（第2段階）

`development` のプロファイルで作るには、`expo-dev-client` が要ります。今は入れていません。入れると、`npx expo start` が既定で Expo Go ではなく開発ビルドを開くようになり、今の Expo Go での動かし方が変わるためです（[Expo CLI](https://docs.expo.dev/more/expo-cli/#develop)。Expo Go で開くときは `npx expo start --go`）。

第2段階で使うときに、次のようにします。

```sh
npx expo install expo-dev-client
npx eas-cli build --profile development --platform android
```

開発ビルドと preview の APK は、同じ `android.package` なので、Pixel には片方しか入りません（入れると置き換わる）。両方を並べて入れたいときは、[Install app variants on the same device](https://docs.expo.dev/build-reference/variants/) の方法で ID を分けます。

## 費用

無料のプラン（Free）で足ります（[料金](https://expo.dev/pricing)、[プラン](https://docs.expo.dev/billing/plans/)）。

| | 無料の枠 |
|---|---|
| EAS Build | Android と iOS がそれぞれ月15回。順番待ちは後回し（low priority）。1回45分まで |
| EAS Update | 月のアクティブユーザー（MAU）1,000人。配信を1回以上受け取った端末を、月ごとに1つと数える |

- 無料のプランでは、枠を超えても料金はかかりません（[プラン](https://docs.expo.dev/billing/plans/#plans)）
- ビルドの枠を使い切ると、翌月1日に戻るまでビルドできません。すぐに要るときは、有料の Starter（月19ドル）に上げるか、手元でビルドします（[FAQ](https://docs.expo.dev/billing/faq/#what-happens-when-i-use-up-the-free-plans-monthly-quota)）
- Update の MAU を超えたときに、無料のプランでどうなるかは、公式の文書に書かれていませんでした。使う端末は Pixel 1台なので、超えることはありません

## Google の開発者確認（ストアを通さないアプリ）

Google は、認定された Android 端末（Android 7 以上）に入れるアプリについて、開発者の本人確認とパッケージ名の登録を求める方針を進めています（[Android developer verification](https://developer.android.com/developer-verification)、[FAQ](https://developer.android.com/developer-verification/guides/faq)）。2026年11月8日に確かめた内容です。

- **始まる時期**：2026年9月30日から、ブラジル・インドネシア・シンガポール・タイで、参加するストアから入れるアプリに対して始まった。2027年に全世界へ広げる予定
- **日本**：公式のページに、日本で始まる日の記載はない。2027年の全世界への展開に含まれると読めるが、日付はわからない
- **ストアを通さずに入れる場合（この文書の手順5）**：2026年9月30日の段階では、参加するストア以外からの導入（サイドロード）には、まだ求められない（FAQ、2026年7月15日の更新）。2027年の全世界への展開のあとは、登録していないアプリを入れるには、端末の側で「advanced flow」（未確認の開発者のアプリを入れるための、1回だけの設定。FAQ では2026年8月に始まるとされている）を済ませる必要があると読める
- **`adb` で入れる場合**：確認は要らない（FAQ：「ADB で入れるアプリは確認が要らない」）
- **個人で少しだけ配るためのアカウント（limited distribution）**：無料で、政府の発行する身分証は要らない。Google アカウントの2段階認証と、Google の支払いのプロフィールが要る。共有できる端末の数は、FAQ では20台、limited distribution のページでは50台と書かれていて、食い違っている

いま（2026年11月）の日本では、手順5の入れ方に影響はありません。2027年に向けて、次のどちらかを選びます。日付が決まったら、この節を直します。

- limited distribution のアカウントを作り、`com.ykitaza.torelog` を登録する
- Pixel を PC とつなぎ、`adb install` で入れる（確認が要らない）

## 配信の改ざんへの備え（コードの署名は使わない）

expo-updates のコードの署名は、EAS の有料プラン（Production 以上）でしか使えないため、入れていません（2026-11-08 に試し、配信が「EAS Update code signing requires a subscription」で断られたので取りやめた）。代わりに、次で配信の乗っ取りを防ぎます。

- Expo のアカウントに2段階認証を付ける
- 配信に使う `EXPO_TOKEN` は、ロボット（役割は Developer）のトークンにし、GitHub の environment `expo`（main だけから使える）に置く
- トークンが漏れたと思ったら、Expo の Access tokens でロボットのトークンを消し、新しく作り直して登録し直す
