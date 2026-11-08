"""筋トレの MCP のツールを、通信を通さずに呼んで確かめる。アクセストークンは検証済みのものに差し替える。"""

import asyncio
import json
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from mcp.server.auth.provider import AccessToken
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

from sync.engine import SyncEngine
from sync.model import Change
from sync.registry import Registry
from sync.store import InMemorySyncStore
from training.main import create_commands, create_queries, register_sync_entities
from training.presentation import mcp_tools

JST = timezone(timedelta(hours=9))
TODAY = date(2026, 11, 8)  # 日曜（週のはじめ）
NOW = datetime(2026, 11, 8, 21, 30, tzinfo=JST)
REGISTRY = Registry()
register_sync_entities(REGISTRY)
ALL_SCOPES = ["training:read", "training:write"]
BENCH = "ベンチプレス"


class FakeSyncStatus:
    async def last_app_sync_at(self, subject):
        return {"alice": "2026-11-08T19:00:00+09:00"}.get(subject)


@pytest.fixture
def engine():
    return SyncEngine(InMemorySyncStore(REGISTRY.index_key), REGISTRY)


@pytest.fixture
def call(monkeypatch, engine):
    """call(ツール, 引数) で呼ぶ。call.login(sub, scopes) で、呼ぶ人と scope を変えられる。"""
    current = {"token": AccessToken(token="t", client_id="c", scopes=ALL_SCOPES, subject="alice")}
    monkeypatch.setattr(mcp_tools, "get_access_token", lambda: current["token"])
    mcp = MCPServer(name="test")
    mcp_tools.register_training_tools(mcp, create_commands(engine, lambda: NOW), create_queries(engine),
                                      today=lambda: TODAY, sync_status=FakeSyncStatus())

    def _call(tool: str, **arguments):
        result = asyncio.run(mcp.call_tool(tool, arguments))
        return json.loads(result.content[0].text)

    def login(subject, scopes=ALL_SCOPES):
        current["token"] = AccessToken(token="t", client_id="c", scopes=scopes, subject=subject)

    _call.login, _call.mcp = login, mcp
    return _call


def bench(*sets):
    return {"exercise": BENCH, "sets": [{"weight_kg": w, "reps": r} for w, r in sets]}


def test_ツールの一覧():
    mcp = MCPServer(name="test")
    mcp_tools.register_training_tools(mcp, None, None, today=lambda: TODAY)
    names = {t.name for t in asyncio.run(mcp.list_tools())}
    assert names == {"record_workout", "get_workout", "list_workouts", "exercise_history", "weekly_training_review",
                     "list_exercises", "update_workout", "delete_workout", "add_exercise", "update_exercise",
                     "record_body", "body_progress"}


def test_記録すると_その日の記録と計算と最後の同期の時刻を返す(call):
    result = call("record_workout", exercises=[bench((80, 8), (85, 5)), {"exercise": "懸垂", "sets": [{"reps": 10}]}])
    assert result["date"] == "2026-11-08" and result["last_app_sync_at"] == "2026-11-08T19:00:00+09:00"
    first, pullups = result["entries"]
    assert (first["exercise"], first["body_part"], first["volume"]) == (BENCH, "胸", 80 * 8 + 85 * 5)
    assert first["max_estimated_1rm"] == round(80 * (1 + 8 / 30), 1)  # Epley 式（testdata と同じ計算）
    assert first["new_personal_best"] is None  # 初めての種目
    assert [s["set_no"] for s in first["sets"]] == [1, 2]
    assert (pullups["exercise"], pullups["sets"][0]["weight_kg"], pullups["volume"]) == ("懸垂", None, 0)
    assert result["total_volume"] == 1065


def test_同じ日に同じ種目を記録すると_セットの後ろに足す(call):
    call("record_workout", exercises=[bench((80, 8))])
    entries = call("record_workout", exercises=[bench((90, 3))])["entries"]
    assert len(entries) == 1 and [(s["set_no"], s["weight_kg"]) for s in entries[0]["sets"]] == [(1, 80), (2, 90)]


def test_自己ベストを超えたかが分かる(call):
    call("record_workout", exercises=[bench((80, 8))], day="2026-11-01")
    assert call("record_workout", exercises=[bench((90, 8))])["entries"][0]["new_personal_best"] is True
    history = call("exercise_history", exercise=BENCH)
    assert [d["date"] for d in history["days"]] == ["2026-11-01", "2026-11-08"]
    assert history["personal_best"] == {"date": "2026-11-08", "weight_kg": 90, "reps": 8, "estimated_1rm": 114.0}


