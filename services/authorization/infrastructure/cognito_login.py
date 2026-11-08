"""本人確認（Cognito）との境界（腐敗防止層）。

Cognito の言葉（IDトークン、cognito:username など）を、認可の Subject に変換して渡す。
OIDC の RP としての処理（state・nonce・PKCE、認可コードの引き換え、IDトークンの検証）は Authlib のクライアントに任せる。
"""

from urllib.parse import urlencode

from authlib.integrations.flask_client import OAuth
from flask import Flask, Response

from oauth.models import Subject


class CognitoLogin:
    def __init__(self, app: Flask, issuer: str, client_id: str, client_secret: str, redirect_uri: str):
        oauth = OAuth(app)
        self.cognito = oauth.register(
            name="cognito",
            client_id=client_id,
            client_secret=client_secret,
            # OIDC Discovery：/authorize・/token・JWKS の場所を Cognito の文書から知る
            server_metadata_url=f"{issuer}/.well-known/openid-configuration",
            client_kwargs={
                "scope": "openid email",
                "code_challenge_method": "S256",  # Cognito に対しても PKCE を使う
                "token_endpoint_auth_method": "client_secret_basic",
            },
        )
        self.client_id, self.redirect_uri = client_id, redirect_uri

    def redirect_to_login(self) -> Response:
        # state・nonce・PKCE の合言葉は、Authlib がセッションに入れて覚えておく
        return self.cognito.authorize_redirect(self.redirect_uri)

    def subject_from_callback(self) -> Subject:
        # state の照合、認可コードの引き換え、IDトークンの署名・iss・aud・exp・nonce の検証
        token = self.cognito.authorize_access_token()
        claims = token["userinfo"]
        return Subject(id=claims["sub"], email=claims.get("email", ""))

    def logout_url(self, logout_uri: str) -> str:
        """Cognito のログイン画面のセッションを消す URL。消したあと logout_uri（Cognito に登録したもの）へ戻る。"""
        # /logout は OIDC Discovery の文書にないので、/oauth2/authorize と同じドメインから組み立てる
        metadata = self.cognito.load_server_metadata()
        base = metadata["authorization_endpoint"].removesuffix("/oauth2/authorize")
        return f"{base}/logout?{urlencode({'client_id': self.client_id, 'logout_uri': logout_uri})}"
