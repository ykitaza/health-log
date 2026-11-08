"""Authlib の認可サーバー（Flask の統合）を組み立てる。

Authlib に任せるもの：認可コードのグラント、PKCE（RFC 7636）、リフレッシュトークン（ローテーション）、
失効（RFC 7009）、iss（RFC 9207）、JWT のアクセストークン（RFC 9068）、クライアント認証（none）とエラー応答。
ここで書くのは、保存先とのやり取りと、方針（S256 だけ、ローテーションと再使用の検出）だけ。
RFC 8707 は resource_indicators.py、CIMD は infrastructure/cimd_client_directory.py にある。
"""

import secrets
import time

from authlib.integrations.flask_oauth2 import AuthorizationServer as FlaskAuthorizationServer
from authlib.oauth2 import rfc9207
from authlib.oauth2.rfc6749 import InvalidRequestError, OAuth2Error, OAuth2Request, grants
from authlib.oauth2.rfc6749.requests import BasicOAuth2Payload
from authlib.oauth2.rfc7009 import RevocationEndpoint
from authlib.oauth2.rfc7636 import CodeChallenge
from authlib.oauth2.rfc9068 import JWTBearerTokenGenerator
from flask import Response, g
from joserfc import jwt
from joserfc.errors import JoseError
from joserfc.jwk import KeySet, RSAKey

from oauth.models import (
    AuthorizationCode,
    Client,
    Connection,
    RefreshTokenFamily,
    hash_secret,
    is_client_id_url,
    parse_refresh_token,
)
from oauth.resource_indicators import ResourceIndicators, ResourceServer, check_token_resource
from oauth.store import Store

KEY_ID = "authz-key-1"
# 5分：取り消し（ログアウト）しても、発行済みのアクセストークンは期限まで使えてしまうため短くする
ACCESS_TOKEN_TTL_SECONDS = 300
CODE_TTL_SECONDS = 60
REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60  # 使うたびに、ここから数え直す


def new_id() -> str:
    return secrets.token_urlsafe(32)


class S256CodeChallenge(CodeChallenge):
    """PKCE。必ず使い、方式は S256 だけにする（plain や、PKCE なしは認めない）。"""

    SUPPORTED_CODE_CHALLENGE_METHOD = ["S256"]

    def validate_code_challenge(self, grant, redirect_uri):
        data = grant.request.payload.data
        if not data.get("code_challenge") or data.get("code_challenge_method") != "S256":
            raise InvalidRequestError("PKCE with code_challenge_method=S256 is required.")
        super().validate_code_challenge(grant, redirect_uri)


class AuthorizationCodeGrant(grants.AuthorizationCodeGrant):
    TOKEN_ENDPOINT_AUTH_METHODS = ["none"]  # シークレットを持たないクライアント（PKCE で確かめる）

    def save_authorization_code(self, code, request):
        data = request.payload.data
        item = AuthorizationCode(
            code=code,
            client_id=request.client.client_id,
            redirect_uri=request.payload.redirect_uri,
            scope=request.scope,
            code_challenge=data["code_challenge"],
            code_challenge_method=data["code_challenge_method"],
            resource=request.resource,  # ResourceIndicators が決めた宛先
            subject=request.user,
        )
        self.server.store.put("code", code, item.to_dict(), CODE_TTL_SECONDS)

    def query_authorization_code(self, code, client):
        # 取り出すと同時に消す。確かめに失敗しても、同じ認可コードはもう使えない（1回だけ）
        data = self.server.store.pop("code", code)
        if data is None:
            return None
        item = AuthorizationCode.from_dict(data)
        return item if item.client_id == client.client_id else None

    def delete_authorization_code(self, authorization_code):
        pass  # query_authorization_code で取り出したときに消している

    def authenticate_user(self, authorization_code):
        # 認可コードを引き換えるたびに、新しい連携（リフレッシュトークンの系列）を始める
        return Connection(new_id(), authorization_code.subject, authorization_code.resource)

    def validate_token_request(self):
        super().validate_token_request()
        check_token_resource(self.request.payload.data.get("resource"), self.request.authorization_code.resource)


