import time
from collections.abc import Awaitable, Callable

import anyio
import httpx2
import jwt
from mcp.server.auth.provider import AccessToken

JwksFetcher = Callable[[], Awaitable[dict]]


class JwksUnavailableError(Exception):
    """公開鍵（JWKS）が取れず、トークンが正しいかどうか決められない。トークンが不正なのではないので、401 ではなく 503 にする。"""


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
    # JWKS が取れなかったときの、1回だけのやり直しの前の待ち（秒）。Lambda の解凍直後などの一瞬の失敗を越える
    JWKS_RETRY_DELAY_SECONDS = 0.3

    def __init__(self, trusted_issuer: str, resource_url: str, fetch_jwks: JwksFetcher | None = None,
                 clock: Callable[[], float] = time.monotonic,
                 sleep: Callable[[float], Awaitable[None]] = anyio.sleep):
        self.trusted_issuer, self.resource_url = trusted_issuer, resource_url
        self.fetch_jwks = fetch_jwks or self._fetch_jwks
        self.clock, self.sleep = clock, sleep
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
        except jwt.PyJWTError:
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
            try:
                jwks = jwt.PyJWKSet.from_dict(await self._fetch_with_retry())
            except JwksUnavailableError:
                if not self.keys:
                    raise  # 使える鍵が1つもない。不正なトークンとは区別して、一時的なエラーにする
                self.fetched_at = self.clock()  # 取れるまで毎回は問い合わせない
                if kid not in self.keys:
                    raise  # 前に取れた鍵に kid がない（鍵が替わったかもしれない）ので、決められない
                # 前に取れた鍵で検証する
            else:
                self.keys = {k.key_id: k for k in jwks.keys}
                self.fetched_at = self.clock()
        return self.keys.get(kid)

    async def _fetch_with_retry(self) -> dict:
        try:
            return await self.fetch_jwks()
        except httpx2.HTTPError:
            await self.sleep(self.JWKS_RETRY_DELAY_SECONDS)  # 少し待って1回だけやり直す
        try:
            return await self.fetch_jwks()
        except httpx2.HTTPError as e:
            raise JwksUnavailableError("JWKS を取得できない") from e

    def _may_refetch(self) -> bool:
        # 取れたことがなければ取る（取れなかったときは、次のリクエストでまた試す）
        return self.fetched_at is None or self.clock() - self.fetched_at >= self.JWKS_MIN_REFETCH_SECONDS

    async def _fetch_jwks(self) -> dict:
        async with httpx2.AsyncClient(timeout=5) as client:
            res = await client.get(f"{self.trusted_issuer}/.well-known/jwks.json")
            res.raise_for_status()
            return res.json()