@pytest.mark.parametrize("exercises,message", [
    ([{"exercise": "ベンチ", "sets": [{"weight_kg": 80, "reps": 8}]}], "近い名前：ベンチプレス"),
    ([{"exercise": BENCH, "sets": [{"reps": 8}]}], "重量（kg）を入れてください"),
    ([{"exercise": "懸垂", "sets": [{"weight_kg": 10, "reps": 8}]}], "重量は入れないでください"),
])
def test_種目の名前や記録の仕方が合わなければ理由を返し_何も書かない(call, engine, exercises, message):
    with pytest.raises(ToolError, match=message):
        call("record_workout", exercises=exercises)
    assert engine.head("alice") == 0


@pytest.mark.parametrize("sets", [[{"weight_kg": 501, "reps": 1}], [{"weight_kg": 80, "reps": 0}], []])
def test_範囲の外の入力は断る(call, sets):
    with pytest.raises(ToolError):
        call("record_workout", exercises=[{"exercise": BENCH, "sets": sets}])


def test_セットを直し_消し_種目を消し_日を移す(call):
    workout = call("record_workout", exercises=[bench((80, 8), (85, 5), (60, 12)), {"exercise": "スクワット",
                                                                                    "sets": [{"weight_kg": 100, "reps": 5}]}])
    bench_entry, squat = workout["entries"]
    s1, s2, s3 = (s["set_id"] for s in bench_entry["sets"])
    updated = call("update_workout", day="2026-11-08", change_sets=[{"set_id": s1, "reps": 10, "memo": "補助あり"}],
                   remove_set_ids=[s2], remove_entry_ids=[squat["entry_id"]])
    entry = updated["entries"][0]
    assert len(updated["entries"]) == 1
    assert [(s["set_no"], s["weight_kg"], s["reps"], s["memo"]) for s in entry["sets"]] == [
        (1, 80, 10, "補助あり"), (2, 60, 12, "")]
    moved = call("update_workout", day="2026-11-08", move_to="2026-11-07")
    assert moved["date"] == "2026-11-07" and moved["entries"][0]["entry_id"] == entry["entry_id"]
    assert call("get_workout")["entries"] == []


def test_最後のセットは消せない(call):
    entry = call("record_workout", exercises=[bench((80, 8))])["entries"][0]
    with pytest.raises(ToolError, match="最後のセットは消せません"):
        call("update_workout", day="2026-11-08", remove_set_ids=[entry["sets"][0]["set_id"]])


def test_存在しない_ID_や日は断る(call):
    call("record_workout", exercises=[bench((80, 8))])
    with pytest.raises(ToolError, match="セット nope はありません"):
        call("update_workout", day="2026-11-08", change_sets=[{"set_id": "nope", "reps": 1}])
    with pytest.raises(ToolError, match="種目 nope はありません"):
        call("delete_workout", day="2026-11-08", entry_ids=["nope"])
    with pytest.raises(ToolError, match="2026-11-01 の筋トレの記録はありません"):
        call("delete_workout", day="2026-11-01")
    with pytest.raises(ToolError, match="直す内容"):
        call("update_workout", day="2026-11-08")


def test_消すと集計からも消える(call):
    call("record_workout", exercises=[bench((80, 8))])
    result = call("delete_workout", day="2026-11-08")
    assert len(result["deleted_entry_ids"]) == 1 and result["remaining"]["entries"] == []
    assert call("weekly_training_review")["sessions"] == 0


def test_一覧と週のふり返り(call):
    call("record_workout", exercises=[bench((80, 8))], day="2026-11-03")
    call("record_workout", exercises=[{"exercise": "スクワット", "sets": [{"weight_kg": 100, "reps": 5}]}],
         day="2026-11-08")
    call("record_workout", exercises=[bench((60, 10))], day="2026-11-08")
    listed = call("list_workouts", start="2026-11-01", end="2026-11-08")["workouts"]
    assert [(w["date"], w["exercises"], w["total_volume"]) for w in listed] == [
        ("2026-11-03", [BENCH], 640), ("2026-11-08", ["スクワット", BENCH], 1100)]
    review = call("weekly_training_review")
    assert review["week"] == {"from": "2026-11-08", "to": "2026-11-14", "until": "2026-11-08"}
    assert (review["sessions"], review["total_volume"], review["days_since_last_training"]) == (1, 1100, 0)
    parts = {p["body_part"]: p for p in review["by_body_part"]}
    assert (parts["脚"]["volume"], parts["脚"]["share_pct"], parts["胸"]["share_pct"]) == (500, 45.5, 54.5)
    assert "背中" in review["untrained_body_parts"]
    assert (review["last_week"]["sessions"], review["last_week"]["total_volume"]) == (1, 640)
    assert len(review["weeks"]) == 8
    later = call("weekly_training_review", day="2026-11-11")
    assert later["days_since_last_training"] == 3


