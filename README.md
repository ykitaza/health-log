# meal-log-mcp

Claude や ChatGPT に、食事の写真か一言を送るだけで記録できる MCP サーバーです。
筋トレと体組成を記録するスマホのアプリ「トレログ」（仮。[apps/mobile](apps/mobile/README.md)）も、同じリポジトリで作っています。

## リポジトリの構成

| フォルダ | 中身 |
|---|---|
| `services/authorization/` | 認可API（Flask・Authlib）。Cognito でログインさせ、食事記録に使うアクセストークンを出す |
| `services/meals/` | 食事記録の MCP サーバー |
| `apps/mobile/` | 筋トレのアプリ（Expo）。今は端末の中だけで動く（[README](apps/mobile/README.md)） |
| `cdk/` | AWS の構成（CDK）。スタックは `CognitoStudy` と、監視の `CognitoStudyMonitoring`・`CognitoStudyMonitoringGlobal` の3つ |
| `docs/` | 構成図、シーケンス図、設計、監視の説明 |
| `tools/inspector/` | MCP Inspector で試すときの CIMD の文書 |
| `.github/` | CI（テスト、アプリの配信）と Dependabot の設定 |

## 背景

食生活を見直そうと思い、まずは記録から始めることにしました。
ただ、そのために食事記録のアプリを新しく入れるのは気が進まず、有料のものも多くあります。
安く、いつも使っているアプリで手軽に記録できればよいと考えました。

普段から使っている Claude や ChatGPT なら、写真から料理と量を推定できます。
そこで、推定は AI に任せ、記録と集計だけをこのサーバーが受け持つ形にしました。
目標の計算や週のまとめはサーバーが決まった式で行い、AI に数字を考えさせません。

もう1つの目的は、MCP の認可（OAuth 2.1、CIMD、PKCE、リフレッシュトークン）を理解することです。
ログイン画面は Cognito に任せ、その前に認可API を置いています。
OAuth の中心（認可コード、PKCE、リフレッシュトークン、失効、JWT のアクセストークン）は保守されているライブラリ（Authlib）に任せ、
Authlib にない CIMD と RFC 8707（resource）、同意画面を自分で書いています。

## 特徴

- **MCP サーバー**：Claude・ChatGPT など、MCP に対応したチャットにコネクタとして登録して使う。食事の記録に専用のアプリや画面は要りません
- **利用者ごとの記録**：OAuth でログインした人を識別し、記録はその人の分だけを読み書きします。アクセストークンは食事記録だけに使え、5分で切れます（切れたらリフレッシュトークンで更新します）
- **推論はクライアント側**：写真の解析や栄養の推定は、Claude・ChatGPT の AI が行います。サーバーは AI を呼ばないので、AI の利用料がかかりません。かかるのは Lambda・DynamoDB・API Gateway の従量課金だけで、1人で使う分なら小さく済みます
- **見せ方もクライアント側**：サーバーはデータ（JSON）だけを返し、表・グラフ・入力フォームは Claude・ChatGPT が自分の画面で作ります

## できること

### 食事の記録（MCP）

チャットでの頼み方の例と、そのとき起きることです。

| 頼み方 | 起きること |
|---|---|
| 写真を貼って「昼ごはん」 | AI が料理と量を推定して表で見せ、了承を得てから記録する |
| 「朝はいつもの」「昨日の夜と同じ」 | 保存した組み合わせや前の食事を、確認なしで記録する |
| 「今日あと何を食べればいい？」 | 今日の合計と、目標までの残り（kcal・PFC）を返す |
| 「今週をふり返って」 | 日ごとの kcal の推移と、PFC の割合を、表やグラフで見せる |
| 「目標を決めたい」 | 方針（増量・減量・維持）だけでも決められる。体重や身長を答えると、kcal と PFC の目標を計算する |
| 「体重 70kg」「目標まであとどれくらい？」 | 体重を記録し、最近のペースから目標体重までの週数を出す |
| 「さっきのご飯、量を半分に」 | 記録を直す（消すこともできる） |
| 「ログアウトして」 | 連携を解除する（別のアカウントでログインしてしまったとき） |

写真は保存しません。保存するのは、AI が写真から読み取った説明文と栄養の推定値だけです。

### 筋トレのアプリ（トレログ）

筋トレの記録（種目・重量・回数）、総負荷量や推定1RM の分析、体組成の記録と推移を、スマホのアプリで扱います。
今は記録を端末の SQLite にだけ保存し、サーバーとはつながりません。ログインと同期、食事の記録は次の段階で足します。
動かし方は [apps/mobile/README.md](apps/mobile/README.md) にあります。

## 構成

![構成図](docs/architecture.drawio.svg)

