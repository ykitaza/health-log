"""認可API を HTTP で通しで確かめる（外から見た動き）。

Cognito でのログインは偽物に、CIMD の文書の取得は決め打ちの応答に差し替える。保存先はメモリー。
"""

import time
from urllib.parse import parse_qs, urlsplit

import httpx
import jwt
import pytest
from authlib.integrations.base_client import MismatchingStateError
from authlib.oauth2 import rfc8414, rfc9207
from flask import redirect

from infrastructure.cimd_client_directory import CimdClientDirectory
from infrastructure.settings import Settings, new_private_key_pem
from infrastructure.stores import MemoryStore
from main import create_app
from oauth.models import Subject, hash_secret

ISSUER = "https://authz.example"
MEALS = "https://meals.example/mcp"
CLIENT_ID = "https://client.example/metadata.json"
OTHER_CLIENT_ID = "https://other.example/metadata.json"
REDIRECT = "https://client.example/callback"
VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"  # RFC 7636 付録 B
DOCS = {
    url: {"client_id": url, "client_name": "Example", "redirect_uris": [REDIRECT]}
    for url in (CLIENT_ID, OTHER_CLIENT_ID)
}


class FakeLogin:
    def __init__(self):
        self.subject = Subject("user-1", "u@example.com")

    def redirect_to_login(self):
        return redirect("https://login.example/oauth2/authorize")

    def subject_from_callback(self):
        return self.subject

    def logout_url(self, logout_uri):
        return f"https://login.example/logout?logout_uri={logout_uri}"


def fetch_document(url):
    if url not in DOCS:
        return httpx.Response(404)
    return httpx.Response(200, json=DOCS[url])


@pytest.fixture
def store():
    return MemoryStore()


@pytest.fixture
def login():
    return FakeLogin()


@pytest.fixture
def client(store, login):
    settings = Settings(
        issuer=ISSUER, meals_resource=MEALS, cognito_issuer="", cognito_client_id="", cognito_client_secret="",
        signing_key_pem=new_private_key_pem(), session_secret="test-secret", state_table=None, on_lambda=False,
    )
    app = create_app(settings, store=store, clients=CimdClientDirectory(http_get=fetch_document), login=login)
    return app.test_client()


def authorize_params(**overrides):
    params = dict(client_id=CLIENT_ID, redirect_uri=REDIRECT, response_type="code", state="xyz",
                  scope="meals:read meals:write", code_challenge=CHALLENGE, code_challenge_method="S256",
                  resource=MEALS)
    return {k: v for k, v in {**params, **overrides}.items() if v is not None}


def query_of(response) -> dict:
    location = response.headers["Location"]
    return {k: v[0] for k, v in parse_qs(urlsplit(location).query).items()}


def login_and_consent(client, decision="allow", **overrides):
    """/authorize → ログイン → 同意 まで進め、/consent の応答を返す。"""
    res = client.get("/authorize", query_string=authorize_params(**overrides))
    assert res.status_code == 302 and res.headers["Location"].startswith("https://login.example/")
    page = client.get("/cognito/callback")
    assert page.status_code == 200
    return client.post("/consent", data={"decision": decision})


def issue_code(client, **overrides) -> str:
    res = login_and_consent(client, **overrides)
    assert res.status_code == 303
    return query_of(res)["code"]


def exchange(client, code, **overrides):
    data = dict(grant_type="authorization_code", code=code, redirect_uri=REDIRECT, client_id=CLIENT_ID,
                code_verifier=VERIFIER, resource=MEALS)
    return client.post("/token", data={k: v for k, v in {**data, **overrides}.items() if v is not None})


def tokens_for(client) -> dict:
    res = exchange(client, issue_code(client))
    assert res.status_code == 200, res.json
    return res.json


def refresh(client, refresh_token, **overrides):
    data = dict(grant_type="refresh_token", refresh_token=refresh_token, client_id=CLIENT_ID)
    return client.post("/token", data={k: v for k, v in {**data, **overrides}.items() if v is not None})


