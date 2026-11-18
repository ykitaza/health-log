"""ことばの MCP サーバーを HTTP で通しで確かめる（認証・宛先・scope・RFC 9728 の文書・JWKS が取れないときの 503）。"""

import json
import time

import anyio
import httpx2
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from jwt.algorithms import RSAAlgorithm
from mcp.client import Client
from mcp.client.streamable_http import streamable_http_client

import mcp_main
from mcp_connector.access_token_verifier import AuthzApiTokenVerifier, JwksUnavailableError
from tests.conftest import Clock
from words.main import create_engine, create_service

ISSUER = "https://authz.example"
RESOURCE = "http://127.0.0.1:8002/mcp"
KARADA = "https://karada.example/mcp"
KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
SCOPES = "words:read words:write"


async def jwks() -> dict:
    return {"keys": [{**RSAAlgorithm.to_jwk(KEY.public_key(), as_dict=True), "kid": "k", "alg": "RS256"}]}


def token(aud=RESOURCE, scope=SCOPES, sub="alice"):
    now = int(time.time())
    return jwt.encode({"iss": ISSUER, "sub": sub, "aud": aud, "client_id": "https://claude.ai/oauth/mcp-oauth-client-metadata",
                       "scope": scope, "iat": now, "exp": now + 300}, KEY, algorithm="RS256",
                      headers={"kid": "k", "typ": "at+jwt"})


class FakeSession:
    def __init__(self):
        self.revoked = []

    async def revoke(self, access_token, client_id):
        self.revoked.append(client_id)

    def logout_url(self):
        return f"{ISSUER}/logout"


@pytest.fixture
def server():
    session = FakeSession()
    verifier = AuthzApiTokenVerifier(ISSUER, RESOURCE, fetch_jwks=jwks)
    mcp = mcp_main.create_server(create_service(create_engine(None), Clock()), verifier, ISSUER, RESOURCE, session)
    return {"mcp": mcp, "app": mcp_main.create_app(mcp, "127.0.0.1"), "session": session}


def http(app, bearer=None):
    headers = {"Authorization": f"Bearer {bearer}"} if bearer else {}
    transport = httpx2.ASGITransport(app=app, raise_app_exceptions=False)
    return httpx2.AsyncClient(transport=transport, base_url="http://127.0.0.1:8002", headers=headers)


def run(server, bearer, body):
    async def go():
        async with server["mcp"].session_manager.run():
            async with http(server["app"], bearer) as h:
                async with Client(streamable_http_client(RESOURCE, http_client=h)) as client:
                    return await body(client)
    return anyio.run(go)


def post(server, bearer):
    async def go():
        async with server["mcp"].session_manager.run():
            async with http(server["app"], bearer) as h:
                return await h.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
                                    headers={"Accept": "application/json, text/event-stream"})
    return anyio.run(go)


def test_ことばの宛先のトークンで_ツールを使える(server):
    async def body(client):
        init = client.server_info if hasattr(client, "server_info") else None
        names = {t.name for t in (await client.list_tools()).tools}
        captured = await client.call_tool("capture_expression", {"text": "腑に落ちる"})
        return init, names, json.loads(captured.content[0].text)

    _, names, captured = run(server, token(), body)
    assert {"capture_expression", "grep_words", "get_words", "list_facets", "logout"} <= names
    assert captured["status"] == "recorded"


def test_KARADA_宛てのトークンは断る(server):
    res = post(server, token(aud=KARADA, scope="meals:read meals:write"))
    assert res.status_code == 401 and "resource_metadata" in res.headers["www-authenticate"]


def test_トークンがなければ_401(server):
    assert post(server, None).status_code == 401


def test_scope_が足りなければ_403(server):
    res = post(server, token(scope="words:read"))
    assert res.status_code == 403 and "words:write" in res.text


def test_保護されたリソースの文書は_ことばの_URL_と_scope(server):
    async def go():
        async with http(server["app"]) as h:
            return (await h.get("/.well-known/oauth-protected-resource/mcp")).json()

    metadata = anyio.run(go)
    assert metadata["resource"] == RESOURCE and metadata["authorization_servers"] == [ISSUER]
    assert metadata["scopes_supported"] == ["words:read", "words:write"]


def test_サーバーの説明は設計メモの案(server):
    assert server["mcp"].instructions.startswith("日本語の表現を集めて、話すときに使えるようにするサーバー（ことば）。")
    assert "delete_expression は、消すものを見せて了承を得てから呼ぶ" in server["mcp"].instructions


def test_JWKS_が取れないときは_401_ではなく_503(server):
    class DownVerifier:
        async def verify_token(self, token):
            raise JwksUnavailableError("down")

    mcp = mcp_main.create_server(create_service(create_engine(None), Clock()), DownVerifier(), ISSUER, RESOURCE,
                                 server["session"])
    app = mcp_main.create_app(mcp, "127.0.0.1")

    async def go():
        async with http(app, "x") as h:
            return await h.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"})

    res = anyio.run(go)
    assert res.status_code == 503 and res.headers["retry-after"] == "1"


def test_ログアウトは連携を取り消す(server):
    async def body(client):
        return json.loads((await client.call_tool("logout", {})).content[0].text)

    result = run(server, token(), body)
    assert result["logout_url"] == f"{ISSUER}/logout" and len(server["session"].revoked) == 1


def test_PC_の設定は_8002_番(monkeypatch):
    monkeypatch.delenv("AWS_LAMBDA_FUNCTION_NAME", raising=False)
    monkeypatch.setenv("WORDS_TABLE", "t")
    settings = mcp_main.load_settings()
    assert (settings.resource_url, settings.table_name, settings.on_lambda) == ("http://localhost:8002/mcp", "t", False)
