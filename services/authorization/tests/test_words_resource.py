"""ことばの MCP を2つ目のリソースサーバー（宛先）として足したときの動き（docs/words-design.md の「MCP の宛先」）。

- resource を送らないクライアントは KARADA 宛て（今のコネクタが、つなぎ直しも更新もそのままできる）
- ことばの宛先のトークンは aud がことばの URL で、scope はことばの2つだけ。同意画面の見出しは「ことば」
- ことばの URL のパラメータがまだないときは、ことばを足さずに起動する
"""

import boto3
import jwt
import pytest
from moto import mock_aws

from infrastructure.cimd_client_directory import CimdClientDirectory
from infrastructure.settings import Settings, load_lambda_settings, new_private_key_pem
from infrastructure.stores import MemoryStore
from main import create_app
from tests.test_flow import (
    ISSUER,
    MEALS,
    FakeClock,
    FakeLogin,
    authorize_params,
    exchange,
    fetch_document,
    query_of,
    refresh,
)

WORDS = "https://words.example/mcp"


def words_client(words_resource=WORDS):
    settings = Settings(
        issuer=ISSUER, meals_resource=MEALS, cognito_issuer="", cognito_client_id="", cognito_client_secret="",
        signing_key_pem=new_private_key_pem(), session_secret="test-secret", state_table=None, on_lambda=False,
        words_resource=words_resource,
    )
    app = create_app(settings, store=MemoryStore(), clients=CimdClientDirectory(http_get=fetch_document),
                     login=FakeLogin(), clock=FakeClock())
    return app.test_client()


def consent(client, **overrides):
    res = client.get("/authorize", query_string=authorize_params(**overrides))
    assert res.status_code == 302, res.headers.get("Location")
    page = client.get("/cognito/callback").get_data(as_text=True)
    res = client.post("/consent", data={"decision": "allow"})
    return page, res


def tokens(client, resource, **overrides):
    page, res = consent(client, resource=resource, **overrides)
    assert res.status_code == 303, res.headers.get("Location")
    token = exchange(client, query_of(res)["code"], resource=resource)
    assert token.status_code == 200, token.json
    return page, token.json


def claims(body):
    return jwt.decode(body["access_token"], options={"verify_signature": False})


def test_resource_を送らないクライアントは_KARADA_宛て():
    client = words_client()
    _, body = tokens(client, None, scope=None)
    c = claims(body)
    assert c["aud"] == MEALS and c["scope"] == "meals:read meals:write training:read training:write"
    again = refresh(client, body["refresh_token"])  # 更新もそのまま
    assert again.status_code == 200 and claims(again.json)["aud"] == MEALS


def test_KARADA_の流れは今までと同じ():
    client = words_client()
    page, body = tokens(client, MEALS)
    assert "KARADA" in page and "ことば" not in page
    assert (claims(body)["aud"], body["scope"]) == (MEALS, "meals:read meals:write")


def test_ことば宛てのトークンは_aud_がことばで_scope_はことばだけ():
    client = words_client()
    page, body = tokens(client, WORDS, scope="words:read words:write meals:read")
    c = claims(body)
    assert c["aud"] == WORDS and body["scope"] == "words:read words:write"
    assert '<p class="logo" aria-label="ことば">ことば</p>' in page and "ことば（集めた表現" in page
    assert "<title>連携の確認 - ことば</title>" in page
    again = refresh(client, body["refresh_token"])
    assert again.status_code == 200 and claims(again.json)["aud"] == WORDS


def test_ことば宛てに_KARADA_の_scope_だけを求めたら断る():
    client = words_client()
    res = client.get("/authorize", query_string=authorize_params(resource=WORDS, scope="meals:read"))
    assert query_of(res)["error"] == "invalid_scope"


def test_トークンの交換で宛先を変えられない():
    client = words_client()
    _, res = consent(client, resource=WORDS, scope="words:read")
    token = exchange(client, query_of(res)["code"], resource=MEALS)
    assert token.status_code == 400 and token.json["error"] == "invalid_target"


def test_ことばの_URL_がなければ_ことばの宛先は知らない():
    client = words_client(None)
    res = client.get("/authorize", query_string=authorize_params(resource=WORDS, scope="words:read"))
    assert query_of(res)["error"] == "invalid_target"
    metadata = client.get("/.well-known/oauth-authorization-server").json
    assert metadata["scopes_supported"] == ["meals:read", "meals:write", "training:read", "training:write"]


def test_認可APIの文書には_ことばの_scope_も並ぶ():
    metadata = words_client().get("/.well-known/oauth-authorization-server").json
    assert metadata["scopes_supported"][-2:] == ["words:read", "words:write"]


# ---- Lambda の設定（SSM） ----


@pytest.fixture
def aws(monkeypatch):
    monkeypatch.setenv("AWS_DEFAULT_REGION", "ap-northeast-1")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    with mock_aws():
        pool = boto3.client("cognito-idp").create_user_pool(PoolName="p")["UserPool"]["Id"]
        client_id = boto3.client("cognito-idp").create_user_pool_client(
            UserPoolId=pool, ClientName="authz-api", GenerateSecret=True)["UserPoolClient"]["ClientId"]
        ssm = boto3.client("ssm")
        for name, value in {"/t/client-id": client_id, "/t/authz-url": ISSUER + "/",
                            "/t/meals-url": "https://meals.example"}.items():
            ssm.put_parameter(Name=name, Value=value, Type="String")
        for key, value in {"COGNITO_CLIENT_ID_PARAM": "/t/client-id", "COGNITO_USER_POOL_ID": pool,
                           "AUTHZ_URL_PARAM": "/t/authz-url", "MEALS_URL_PARAM": "/t/meals-url",
                           "SIGNING_KEY_PARAM": "/t/signing-key", "SESSION_SECRET_PARAM": "/t/session",
                           "COGNITO_ISSUER": "https://cognito.example", "STATE_TABLE": "state",
                           "WORDS_URL_PARAM": "/t/words-url"}.items():
            monkeypatch.setenv(key, value)
        yield ssm


def test_ことばの_URL_のパラメータがまだなくても起動する(aws):
    settings = load_lambda_settings()
    assert settings.words_resource is None and settings.meals_resource == MEALS


def test_ことばの_URL_のパラメータがあれば_ことばの_mcp_を宛先にする(aws):
    aws.put_parameter(Name="/t/words-url", Value="https://words.example/", Type="String")
    assert load_lambda_settings().words_resource == WORDS


def test_ことばの_URL_のパラメータの名前がない環境でも起動する(aws, monkeypatch):
    monkeypatch.delenv("WORDS_URL_PARAM")
    assert load_lambda_settings().words_resource is None

