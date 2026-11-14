"""ブラウザに出す画面：エスケープ、CSP と X-Frame-Options、同意のボタン、scope の言葉。"""

import base64
import hashlib
import re
from html.parser import HTMLParser

import pytest

from presentation.pages import (
    CONTENT_SECURITY_POLICY, SCRIPT, STYLE, render_consent_page, render_error_page, render_logged_out_page,
    render_open_app_page, render_privacy_page,
)
from tests.test_flow import authorize_params, client, login, store  # noqa: F401（同じ組み立てを使う）

EVIL = '<script>alert(1)</script>"\'&'


class Tags(HTMLParser):
    """ページの中のタグ、イベント属性、style・script の中身を集める。"""

    def __init__(self, page: str):
        super().__init__(convert_charrefs=True)
        self.tags: set[str] = set()
        self.event_attrs: list[str] = []
        self.blocks: dict[str, list[str]] = {"style": [], "script": []}
        self._open: str | None = None
        self.feed(page)

    def handle_starttag(self, tag, attrs):
        self.tags.add(tag)
        self.event_attrs += [name for name, _ in attrs if name.startswith("on")]
        self._open = tag if tag in self.blocks else None

    def handle_endtag(self, tag):
        self._open = None

    def handle_data(self, data):
        if self._open:
            self.blocks[self._open].append(data)


def sha256(text: str) -> str:
    return "'sha256-" + base64.b64encode(hashlib.sha256(text.encode()).digest()).decode() + "'"


def test_consent_page_escapes_client_name_host_email_and_unknown_scope():
    page = render_consent_page(EVIL, EVIL, EVIL, [EVIL])
    assert "<script>alert(1)" not in page
    assert page.count("&lt;script&gt;alert(1)&lt;/script&gt;&quot;&#x27;&amp;") == 4


def test_error_page_escapes_description():
    page = render_error_page(EVIL)
    assert "<script>alert(1)" not in page and "&lt;script&gt;alert(1)" in page


def test_consent_page_shows_scopes_in_plain_words_and_named_buttons():
    page = render_consent_page("Claude", "claude.ai", "u@example.com",
                               ["meals:read", "meals:write", "training:read", "training:write"])
    for words in ["食事の記録と目標を読む", "食事の記録と目標を書く（追加・修正・削除）",
                  "筋トレ（種目・重量・回数）と体組成の記録を読む", "筋トレと体組成の記録を書く（追加・修正・削除）"]:
        assert words in page
    # ボタンの送る値は今までと同じ（allow・deny）。名前は動作の言葉
    assert '<button name="decision" value="allow" class="allow">許可する</button>' in page
    assert '<button name="decision" value="deny" class="deny">やめる</button>' in page
    assert '<form method="post" action="/consent"' in page
    assert "食事の写真はこのサービスに送られず" in page


@pytest.mark.parametrize("page", [
    render_consent_page("Claude", "claude.ai", "u@example.com", ["meals:read"]),
    render_error_page("x"), render_logged_out_page(), render_privacy_page(),
    render_open_app_page("meals?date=2026-11-12", "食事の記録"),
])
def test_pages_load_nothing_from_outside_and_keep_only_hashed_inline_code(page):
    tags = Tags(page)
    assert not tags.tags & {"link", "img", "iframe", "object", "embed"}
    assert not re.search(r"@import|url\(|https?://(?!www\.w3\.org)", page)
    assert tags.event_attrs == []  # インラインのイベント属性は CSP で動かないので使わない
    assert tags.blocks == {"style": [STYLE], "script": [SCRIPT]}
    assert 'aria-label="KARADA"' in page


def test_csp_allows_only_the_embedded_style_and_script():
    csp = CONTENT_SECURITY_POLICY
    assert "default-src 'none'" in csp and "frame-ancestors 'none'" in csp and "base-uri 'none'" in csp
    assert f"style-src {sha256(STYLE)}" in csp and f"script-src {sha256(SCRIPT)}" in csp
    assert "unsafe-inline" not in csp


@pytest.mark.parametrize("path", ["/privacy", "/logged-out", "/cognito/callback", "/relogin", "/open/meals", "/open/injuries", "/open/nope"])
def test_html_pages_carry_csp_and_x_frame_options(client, path):  # noqa: F811
    res = client.get(path)
    assert res.mimetype == "text/html"
    assert res.headers["Content-Security-Policy"] == CONTENT_SECURITY_POLICY
    assert res.headers["X-Frame-Options"] == "DENY"


def test_consent_page_carries_csp_and_x_frame_options(client):  # noqa: F811
    client.get("/authorize", query_string=authorize_params())
    res = client.get("/cognito/callback")
    assert res.status_code == 200 and "許可する" in res.get_data(as_text=True)
    assert res.headers["Content-Security-Policy"] == CONTENT_SECURITY_POLICY
    assert res.headers["X-Frame-Options"] == "DENY"


def test_json_responses_are_left_alone(client):  # noqa: F811
    res = client.get("/.well-known/oauth-authorization-server")
    assert "Content-Security-Policy" not in res.headers


INTENT = "#Intent;scheme=torelog;package=com.ykitaza.torelog;end"


@pytest.mark.parametrize(("path", "target", "name"), [
    ("/open/meals?date=2026-11-12", "meals?date=2026-11-12", "食事の記録"),
    ("/open/training?date=2026-11-12", "training?date=2026-11-12", "筋トレの記録"),
    ("/open/reports", "reports", "レポート"),
    # レポートは日付と種類（daily・weekly・monthly）で、その日を含む期間のタブを開く。決まった形でないものは付けない
    ("/open/reports?date=2026-11-12", "reports?date=2026-11-12", "レポート"),
    ("/open/reports?date=2026-11-12&kind=weekly", "reports?date=2026-11-12&amp;kind=weekly", "レポート"),
    ("/open/reports?kind=monthly", "reports?kind=monthly", "レポート"),
    ("/open/reports?date=2026-11-12&kind=other", "reports?date=2026-11-12", "レポート"),
    ("/open/reports?date=2026/11/12&kind=daily%22%3E", "reports", "レポート"),
    ("/open/meals?date=2026-11-12&kind=weekly", "meals?date=2026-11-12", "食事の記録"),
    # ケガはアプリの筋トレのタブの「ケガ」へ。日付は使わない
    ("/open/injuries", "injuries", "ケガの記録"),
    ("/open/injuries?date=2026-11-12", "injuries", "ケガの記録"),
    ("/open/meals?date=2026-11-12%22%3E%3Cscript%3E", "meals", "食事の記録"),
    ("/open/meals?date=12/11/2026", "meals", "食事の記録"),
])
def test_open_app_page_links_to_the_app_with_fixed_values_only(client, path, target, name):  # noqa: F811
    res = client.get(path)
    assert res.status_code == 200
    body = res.get_data(as_text=True)
    assert f'href="intent://{target}{INTENT}"' in body
    assert name in body and "KARADA で開く" in body
    assert "<script>alert" not in body and "%3Cscript" not in body.lower()


@pytest.mark.parametrize("path", ["/open/settings", "/open/meals.json", "/open/", "/open/injury"])
def test_open_app_page_rejects_other_targets(client, path):  # noqa: F811
    res = client.get(path)
    assert res.status_code == 404
    assert "intent://" not in res.get_data(as_text=True)
