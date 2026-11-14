import httpx
import pytest

from infrastructure.cimd_client_directory import CimdClientDirectory, ClientRejected

CLIENT_ID = "https://client.example/metadata.json"
DOC = {"client_id": CLIENT_ID, "client_name": "Example", "redirect_uris": ["https://client.example/callback"]}


def directory(status=200, json=None, error=None):
    def http_get(url):
        if error:
            raise error
        return httpx.Response(status, json=DOC if json is None else json)

    return CimdClientDirectory(http_get=http_get)


def test_reads_client_from_metadata_document():
    client = directory().find(CLIENT_ID)
    assert (client.client_name, client.redirect_uris) == ("Example", ("https://client.example/callback",))


def test_accepts_client_that_also_supports_none():
    # ChatGPT の文書の形
    doc = {**DOC, "token_endpoint_auth_method": "private_key_jwt",
           "token_endpoint_auth_methods_supported": ["none", "private_key_jwt"]}
    assert directory(json=doc).find(CLIENT_ID).client_name == "Example"


@pytest.mark.parametrize("kwargs", [
    {"status": 404},
    {"error": httpx.ConnectError("down")},
    {"json": {**DOC, "client_id": "https://other.example/metadata.json"}},  # 他人の文書の使い回し
    {"json": {**DOC, "token_endpoint_auth_method": "client_secret_basic"}},
    {"json": {"client_id": CLIENT_ID}},  # redirect_uris がない
    {"json": {**DOC, "padding": "x" * 6000}},  # 5KB を超える
])
def test_rejects_unusable_documents(kwargs):
    with pytest.raises(ClientRejected):
        directory(**kwargs).find(CLIENT_ID)


def test_stops_reading_once_the_document_exceeds_5kb(monkeypatch):
    # 大きな文書（や終わらない応答）を全部受け取らず、5KB を超えたところで読むのをやめる
    sent = []

    def chunks():
        for _ in range(1000):  # 1KB × 1000
            sent.append(1)
            yield b"x" * 1024

    transport = httpx.MockTransport(lambda request: httpx.Response(200, stream=ChunkStream(chunks())))
    real_client = httpx.Client
    monkeypatch.setattr(httpx, "Client", lambda **kwargs: real_client(transport=transport, **kwargs))
    with pytest.raises(ClientRejected):
        CimdClientDirectory().find(CLIENT_ID)
    assert len(sent) <= 6


class ChunkStream(httpx.SyncByteStream):
    def __init__(self, chunks):
        self.chunks = chunks

    def __iter__(self):
        yield from self.chunks


def test_reads_document_through_the_stream(monkeypatch):
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json=DOC))
    real_client = httpx.Client
    monkeypatch.setattr(httpx, "Client", lambda **kwargs: real_client(transport=transport, **kwargs))
    assert CimdClientDirectory().find(CLIENT_ID).client_name == "Example"


def test_does_not_fetch_non_https_urls():
    fetched = []
    directory = CimdClientDirectory(http_get=fetched.append)
    with pytest.raises(ClientRejected):
        directory.find("http://169.254.169.254/latest/meta-data")  # SSRF の対策
    with pytest.raises(ClientRejected):
        directory.find("http://localhost:3005/client-metadata.json")  # 既定（Lambda）では localhost も取りに行かない
    assert fetched == []


def test_fetches_localhost_only_when_allowed():
    fetched = []

    def http_get(url):
        fetched.append(url)
        return httpx.Response(200, json={**DOC, "client_id": url})

    local = "http://localhost:3005/client-metadata.json"
    assert CimdClientDirectory(http_get=http_get, allow_loopback_http=True).find(local).client_id == local
    assert fetched == [local]


def test_fetches_only_allowed_hosts_when_restricted():
    fetched = []

    def http_get(url):
        fetched.append(url)
        return httpx.Response(200, json={**DOC, "client_id": url})

    directory = CimdClientDirectory(http_get=http_get, allowed_hosts=frozenset({"claude.ai", "chatgpt.com"}))
    allowed = "https://claude.ai/oauth/mcp-oauth-client-metadata"
    assert directory.find(allowed).client_id == allowed
    for other in ["https://client.example/metadata.json",
                  "https://claude.ai.evil.example/metadata.json",  # 名前の先頭だけが同じ
                  "https://evil.claude.ai/metadata.json",  # サブドメイン
                  "https://claude.ai:8443/metadata.json"]:  # 既定でないポート
        with pytest.raises(ClientRejected):
            directory.find(other)
    assert fetched == [allowed]


def test_does_not_restrict_hosts_by_default():
    # PC で動かすとき（allowed_hosts を渡さない）は、ホストを絞らない
    assert directory().find(CLIENT_ID).client_id == CLIENT_ID


def test_uses_hosted_document_without_fetching_and_still_checks_it():
    # 認可API が自分で公開している文書（Muse）は取りに行かない。中身は取りに行った文書と同じように確かめる
    fetched = []
    hosted = "https://authz.example/clients/muse.json"
    doc = {**DOC, "client_id": hosted}
    directory = CimdClientDirectory(http_get=fetched.append, allowed_hosts=frozenset({"claude.ai"}),
                                    hosted={hosted: doc})
    assert directory.find(hosted).redirect_uris == ("https://client.example/callback",)
    with pytest.raises(ClientRejected):
        CimdClientDirectory(http_get=fetched.append, hosted={hosted: {**doc, "client_id": CLIENT_ID}}).find(hosted)
    assert fetched == []
