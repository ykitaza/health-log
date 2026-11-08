# 全体の設計

食事記録そのもの（ドメイン、ツール、目標の計算）の設計は [meals-design.md](meals-design.md)、ログインからツールの呼び出しまでの流れは [シーケンス図](sequence.md) にあります。
スマホアプリ（トレログ）とサーバーの同期は [sync-design.md](sync-design.md)、アプリ用の API の仕様は [api/app-api.yaml](api/app-api.yaml)（OpenAPI）にあります。

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
| `cdk/` | AWS の構成（CDK）。Cognito（新規登録は不可、パスキー、認可API 用とスマホアプリ用のクライアント）、Lambda 2つ（入口は API Gateway の HTTP API、流量の制限付き）、DynamoDB 2つ、SSM パラメータ。監視（[monitoring.md](monitoring.md)） |
| `tools/inspector/` | MCP Inspector 用の CIMD の文書（PC で食事記録を試すとき） |
| `docs/` | 設計書と図 |

## 外から届く道を絞る

本人だけで使うので、次のように絞っています。

- 入口は API Gateway の HTTP API だけにしています（Lambda の関数 URL は使いません）
- 流量の制限は 1秒1回・瞬間5回です。超えた分は 429 で断るので、叩かれ続けても月の費用に上限がかかります
- Cognito のログイン画面からの新規登録はできません。ユーザーは管理者の操作（`setup-local.sh`）でだけ作ります
- ユーザープールと DynamoDB のテーブルは、削除の保護を有効にし、`cdk destroy` でも消えない（RETAIN）ようにしています。ユーザーが消えると `sub`（食べた人の ID）が変わり、記録がたどれなくなるためです

## パスキー

ログインはパスキーで行います。設定はユーザープールにあり、どれも CloudFormation では置き換えにならない変更です。

| 設定 | 値 | 理由 |
|---|---|---|
| 最初の要素（`SignInPolicy`） | パスワード、パスキー | パスワードは CloudFormation の決まりで外せない。下の移行の手順で、長いランダムな値にして捨てる |
| RP ID | `oidc-study-<アカウント>.auth.ap-northeast-1.amazoncognito.com` | 今のプレフィックスのドメイン。**あとで独自ドメインを足すと、パスキーはすべて作り直しになる** |
| 本人確認 | 必須（`required`） | 端末の指紋や PIN を必ず通す |
| MFA | OFF | パスキーの本人確認で代える |
| パスワードの再設定 | 管理者だけ（`AccountRecovery.NONE`） | 捨てたパスワードを、メールを読める人が作り直せないようにする |
| クライアントの認証フロー | `ALLOW_USER_AUTH`（選択式のサインイン） | マネージドログインでパスキーを選ばせるのに要る |

認可API 用のクライアント（`authz-api`）にも `ALLOW_USER_AUTH` を付けています。
AWS の資料（[Configure authentication methods for managed login](https://docs.aws.amazon.com/cognito/latest/developerguide/authentication-flows-selection-managedlogin.html)）では、マネージドログインがサインインの方法（パスキーなど）を選ばせるのは、クライアントに `ALLOW_USER_AUTH` があるときです。
CDK の `AuthFlow` の資料も、パスキーを有効にしたら `authFlows: { user: true }` を付けるように書いています。
付けないと、Claude・ChatGPT からの接続（MCP）のログインでパスキーが使えません。
`authFlows` を指定すると、既定で開いていた SRP とカスタム認証の入口（`ALLOW_USER_SRP_AUTH`・`ALLOW_CUSTOM_AUTH`）は閉じます。認可API はマネージドログインだけを使うので、影響はありません。

### パスキーへの移行の手順

管理者の操作は、AWS の個人のアカウントで行います。パスワードは画面に出さず、ファイルにも残しません。

1. **デプロイ**する（`cd cdk && ./build-lambda.sh && npx cdk deploy`）。ここまでは、今のパスワードでそのままログインできます
2. **管理者**が、本人のパスワードを長いランダムな値にする（この値は本人に渡し、手順4で捨てる）
   ```sh
   PW="$(openssl rand -base64 33 | tr -d '/+=')Aa1!"
   aws cognito-idp admin-set-user-password --user-pool-id <UserPoolId> --username <メールアドレス> --password "$PW" --permanent
   ```
3. **本人**が、PC かスマホのブラウザで次の URL を開き、メールアドレスと手順2のパスワードでログインする。続けて「パスキーを追加」の画面で、端末のパスキー（Google パスワード マネージャーや iCloud キーチェーンなど）を作る
   ```
   https://<CognitoDomain>/passkeys/add?client_id=<ClientId>&redirect_uri=<AuthzUrl>/cognito/callback
   ```
   - `<CognitoDomain>`・`<ClientId>`・`<AuthzUrl>` は `cdk deploy` の出力です
   - 管理者が作ったユーザーには、マネージドログインがパスキーの登録を勧めないので、この URL を直接開きます
   - 作ったあと認可API に戻り、エラーの画面が出ることがあります（ログインの途中の状態がないため）。パスキーは作れているので、そのまま閉じてかまいません
4. **管理者**が、パスワードを別のランダムな値に変え、その値はどこにも残さない（手順2のコマンドを、もう一度実行して `PW` を捨てる）
5. **本人**が、PC で Claude か ChatGPT のコネクタをつなぎ直し、ログイン画面で「パスキーでサインイン」を選んで、パスワードなしで入れることを確かめる。スマホアプリでも同じように入れることを確かめる

パスキーをなくしたときは、手順2〜4をもう一度行います。

## スマホアプリ（トレログ）のログイン

アプリは Cognito のマネージドログインに、OIDC（認可コード＋PKCE）でつなぎます。MCP の認可API は通しません。
同じ Cognito のユーザーなので、アクセストークンの `sub` は MCP と同じです（認可API は Cognito の ID トークンの `sub` を、そのまま自分のアクセストークンの `sub` にしています。`services/authorization/infrastructure/cognito_login.py`）。

| 設定 | 値 | 理由 |
|---|---|---|
| クライアント | `torelog-app`。シークレットなし（パブリック） | 端末に秘密を置けない。PKCE で守る |
| フロー | 認可コードだけ。`ALLOW_USER_AUTH`（パスキー） | |
| 戻り先 | `torelog://callback`、ログアウトは `torelog://signout` | |
| アクセストークン・ID トークン | 15分 | 盗まれたときの被害を小さくする |
| リフレッシュトークン | 30日。使うたびに新しくする（古いものは10秒だけ使える） | 10秒は、通信が切れて取り直すとき用 |
| 失効・ユーザーの有無 | 失効を有効、ユーザーの有無をエラーから知られないようにする | |
| scope | `openid`、`torelog-api/meals.read`、`torelog-api/meals.write` | アプリ用の API のルートで必須にし、ID トークンや認可API 用のクライアントのトークンを断る |

scope はリソースサーバー `torelog-api` に置き、名前は「対象.操作」にしています。筋トレは同じ形で `training.read`・`training.write` を足します（MCP の認可API の scope `meals:read` とは別の名前空間です）。
アプリが使う値（issuer、クライアント ID、Cognito のドメイン）は、`cdk deploy` の出力と SSM パラメータ（`/cognito-study/app/*`）にあります。どれも秘密ではありません。
