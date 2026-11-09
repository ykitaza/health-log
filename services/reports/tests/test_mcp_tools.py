"""レポートの MCP のツールを、通信を通さずに呼んで確かめる。アクセストークンは検証済みのものに差し替える。"""

import asyncio
import json

import pytest
from mcp.server.auth.provider import AccessToken
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

from reports.domain import report as limits
from reports.main import create_service, register_sync_entities
from reports.presentation import mcp_tools
from sync.engine import SyncEngine
from sync.registry import Registry
from sync.store import InMemorySyncStore

REGISTRY = Registry()
register_sync_entities(REGISTRY)
ALL_SCOPES = ["training:read", "training:write"]


class Clock:
    """受け付けた時刻（1回ごとに1秒進む。新しい順を確かめるため）。"""

    def __init__(self):
        self.n = 0

    def __call__(self):
        self.n += 1
        return f"2026-11-09T01:00:{self.n:02d}.000Z"


@pytest.fixture
def engine():
    return SyncEngine(InMemorySyncStore(REGISTRY.index_key), REGISTRY, clock=Clock())


@pytest.fixture
def call(monkeypatch, engine):
    current = {"token": AccessToken(token="t", client_id="c", scopes=ALL_SCOPES, subject="alice")}
    monkeypatch.setattr(mcp_tools, "get_access_token", lambda: current["token"])
    mcp = MCPServer(name="test")
    mcp_tools.register_report_tools(mcp, create_service(engine))

    def _call(tool: str, **arguments):
        result = asyncio.run(mcp.call_tool(tool, arguments))
        return json.loads(result.content[0].text)

    def login(subject, scopes=ALL_SCOPES):
        current["token"] = AccessToken(token="t", client_id="c", scopes=scopes, subject=subject)

    _call.login = login
    return _call


WEEKLY = {
    "title": "今週のまとめ", "overall_tone": "good", "headline": "脚の日が増え、たんぱく質も目標どおり",
    "kind": "weekly", "period_start": "2026-11-02", "period_end": "2026-11-08",
    "highlights": [
        {"area": "training", "tone": "good", "text": "脚の日が2回に増えた",
         "metric": {"label": "合計負荷量", "value": 12.45, "unit": "t", "delta": 1.3, "delta_good": True}},
        {"area": "sleep", "tone": "caution", "text": "睡眠が6時間を切る日が3日"},
    ],
    "next_steps": ["夕食の揚げ物を週2回までに"],
    "body": "## 筋トレ\n- **12.45 t**",
}


def test_ツールの一覧と説明():
    mcp = MCPServer(name="test")
    mcp_tools.register_report_tools(mcp, None)
    tools = {t.name: t for t in asyncio.run(mcp.list_tools())}
    assert set(tools) == {"save_report", "list_reports", "get_report", "delete_report"}
    assert "今週のまとめを作って" in tools["save_report"].description  # いつ使うかが分かる
    assert tools["delete_report"].annotations.destructive_hint is True


def test_保存すると_一覧と1件で読める(call):
    saved = call("save_report", **WEEKLY)["report"]
    assert saved["created_at"] == "2026-11-09T10:00:01+09:00"  # 日本時間
    assert (saved["overall_tone"], saved["headline"]) == ("good", WEEKLY["headline"])
    full = call("get_report", report_id=saved["report_id"])
    assert full["highlights"][0]["metric"] == WEEKLY["highlights"][0]["metric"]
    assert full["highlights"][1]["metric"] is None
    assert (full["next_steps"], full["body"]) == (WEEKLY["next_steps"], WEEKLY["body"])
    listed = call("list_reports")["reports"]
    assert [r["report_id"] for r in listed] == [saved["report_id"]] and "body" not in listed[0]


