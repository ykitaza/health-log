# ことば（apps/words）

本や会話で出会った日本語の表現を拾い、聞いて、自分の言葉にしていくアプリ。設計は [docs/words-design.md](../../docs/words-design.md)、
サーバーとの約束は [docs/api/words-app-api.yaml](../../docs/api/words-app-api.yaml) と [testdata/words](../../testdata/words)。
KARADA（apps/karada）とは別の Expo のアプリで、ログイン（Cognito の torelog-app、パスキー）だけを共通にする。

## 画面

下のタブは、ホーム・拾った・手札・聞く の 4 つ。設定へは、どのタブの見出しの右の歯車からでも行ける。

| タブ・画面 | 中身 |
|---|---|
| ホーム（タブ） | 上から、書き留める欄（1 行の欄と右に「AI で拾う」。書くと「拾う」と場所・題などが開く）、今週の一文（「今週は N 語。使えた M。」）と今週の落款（押すと記録）、今日の手札（聞くと同じ並びで 3 つ）、「▶ 手札を聞く」（N 語・約 M 分。聞くへ）、最近拾った（出会った場所つき）。0 の週も責めない |
| 書き留める欄（ホームの上・拾う） | 表現・出会った場所（チップ。編集で足す・名前を変える・並べ替える・隠す）・題・場面・例文・使いたい、たたんだ「探すときの手がかり」（使う場面・気持ち・こういう時に）、拾う、AI で拾う |
| 拾った（タブ） | 本・人ごとのまとまり、絞り込み（★・未記入・AI から・手札・自分の言葉・場所）、横にすべらせて手札に入れる。虫めがね（探す）、歯車（設定） |
| 探す（拾ったの虫めがね） | 文字（端末の SQLite の search_key）と、場面・気持ち・硬さ・場所と本・時期・置き場所・★の絞り込み。場面で（硬さごと） |
| 手札（タブ） | 10 の枠、段階と「そろそろ」。空いた枠は「拾ったから選ぶ」。上の「聞く」で手札だけを流す |
| 聞く（タブ） | 運転中に耳で聞く。大きな再生・前・次。並びは手札の期限 → 手札 → ★ → 最近拾ったもの。読む速さ・くり返し・間は設定で選ぶ |
| 言葉の詳細 | 表現・読み・出どころ・意味とニュアンス（Claude が補った）・例文（自分・Claude の案。タップで確かめる）・タグ（タップで確かめる）・硬さ・似た言葉・また出会った・使えた（朱の落款）・手札に入れる・消す |
| 記録（ホームの今週の一文・設定から） | 拾った数（週・月）・使えたの落款・聞いた時間・場所ごと。責めない（続けた日数は出さない） |
| 設定（歯車） | アカウント（KARADA と同じアカウント）、記録、AI とつなぐ（コネクタの URL）、同期、聞く（読む速さ・1 語ごとのくり返し・区切りのあいだの間・自然な声（Polly））、通知、一覧（出会った場所・タグ） |

## 聞く（端末の読み上げ）

- 声は端末の読み上げ（Android の TextToSpeech。Pixel では Google の音声）。無料で、つながらなくても使える
- 画面を消しても、ロック画面・通知・車の Bluetooth の「次」「前」で動かせるよう、いま聞くものと次のものだけを
  一時ファイル（WAV）に書き出し、expo-audio の再生の並び（メディアセッション）で鳴らす。鳴らし終えたらすぐ消す（2つまで。保存しない）
- 書き出しは自前の小さなモジュール（`modules/kotoba-tts`。Android だけ。`TextToSpeech.synthesizeToFile`）
- 1 語は 1 つの一時ファイルにまとめる（`lib/listen/audioJoin.ts`。区切りのあいだは無音でつなぐ）。読む速さは再生の並びの playbackRate で、声の高さは変わらない
- 設定の「読む速さ」（0.8・1.0・1.2 倍）・「1 語ごとのくり返し」（1〜3 回）・「区切りのあいだの間」（短い・ふつう・長い）は端末に残り、次に準備する言葉から効く（`lib/listen/pace.ts`）
- 設定の「自然な声（Polly）」をオンにしたときだけ、サーバー（`POST /v1/audio`）の MP3 を同じ一時ファイルの作りで使う（既定はオフ）
- 台本（表現 → 読み → 説明 → 使い方 → 例文2つ）は `lib/speech.ts`。サーバーと同じ（`testdata/words/speech.json`）
- web（E2E）は音を出さず、時計で進める（`lib/listen/engine.web.ts`）

## 動かし方

```sh
cd apps/words
npm ci
npx tsc --noEmit && npx expo lint . --max-warnings 0 && npx jest
npx expo export --platform web --clear   # E2E 用の書き出し（--clear は KARADA の Metro のキャッシュと混ざらないように）
npx playwright test
SHOTS_DIR=/tmp/shots npx playwright test e2e/shots.spec.ts   # PR に貼る画面の写し
```

CI（.github/workflows/test.yml の words-app と words-app-e2e）も、型・lint・jest と、web の書き出しを Chromium で流す E2E を同じ順で行う。

## ローカルの Node

Node は 24 を使う（`.node-version` と同じ。CI も同じ）。Node 22.12 では eas-cli が app.config.ts を読めず、`eas init` が app.json に書き込めなかった（#299）。

## EAS（ビルドと配信）

- EAS のプロジェクトは @ponchulove/kotoba。ID は app.json の `extra.eas.projectId`（#299）。KARADA の ID は使わない
- Cognito の torelog-app の戻り先（`kotoba://callback`・`kotoba-dev://callback`、ログアウトは `kotoba://signout`・`kotoba-dev://signout`）は #284 で足してある
- ことばの MCP の URL（本番の `WordsMcpServerUrl`）は app.json の `extra.kotoba.mcpUrl` に入っていて、AI とつなぐの画面に出す（#299）

### ビルド

```sh
cd apps/words
npx eas-cli build --profile preview --platform android
```

- preview は内部配布の APK で、チャンネルは preview（eas.json）。autoIncrement で版の番号が上がる。クラウドのビルドの Node は 24.14.0
- ネイティブのモジュール（expo-notifications・expo-audio・expo-speech・expo-file-system・expo-sqlite・expo-secure-store と `modules/kotoba-tts`）や app.json のネイティブの設定を変えると、runtime version（fingerprint）が変わるので、ビルドし直す
- EAS のアップロードから外すもの（.easignore）は、.gitignore と合わせて直す（EAS は .easignore があると .gitignore を使わない）

### EAS Update（JS の配信）

- apps/words の JS の変更は、`.github/workflows/eas-update-words.yml` が main への push（test が通ったあと）で preview チャンネルに配信する（#303・#304）。手動の workflow_dispatch は main だけ
- 配信は Android 向け。fingerprint の runtime version が一致するビルドにだけ届く。ワークフローの最後に出る `runtime version` を、入れたビルドと比べる
- EXPO_TOKEN は GitHub の environment `expo` の secret に置く。無いと配信は飛ばされる（notice が出る）
