# cdk

AWS の構成を CDK（TypeScript）で書いています。スタックは4つです。

| スタック | リージョン | ファイル | 中身 |
|---|---|---|---|
| `CognitoStudy` | ap-northeast-1 | `lib/infra-stack.ts` | Cognito（パスキー、認可API 用とアプリ用のクライアント）、認可API・MCP サーバー・アプリ用の API の API Gateway・Lambda、DynamoDB 2つ、SSM パラメータ |
| `CognitoStudyMonitoring` | ap-northeast-1 | `lib/monitoring-stack.ts` | 監視（アラーム、CloudTrail、EventBridge、SNS）。[監視](../docs/monitoring.md) |
| `CognitoStudyMonitoringGlobal` | us-east-1 | `lib/monitoring-stack.ts` | IAM の操作を東京に転送する EventBridge のルール |
| `CognitoStudyCiCd` | ap-northeast-1 | `lib/cicd-stack.ts` | GitHub Actions の OIDC の ID プロバイダーと、差分用・デプロイ用のロール。手でデプロイする（[サーバーの CD](../docs/cd.md)） |

スタックの組み立ては `bin/infra.ts` です。監視のスタックとは、SSM パラメータの名前だけでつなぎます（スタックをまたぐ Export は作りません）。

## コマンド

```sh
npm ci
npx tsc --noEmit                  # 型チェック
npm test                          # jest（test/）。テンプレートの中身を確かめる
./build-lambda.sh                 # Lambda に載せるもの（authorization・mcp・app_api の3つ）を build/ にまとめる。デプロイの前に実行する
npx cdk diff --all                # デプロイ済みのものとの差
npx cdk deploy --all              # 4つのスタックをデプロイする
```

初めてデプロイするときは、東京と us-east-1 の bootstrap が要ります。手順は [初めてのデプロイ](../docs/cd.md#初めてのデプロイ) にあります。
