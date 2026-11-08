"""Cognito との境界。MCP のアクセストークンの sub は、Cognito の sub そのもの（アプリの API と同じ人になる）。"""

from flask import Flask

from infrastructure.cognito_login import CognitoLogin


def test_Cognito_の_sub_をそのまま本人の_ID_にする(monkeypatch):
    app = Flask(__name__)
    app.secret_key = "test"
    login = CognitoLogin(app, "https://cognito-idp.ap-northeast-1.amazonaws.com/pool", "client", "secret",
                         "http://localhost:3000/cognito/callback")
    # Authlib が IDトークンを検証したあとのクレーム（cognito:username は sub と別の値になり得る）
    monkeypatch.setattr(login.cognito, "authorize_access_token", lambda: {"userinfo": {
        "sub": "8a1b2c3d-cognito-sub", "cognito:username": "other-name", "email": "me@example.com"}})
    with app.test_request_context("/cognito/callback"):
        subject = login.subject_from_callback()
    assert (subject.id, subject.email) == ("8a1b2c3d-cognito-sub", "me@example.com")
