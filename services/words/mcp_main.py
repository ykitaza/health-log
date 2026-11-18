"""ことばの MCP サーバーの組み立て（DI）。Lambda Web Adapter の上で uvicorn が動かす（cdk/build-lambda.sh の run.sh）。

KARADA の MCP（services/mcp/main.py）と同じ作りで、URL・コネクタ・サーバーの説明（instructions）は別。
- サーバー（MCPServer）と認証（アクセストークンの検証、scope）を作る。MCP のプロトコルは公式の SDK に任せる
- トークンは共有の認可API が出したもので、宛先（aud）がことばの MCP の URL のものだけを受け付ける（宛先はコネクタごと）
- アクセストークンの検証（JWKS のやり直し・覚えておく鍵・取れないときの 503）と logout は、KARADA と共有の部品（mcp_connector）
"""

import logging
import os
from dataclasses import dataclass
from datetime import datetime

from mcp.server.auth.provider import TokenVerifier
from mcp.server.auth.settings import AuthSettings
from mcp.server.mcpserver import MCPServer

from mcp_connector.access_token_verifier import AuthzApiTokenVerifier
from mcp_connector.authz_session import AuthzApiSession
from mcp_connector.errors import unhandled_error
from mcp_connector.request_log import JsonRpcLogMiddleware
from mcp_connector.tools import Session, register_connector_tools
from words.application.service import WordsService
from words.domain.schedule import JST
from words.main import create_engine, create_service
from words.presentation import mcp_tools

REQUIRED_SCOPES = [mcp_tools.READ_SCOPE, mcp_tools.WRITE_SCOPE]  # 接続のところで両方を必須にする（足りなければ SDK が 403）


def now() -> datetime:
    return datetime.now(JST)


@dataclass(frozen=True)
class Settings:
    trusted_issuer: str  # 信じる認可API（アクセストークンの iss）
    resource_url: str  # このMCPサーバーの名前（RFC 8707 の resource、アクセストークンの aud）
    table_name: str | None  # None ならメモリーに置く（PC 用）
    on_lambda: bool


def load_settings() -> Settings:
    trusted_issuer = os.environ.get("AUTHZ_ISSUER", "http://localhost:3000").rstrip("/")
    table_name = os.environ.get("WORDS_TABLE")
    if "AWS_LAMBDA_FUNCTION_NAME" not in os.environ:
        return Settings(trusted_issuer, "http://localhost:8002/mcp", table_name, on_lambda=False)

    import boto3  # Lambda の実行環境に入っている

    # 自分の URL（HTTP API）は作成後に決まるので、CDK が SSM に書いたものを読む（/cognito-study/words/url）
    own_url = boto3.client("ssm").get_parameter(Name=os.environ["MCP_URL_PARAM"])["Parameter"]["Value"]
    return Settings(trusted_issuer, own_url.rstrip("/") + "/mcp", table_name, on_lambda=True)


def create_server(service: WordsService, token_verifier: TokenVerifier, trusted_issuer: str, resource_url: str,
                  session: Session) -> MCPServer:
    mcp = MCPServer(
        name="kotoba",
        title="ことば",
        instructions=mcp_tools.INSTRUCTIONS,
        token_verifier=token_verifier,
        auth=AuthSettings(
            issuer_url=trusted_issuer,
            resource_server_url=resource_url,
            required_scopes=REQUIRED_SCOPES,
            validate_token_resource=False,  # aud はトークンの検証で確かめている
        ),
    )
    mcp_tools.register_words_tools(mcp, service)
    register_connector_tools(mcp, session)
    return mcp


def create_app(mcp: MCPServer, host: str):
    # ステートレスで、応答は SSE ではなく JSON にする（Lambda は応答をまとめて返すため）。
    # RFC 9728 の文書（/.well-known/oauth-protected-resource/mcp）は SDK が required_scopes で作る
    app = mcp.streamable_http_app(streamable_http_path="/mcp", stateless_http=True, json_response=True, host=host)
    app.add_exception_handler(Exception, unhandled_error)  # JWKS が取れないときは 401 ではなく 503
    return JsonRpcLogMiddleware(app)  # 診断用：どのツールが呼ばれたかをログに出す（引数の値は出さない）


settings = load_settings()
mcp = create_server(
    create_service(create_engine(settings.table_name), now),
    token_verifier=AuthzApiTokenVerifier(settings.trusted_issuer, settings.resource_url),
    trusted_issuer=settings.trusted_issuer,
    resource_url=settings.resource_url,
    session=AuthzApiSession(settings.trusted_issuer),
)
# PC では 127.0.0.1 で待ち受ける（SDK が DNS リバインディング対策を自動で入れる）。Lambda では 0.0.0.0
HOST = "0.0.0.0" if settings.on_lambda else "127.0.0.1"
app = create_app(mcp, HOST)
logging.getLogger("mcp.requests").setLevel(logging.INFO)

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=HOST, port=8002)