def test_期間がおかしければ断る(call):
    with pytest.raises(ToolError, match="end は start"):
        call("list_workouts", start="2026-11-08", end="2026-11-01")
    with pytest.raises(ToolError, match="366日"):
        call("list_workouts", start="2025-01-01", end="2026-11-08")


def test_種目を足して記録に使える_同じ部位に同じ名前は作れない(call):
    added = call("add_exercise", name="ケトルベルスイング", body_part="脚")
    assert (added["body_part"], added["record_type"]) == ("脚", "weight_reps")
    call("record_workout", exercises=[{"exercise": "ケトルベル スイング", "sets": [{"weight_kg": 16, "reps": 20}]}])
    with pytest.raises(ToolError, match="もう「ケトルベルスイング」があります"):
        call("add_exercise", name="ケトルベルスイング", body_part="脚")
    with pytest.raises(ToolError, match="という部位はありません"):
        call("add_exercise", name="ネックカール", body_part="首")
    names = [e["name"] for p in call("list_exercises")["body_parts"] if p["body_part"] == "脚" for e in p["exercises"]]
    assert names[-1] == "ケトルベルスイング"


def test_種目の名前を変えると_過去の記録と推移も新しい名前で出る(call):
    call("record_workout", exercises=[bench((80, 8))], day="2026-11-01")
    renamed = call("update_exercise", exercise=BENCH, name="バーベルベンチプレス")
    assert (renamed["name"], renamed["body_part"], renamed["hidden"]) == ("バーベルベンチプレス", "胸", False)
    assert call("get_workout", day="2026-11-01")["entries"][0]["exercise"] == "バーベルベンチプレス"
    assert call("list_workouts", start="2026-11-01", end="2026-11-08")["workouts"][0]["exercises"] == ["バーベルベンチプレス"]
    history = call("exercise_history", exercise="バーベルベンチプレス")
    assert [d["date"] for d in history["days"]] == ["2026-11-01"]
    with pytest.raises(ToolError, match="という名前の種目はありません"):
        call("exercise_history", exercise="ベンチプレス")  # 古い名前では選ばない
    # 同じ種目（ID）に記録が続く
    entry = call("record_workout", exercises=[{"exercise": renamed["exercise_id"], "sets": [{"weight_kg": 85, "reps": 5}]}])
    assert entry["entries"][0]["new_personal_best"] is not None


def test_種目の部位を変えると_新しい部位の最後に並び_週のふり返りの部位も変わる(call):
    call("record_workout", exercises=[{"exercise": "懸垂", "sets": [{"reps": 10}]}, bench((80, 8))])
    moved = call("update_exercise", exercise=BENCH, body_part="肩")
    assert moved["body_part"] == "肩"
    shoulders = next(p for p in call("list_exercises")["body_parts"] if p["body_part"] == "肩")
    assert shoulders["exercises"][-1]["name"] == BENCH
    parts = {p["body_part"]: p["volume"] for p in call("weekly_training_review")["by_body_part"]}
    assert (parts["肩"], parts["胸"]) == (640, 0)


