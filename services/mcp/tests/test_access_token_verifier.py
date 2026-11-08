"""アクセストークンの検証を、9通りのトークンで確かめる（以前 api/ で行ったテストの移植）。"""

import asyncio
import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from jwt.algorithms import RSAAlgorithm

from connector.access_token_verifier import AuthzApiTokenVerifier

ISSUER = "https://authz.example"
RESOURCE = "https://mcp.example/mcp"
REAL_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
FAKE_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


async def stub_jwks() -> dict:
    """JWKS の取得の代わりに、認可APIの本物の公開鍵を返す。"""
    return {"keys": [{**RSAAlgorithm.to_jwk(REAL_KEY.public_key(), as_dict=True), "kid": "k", "alg": "RS256"}]}


def token(key=REAL_KEY, headers=None, **overrides):
    now = int(time.time())
    claims = {"iss": ISSUER, "sub": "user-1", "aud": RESOURCE, "client_id": "c", "scope": "read",
              "iat": now, "exp": now + 60, **overrides}
    return jwt.encode(claims, key, algorithm="RS256", headers=headers or {"kid": "k", "typ": "at+jwt"})


def verify(t):
    return asyncio.run(AuthzApiTokenVerifier(ISSUER, RESOURCE, fetch_jwks=stub_jwks).verify_token(t))


def test_accepts_valid_token():
    result = verify(token())
    assert (result.subject, result.scopes, result.client_id) == ("user-1", ["read"], "c")


@pytest.mark.parametrize("bad", [
    "abc.def.ghi",  # でたらめ
    token(key=FAKE_KEY),  # 別の鍵で署名（なりすまし）
    token(iss="https://evil.example"),
    token(aud="https://other.example/mcp"),  # 別のリソースサーバー宛て
    token(iat=int(time.time()) - 700, exp=int(time.time()) - 100),  # 期限切れ
    token(headers={"kid": "k"}),  # typ が at+jwt でない（IDトークンの取り違え）
])
def test_rejects_invalid_tokens(bad):
    assert verify(bad) is None


@pytest.mark.parametrize("claim", ["client_id", "sub", "exp", "iss", "aud"])
def test_rejects_tokens_missing_required_claims(claim):
    # 500 ではなく、ほかの不正なトークンと同じく None（SDK が 401 を返す）
    t = token()
    claims = jwt.decode(t, options={"verify_signature": False})
    del claims[claim]
    assert verify(jwt.encode(claims, REAL_KEY, algorithm="RS256", headers={"kid": "k", "typ": "at+jwt"})) is None


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


def test_unknown_kid_does_not_refetch_jwks_every_time():
    fetched, clock = [], Clock()

    async def counting_jwks():
        fetched.append(clock.now)
        return await stub_jwks()

    verifier = AuthzApiTokenVerifier(ISSUER, RESOURCE, fetch_jwks=counting_jwks, clock=clock)
    run = lambda t: asyncio.run(verifier.verify_token(t))  # noqa: E731
    assert run(token()) is not None and len(fetched) == 1  # 初回は取る
    unknown = token(headers={"kid": "unknown", "typ": "at+jwt"})
    for _ in range(5):
        assert run(unknown) is None
    assert len(fetched) == 1  # 前に取ってから間もないので、知らない kid が来ても取り直さない
    clock.now += AuthzApiTokenVerifier.JWKS_MIN_REFETCH_SECONDS
    assert run(unknown) is None and len(fetched) == 2  # 間があけば取り直す（鍵が替わったかもしれない）
    assert run(unknown) is None and len(fetched) == 2
    assert run(token()) is not None and len(fetched) == 2  # 知っている kid は今の鍵で検証する
