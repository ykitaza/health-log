"""HTTP の入口。OAuth の処理は Authlib の認可サーバーに任せ、ここではログインと同意の画面の流れをつなぐ。

/authorize で要求を確かめて保存 → Cognito でログイン → 同意画面 → /consent で Authlib が認可コードを出す。
"""

import re
from typing import Protocol

from authlib.common.errors import AuthlibBaseError as LoginError
from authlib.oauth2 import OAuth2Error
from flask import Blueprint, Response, current_app, jsonify, redirect, request, session

from infrastructure.cimd_client_directory import CimdClientDirectory, ClientRejected
from oauth.models import Client, Subject
from oauth.server import AuthorizationServer, TokenRevocationEndpoint, new_id, use_client
from oauth.store import Store
from presentation.pages import (
    CONTENT_SECURITY_POLICY, render_consent_page, render_error_page, render_logged_out_page, render_open_app_page,
    render_privacy_page,
)

# ブラウザのセッション（署名付き Cookie）に、進行中の認可リクエストの ID を入れておく
SESSION_KEY = "authorization_request_id"
REQUEST_TTL_SECONDS = 600
NOT_FOUND = "認可リクエストが見つかりません（最初からやり直してください）"
EXPIRED = "認可リクエストが見つかりません（期限切れの可能性があります）"
# アプリへ戻る案内（/open/<画面>）で開ける画面と、ページに出す名前。ほかの値は受け付けない（リンクに入る値を決まったものだけにする）
OPEN_TARGETS = {"meals": "食事の記録", "training": "筋トレの記録", "reports": "レポート", "injuries": "ケガの記録"}
# 日付を付ける画面（ケガは日付を使わない）
DATED_TARGETS = {"meals", "training", "reports"}
DATE = re.compile(r"\d{4}-\d{2}-\d{2}")
# レポートで開く期間のタブ（日・週・月）。ほかの値は付けない
REPORT_KINDS = {"daily", "weekly", "monthly"}


class LoginGateway(Protocol):
    """本人確認（ログイン）の入口。ブラウザのリダイレクトを伴うので、HTTP の層で扱う。"""

    def redirect_to_login(self) -> Response: ...

    def subject_from_callback(self) -> Subject: ...

    def logout_url(self, logout_uri: str) -> str:
        """ログイン画面のセッションを消し、logout_uri へ戻る URL。"""
        ...


def error_page(description: str) -> Response:
    """redirect_uri へ返せないエラー（クライアントを確かめられない、など）はエラー画面にする。"""
    return Response(render_error_page(description), status=400, mimetype="text/html")


def rejected(description: str, error: Exception) -> Response:
    """例外の中身は画面に出さず、ログ（CloudWatch Logs）にだけ残す。内部の情報を外に見せないため。"""
    current_app.logger.warning("%s: %r", request.path, error)
    return error_page(description)