def test_一覧は新しい順で_種類と件数で絞れる(call):
    first = call("save_report", **WEEKLY)["report"]["report_id"]
    second = call("save_report", **{**WEEKLY, "title": "10月のまとめ", "kind": "monthly"})["report"]["report_id"]
    assert [r["report_id"] for r in call("list_reports")["reports"]] == [second, first]
    assert [r["report_id"] for r in call("list_reports", kind="weekly")["reports"]] == [first]
    assert len(call("list_reports", limit=1)["reports"]) == 1


def test_消すと_一覧から消え_もう一度は消せない(call):
    report_id = call("save_report", **WEEKLY)["report"]["report_id"]
    assert call("delete_report", report_id=report_id) == {"deleted": report_id}
    assert call("list_reports")["reports"] == []
    with pytest.raises(ToolError, match="見つかりません"):
        call("delete_report", report_id=report_id)


def test_ほかの人のレポートは読めず消せない(call):
    report_id = call("save_report", **WEEKLY)["report"]["report_id"]
    call.login("bob")
    assert call("list_reports")["reports"] == []
    for tool in ("get_report", "delete_report"):
        with pytest.raises(ToolError, match="見つかりません"):
            call(tool, report_id=report_id)


def test_筋トレの_scope_がなければ断る(call):
    call.login("alice", scopes=["meals:read", "meals:write"])
    with pytest.raises(ToolError, match="training:write"):
        call("save_report", **WEEKLY)
    call.login("alice", scopes=["training:read"])
    assert call("list_reports") == {"reports": []}
    with pytest.raises(ToolError, match="training:write"):
        call("save_report", **WEEKLY)


@pytest.mark.parametrize("change, message", [
    ({"title": " "}, "題"),
    ({"title": "あ" * (limits.MAX_TITLE + 1)}, "title"),
    ({"body": "あ" * (limits.MAX_BODY + 1)}, "body"),
    ({"headline": "あ" * (limits.MAX_HEADLINE + 1)}, "headline"),
    ({"overall_tone": "bad"}, "overall_tone"),
    ({"kind": "daily"}, "kind"),
    ({"period_end": None}, "両方"),
    ({"period_end": "2026-11-01"}, "period_end"),
    ({"period_start": "2025-01-01", "period_end": "2026-11-08"}, "366日"),
    ({"highlights": [WEEKLY["highlights"][1]] * (limits.MAX_HIGHLIGHTS + 1)}, "highlights"),
    ({"highlights": [{**WEEKLY["highlights"][1], "area": "mood"}]}, "area"),
    ({"highlights": [{**WEEKLY["highlights"][1], "text": ""}]}, "text"),
    ({"highlights": [{**WEEKLY["highlights"][0], "metric": {"label": "x", "value": 1e7}}]}, "value"),
    ({"highlights": [{**WEEKLY["highlights"][0], "metric": {"label": "x", "value": 1, "delta_good": True}}]}, "delta_good"),
    ({"next_steps": ["a"] * (limits.MAX_NEXT_STEPS + 1)}, "next_steps"),
    ({"next_steps": ["あ" * (limits.MAX_NEXT_STEP_TEXT + 1)]}, "next_steps"),
    ({"body": "", "headline": "", "highlights": []}, "本文か"),
])
def test_入力を確かめる(call, change, message):
    with pytest.raises(ToolError, match=message):
        call("save_report", **{**WEEKLY, **change})
    assert call("list_reports")["reports"] == []


def test_絵文字の多い本文は_大きさの上限で断る(call):
    with pytest.raises(ToolError, match="大きすぎ"):
        call("save_report", **{**WEEKLY, "body": "😀" * 15000})


def test_件数の上限(call, monkeypatch):
    monkeypatch.setattr("reports.application.service.MAX_REPORTS", 2)
    call("save_report", **WEEKLY)
    call("save_report", **WEEKLY)
    with pytest.raises(ToolError, match="2件まで"):
        call("save_report", **WEEKLY)
    call("delete_report", report_id=call("list_reports")["reports"][0]["report_id"])
    call("save_report", **WEEKLY)  # 消せば保存できる
