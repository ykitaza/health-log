"""アプリへ戻るリンク（app_link）：作り方と、記録・読み出しのツールの結果に入ること。"""

import pytest

from connector.app_links import make_app_link
from tests.test_main import ALL_SCOPES, ISSUER, LUNCH, data, run, server  # noqa: F401（server はフィクスチャ）

link = make_app_link(ISSUER + "/")


@pytest.mark.parametrize("args, expected", [
    (("meals", "2026-11-12"), "/open/meals?date=2026-11-12"),
    (("training", "2026-11-12"), "/open/training?date=2026-11-12"),
    (("meals",), "/open/meals"),
    (("reports",), "/open/reports"),
    (("reports", "2026-11-02", "weekly"), "/open/reports?date=2026-11-02&kind=weekly"),
    (("reports", None, "monthly"), "/open/reports?kind=monthly"),
    (("reports", None, "phase"), "/open/reports"),  # 認可サーバーが受け付けない kind は付けない
    (("meals", None, "weekly"), "/open/meals"),  # kind はレポートだけ
    (("injuries", "2026-11-12"), "/open/injuries"),  # ケガは date を受け付けない
])
def test_リンクは認可サーバーの_open_に_決まった画面と値だけで作る(args, expected):
    assert link(*args) == ISSUER + expected


@pytest.mark.parametrize("args", [("settings",), ("meals", "2026/11/12"), ("meals", '2026-11-12">')])
def test_決まった画面と日付の形以外は作らない(args):
    with pytest.raises(ValueError):
        link(*args)


def test_食事と筋トレとケガとレポートの結果に_内容に合う画面へのリンクが入る(server):  # noqa: F811
    report = {"title": "今週のまとめ", "overall_tone": "good", "headline": "よく続いた", "kind": "weekly",
              "period_start": "2026-11-02", "period_end": "2026-11-08"}

    async def body(client):
        async def call(name, args=None):
            return data(await client.call_tool(name, args or {}))
        return {
            "record_meal": await call("record_meal", {"meal": LUNCH}),
            "list_meals": await call("list_meals", {"start": "2026-11-03", "end": "2026-11-08"}),
            "today_status": await call("today_status", {"day": "2026-11-05"}),
            "goal_progress": await call("goal_progress"),
            "record_workout": await call("record_workout", {"exercises": [
                {"exercise": "ベンチプレス", "sets": [{"weight_kg": 60, "reps": 8}]}], "day": "2026-11-06"}),
            "get_workout": await call("get_workout", {"day": "2026-11-06"}),
            "body_progress": await call("body_progress"),
            "list_injuries": await call("list_injuries"),
            "save_report": await call("save_report", report),
            "list_reports": await call("list_reports", {"kind": "weekly"}),
            "period_overview": await call("period_overview", {"start": "2026-11-02", "end": "2026-11-08"}),
        }

    r = run(server, ALL_SCOPES, body)
    assert r["record_meal"]["app_link"] == f"{ISSUER}/open/meals?date=2026-11-08"
    assert r["list_meals"]["app_link"] == f"{ISSUER}/open/meals?date=2026-11-03"
    assert r["today_status"]["app_link"] == f"{ISSUER}/open/meals?date=2026-11-05"
    assert r["goal_progress"]["app_link"] == f"{ISSUER}/open/meals"
    assert r["record_workout"]["app_link"] == r["get_workout"]["app_link"] == f"{ISSUER}/open/training?date=2026-11-06"
    assert r["body_progress"]["app_link"] == f"{ISSUER}/open/training"
    assert r["list_injuries"]["app_link"] == f"{ISSUER}/open/injuries"
    assert r["save_report"]["app_link"] == f"{ISSUER}/open/reports?date=2026-11-02&kind=weekly"
    assert r["list_reports"]["app_link"] == f"{ISSUER}/open/reports"
    assert r["period_overview"]["app_link"] == f"{ISSUER}/open/reports?date=2026-11-02"


def test_サーバーの説明に_リンクを1つだけ添える指示がある(server):  # noqa: F811
    text = server["mcp"].instructions
    assert "app_link" in text and "KARADA で開く" in text and "1つだけ" in text
