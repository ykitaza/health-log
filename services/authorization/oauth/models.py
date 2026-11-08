"""Authlib の認可サーバーに渡すモデル（クライアント、本人、認可コード、リフレッシュトークンの系列）。

Authlib が求めるメソッド（ClientMixin など）を実装し、保存できる形（dict）との変換も持つ。
"""

import hashlib
import hmac
from dataclasses import dataclass
from urllib.parse import urlsplit

from authlib.oauth2.rfc6749 import AuthorizationCodeMixin, ClientMixin, TokenMixin

LOOPBACK_HOSTS = {"localhost", "127.0.0.1"}
GRANT_TYPES = {"authorization_code", "refresh_token"}


def is_client_id_url(value: str, *, allow_loopback_http: bool = False) -> bool:
    """CIMD の client_id（クライアントの情報を書いた文書の URL）として使える形か。

    本来は https だけを認める。allow_loopback_http は PC で動かすときだけ True にし、自分のPCの中（localhost）の
    http も認める。Lambda で認めると、認可API が自分の中へ文書を取りに行ってしまう（SSRF）。
    """
    url = urlsplit(value)
    loopback = allow_loopback_http and url.scheme == "http" and url.hostname in LOOPBACK_HOSTS
    if not (url.scheme == "https" or loopback):
        return False
    return not (url.path in ("", "/") or url.fragment or url.username or url.password)


def redirect_uri_matches(requested: str, registered: str) -> bool:
    if requested == registered:
        return True
    # RFC 8252：自分のPCで動くアプリの戻り先（localhost）は、ポート番号を毎回変えてよい。
    # そのため localhost の http に限り、ポート番号以外が一致すれば認める
    url, reg = urlsplit(requested), urlsplit(registered)
    if url.scheme != "http" or url.hostname not in LOOPBACK_HOSTS:
        return False
    return (url.scheme, url.hostname, url.path, url.query) == (reg.scheme, reg.hostname, reg.path, reg.query)


@dataclass(frozen=True)
class Client(ClientMixin):
    """OAuth クライアント。事前登録はせず、/authorize で CIMD の文書から作る。

    /token と /revoke では文書を取りに行かず、client_id だけのクライアントとして扱う
    （シークレットを持たないクライアントなので、確かめるのは認可コード・PKCE・リフレッシュトークンとの一致）。
    """

    client_id: str
    client_name: str = ""
    redirect_uris: tuple[str, ...] = ()

    @property
    def host(self) -> str:
        """同意画面に出すドメイン。client_name は偽れるので、こちらも並べて出す。"""
        return urlsplit(self.client_id).netloc

    def get_client_id(self):
        return self.client_id

    def get_default_redirect_uri(self):
        return None  # redirect_uri は毎回送ってもらう

    def get_allowed_scope(self, scope):
        # scope はリソースサーバーごとに決まるので、ここでは狭めない（RFC 8707 の拡張で狭める）
        return scope or ""

    def check_redirect_uri(self, redirect_uri):
        return any(redirect_uri_matches(redirect_uri, registered) for registered in self.redirect_uris)

    def check_client_secret(self, client_secret):
        return False

    def check_endpoint_auth_method(self, method, endpoint):
        return method == "none"  # シークレットを持たないクライアント（PKCE で確かめる）だけ

    def check_response_type(self, response_type):
        return response_type == "code"

    def check_grant_type(self, grant_type):
        return grant_type in GRANT_TYPES

    def to_dict(self) -> dict:
        return {"client_id": self.client_id, "client_name": self.client_name,
                "redirect_uris": list(self.redirect_uris)}

    @classmethod
    def from_dict(cls, d: dict) -> "Client":
        return cls(d["client_id"], d["client_name"], tuple(d["redirect_uris"]))


@dataclass(frozen=True)
class Subject:
    """本人。本人確認（Cognito）から受け取った sub とメールアドレス。"""

    id: str
    email: str = ""

    def get_user_id(self):
        return self.id

    def to_dict(self) -> dict:
        return {"id": self.id, "email": self.email}

    @classmethod
    def from_dict(cls, d: dict) -> "Subject":
        return cls(d["id"], d["email"])


@dataclass(frozen=True)
class Connection:
    """連携：誰が（subject）、どのリソースサーバー宛てに（resource）許したか。id はリフレッシュトークンの系列 ID。

    トークンを発行するときに Authlib の user として渡し、アクセストークンの sub・aud・sid にする。
    """

    id: str
    subject: Subject
    resource: str

    def get_user_id(self):
        return self.subject.id


@dataclass(frozen=True)
class AuthorizationCode(AuthorizationCodeMixin):
    code: str
    client_id: str
    redirect_uri: str
    scope: str
    code_challenge: str
    code_challenge_method: str
    resource: str
    subject: Subject

    def get_redirect_uri(self):
        return self.redirect_uri

    def get_scope(self):
        return self.scope

    def to_dict(self) -> dict:
        return {**self.__dict__, "subject": self.subject.to_dict()}

    @classmethod
    def from_dict(cls, d: dict) -> "AuthorizationCode":
        return cls(**{**d, "subject": Subject.from_dict(d["subject"])})


def hash_secret(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


@dataclass(frozen=True)
class RefreshTokenFamily(TokenMixin):
    """リフレッシュトークンの系列。ログインして同意するたびに1つでき、ローテーションしても続く。

    リフレッシュトークンは「<系列ID>.<ランダムな値>」の形。覚えているのは最新のランダムな値のハッシュだけ
    （DB が漏れても、そのままでは使えない）。
    """

    id: str
    client_id: str
    subject: Subject
    scope: str
    resource: str
    current_hash: str
    expires_at: float

    def is_current(self, secret: str) -> bool:
        return hmac.compare_digest(hash_secret(secret), self.current_hash)

    def check_client(self, client):
        return client.get_client_id() == self.client_id

    def get_scope(self):
        return self.scope

    def get_expires_in(self):
        return 0

    def is_expired(self):
        return False  # 期限は保存先の TTL で確かめる

    def is_revoked(self):
        return False  # 取り消した系列は消す

    def to_dict(self) -> dict:
        # 保存の形は、自作の実装のときと同じ（scope は list）。発行済みのリフレッシュトークンをそのまま使えるようにする
        return {**self.__dict__, "subject": self.subject.to_dict(), "scope": self.scope.split()}

    @classmethod
    def from_dict(cls, d: dict) -> "RefreshTokenFamily":
        return cls(**{**d, "subject": Subject.from_dict(d["subject"]), "scope": " ".join(d["scope"]),
                      "expires_at": float(d["expires_at"])})


def parse_refresh_token(value: str) -> tuple[str, str] | None:
    """リフレッシュトークンを（系列ID、ランダムな値）に分ける。形が正しくなければ None。"""
    family_id, dot, secret = value.partition(".")
    if not (family_id and dot and secret) or "." in secret:
        return None
    return family_id, secret