def verify_like_meals(client, access_token) -> dict:
    """MCP の入口（services/mcp/connector/access_token_verifier.py）と同じ確かめ方をする。"""
    header = jwt.get_unverified_header(access_token)
    assert header["typ"] == "at+jwt"
    keys = {k.key_id: k for k in jwt.PyJWKSet.from_dict(client.get("/.well-known/jwks.json").json).keys}
    return jwt.decode(access_token, keys[header["kid"]], algorithms=["RS256"], issuer=ISSUER, audience=MEALS)


def claims_of(body: dict) -> dict:
    return jwt.decode(body["access_token"], options={"verify_signature": False})


# ---- 認可（/authorize、ログイン、同意） ----

def test_full_flow_issues_access_token_for_the_resource(client):
    client.get("/authorize", query_string=authorize_params())
    page = client.get("/cognito/callback")
    assert page.headers["X-Frame-Options"] == "DENY"
    text = page.get_data(as_text=True)
    assert "Example" in text and "client.example" in text and "u@example.com" in text
    assert "食事記録と目標の読み取り" in text

    res = client.post("/consent", data={"decision": "allow"})
    assert res.status_code == 303 and res.headers["Location"].startswith(REDIRECT + "?")
    params = query_of(res)
    assert (params["state"], params["iss"]) == ("xyz", ISSUER)  # RFC 9207

    token = exchange(client, params["code"])
    assert token.status_code == 200 and token.headers["Cache-Control"] == "no-store"
    body = token.json
    assert (body["token_type"], body["expires_in"], body["scope"]) == ("Bearer", 300, "meals:read meals:write")
    claims = verify_like_meals(client, body["access_token"])
    assert (claims["sub"], claims["client_id"], claims["scope"]) == ("user-1", CLIENT_ID, "meals:read meals:write")


def test_denied_consent_returns_access_denied(client):
    res = login_and_consent(client, decision="deny")
    params = query_of(res)
    assert (params["error"], params["state"], params["iss"]) == ("access_denied", "xyz", ISSUER)
    assert "code" not in params


@pytest.mark.parametrize("overrides, error", [
    ({"code_challenge": None, "code_challenge_method": None}, "invalid_request"),  # PKCE なし
    ({"code_challenge_method": "plain"}, "invalid_request"),  # S256 だけ
    ({"response_type": "token"}, "unsupported_response_type"),
    ({"resource": "https://other.example/mcp"}, "invalid_target"),  # RFC 8707
    ({"scope": "read"}, "invalid_scope"),  # このリソースサーバーでは使えない scope だけ
])
def test_invalid_request_is_returned_to_the_client(client, overrides, error):
    res = client.get("/authorize", query_string=authorize_params(**overrides))
    assert res.status_code == 302 and res.headers["Location"].startswith(REDIRECT + "?")
    params = query_of(res)
    assert (params["error"], params["state"], params["iss"]) == (error, "xyz", ISSUER)


@pytest.mark.parametrize("overrides", [
    {"client_id": "https://evil.example/metadata.json"},  # 文書を取れない
    {"client_id": "http://evil.example/metadata.json"},  # https でない
    {"redirect_uri": "https://evil.example/callback"},  # 文書にない戻り先
    {"client_id": None},
])
def test_unverified_client_or_redirect_uri_gets_an_error_page(client, overrides):
    res = client.get("/authorize", query_string=authorize_params(**overrides))
    assert res.status_code == 400 and "Location" not in res.headers
    assert "連携を続けられません" in res.get_data(as_text=True)


def test_login_failure_does_not_show_exception_details(client, login):
    def fail():
        raise MismatchingStateError(description="internal detail")

    login.subject_from_callback = fail
    client.get("/authorize", query_string=authorize_params())
    res = client.get("/cognito/callback")
    text = res.get_data(as_text=True)
    assert res.status_code == 400 and "ログインを確かめられません" in text
    assert "internal detail" not in text and "mismatching_state" not in text


def test_scope_defaults_to_all_scopes_of_the_resource_and_resource_defaults_to_meals(client):
    code = issue_code(client, scope=None, resource=None)
    body = exchange(client, code, resource=None).json
    claims = verify_like_meals(client, body["access_token"])
    assert claims["scope"] == "meals:read meals:write training:read training:write"


