# 開発・テスト

## PC で動かす

```sh
(cd services/authorization && uv run flask --app main run --port 3000) &
(cd services/mcp && PYTHONPATH=../composition uv run python main.py) &   # http://localhost:8001/mcp（記録はメモリーに置く。組み立ての共有は ../composition から読む）
```

先に `setup-local.sh` で `services/authorization/.env` を作っておきます（デプロイした Cognito を使います。[初めてのデプロイ](cd.md#初めてのデプロイ)）。ログインには、本人のユーザーとパスキーを使います（ローカルの戻り先 `http://localhost:3000/cognito/callback` も Cognito に登録してあります）。
署名鍵とセッションの秘密は、初めて起動したときに `services/authorization/` に作られます（`.gitignore` 済み）。

MCP Inspector で試すときの CIMD の文書は `tools/inspector/` にあります（PC で動かすときだけ使えます。[制限](design.md#制限)）。

## テスト

```sh
for s in authorization meals sync training app_api mcp; do (cd services/$s && uv run pytest); done
(cd cdk && npm ci && npx tsc --noEmit && npm test)
(cd apps/mobile && npm ci && npx tsc --noEmit && npx jest)   # testdata/training/*.json で、アプリの計算がサーバーと同じかも確かめる
```

アプリの画面の E2E テストは [apps/mobile/e2e/README.md](../apps/mobile/e2e/README.md) にあります。
GitHub Actions（`.github/workflows/test.yml`）が同じテストと E2E を動かします。PR では変わった部分のジョブだけを、main への push と手での起動では全部を動かします。

## フォルダごとの開発

| フォルダ | 見るもの |
|---|---|
| `apps/mobile/` | 動かし方、テスト、依存の更新：[apps/mobile/README.md](../apps/mobile/README.md) |
| `cdk/` | 型チェック、テスト、差分、デプロイのコマンド：[cdk/README.md](../cdk/README.md) |
| `services/` | 層とフォルダの中身：[全体の設計のフォルダ](design.md#フォルダ) |

## 図を直す

構成図の元は `docs/architecture.drawio` です。直したら、draw.io のデスクトップ版の CLI で SVG を書き出し直します（図を埋め込むので、SVG も draw.io で開けます）。

```sh
/Applications/draw.io.app/Contents/MacOS/draw.io -x -f svg --embed-diagram -o docs/architecture.drawio.svg docs/architecture.drawio
```

ユースケース図の元は `docs/diagrams/usecase.drawio` で、PNG（`docs/diagrams/usecase.drawio.png`）にも図のデータを埋め込んであります（draw.io で開けます）。
シーケンス図の作り直し方は [sequence.md](sequence.md) にあります。
