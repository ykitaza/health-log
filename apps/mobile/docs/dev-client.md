# 開発用のアプリ hlog (dev)

開発中は、EAS Update で配信せずに、PC の Metro から Pixel に直接 JS を送ります。
保存するとすぐアプリに反映され、落ちたときのエラーは PC の端末に出ます。

hlog (dev) は、ふだん使う hlog とは別のアプリとして並べて入ります。

| | hlog（ふだん使い） | hlog (dev)（開発用） |
|---|---|---|
| パッケージ名 | `com.ykitaza.torelog` | `com.ykitaza.torelog.dev` |
| scheme | `torelog` | `torelog-dev` |
| ビルド | `eas.json` の `preview` | `eas.json` の `development`（`APP_VARIANT=development`） |
| JS | EAS Update（`preview` のチャンネル） | PC の Metro |

切り替えは `app.config.ts` にあります。`APP_VARIANT` がないときは `app.json` をそのまま使うので、preview の fingerprint は変わりません。
データ（SQLite）とログインは、2つのアプリで別々です。

## 開発のしかた

1. Pixel を USB で PC につなぐ（開発者向けオプションの USB デバッグを有効にしておく）。`adb devices` に出ることを確かめる
2. Pixel から PC の Metro に届くようにする

   ```sh
   adb reverse tcp:8081 tcp:8081
   ```

3. `apps/mobile` で Metro を起動する。**`APP_VARIANT=development` を付ける**（付けないと、アプリが読む設定の scheme が `torelog` になり、ログインの戻りが hlog (dev) に届かない）

   ```sh
   APP_VARIANT=development npx expo start --dev-client
   ```

4. Pixel で hlog (dev) を開き、`http://localhost:8081` を選ぶ
5. コードを保存すると、すぐアプリに反映される。落ちたときのエラーと `console.log` は、Metro を起動した PC の端末に出る

USB を抜き差ししたら、`adb reverse` をもう一度します。

## hlog (dev) のビルド

ネイティブの部分（ライブラリ、Expo の SDK、`app.json` のプラグインなど）を変えたときだけ、作り直します。

```sh
cd apps/mobile
npm install --no-save expo-dev-client@~58.0.20   # eas-cli の確認を通すため（package.json は変えない）
eas build --profile development --platform android
```

できた APK を Pixel に入れます（EAS のページの QR、または `adb install`）。

### expo-dev-client を package.json に入れない

`expo-dev-client` は `package.json` に入れず、EAS のビルドの中でだけ入れます（`.eas/build/development-android.yml`）。
`package.json` に入れると、次の2つが起きるためです。

- 自動リンクのネイティブの依存が増え、fingerprint の runtimeVersion が変わる。入っている hlog の APK に、配信が届かなくなる
- prebuild が expo-dev-client の config plugin を自動で当てるので、preview の APK の中身も変わる

`eas build` を打つ前に `expo-dev-client` が手元にないと、eas-cli が「入れますか」と聞きます。**ここで Yes と答えない**でください。`package.json` に足され、上の2つが起きます。
`npm install --no-save` で入れたものは自動リンクの対象にならないので、手元の fingerprint（`eas update` の runtimeVersion）は変わりません。`npm ci` をすると消えます。

## ログイン

ログインの戻り先は、hlog (dev) では `torelog-dev://callback`、Cookie を消したあとの戻り先は `torelog-dev://signout` です。
どちらも Cognito のアプリクライアント（torelog-app）に登録してあります（`cdk/lib/infra-stack.ts`）。

チャットの返事の「hlog に戻る」リンクは、`torelog://` を開くので、ふだん使いの hlog が開きます。