- 入口は API Gateway の HTTP API だけで、どれにも流量の制限を付けています（認可API と MCP は1秒1回・瞬間5回、スマホアプリ用の API は1秒10回・瞬間20回）
- スマホアプリ（トレログ）とは、変更の記録を送り合って同期します。MCP からの変更も同じ記録を通るので、アプリにも届きます（[同期の設計](docs/sync-design.md)、[アプリ用の API](docs/api/app-api.yaml)）
- 認可API が Cognito でログインさせ、同意を得てから、食事記録だけに使えるアクセストークンを出します
- 怪しいアクセスや異常（4xx・5xx・429 の急増、ルートや MFA なしのログイン、IAM・Cognito の変更など）を検知してメールで知らせます（[監視](docs/monitoring.md)）
- スマホのアプリは、今は AWS とつながらず、端末の中だけで動きます
- ログインからツールの呼び出しまでの流れは [シーケンス図](docs/sequence.md)、設計の考え方は [全体の設計](docs/design.md) と [食事記録の設計](docs/meals-design.md) にあります

図の元は `docs/architecture.drawio` です。直したら、draw.io のデスクトップ版の CLI で SVG を書き出し直します（図を埋め込むので、SVG も draw.io で開けます）。

```sh
/Applications/draw.io.app/Contents/MacOS/draw.io -x -f svg --embed-diagram -o docs/architecture.drawio.svg docs/architecture.drawio
```

## 使い方

### デプロイする

AWS の認証情報は、環境変数（`AWS_PROFILE` など）で指定しておきます。

スタックは3つで、`npx cdk deploy --all` でまとめてデプロイします。

| スタック | リージョン | 中身 |
|---|---|---|
| `CognitoStudy` | ap-northeast-1 | Cognito、認可API と食事記録の API Gateway・Lambda・DynamoDB |
| `CognitoStudyMonitoring` | ap-northeast-1 | 監視（アラーム、CloudTrail、EventBridge、SNS）。`CognitoStudy` のあとに作られる |
| `CognitoStudyMonitoringGlobal` | us-east-1 | IAM の操作を東京に転送する EventBridge のルール |

us-east-1 にもスタックがあるので、初めてのときは、東京と us-east-1 の両方に CDK の bootstrap をします（1回だけ）。

```sh
cd cdk && npx cdk bootstrap aws://<アカウント ID>/ap-northeast-1 aws://<アカウント ID>/us-east-1
```

```sh
cd cdk && ./build-lambda.sh && npx cdk deploy --all
../services/authorization/setup-local.sh   # ログインに使うユーザー（test1@example.com）を作る
```

パスワードは `services/authorization/.test1-password` に保存されます（画面には出しません）。

すでにデプロイしてあって、同期の仕組みを入れる前の記録があるときは、**デプロイの前に**移行のスクリプトを動かします（[今あるデータの移行](docs/sync-design.md#今あるデータの移行)）。

通知のメールは、デプロイのあとに SNS のトピックへ購読を足すと届きます（[監視](docs/monitoring.md#デプロイとメールの購読の足し方)）。

### Claude・ChatGPT につなぐ

`cdk deploy` の出力 `MealsMcpServerUrl`（末尾が `/mcp`）を登録します。

- Claude：「設定 → コネクタ → カスタムコネクタを追加」に URL を入れます。OAuth クライアントは「Claude の公開アイデンティティを使用」のままにします
- ChatGPT：開発者モードでアプリを作成し、URL を入れて認証方式に OAuth を選びます

登録するとログイン画面が開くので、上のユーザーでログインし、同意画面で「許可する」を押します。

### PC で動かす

```sh
(cd services/authorization && uv run flask --app main run --port 3000) &
(cd services/meals && uv run python main.py) &   # http://localhost:8001/mcp（記録はメモリーに置く）
```

先に `setup-local.sh` で `services/authorization/.env` を作っておきます（デプロイした Cognito を使います）。
署名鍵とセッションの秘密は、初めて起動したときに `services/authorization/` に作られます（`.gitignore` 済み）。

スマホのアプリの動かし方は [apps/mobile/README.md](apps/mobile/README.md) にあります。

### テスト

```sh
for s in authorization meals sync training app_api; do (cd services/$s && uv run pytest); done
(cd cdk && npm ci && npx tsc --noEmit && npm test)
(cd apps/mobile && npm ci && npx tsc --noEmit && npx jest)   # testdata/training/*.json で、アプリの計算がサーバーと同じかも確かめる
```

アプリの画面の E2E テストは [apps/mobile/e2e/README.md](apps/mobile/e2e/README.md) にあります。
PR と main への push では、GitHub Actions（`.github/workflows/test.yml`）が同じテストと E2E を動かします。

### 片付け

`cdk destroy --all` で3つのスタックを消します。
ユーザープールと DynamoDB のテーブルは、削除の保護を付け、`cdk destroy` でも残るようにしています（記録を守るため）。
消すときは、先にコンソールで削除の保護を外してから、それぞれを消します。
CloudTrail の証跡のバケットも、スタックを消しても残します（[監視の片付け](docs/monitoring.md#片付け)）。

```sh
cd cdk && npx cdk destroy --all
# 認可APIが初回起動時に作った秘密の値（スタックとは別に残る）
aws ssm delete-parameters --names /cognito-study/authorization/signing-key /cognito-study/authorization/session-secret
```

## 制限

- 本人だけで使う前提です。ログイン画面からの新規登録はできません
- 栄養の値は AI の推定なので、だいたいの目安として使ってください
- `tools/inspector/` の CIMD の文書は localhost にあるので、Lambda の認可API からは取りに行けません（MCP Inspector で試せるのは PC で動かすときだけです）
