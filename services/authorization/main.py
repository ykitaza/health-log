"""組み立て（DI）。設定を読み、PC か Lambda かで差し込むものを選んで、Flask のアプリを作る。

PC：uv run flask --app main run --port 3000
Lambda：gunicorn "main:create_app()"（cdk/build-lambda.sh の run.sh）
"""

from flask import Flask
from werkzeug.middleware.proxy_fix import ProxyFix

from infrastructure.cimd_client_directory import CimdClientDirectory
from infrastructure.settings import Settings, load_settings
from infrastructure.stores import DynamoDBStore, MemoryStore
from oauth.resource_indicators import ResourceServer
from oauth.server import AuthorizationServer
from oauth.store import Store
from presentation.routes import LoginGateway, create_blueprint

# MCP サーバーで使える scope。名前は「対象:操作」（アプリ用の API の torelog-api/meals.read とは別の名前空間）
MCP_SCOPES = ("meals:read", "meals:write", "training:read", "training:write")
# Lambda で CIMD の文書を取りに行ってよいホスト。使うクライアントは Claude（claude.ai と Claude Code）と ChatGPT だけなので、
# ほかのホストには取りに行かない（知らないクライアントを断り、外への通信を絞る）。PC で動かすときは絞らない（MCP Inspector など）
CIMD_ALLOWED_HOSTS = frozenset({"claude.ai", "chatgpt.com"})


def create_app(
    settings: Settings | None = None,
    *,
    store: Store | None = None,
    clients: CimdClientDirectory | None = None,
    login: LoginGateway | None = None,
) -> Flask:
    settings = settings or load_settings()
    app = Flask(__name__, static_folder=None)  # 静的ファイルは配らない
    # ブラウザのセッション（署名付き Cookie）。Authlib の state・nonce と、進行中の認可リクエストの ID を入れる
    app.config.update(
        SECRET_KEY=settings.session_secret,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=settings.on_lambda,
    )
    if settings.on_lambda:
        # API Gateway が https で受けたことを X-Forwarded-Proto で知る（Authlib は https でない要求を断る）
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=0, x_proto=1, x_host=0, x_port=0, x_prefix=0)

    if store is None:
        store = DynamoDBStore(settings.state_table) if settings.state_table else MemoryStore()
    # 知っているリソースサーバーと、そこで使える scope。信頼関係は手で設定する。
    # MCP サーバー（食事と筋トレのツールを1つにまとめたもの。resource の URL は食事記録のときのまま）
    resource_servers = [ResourceServer(settings.meals_resource, MCP_SCOPES)]
    # localhost の http の client_id（MCP Inspector など）は PC で動かすときだけ認める（Lambda では SSRF になる）
    local = not settings.on_lambda
    server = AuthorizationServer(settings.issuer, settings.signing_key_pem, store, resource_servers,
                                 allow_loopback_http=local)
    if login is None:
        from infrastructure.cognito_login import CognitoLogin

        login = CognitoLogin(
            app,
            issuer=settings.cognito_issuer,
            client_id=settings.cognito_client_id,
            client_secret=settings.cognito_client_secret,
            redirect_uri=f"{settings.issuer}/cognito/callback",
        )
    if clients is None:
        clients = CimdClientDirectory(allow_loopback_http=local, allowed_hosts=None if local else CIMD_ALLOWED_HOSTS)
    app.register_blueprint(create_blueprint(server, clients, store, login))
    return app