def test_種目の名前の変更は_同じ部位に同じ名前があれば断る_ほかの部位ならよい(call, engine):
    with pytest.raises(ToolError, match="胸にはもう「ダンベルフライ」があります"):
        call("update_exercise", exercise=BENCH, name="ダンベル フライ")
    with pytest.raises(ToolError, match="背中にはもう「デッドリフト」があります"):
        call("update_exercise", exercise="ルーマニアンデッドリフト", name="デッドリフト", body_part="背中")
    call("update_exercise", exercise="ダンベルフライ", hidden=True)
    with pytest.raises(ToolError, match="隠している種目です.*update_exercise で表示に戻せます"):
        call("update_exercise", exercise=BENCH, name="ダンベルフライ")
    head = engine.head("alice")
    # 自分と同じ名前（大文字と小文字や空白だけ変える）はよい。ほかの部位に同じ名前があってもよい
    assert call("update_exercise", exercise="スクワット", name="スクワット ")["name"] == "スクワット"
    assert engine.head("alice") == head  # 何も変わらなければ書かない
    assert call("update_exercise", exercise="スクワット", name="デッドリフト")["body_part"] == "脚"
    with pytest.raises(ToolError, match="変える内容"):
        call("update_exercise", exercise=BENCH)
    with pytest.raises(ToolError, match="という部位はありません"):
        call("update_exercise", exercise=BENCH, body_part="首")
    with pytest.raises(ToolError, match="名前を入れてください"):
        call("update_exercise", exercise=BENCH, name="  ")
    with pytest.raises(ToolError, match="40文字以内"):
        call("update_exercise", exercise=BENCH, name="ア" * 41)


def test_種目を隠すと一覧から消え_記録には使え_表示に戻せる(call):
    hidden = call("update_exercise", exercise=BENCH, hidden=True)
    assert hidden["hidden"] is True
    chest = lambda listed: next(p for p in listed["body_parts"] if p["body_part"] == "胸")["exercises"]
    assert BENCH not in [e["name"] for e in chest(call("list_exercises"))]
    assert {"exercise_id": hidden["exercise_id"], "name": BENCH, "record_type": "weight_reps", "hidden": True} in \
        chest(call("list_exercises", include_hidden=True))
    call("record_workout", exercises=[bench((80, 8))])  # 隠した種目も記録に使える
    shown = call("update_exercise", exercise=hidden["exercise_id"], hidden=False)
    assert shown["hidden"] is False and BENCH in [e["name"] for e in chest(call("list_exercises"))]


def test_初期の種目を変えるときは_変えた項目だけを同期に送る(call, engine):
    call("update_exercise", exercise=BENCH, name="バーベルベンチプレス")
    call("update_exercise", exercise="スクワット", hidden=True)
    entries, _, _ = engine.pull("alice", 0, 100, set(REGISTRY.specs))
    assert [(e.change.op, e.change.fields) for e in entries] == [
        ("update", {"name": "バーベルベンチプレス"}), ("update", {"hidden": True})]
    # 同期に記録のある種目も、違う項目だけ
    call("update_exercise", exercise="バーベルベンチプレス", name="ベンチプレス", hidden=True)
    entries, _, _ = engine.pull("alice", 2, 100, set(REGISTRY.specs))
    assert [(e.change.op, e.change.fields) for e in entries] == [("update", {"name": "ベンチプレス", "hidden": True})]


def test_アプリが同期で送った種目の変更と_MCP_の変更は項目ごとに合わさる(call, engine):
    exercise_id = call("update_exercise", exercise=BENCH, name="バーベルベンチプレス")["exercise_id"]
    engine.append("alice", [Change(str(uuid.uuid4()), "exercise", exercise_id, None, "update", {"hidden": True},
                                   "2026-11-08T00:00:00.000Z", "app")])  # 先に端末で隠していた（名前より古い）
    listed = call("list_exercises", include_hidden=True)
    found = [e for p in listed["body_parts"] for e in p["exercises"] if e["exercise_id"] == exercise_id]
    assert found == [{"exercise_id": exercise_id, "name": "バーベルベンチプレス", "record_type": "weight_reps", "hidden": True}]


def test_体組成を記録し_同じ日は渡した項目だけ書き換える(call):
    first = call("record_body", weight_kg=70.2, body_fat_pct=15)
    assert first["recorded"]["weight_kg"] == 70.2 and first["recorded"]["fat_mass_kg"] == 10.5
    second = call("record_body", waist_cm=78)
    assert (second["recorded"]["weight_kg"], second["recorded"]["waist_cm"]) == (70.2, 78)
    call("record_body", day="2026-10-25", weight_kg=71.0)
    progress = call("body_progress", days=30)
    assert [d["date"] for d in progress["days"]] == ["2026-10-25", "2026-11-08"]
    assert progress["weekly_weight_change_kg"] == round((70.2 - 71.0) / 14 * 7, 2)
    with pytest.raises(ToolError, match="どれかを入れてください"):
        call("record_body")
    with pytest.raises(ToolError, match="体重"):
        call("record_body", weight_kg=10)


