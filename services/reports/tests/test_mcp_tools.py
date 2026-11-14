"""レポートの MCP のツールを、通信を通さずに呼んで確かめる。アクセストークンは検証済みのものに差し替える。"""

import asyncio
import json
import uuid
from datetime import date

import pytest
from mcp.server.auth.provider import AccessToken
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

from reports.domain import report as limits
from reports.main import create_service, register_sync_entities
from reports.presentation import mcp_tools
from sync.engine import SyncEngine
from sync.model import Change
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
    assert "今日のまとめを作って" in tools["save_report"].description
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


LINKS = [{"from_area": "sleep", "to_area": "training", "text": "7時間以上寝た日の次の日は、総負荷量が多い", "basis": "3日"},
         {"from_area": "meals", "to_area": "body", "text": "たんぱく質が目標に届いた週は、体脂肪率が下がった"}]
REVIEW = {"text": "体重が目標のペースより速く減っているので、kcal を少し上げる", "target": "meals_goal"}


def test_つながりと目標の見直しを保存すると_1件で読め_同期でアプリに届く(call, engine):
    saved = call("save_report", **{**WEEKLY, "kind": "monthly", "links": LINKS, "review": REVIEW})["report"]
    full = call("get_report", report_id=saved["report_id"])
    assert full["links"] == [LINKS[0], {**LINKS[1], "basis": None}]
    assert full["review"] == REVIEW
    entries, _, _ = engine.pull("alice", 0, 100, {"report"})
    fields = entries[0].state["fields"]
    assert fields["links"] == [LINKS[0], {**LINKS[1], "basis": None}] and fields["review"] == REVIEW
    # 見直す目標は省ける
    other = call("save_report", **{**WEEKLY, "review": {"text": "睡眠の目標を見直す"}})["report"]
    assert call("get_report", report_id=other["report_id"])["review"] == {"text": "睡眠の目標を見直す", "target": None}


def test_つながりと目標の見直しのない前の形も読める(call, engine):
    saved = call("save_report", **WEEKLY)["report"]
    full = call("get_report", report_id=saved["report_id"])
    assert (full["links"], full["review"]) == ([], None)
    entries, _, _ = engine.pull("alice", 0, 100, {"report"})
    assert "links" not in entries[0].state["fields"] and "review" not in entries[0].state["fields"]


def test_一覧は新しい順で_種類と件数で絞れる(call):
    first = call("save_report", **WEEKLY)["report"]["report_id"]
    second = call("save_report", **{**WEEKLY, "title": "10月のまとめ", "kind": "monthly"})["report"]["report_id"]
    assert [r["report_id"] for r in call("list_reports")["reports"]] == [second, first]
    assert [r["report_id"] for r in call("list_reports", kind="weekly")["reports"]] == [first]
    assert len(call("list_reports", limit=1)["reports"]) == 1


def test_日のまとめは_その日だけを期間にして保存できる(call):
    day = {**WEEKLY, "title": "今日のまとめ", "kind": "daily", "period_start": "2026-11-09", "period_end": "2026-11-09"}
    saved = call("save_report", **day)["report"]
    assert (saved["kind"], saved["period_start"], saved["period_end"]) == ("daily", "2026-11-09", "2026-11-09")
    assert [r["report_id"] for r in call("list_reports", kind="daily")["reports"]] == [saved["report_id"]]


@pytest.mark.parametrize("period", [
    {"period_start": "2026-11-08", "period_end": "2026-11-09"},
    {"period_start": None, "period_end": None},
])
def test_日のまとめは_期間が同じ日でないと断る(call, period):
    with pytest.raises(ToolError, match="daily"):
        call("save_report", **{**WEEKLY, "kind": "daily", **period})
    assert call("list_reports")["reports"] == []


def test_save_report_の_kind_は必須で_other_を含まず_phase_を含む():
    mcp = MCPServer(name="test")
    mcp_tools.register_report_tools(mcp, None)
    tools = {t.name: t for t in asyncio.run(mcp.list_tools())}
    schema = tools["save_report"].input_schema
    assert "kind" in schema["required"]  # 省くと断る（既定の other はない）
    assert schema["properties"]["kind"]["enum"] == ["daily", "weekly", "monthly", "phase"]
    # 一覧の絞り込みでは、前に保存した other を探せるよう残す
    assert tools["list_reports"].input_schema["properties"]["kind"]["anyOf"][0]["enum"] == [
        "daily", "weekly", "monthly", "phase", "other"]