def create_blueprint(
    server: AuthorizationServer, clients: CimdClientDirectory, store: Store, login: LoginGateway, muse_metadata: dict,
) -> Blueprint:
    bp = Blueprint("authorization", __name__)

    @bp.after_request
    def protect_pages(response: Response) -> Response:
        # HTML の画面はすべて、埋め込んだ CSS と JS のほかを読み込ませず（CSP）、別のサイトに埋め込ませない
        # （「許可する」を押させる攻撃を防ぐ。古いブラウザのために X-Frame-Options も付ける）
        if response.mimetype == "text/html":
            response.headers["Content-Security-Policy"] = CONTENT_SECURITY_POLICY
            response.headers["X-Frame-Options"] = "DENY"
        return response

    @bp.get("/authorize")
    def authorize():
        # CIMD：client_id の URL から文書を取りに行く。確かめられなければエラー画面（redirect_uri へは返さない）
        client_id = request.args.get("client_id")
        if client_id:
            try:
                use_client(clients.find(client_id))
            except ClientRejected as e:
                return rejected("クライアントを確かめられません（client_id の URL と、その文書を確かめてください）", e)
        try:
            grant = server.get_consent_grant(end_user=None)
        except OAuth2Error as e:
            # redirect_uri を確かめられたエラーだけを、クライアントへ返す
            if e.redirect_uri:
                return server.authorization_error_response(e)
            return rejected("リクエストを受け付けられません（client_id か redirect_uri が正しくありません）", e)
        request_id = new_id()
        store.put("request", request_id, {
            "params": request.args.to_dict(),  # 同意のあと、Authlib にもう一度確かめさせる
            "client": grant.client.to_dict(),
            "scope": grant.request.scope,
            "subject": None,
        }, REQUEST_TTL_SECONDS)
        session[SESSION_KEY] = request_id
        return login.redirect_to_login()

    @bp.get("/cognito/callback")
    def cognito_callback():
        request_id = session.get(SESSION_KEY)
        if request_id is None:
            return error_page(NOT_FOUND)
        try:
            subject = login.subject_from_callback()
        except LoginError as e:
            return rejected("ログインを確かめられません（最初からやり直してください）", e)
        pending = store.get("request", request_id)
        if pending is None:
            return error_page(EXPIRED)
        store.put("request", request_id, {**pending, "subject": subject.to_dict()}, REQUEST_TTL_SECONDS)
        client = Client.from_dict(pending["client"])
        page = render_consent_page(client.client_name, client.host, subject.email, pending["scope"].split())
        return Response(page, mimetype="text/html")

    @bp.post("/consent")
    def consent():
        # セッション Cookie は SameSite=Lax なので、別のサイトから送らせた POST には付かない
        request_id = session.pop(SESSION_KEY, None)
        if request_id is None:
            # 「許可する」の2回押しや再送信など。1回目で手続きは終わっていることが多い
            return error_page("この連携の手続きは、すでに終わっているか期限が切れています。"
                              "連携アプリの画面に戻って、つながっているかを確かめてください")
        pending = store.pop("request", request_id)
        if pending is None:
            return error_page(EXPIRED)
        if pending["subject"] is None:
            return error_page("ログインが済んでいません（最初からやり直してください）")
        subject = Subject.from_dict(pending["subject"])
        use_client(Client.from_dict(pending["client"]))
        authorization_request = server.saved_authorization_request(pending["params"])
        try:
            grant = server.get_consent_grant(authorization_request, end_user=subject)
        except OAuth2Error as e:
            return rejected("リクエストを受け付けられません（最初からやり直してください）", e)
        approved = request.form.get("decision") == "allow"
        # 許可なら認可コード、拒否なら access_denied を、iss（RFC 9207）を付けて redirect_uri へ返す
        response = server.create_authorization_response(
            authorization_request, grant_user=subject if approved else None, grant=grant)
        if response.status_code == 302:
            response.status_code = 303  # POST への返事なので 303 にして、ブラウザに GET で移動させる
        return response

    @bp.post("/token")
    def token():
        return server.create_token_response()

    @bp.post("/revoke")
    def revoke():
        # RFC 7009：知らないトークンでも 200 を返す（トークンが有効かどうかを外から探らせないため）
        return server.create_endpoint_response(TokenRevocationEndpoint.ENDPOINT_NAME)

    @bp.get("/switch-account")
    def switch_account():
        """同意画面の「別のアカウントで入り直す」。Cognito のセッションを消してから、ログイン画面に戻る。"""
        request_id = session.get(SESSION_KEY)
        if request_id is None:
            return error_page(NOT_FOUND)
        pending = store.get("request", request_id)
        if pending is None or pending["subject"] is None:
            return error_page(EXPIRED)
        # 同じ認可リクエストのまま、本人を外して本人確認からやり直す
        store.put("request", request_id, {**pending, "subject": None}, REQUEST_TTL_SECONDS)
        return redirect(login.logout_url(f"{server.issuer}/relogin"))

    @bp.get("/relogin")
    def relogin():
        """Cognito のセッションを消したあとに戻ってくる。同じ認可リクエストのまま、ログイン画面へ。"""
        if session.get(SESSION_KEY) is None:
            return error_page(NOT_FOUND)
        return login.redirect_to_login()

    @bp.get("/logout")
    def logout():
        """ログアウト：このブラウザのセッションと、Cognito のログイン画面のセッションを消す。"""
        session.clear()
        return redirect(login.logout_url(f"{server.issuer}/logged-out"))

    @bp.get("/logged-out")
    def logged_out():
        return Response(render_logged_out_page(), mimetype="text/html")

    @bp.get("/.well-known/oauth-authorization-server")
    def metadata():
        return jsonify(server.metadata())

    @bp.get("/.well-known/jwks.json")
    def jwks():
        return jsonify(server.jwks())

    @bp.get("/clients/muse.json")
    def muse_client():
        """Muse の CIMD の文書（client_id はこの URL）。決まった1つの文書だけを返す。"""
        response = jsonify(muse_metadata)
        response.headers["Cache-Control"] = "public, max-age=3600"
        return response

    @bp.get("/open/<target>")
    def open_app(target: str):
        """チャットの返事のリンクから、アプリの画面へ戻る案内。決まった画面と、決まった形の日付（レポートは決まった種類も）だけを使う。セッションは使わない。"""
        if target not in OPEN_TARGETS:
            return Response(render_error_page("このリンクは使えません。"), status=404, mimetype="text/html")
        date = request.args.get("date", "")
        params = [f"date={date}"] if target in DATED_TARGETS and DATE.fullmatch(date) else []
        kind = request.args.get("kind", "")
        if target == "reports" and kind in REPORT_KINDS:
            params.append(f"kind={kind}")
        path = f"{target}?{'&'.join(params)}" if params else target
        return Response(render_open_app_page(path, OPEN_TARGETS[target]), mimetype="text/html")

    @bp.get("/privacy")
    def privacy():
        return Response(render_privacy_page(), mimetype="text/html")

    return bp