def test_consent_page_explains_training_scopes(client):
    client.get("/authorize", query_string=authorize_params(
        scope="meals:read meals:write training:read training:write"))
    text = client.get("/cognito/callback").get_data(as_text=True)
    assert "筋トレ（種目・重量・回数）と体組成の記録の読み取り" in text
    assert "筋トレと体組成の記録の追加・修正・削除" in text
    res = client.post("/consent", data={"decision": "allow"})
    body = exchange(client, query_of(res)["code"]).json
    assert body["scope"] == "meals:read meals:write training:read training:write"


def test_scope_is_narrowed_to_what_the_resource_serves(client):
    body = exchange(client, issue_code(client, scope="read meals:read")).json
    assert (body["scope"], claims_of(body)["scope"]) == ("meals:read", "meals:read")


def test_consent_twice_is_rejected(client):
    login_and_consent(client)
    res = client.post("/consent", data={"decision": "allow"})
    assert res.status_code == 400


def test_consent_without_login_is_rejected(client):
    client.get("/authorize", query_string=authorize_params())
    res = client.post("/consent", data={"decision": "allow"})
    assert res.status_code == 400 and "Location" not in res.headers


def test_switch_account_restarts_login_on_the_same_request(client, login):
    client.get("/authorize", query_string=authorize_params())
    login.subject = Subject("wrong-user", "wrong@example.com")
    client.get("/cognito/callback")
    res = client.get("/switch-account")
    assert res.headers["Location"] == f"https://login.example/logout?logout_uri={ISSUER}/relogin"
    assert client.get("/relogin").headers["Location"].startswith("https://login.example/")
    login.subject = Subject("user-1", "u@example.com")
    assert "u@example.com" in client.get("/cognito/callback").get_data(as_text=True)
    code = query_of(client.post("/consent", data={"decision": "allow"}))["code"]
    assert claims_of(exchange(client, code).json)["sub"] == "user-1"


# ---- 認可コードの引き換え（/token） ----

def test_code_can_be_used_only_once(client):
    code = issue_code(client)
    assert exchange(client, code).status_code == 200
    res = exchange(client, code)
    assert (res.status_code, res.json["error"]) == (400, "invalid_grant")


@pytest.mark.parametrize("overrides, error", [
    ({"code_verifier": "x" * 43}, "invalid_grant"),  # PKCE が一致しない
    ({"code_verifier": None}, "invalid_request"),
    ({"client_id": OTHER_CLIENT_ID}, "invalid_grant"),  # 別のクライアント
    ({"redirect_uri": "https://client.example/other"}, "invalid_grant"),
    ({"resource": "https://other.example/mcp"}, "invalid_target"),  # RFC 8707
    ({"client_id": None}, "invalid_client"),
])
def test_code_rejects_mismatches(client, overrides, error):
    res = exchange(client, issue_code(client), **overrides)
    assert (res.status_code, res.json["error"]) == (400, error)


def test_unsupported_grant_type(client):
    res = client.post("/token", data={"grant_type": "password", "client_id": CLIENT_ID})
    assert (res.status_code, res.json["error"]) == (400, "unsupported_grant_type")


def test_access_token_carries_session_id(client):
    tokens = tokens_for(client)
    family_id = tokens["refresh_token"].partition(".")[0]
    claims = claims_of(tokens)
    assert claims["sid"] == family_id
    assert claims["exp"] - claims["iat"] == 300  # 5分


# ---- リフレッシュトークン ----

def test_refresh_token_issues_new_tokens_for_the_same_grant(client):
    first = tokens_for(client)
    second = refresh(client, first["refresh_token"]).json
    assert second["refresh_token"] != first["refresh_token"]  # ローテーション
    assert second["refresh_token"].partition(".")[0] == first["refresh_token"].partition(".")[0]  # 同じ系列
    claims = verify_like_meals(client, second["access_token"])
    assert (claims["scope"], claims["sub"]) == ("meals:read meals:write", "user-1")
    third = refresh(client, second["refresh_token"], resource=MEALS)
    assert third.status_code == 200


def test_reused_refresh_token_revokes_the_whole_family(client):
    first = tokens_for(client)
    second = refresh(client, first["refresh_token"]).json
    assert refresh(client, first["refresh_token"]).json["error"] == "invalid_grant"  # 古いものをもう一度使った
    assert refresh(client, second["refresh_token"]).json["error"] == "invalid_grant"  # 系列ごと無効になった