class RefreshTokenGrant(grants.RefreshTokenGrant):
    TOKEN_ENDPOINT_AUTH_METHODS = ["none"]
    INCLUDE_NEW_REFRESH_TOKEN = True  # ローテーション：使うたびに新しいリフレッシュトークンを渡す

    def authenticate_refresh_token(self, refresh_token):
        parsed = parse_refresh_token(refresh_token)
        if parsed is None:
            return None
        family_id, secret = parsed
        data = self.server.store.get("refresh", family_id)
        if data is None:
            return None
        family = RefreshTokenFamily.from_dict(data)
        if family.expires_at <= time.time():
            return None
        if not family.is_current(secret):
            # ローテーションで古くなったものが使われた。盗まれた可能性があるので、系列ごと無効にする
            self.server.store.pop("refresh", family_id)
            return None
        return family

    def authenticate_user(self, refresh_token):
        return Connection(refresh_token.id, refresh_token.subject, refresh_token.resource)

    def revoke_old_credential(self, refresh_token):
        pass  # save_token で系列の最新のハッシュを置き換えたので、古いリフレッシュトークンはもう使えない

    def validate_token_request(self):
        super().validate_token_request()
        check_token_resource(self.request.payload.data.get("resource"), self.request.refresh_token.resource)


class TokenRevocationEndpoint(RevocationEndpoint):
    """RFC 7009。リフレッシュトークンでもアクセストークンでも、その連携の系列ごと消す。"""

    CLIENT_AUTH_METHODS = ["none"]

    def query_token(self, token_string, token_type_hint):
        family_id = self._family_id(token_string)
        data = self.server.store.get("refresh", family_id) if family_id else None
        return RefreshTokenFamily.from_dict(data) if data else None

    def authenticate_token(self, request, client):
        self.check_params(request, client)
        family = self.query_token(request.form["token"], request.form.get("token_type_hint"))
        # 別のクライアントのトークンなら何もしない。知らないトークンと同じく 200 を返す
        # （トークンが有効かどうかを外から探らせないため）
        return family if family and family.check_client(client) else None

    def revoke_token(self, token, request):
        self.server.store.pop("refresh", token.id)

    def _family_id(self, token: str) -> str | None:
        parsed = parse_refresh_token(token)  # リフレッシュトークン（系列ID.ランダムな値）
        if parsed:
            return parsed[0]
        claims = self.server.read_access_token(token)  # アクセストークン（JWT）の sid
        return claims.get("sid") if claims else None


class AccessTokenGenerator(JWTBearerTokenGenerator):
    """RFC 9068 の JWT のアクセストークン。aud は RFC 8707 の resource、sid は連携（リフレッシュトークンの系列）。"""

    def __init__(self, issuer: str, keys: KeySet):
        super().__init__(issuer, alg="RS256", refresh_token_generator=self.new_refresh_token,
                         expires_generator=ACCESS_TOKEN_TTL_SECONDS)
        self.keys = keys

    def get_jwks(self):
        return self.keys

    def get_audiences(self, client, user, scope):
        return user.resource

    def get_extra_claims(self, client, grant_type, user, scope):
        return {"sid": user.id}

    @staticmethod
    def new_refresh_token(client, grant_type, user, scope):
        return f"{user.id}.{secrets.token_urlsafe(32)}"


class IssuerParameter(rfc9207.IssuerParameter):
    """RFC 9207：認可の応答（エラーも含む）に iss を付ける。"""

    def __init__(self, issuer: str):
        self.issuer = issuer

    def get_issuer(self) -> str:
        return self.issuer


