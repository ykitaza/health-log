"""アプリ（KARADA）へ戻るリンクを作る。ツールの結果の app_link に入れ、AI が返事の最後に添える。

リンクは認可サーバーの案内のページ（/open/<画面>）で、押すと「KARADA で開く」からアプリの画面へ行く。
開ける画面と値は、認可サーバー（services/authorization の OPEN_TARGETS）が受け付ける決まったものだけ：
画面は meals・training・reports・injuries、date は YYYY-MM-DD、kind は reports だけの daily・weekly・monthly。
認可サーバーの URL は、信じる認可API（AUTHZ_ISSUER）と同じなので、新しい設定はいらない。
"""

from __future__ import annotations

from datetime import date
from typing import Callable

TARGETS = ("meals", "training", "reports", "injuries")
DATED_TARGETS = ("meals", "training", "reports")  # ?date= を受け付ける画面
REPORT_KINDS = ("daily", "weekly", "monthly")

# (画面, 日付, 種類) -> リンク。meals・training・reports・injuries のツールに渡す
AppLink = Callable[..., str]


def make_app_link(base_url: str) -> AppLink:
    base = base_url.rstrip("/")

    def app_link(target: str, day: date | str | None = None, kind: str | None = None) -> str:
        if target not in TARGETS:
            raise ValueError(f"開けない画面です：{target}")
        query = []
        if day is not None and target in DATED_TARGETS:
            query.append(f"date={date.fromisoformat(str(day)).isoformat()}")  # 形が違えば ValueError
        if kind in REPORT_KINDS and target == "reports":
            query.append(f"kind={kind}")
        return f"{base}/open/{target}" + ("?" + "&".join(query) if query else "")

    return app_link
