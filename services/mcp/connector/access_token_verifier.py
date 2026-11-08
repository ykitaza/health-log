import time
from collections.abc import Awaitable, Callable

import httpx2
import jwt
from mcp.server.auth.provider import AccessToken

JwksFetcher = Callable[[], Awaitable[dict]]


class AuthzApiTokenVerifier:
    """MCP SDK の TokenVerifier の実装。認可APIが発行したアクセストークンを検証する。

    認可コンテキストとの約束（公開された形）は、アクセストークンの JWT だけ。
    公開鍵（JWKS）は非同期の HTTP で取る（スレッドを使わないので、Lambda でも Cloudflare Workers でも動く）。
    HTTP クライアントは MCP SDK と同じ httpx2（Workers の上では fetch を使う版に切り替わる）。
    """

    # 知らない kid が来ても、前に JWKS を取ってからこの秒数は取り直さない。
    # でたらめな kid のトークンを送り続けられても、認可APIへの問い合わせが増えないようにする
    JWKS_MIN_REFETCH_SECONDS = 60
    # 必ず要るクレーム。ないトークンは、ほかの不正なトークンと同じく断る（SDK が 401 を返す）
    REQUIRED_CLAIMS = ["iss", "aud", "exp", "sub", "client_id"]

    def __init__(self, trusted_issuer: str, resource_url: str, fetch_jwks: JwksFetcher | None = None,
                 clock: Callable[[], float] = time.monotonic):
        self.trusted_issuer, self.resource_url = trusted_issuer, resource_url
        self.fetch_jwks = fetch_jwks or self._fetch_jwks
        self.clock = clock
        self.keys: dict[str, jwt.PyJWK] = {}  # kid → 公開鍵。知らない kid が来たときだけ取り直す
        self.fetched_at: float | None = None  # 最後に JWKS を取れた時刻

    async def verify_token(self, token: str) -> AccessToken | None:
        try:
            header = jwt.get_unverified_header(token)
            # IDトークンなどを取り違えて送ってきていないか（RFC 9068 のアクセストークンは typ が at+jwt）
            if header.get("typ") != "at+jwt":
                return None
            key = await self._key(header.get("kid"))
            if key is None:
                return None
            # 署名・iss（信じる発行者か）・aud（自分宛てか）・exp（期限内か）を検証する
            claims = jwt.decode(
                token, key, algorithms=["RS256"], issuer=self.trusted_issuer, audience=self.resource_url,
                options={"require": self.REQUIRED_CLAIMS})
        except (jwt.PyJWTError, httpx2.HTTPError):
            return None  # SDK が 401 と resource_metadata を返す
        return AccessToken(
            token=token,
            client_id=claims["client_id"],
            scopes=claims.get("scope", "").split(),
            expires_at=claims["exp"],
            resource=self.resource_url,
            subject=claims["sub"],
            claims=claims,
        )

    async def _key(self, kid: str | None) -> jwt.PyJWK | None:
        if kid not in self.keys and self._may_refetch():  # 鍵が替わった（または初回）
            jwks = jwt.PyJWKSet.from_dict(await self.fetch_jwks())
            self.keys = {k.key_id: k for k in jwks.keys}
            self.fetched_at = self.clock()
        return self.keys.get(kid)

    def _may_refetch(self) -> bool:
        # 取れたことがなければ取る（取れなかったときは、次のリクエストでまた試す）
        return self.fetched_at is None or self.clock() - self.fetched_at >= self.JWKS_MIN_REFETCH_SECONDS

    async def _fetch_jwks(self) -> dict:
        async with httpx2.AsyncClient(timeout=5) as client:
            res = await client.get(f"{self.trusted_issuer}/.well-known/jwks.json")
            res.raise_for_status()
            return res.json()
