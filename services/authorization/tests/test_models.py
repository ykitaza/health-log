import pytest

from oauth.models import Client, is_client_id_url, parse_refresh_token


@pytest.mark.parametrize("url", [
    "https://claude.ai/oauth/claude-code-client-metadata",
    "http://localhost:3005/client-metadata.json",
    "http://127.0.0.1:3005/client-metadata.json",
])
def test_client_id_accepts_https_and_local_http(url):
    assert is_client_id_url(url)


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
