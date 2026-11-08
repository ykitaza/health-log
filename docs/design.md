# 全体の設計

食事記録そのもの（ドメイン、ツール、目標の計算）の設計は [meals-design.md](meals-design.md)、ログインからツールの呼び出しまでの流れは [シーケンス図](sequence.md) にあります。

## なぜ Cognito の前に認可API を置くのか

MCP の仕様は、クライアント（Claude・ChatGPT）を事前登録せずに使える OAuth を求めています。Cognito だけを認可サーバーにすると、次の点が足りません。

- client_id に URL を使い、そこからクライアント情報を取る方式（CIMD）
- トークンの宛先を MCP サーバーに限る `resource` パラメータ（RFC 8707）
- 認可サーバーの情報を返す `/.well-known/oauth-authorization-server`（RFC 8414）

そのため、本人確認（ログイン画面）だけを Cognito に任せ、どのクライアントに何を許すかは認可API が決めます。

## 境界づけられたコンテキスト

```
本人確認（Cognito）──IDトークン──► 認可（services/authorization/）──アクセストークン──► 食事記録（services/meals/）
```

| コンテキスト | 扱う問い | 担当 |
|---|---|---|
| 本人確認 | この人は誰か | 外部のシステム（Cognito） |
| 認可 | どのクライアントに、誰の、何を許したか | `services/authorization/` |
| 食事記録 | この人は何を食べ、目標とどれだけ違うか | `services/meals/`（MCP サーバー） |

- 本人確認 → 認可：`services/authorization/infrastructure/cognito_login.py`（腐敗防止層、Authlib）が IDトークンを `Subject` に変えます
- 認可 → 食事記録：受け渡すのはアクセストークン（JWT）だけです。食事記録は、認可APIの iss と JWKS を手で設定して信じます
- scope はリソースサーバーごとに持ちます（食事記録は `meals:read`・`meals:write`）
- MCP は食事記録を外に出す通信の形式なので、`services/meals/presentation/` に置きます

## 認可API の作り

認可API は Flask と Authlib の認可サーバー（`authlib.integrations.flask_oauth2`）で作っています。
FastAPI と Starlette には、Authlib の認可サーバーの公式な統合がないためです（食事記録は別の Lambda なので、Starlette のままです）。
OAuth の中心は、保守されているライブラリに任せて、自分で書くのは Authlib にないものと、保存先とのやり取りだけにしています。

| 担当 | 中身 | 場所 |
|---|---|---|
| Authlib | 認可コードのグラント、PKCE（RFC 7636）、リフレッシュトークンのローテーション、失効（RFC 7009）、`iss`（RFC 9207）、JWT のアクセストークン（RFC 9068）、クライアント認証（`none`）、OAuth のエラー応答 | `oauth/server.py` で組み立てる |
| 自分で書く | RFC 8707（`resource` を確かめて `aud` に入れる。scope をリソースサーバーごとに狭める。受け入れられなければ `invalid_target`） | `oauth/resource_indicators.py` |
| 自分で書く | CIMD（client_id の URL から文書を取る。https だけ・リダイレクトをたどらない・5秒・5KB まで） | `infrastructure/cimd_client_directory.py` |
| 自分で書く | Cognito でのログイン（Authlib の OIDC クライアント）、同意画面、アカウントの切り替え、ログアウト | `infrastructure/cognito_login.py`、`presentation/` |
| 自分で書く | 保存（認可の途中の状態、認可コード、リフレッシュトークンの系列）。方針として、PKCE は S256 だけ、認可コードは取り出すと同時に消す、古いリフレッシュトークンが再び届いたら系列ごと無効にする | `infrastructure/stores.py`、`oauth/server.py` |

- 認可の途中の状態（DynamoDB の `request#…`）には、`/authorize` のパラメータとクライアントの情報を保存し、同意のあと Authlib にもう一度確かめさせてから認可コードを出します
- リフレッシュトークンは「系列ID.ランダムな値」の形で、保存するのは最新の値のハッシュだけです。アクセストークンの `sid` は系列ID で、`/revoke` はどちらのトークンでも系列ごと消します
- アクセストークンの形（iss、aud、scope、client_id、sid、5分で切れる、`typ: at+jwt`、鍵 ID `authz-key-1`）は、食事記録の確かめ方（`services/meals/infrastructure/access_token_verifier.py`）に合わせています

## フォルダ

組み立て（DI）は各サービスの `main.py` で行います。食事記録は DDD の層（`presentation` → `application` → `domain` ← `infrastructure`）に分けています。

| フォルダ | 中身 |
|---|---|
| `services/authorization/` | 認可API（Flask ＋ Authlib）。`oauth/`（Authlib の認可サーバーの組み立て、RFC 8707）、`infrastructure/`（CIMD、Cognito、保存先、設定）、`presentation/`（入口、同意画面、プライバシーポリシー `/privacy`） |
| `services/meals/` | MCP サーバー。食事の記録・修正・いつもの・目標・今日の残り・週のふり返り・体重と目標までの進み具合・ログアウト（ツール18個） |
| `cdk/` | AWS の構成（CDK）。Cognito（新規登録は不可）、Lambda 2つ（入口は API Gateway の HTTP API、流量の制限付き）、DynamoDB 2つ、SSM パラメータ |
| `tools/inspector/` | MCP Inspector 用の CIMD の文書（PC で食事記録を試すとき） |
| `docs/` | 設計書と図 |

## 外から届く道を絞る

本人だけで使うので、次のように絞っています。

- 入口は API Gateway の HTTP API だけにしています（Lambda の関数 URL は使いません）
- 流量の制限は 1秒1回・瞬間5回です。超えた分は 429 で断るので、叩かれ続けても月の費用に上限がかかります
- Cognito のログイン画面からの新規登録はできません。ユーザーは管理者の操作（`setup-local.sh`）でだけ作ります
