import pytest

from oauth.models import Client, RefreshTokenFamily, TokenMatch, hash_secret, is_client_id_url, parse_refresh_token


LOCAL_CLIENT_IDS = ["http://localhost:3005/client-metadata.json", "http://127.0.0.1:3005/client-metadata.json"]


def test_client_id_accepts_https():
    assert is_client_id_url("https://claude.ai/oauth/claude-code-client-metadata")


@pytest.mark.parametrize("url", LOCAL_CLIENT_IDS)
def test_client_id_accepts_local_http_only_when_allowed(url):
    # PC で動かすときだけ認める。Lambda で認めると、認可API が自分の中（localhost）へ取りに行ってしまう（SSRF）
    assert is_client_id_url(url, allow_loopback_http=True)
    assert not is_client_id_url(url)


@pytest.mark.parametrize("url", [
    "http://evil.example/meta.json",  # localhost 以外の http
    "https://example.com",  # パスがない
    "https://example.com/",
    "https://user:pass@example.com/meta.json",
    "https://example.com/meta.json#x",
    "study-client",  # URL ではない
])
def test_client_id_rejects_invalid_urls(url):
    assert not is_client_id_url(url)


def client_with(redirect_uri: str) -> Client:
    return Client("https://client.example/metadata.json", "Example", (redirect_uri,))


def test_loopback_redirect_ignores_port():
    client = client_with("http://localhost/callback")
    assert client.check_redirect_uri("http://localhost:51234/callback")
    assert not client.check_redirect_uri("http://localhost:51234/evil")
    assert not client.check_redirect_uri("http://127.0.0.1:51234/callback")


def test_non_loopback_redirect_requires_exact_match():
    client = client_with("https://claude.ai/api/mcp/auth_callback")
    assert client.check_redirect_uri("https://claude.ai/api/mcp/auth_callback")
    assert not client.check_redirect_uri("https://claude.ai:8443/api/mcp/auth_callback")


@pytest.mark.parametrize("value", ["", "fam", "fam.", ".secret", "a.b.c"])
def test_malformed_refresh_tokens_are_not_parsed(value):
    assert parse_refresh_token(value) is None


def stored_family(**extra) -> dict:
    return {"id": "fam", "client_id": "https://client.example/metadata.json",
            "subject": {"id": "user-1", "email": "u@example.com"}, "scope": ["meals:read"],
            "resource": "https://meals.example/mcp", "current_hash": hash_secret("current"), "expires_at": 2e9,
            **extra}


def test_family_stored_before_previous_hash_loads_and_only_its_current_token_matches():
    family = RefreshTokenFamily.from_dict(stored_family())
    assert (family.previous_hash, family.rotated_at) == (None, None)
    assert family.match("current", 0, 60) is TokenMatch.CURRENT
    assert family.match("other", 0, 60) is TokenMatch.OLDER


@pytest.mark.parametrize(("now", "expected"), [
    (1000, TokenMatch.PREVIOUS_IN_GRACE),
    (1059.9, TokenMatch.PREVIOUS_IN_GRACE),
    (1060, TokenMatch.PREVIOUS_AFTER_GRACE),
])
def test_previous_token_matches_only_within_the_grace(now, expected):
    family = RefreshTokenFamily.from_dict(stored_family(previous_hash=hash_secret("previous"), rotated_at=1000))
    assert family.match("previous", now, 60) is expected
    assert RefreshTokenFamily.from_dict(family.to_dict()) == family  # 保存して読み直しても同じ