def test_other_は保存できない(call):
    with pytest.raises(ToolError, match="kind"):
        call("save_report", **{**WEEKLY, "kind": "other"})
    assert call("list_reports")["reports"] == []


def test_kind_を省くと保存できない(call):
    without_kind = {k: v for k, v in WEEKLY.items() if k != "kind"}
    with pytest.raises(ToolError, match="kind"):
        call("save_report", **without_kind)
    assert call("list_reports")["reports"] == []


def test_前に保存した_other_は_一覧と1件で読める(call, engine):
    # 前の形（kind=other の分析）は同期の記録として残っている。消さずに読めることを確かめる
    report_id = str(uuid.uuid4())
    engine.append("alice", [Change(str(uuid.uuid4()), "report", report_id, None, "create",
                                   {"title": "ベンチプレスの分析", "body": "本文", "kind": "other"},
                                   "2026-11-08T01:00:00.000Z", "mcp")])
    listed = call("list_reports")["reports"]
    assert [r["report_id"] for r in listed] == [report_id] and listed[0]["kind"] == "other"
    assert [r["report_id"] for r in call("list_reports", kind="other")["reports"]] == [report_id]
    full = call("get_report", report_id=report_id)
    assert full["kind"] == "other" and full["title"] == "ベンチプレスの分析"


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
    ({"kind": "yearly"}, "kind"),
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
    ({"links": LINKS + LINKS}, "links"),
    ({"links": [{**LINKS[0], "to_area": "sleep"}]}, "違う分野"),
    ({"links": [{**LINKS[0], "from_area": "mood"}]}, "from_area"),
    ({"links": [{**LINKS[0], "text": "あ" * (limits.MAX_LINK_TEXT + 1)}]}, "text"),
    ({"links": [{**LINKS[0], "basis": "あ" * (limits.MAX_LINK_BASIS + 1)}]}, "basis"),
    ({"links": [{**LINKS[0], "basis": " "}]}, "basis"),
    ({"review": {"text": ""}}, "review"),
    ({"review": {"text": "あ" * (limits.MAX_REVIEW_TEXT + 1)}}, "review"),
    ({"review": {**REVIEW, "target": "sleep_goal"}}, "target"),
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
    call("save_report", **{**WEEKLY, "title": "10月のまとめ", "kind": "monthly"})
    with pytest.raises(ToolError, match="2件まで"):
        call("save_report", **{**WEEKLY, "period_start": "2026-11-09", "period_end": "2026-11-15"})  # 別の期間は新しい分として数える
    # 上限でも、同じ種類・期間の保存し直し（置き換え）はできる
    replaced = call("save_report", **{**WEEKLY, "title": "今週のまとめ（直した）"})["report"]
    assert len(call("list_reports")["reports"]) == 2  # 置き換えでは増えない
    assert call("get_report", report_id=replaced["report_id"])["title"] == "今週のまとめ（直した）"
    call("delete_report", report_id=call("list_reports")["reports"][0]["report_id"])
    call("save_report", **WEEKLY)  # 消せば保存できる


def test_同じ種類と期間で保存し直すと_置き換わる(call):
    first = call("save_report", **WEEKLY)["report"]
    second = call("save_report", **{**WEEKLY, "title": "今週のまとめ（新しい）", "body": "新しい本文",
                                     "next_steps": ["新しい一歩"]})["report"]
    assert second["report_id"] != first["report_id"]  # 消して作り直すので ID は新しい
    assert [r["report_id"] for r in call("list_reports")["reports"]] == [second["report_id"]]  # 1件だけ残る
    full = call("get_report", report_id=second["report_id"])
    assert (full["title"], full["body"], full["next_steps"]) == ("今週のまとめ（新しい）", "新しい本文", ["新しい一歩"])
    with pytest.raises(ToolError, match="見つかりません"):
        call("get_report", report_id=first["report_id"])  # 前の方は消えている