@pytest.mark.parametrize("change", [
    lambda rt: {"client_id": OTHER_CLIENT_ID},  # 別のクライアント
    lambda rt: {"refresh_token": "unknown." + rt.partition(".")[2]},  # 知らない系列
    lambda rt: {"refresh_token": "no-dot"},  # 形が正しくない
])
def test_refresh_rejects_invalid_requests(client, change):
    first = tokens_for(client)
    res = refresh(client, **{"refresh_token": first["refresh_token"], **change(first["refresh_token"])})
    assert (res.status_code, res.json["error"]) == (400, "invalid_grant")


def test_refresh_rejects_other_resource(client):
    first = tokens_for(client)
    res = refresh(client, first["refresh_token"], resource="https://other.example/mcp")
    assert res.json["error"] == "invalid_target"


def test_refresh_token_issued_before_the_switch_to_authlib_still_works(client, store):
    # 自作の実装のときに保存した系列（同じ形）と、そのときのリフレッシュトークン
    store.put("refresh", "fam", {
        "id": "fam", "client_id": CLIENT_ID, "subject": {"id": "user-1", "email": "u@example.com"},
        "scope": ["meals:read", "meals:write"], "resource": MEALS, "current_hash": hash_secret("secret-1"),
        "expires_at": time.time() + 3600,
    }, 3600)
    body = refresh(client, "fam.secret-1").json
    claims = verify_like_meals(client, body["access_token"])
    # 筋トレの scope は足さない（同意したときの scope のまま。筋トレを使うには同意し直す）
    assert (claims["sub"], claims["sid"], claims["scope"]) == ("user-1", "fam", "meals:read meals:write")


# ---- 失効（/revoke） ----

def revoke(client, token, client_id=CLIENT_ID):
    return client.post("/revoke", data={"token": token, "client_id": client_id})


@pytest.mark.parametrize("which", ["refresh_token", "access_token"])
def test_revoking_either_token_ends_the_connection(client, which):
    tokens = tokens_for(client)
    assert revoke(client, tokens[which]).status_code == 200
    assert refresh(client, tokens["refresh_token"]).json["error"] == "invalid_grant"


@pytest.mark.parametrize("token", ["unknown.secret", "not-a-token", "a.b.c"])
def test_revoking_unknown_token_does_nothing(client, token):
    tokens = tokens_for(client)
    assert revoke(client, token).status_code == 200  # エラーにしない（RFC 7009）
    assert refresh(client, tokens["refresh_token"]).status_code == 200


def test_other_client_cannot_revoke(client):
    tokens = tokens_for(client)
    assert revoke(client, tokens["refresh_token"], OTHER_CLIENT_ID).status_code == 200
    assert refresh(client, tokens["refresh_token"]).status_code == 200  # まだ使える


# ---- 公開する文書 ----

def test_metadata(client):
    metadata = client.get("/.well-known/oauth-authorization-server").json
    assert metadata == {
        "issuer": ISSUER,
        "authorization_endpoint": f"{ISSUER}/authorize",
        "token_endpoint": f"{ISSUER}/token",
        "jwks_uri": f"{ISSUER}/.well-known/jwks.json",
        "revocation_endpoint": f"{ISSUER}/revoke",
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none"],
        "scopes_supported": ["meals:read", "meals:write", "training:read", "training:write"],
        "authorization_response_iss_parameter_supported": True,
        "client_id_metadata_document_supported": True,
    }
    rfc8414.AuthorizationServerMetadata(metadata).validate(metadata_classes=[rfc9207.AuthorizationServerMetadata])


def test_jwks_publishes_only_the_public_key(client):
    (key,) = client.get("/.well-known/jwks.json").json["keys"]
    assert (key["kid"], key["use"], key["alg"], key["kty"]) == ("authz-key-1", "sig", "RS256", "RSA")
    assert "d" not in key


def test_logout_clears_the_login_page_session(client):
    res = client.get("/logout")
    assert res.headers["Location"] == f"https://login.example/logout?logout_uri={ISSUER}/logged-out"