class AuthorizationServer(FlaskAuthorizationServer):
    def __init__(self, issuer: str, signing_key_pem: str, store: Store, resource_servers: list[ResourceServer],
                 *, allow_loopback_http: bool = False):
        super().__init__()
        self.issuer, self.store, self.resource_servers = issuer, store, resource_servers
        self.allow_loopback_http = allow_loopback_http  # localhost の http の client_id を認めるか（PC だけ）
        self.keys = KeySet([RSAKey.import_key(
            signing_key_pem, parameters={"kid": KEY_ID, "use": "sig", "alg": "RS256"})])
        self.issuer_parameter = IssuerParameter(issuer)

        self.register_grant(AuthorizationCodeGrant, [S256CodeChallenge(required=True),
                                                     ResourceIndicators(resource_servers)])
        self.register_grant(RefreshTokenGrant)
        self.register_endpoint(TokenRevocationEndpoint)
        self.register_extension(self.issuer_parameter)
        self.register_token_generator("default", AccessTokenGenerator(issuer, self.keys))

    def query_client(self, client_id):
        # /authorize と /consent では、CIMD の文書から作ったクライアントを use_client で置いておく
        client = g.get("clients", {}).get(client_id)
        if client is not None:
            return client
        if client_id and is_client_id_url(client_id, allow_loopback_http=self.allow_loopback_http):
            return Client(client_id)
        return None

    def save_token(self, token, request):
        """トークンを発行したら、連携（リフレッシュトークンの系列）に最新のリフレッシュトークンのハッシュを置く。"""
        connection: Connection = request.user
        previous: RefreshTokenFamily | None = request.refresh_token  # リフレッシュのときは、元の系列
        _, secret = parse_refresh_token(token["refresh_token"])
        family = RefreshTokenFamily(
            id=connection.id,
            client_id=request.client.client_id,
            subject=connection.subject,
            scope=previous.scope if previous else token["scope"],
            resource=connection.resource,
            current_hash=hash_secret(secret),
            expires_at=time.time() + REFRESH_TOKEN_TTL_SECONDS,
        )
        self.store.put("refresh", family.id, family.to_dict(), REFRESH_TOKEN_TTL_SECONDS)

    def create_oauth2_request(self, request):
        # 同意画面のあと（/consent）は、保存しておいた /authorize のパラメータで確かめ直す
        if isinstance(request, OAuth2Request):
            return request
        return super().create_oauth2_request(request)

    def saved_authorization_request(self, params: dict) -> OAuth2Request:
        request = OAuth2Request("GET", f"{self.issuer}/authorize")
        request.payload = BasicOAuth2Payload(params)
        return request

    def authorization_error_response(self, error: OAuth2Error) -> Response:
        """/authorize のエラーを、確かめた redirect_uri へ返す（iss を付ける）。"""
        response = self.handle_error_response(None, error)
        self.issuer_parameter.add_issuer_parameter(self, response)
        return response

    def read_access_token(self, token: str) -> dict | None:
        """自分が発行したアクセストークンなら、その中身を返す。期限切れでもよい（取り消しに使うため）。"""
        try:
            claims = jwt.decode(token, self.keys, algorithms=["RS256"]).claims
        except (JoseError, ValueError):
            return None
        return claims if claims.get("iss") == self.issuer else None

    def jwks(self) -> dict:
        # 公開鍵だけを公開する。リソースサーバーはこれで署名を検証する
        return {"keys": [key.as_dict(private=False) for key in self.keys]}

    def metadata(self) -> dict:
        """RFC 8414：OAuth クライアントが認可APIの入口と、対応している方式を知るための文書。"""
        issuer = self.issuer
        return {
            "issuer": issuer,
            "authorization_endpoint": f"{issuer}/authorize",
            "token_endpoint": f"{issuer}/token",
            "jwks_uri": f"{issuer}/.well-known/jwks.json",
            "revocation_endpoint": f"{issuer}/revoke",  # RFC 7009
            "response_types_supported": ["code"],
            "grant_types_supported": ["authorization_code", "refresh_token"],
            "code_challenge_methods_supported": S256CodeChallenge.SUPPORTED_CODE_CHALLENGE_METHOD,
            "token_endpoint_auth_methods_supported": AuthorizationCodeGrant.TOKEN_ENDPOINT_AUTH_METHODS,
            # すべてのリソースサーバーの scope。どれが使えるかはリソースサーバーごとに違う
            "scopes_supported": [scope for server in self.resource_servers for scope in server.scopes],
            "authorization_response_iss_parameter_supported": True,  # RFC 9207
            "client_id_metadata_document_supported": True,  # CIMD
        }


def use_client(client: Client) -> None:
    """このリクエストの間、CIMD の文書から作ったクライアントを Authlib に使わせる。"""
    g.clients = {client.client_id: client}