def test_置き換えで_次の一歩のチェックは_文面が同じものだけ引き継ぐ(call, engine):
    steps = ["脚の日を2回入れる", "たんぱく質を毎日130gとる", "0時までに寝る"]
    saved = call("save_report", **{**WEEKLY, "next_steps": steps})["report"]
    engine.append("alice", [Change(str(uuid.uuid4()), "report", saved["report_id"], None, "update",
                                   {"next_steps_done": [0, 2]}, "2026-11-09T02:00:00.000Z", "app")])
    # 並びを変え、1件は文面を変えて保存し直す（チェックは文面で引き継ぐので、番号は新しい並びに移る）
    new_steps = ["朝食を抜かない", "0時までに寝る", "脚の日を2回入れる"]
    replaced = call("save_report", **{**WEEKLY, "next_steps": new_steps})["report"]
    full = call("get_report", report_id=replaced["report_id"])
    assert full["next_steps"] == new_steps and full["next_steps_done"] == [1, 2]


def test_説明に_前の週の次の一歩を振り返ってから書くとある():
    mcp = MCPServer(name="test")
    mcp_tools.register_report_tools(mcp, None)
    save = {t.name: t for t in asyncio.run(mcp.list_tools())}["save_report"]
    assert "previous_next_steps" in save.description and "振り返ってから" in save.description
    assert "振り返ってから" in mcp_tools.INSTRUCTIONS


def test_前の週のまとめの次の一歩と_アプリのチェック(call, engine):
    steps = ["脚の日を2回入れる", "たんぱく質を毎日130gとる", "0時までに寝る日を4日つくる"]
    old = call("save_report", **{**WEEKLY, "period_start": "2026-10-26", "period_end": "2026-11-01", "next_steps": ["古い"]})
    saved = call("save_report", **{**WEEKLY, "next_steps": steps})["report"]
    call("save_report", **{**WEEKLY, "kind": "monthly", "period_start": "2026-11-01", "period_end": "2026-11-08"})
    report_id = saved["report_id"]
    engine.append("alice", [Change(str(uuid.uuid4()), "report", report_id, None, "update", {"next_steps_done": [0, 2]},
                                   "2026-11-09T02:00:00.000Z", "app")])
    previous = mcp_tools.PreviousNextSteps(create_service(engine))
    got = asyncio.run(previous.previous_next_steps("alice", date(2026, 11, 9)))
    assert got["report_id"] == report_id and got["done_count"] == 2
    assert got["steps"] == [{"text": steps[0], "done": True}, {"text": steps[1], "done": False},
                            {"text": steps[2], "done": True}]
    assert asyncio.run(previous.previous_next_steps("alice", date(2026, 11, 2)))["steps"] == [
        {"text": "古い", "done": False}]
    assert old["report"]["report_id"] != report_id
    assert asyncio.run(previous.previous_next_steps("alice", date(2026, 11, 17))) is None  # 2週前のまとめは見ない
    assert asyncio.run(previous.previous_next_steps("bob", date(2026, 11, 9))) is None
    assert call("get_report", report_id=report_id)["next_steps_done"] == [0, 2]


# --- フェーズの振り返り（kind が phase） ---

PHASE_ID = "phase-bulk-1"
PHASE_REVIEW = {
    "title": "増量 16週の振り返り", "overall_tone": "good", "headline": "体重も BIG3 も伸び、目標に届いた",
    "kind": "phase", "phase_id": PHASE_ID,
    "highlights": [{"area": "training", "tone": "good", "text": "脚の日を週2回続けられた"}],
    "next_steps": ["維持の4週は、たんぱく質を今の量のまま"],
    "body": "## 次のフェーズ\n- 維持 4 週をすすめます",
}


class FakePhases:
    """フェーズの期間（main.py の TrainingPhasePeriods の代わり）。"""

    def __init__(self):
        self.periods = {PHASE_ID: {"kind": "normal", "start_date": "2026-07-01", "end_date": "2026-10-20"},
                        "rehab-1": {"kind": "rehab", "start_date": "2026-08-01", "end_date": "2026-08-10"}}

    async def phase_period(self, subject, phase_id):
        return self.periods.get(phase_id) if subject == "alice" else None