def test_ほかの人の記録は見えず_直せない(call):
    entry = call("record_workout", exercises=[bench((80, 8))])["entries"][0]
    call("add_exercise", name="ケトルベルスイング", body_part="脚")
    call("record_body", weight_kg=70)
    call.login("bob")
    assert call("get_workout")["entries"] == []
    assert call("list_workouts", start="2026-11-01", end="2026-11-08")["workouts"] == []
    assert call("body_progress")["days"] == []
    assert call("weekly_training_review")["sessions"] == 0
    assert call("get_workout")["last_app_sync_at"] is None  # 同期の時刻も本人の分だけ
    with pytest.raises(ToolError, match="ありません"):
        call("update_workout", day="2026-11-08", change_sets=[{"set_id": entry["sets"][0]["set_id"], "reps": 1}])
    with pytest.raises(ToolError, match="ケトルベルスイング"):
        call("record_workout", exercises=[{"exercise": "ケトルベルスイング", "sets": [{"weight_kg": 16, "reps": 1}]}])


@pytest.mark.parametrize("tool,arguments,scope", [
    ("get_workout", {}, "training:read"),
    ("list_workouts", {"start": "2026-11-01", "end": "2026-11-08"}, "training:read"),
    ("exercise_history", {"exercise": BENCH}, "training:read"),
    ("weekly_training_review", {}, "training:read"),
    ("list_exercises", {}, "training:read"),
    ("body_progress", {}, "training:read"),
    ("record_workout", {"exercises": [bench((80, 8))]}, "training:write"),
    ("update_workout", {"day": "2026-11-08", "remove_set_ids": ["x"]}, "training:write"),
    ("delete_workout", {"day": "2026-11-08"}, "training:write"),
    ("add_exercise", {"name": "x", "body_part": "胸"}, "training:write"),
    ("update_exercise", {"exercise": BENCH, "hidden": True}, "training:write"),
    ("record_body", {"weight_kg": 70}, "training:write"),
])
def test_筋トレの_scope_がなければ断る(call, engine, tool, arguments, scope):
    call.login("alice", scopes=["meals:read", "meals:write"])  # 筋トレのツールを足す前に同意したコネクタ
    with pytest.raises(ToolError, match=f"許可（{scope}）がありません.*つなぎ直し"):
        call(tool, **arguments)
    other = "training:write" if scope == "training:read" else "training:read"
    call.login("alice", scopes=[other])  # 読み取りと書き込みは別
    with pytest.raises(ToolError, match=scope):
        call(tool, **arguments)
    assert engine.head("alice") == 0


def test_書いた変更は_アプリから届く変更と同じ確かめ方を通り_アプリに同期で降りる(call, engine):
    workout = call("record_workout", exercises=[bench((80, 8)), {"exercise": "懸垂", "sets": [{"reps": 10}]}])
    call("update_workout", day="2026-11-08", change_sets=[{"set_id": workout["entries"][0]["sets"][0]["set_id"],
                                                           "weight_kg": 82.5}])
    call("add_exercise", name="ケトルベルスイング", body_part="脚")
    call("update_exercise", exercise="ケトルベルスイング", name="ケトルベル・スイング", body_part="背中", hidden=True)
    call("update_exercise", exercise=BENCH, name="バーベルベンチプレス")
    call("record_body", weight_kg=70, memo="朝")
    call("delete_workout", day="2026-11-08", entry_ids=[workout["entries"][1]["entry_id"]])
    entries, _, _ = engine.pull("alice", 0, 100, set(REGISTRY.specs))
    assert entries and all(e.change.origin == "mcp" for e in entries)
    for e in entries:
        c = e.change
        raw = {"change_id": str(uuid.uuid4()), "entity_type": c.entity_type, "entity_id": c.entity_id,
               "op": c.op, "fields": c.fields, "changed_at": "2026-11-08T12:00:00Z"}
        if c.op in ("delete", "restore"):
            raw.pop("fields")
        assert isinstance(REGISTRY.parse_change(raw, set(REGISTRY.specs), None), Change), (c, raw)
    # アプリ（同期の受け取り）からも、直した値が見える
    sets = [e.state for e in entries if e.change.entity_type == "workout_set" and not e.state["deleted"]]
    assert 82.5 in [s["fields"].get("weight_kg") for s in sets]