@pytest.fixture
def phase_call(monkeypatch, engine):
    token = AccessToken(token="t", client_id="c", scopes=ALL_SCOPES, subject="alice")
    monkeypatch.setattr(mcp_tools, "get_access_token", lambda: token)
    mcp = MCPServer(name="test")
    phases = FakePhases()
    mcp_tools.register_report_tools(mcp, create_service(engine), phases)

    def _call(tool: str, **arguments):
        result = asyncio.run(mcp.call_tool(tool, arguments))
        return json.loads(result.content[0].text)

    _call.phases = phases
    return _call


def test_フェーズの振り返りは_期間を省くとフェーズの開始日から終わりの日で保存し_同期でアプリに届く(phase_call, engine):
    saved = phase_call("save_report", **PHASE_REVIEW)["report"]
    assert (saved["kind"], saved["phase_id"], saved["period_start"], saved["period_end"]) == (
        "phase", PHASE_ID, "2026-07-01", "2026-10-20")
    state = engine.doc("alice", "report", saved["report_id"]).own
    assert (state.values["kind"], state.values["phase_id"]) == ("phase", PHASE_ID)
    assert [r["report_id"] for r in phase_call("list_reports", kind="phase")["reports"]] == [saved["report_id"]]
    assert phase_call("list_reports", kind="weekly")["reports"] == []


def test_フェーズの振り返りは_同じフェーズなら置き換える_終わりの日が変わっても(phase_call):
    first = phase_call("save_report", **PHASE_REVIEW)["report"]
    phase_call.phases.periods[PHASE_ID] = {"kind": "normal", "start_date": "2026-07-01", "end_date": "2026-11-03"}  # 延長した
    second = phase_call("save_report", **{**PHASE_REVIEW, "headline": "延長して届いた"})["report"]
    assert [r["report_id"] for r in phase_call("list_reports")["reports"]] == [second["report_id"]]
    assert second["report_id"] != first["report_id"] and second["period_end"] == "2026-11-03"


def test_フェーズが違えば置き換えない(phase_call):
    phase_call.phases.periods["phase-cut-1"] = {"kind": "normal", "start_date": "2026-11-01", "end_date": "2026-11-10"}
    phase_call("save_report", **PHASE_REVIEW)
    phase_call("save_report", **{**PHASE_REVIEW, "phase_id": "phase-cut-1"})
    assert len(phase_call("list_reports", kind="phase")["reports"]) == 2


@pytest.mark.parametrize("change, message", [
    ({"phase_id": "nothing"}, "見つかりません"),
    ({"phase_id": "rehab-1"}, "療養"),
    ({"period_start": "2026-07-01", "period_end": "2026-10-01"}, "period_end=2026-10-20"),
    ({"phase_id": None}, "phase_id"),
])
def test_フェーズの振り返りの_フェーズと期間を確かめる(phase_call, change, message):
    with pytest.raises(ToolError, match=message):
        phase_call("save_report", **{k: v for k, v in {**PHASE_REVIEW, **change}.items() if v is not None})


def test_ほかの種類は_phase_id_を持てない(phase_call):
    with pytest.raises(ToolError, match="phase_id"):
        phase_call("save_report", **{**WEEKLY, "phase_id": PHASE_ID})


def test_期間を合わせて渡しても保存できる_366日より長くても(phase_call):
    phase_call.phases.periods[PHASE_ID] = {"kind": "normal", "start_date": "2025-01-01", "end_date": "2026-10-20"}
    saved = phase_call("save_report", **{**PHASE_REVIEW, "period_start": "2025-01-01", "period_end": "2026-10-20"})["report"]
    assert saved["period_start"] == "2025-01-01"


def test_説明に_フェーズの振り返りの決まりがある():
    for words in ("list_phases", "phase_id", "維持 4 週", "療養", "ウエスト", "体脂肪率は参考", "診断や治療の助言はしない"):
        assert words in mcp_tools.INSTRUCTIONS
