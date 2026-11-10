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
TODAY = date(2026, 11, 8)  # 日曜（週の最後の日。週は月曜〜日曜）
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
                     "record_body", "body_progress", "sleep_summary", "heart_rate_summary", "step_summary",
                     "record_injury", "list_injuries", "add_injury_review", "mark_injury_fixed", "update_injury",
                     "delete_injury"}


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
    call("record_workout", exercises=[bench((80, 8))], day="2026-11-01")  # 日曜（先週の最後の日）
    call("record_workout", exercises=[{"exercise": "スクワット", "sets": [{"weight_kg": 100, "reps": 5}]}],
         day="2026-11-08")
    call("record_workout", exercises=[bench((60, 10))], day="2026-11-08")
    listed = call("list_workouts", start="2026-11-01", end="2026-11-08")["workouts"]
    assert [(w["date"], w["exercises"], w["total_volume"]) for w in listed] == [
        ("2026-11-01", [BENCH], 640), ("2026-11-08", ["スクワット", BENCH], 1100)]
    review = call("weekly_training_review")
    assert review["week"] == {"from": "2026-11-02", "to": "2026-11-08", "until": "2026-11-08"}
    assert (review["sessions"], review["total_volume"], review["days_since_last_training"]) == (1, 1100, 0)
    parts = {p["body_part"]: p for p in review["by_body_part"]}
    assert (parts["脚"]["volume"], parts["脚"]["share_pct"], parts["胸"]["share_pct"]) == (500, 45.5, 54.5)
    assert "背中" in review["untrained_body_parts"]
    assert (review["last_week"]["sessions"], review["last_week"]["total_volume"]) == (1, 640)
    assert len(review["weeks"]) == 8
    later = call("weekly_training_review", day="2026-11-11")
    assert later["days_since_last_training"] == 3


def test_自重の種目は_体重_割合_回数で総負荷量に入る_体重がなければ入れずに知らせる(call):
    pullups = {"exercise": "懸垂", "sets": [{"reps": 10}, {"reps": 8}]}
    first = call("record_workout", exercises=[pullups, bench((80, 8))], day="2026-11-01")  # 先週の日曜
    assert (first["total_volume"], first["bodyweight_kg"]) == (640, None)  # 体重の記録がない
    assert "2セット" in first["note"] and first["entries"][0]["sets"][0]["volume"] == 0
    call("record_body", day="2026-10-20", weight_kg=70)  # 30日以内のいちばん近い前の日の体重を使う
    day = call("get_workout", day="2026-11-01")
    assert (day["bodyweight_kg"], day["total_volume"], "note" in day) == (70, 70 * 18 + 640, False)
    assert day["entries"][0]["sets"][0]["volume"] == 700 and day["entries"][0]["max_estimated_1rm"] is None
    call("record_body", day="2026-11-08", weight_kg=72)
    call("record_workout", exercises=[{"exercise": "クランチ", "sets": [{"reps": 20}]}])  # 初期の割合 0.3
    review = call("weekly_training_review")
    assert review["total_volume"] == round(72 * 0.3 * 20, 1) and review["last_week"]["total_volume"] == 70 * 18 + 640
    listed = call("list_workouts", start="2026-11-01", end="2026-11-08")["workouts"]
    assert [w["total_volume"] for w in listed] == [70 * 18 + 640, 432]
    history = call("exercise_history", exercise="懸垂")
    assert (history["bodyweight_ratio"], history["days"][0]["volume"], history["personal_best"]) == (1, 1260, None)


def test_種目の割合を足すときに決め_変えると過去の記録も新しい割合で出る(call, engine):
    added = call("add_exercise", name="膝つき腕立て", body_part="胸", record_type="reps_only")
    assert added["bodyweight_ratio"] == 0.5  # 省くと名前から決める
    plank = call("add_exercise", name="プランク", body_part="腹筋", record_type="reps_only")
    assert plank["bodyweight_ratio"] == 0
    own = call("add_exercise", name="ハンドスタンドプッシュアップ", body_part="肩", record_type="reps_only",
               bodyweight_ratio=0.9)
    assert own["bodyweight_ratio"] == 0.9
    with pytest.raises(ToolError, match="回数だけ"):
        call("add_exercise", name="ケトルベルスイング", body_part="脚", bodyweight_ratio=0.5)
    with pytest.raises(ToolError):
        call("add_exercise", name="片手懸垂", body_part="背中", record_type="reps_only", bodyweight_ratio=1.5)
    call("record_body", weight_kg=60)
    call("record_workout", exercises=[{"exercise": "膝つき腕立て", "sets": [{"reps": 10}]},
                                      {"exercise": "プランク", "sets": [{"reps": 60}]}])
    assert call("get_workout")["total_volume"] == 300
    assert call("update_exercise", exercise="膝つき腕立て", bodyweight_ratio=0.4)["bodyweight_ratio"] == 0.4
    assert call("get_workout")["total_volume"] == 240
    entries, _, _ = engine.pull("alice", 0, 100, {"exercise"})
    assert [e.change.fields.get("bodyweight_ratio") for e in entries] == [0.5, 0, 0.9, 0.4]  # アプリにも降りる
    # 初期の種目は割合を持たず、名前から決める。変えたときだけ送る
    call("update_exercise", exercise="懸垂", name="チンニング")
    entries, _, _ = engine.pull("alice", 0, 100, {"exercise"})
    assert entries[-1].change.fields == {"name": "チンニング"}
    assert call("get_workout")["total_volume"] == 240


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


def test_種目の一覧に_BIG3_の役とフォームの動画を付ける_MCP_の変更では消さない(call, engine):
    def listed():
        return {e["name"]: e for p in call("list_exercises")["body_parts"] for e in p["exercises"]}

    # 割り当てる前は、名前で決めた役（インクラインダンベルプレス・ルーマニアンデッドリフトは入らない）
    roles = {name: e["big3"] for name, e in listed().items() if "big3" in e}
    assert roles == {"ベンチプレス": "bench", "スクワット": "squat", "デッドリフト": "deadlift"}
    assert all("form_video_url" not in e for e in listed().values())
    # アプリでベンチプレスの役をほかの種目に移し、フォームの動画を入れた
    narrow = call("add_exercise", name="ナローベンチ", body_part="胸")["exercise_id"]
    engine.append("alice", [
        Change(str(uuid.uuid4()), "exercise", narrow, None, "update",
               {"big3": "bench", "form_video_url": "https://youtu.be/abc"}, "2026-11-08T10:00:00.000Z", "app"),
    ])
    found = listed()
    assert {name: e["big3"] for name, e in found.items() if "big3" in e} == {"ナローベンチ": "bench"}  # 名前では決めない
    assert found["ナローベンチ"]["form_video_url"] == "https://youtu.be/abc"
    # MCP で名前を変えても、役とリンクは残り、送るのは名前だけ
    call("update_exercise", exercise=narrow, name="ナローグリップベンチ")
    entries, _, _ = engine.pull("alice", 0, 100, {"exercise"})
    assert entries[-1].change.fields == {"name": "ナローグリップベンチ"}
    assert listed()["ナローグリップベンチ"]["big3"] == "bench"


def test_体組成を記録し_同じ日は渡した項目だけ書き換える(call):
    first = call("record_body", weight_kg=70.2, body_fat_pct=15)
    assert first["recorded"]["weight_kg"] == 70.2 and first["recorded"]["fat_mass_kg"] == 10.5
    second = call("record_body", body_fat_pct=16)
    assert (second["recorded"]["weight_kg"], second["recorded"]["body_fat_pct"]) == (70.2, 16)
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
    assert call("sleep_summary")["nights"] == [] and call("heart_rate_summary")["days"] == []
    assert call("step_summary")["days"] == []
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
    ("sleep_summary", {}, "training:read"),
    ("heart_rate_summary", {}, "training:read"),
    ("step_summary", {}, "training:read"),
    ("record_workout", {"exercises": [bench((80, 8))]}, "training:write"),
    ("update_workout", {"day": "2026-11-08", "remove_set_ids": ["x"]}, "training:write"),
    ("delete_workout", {"day": "2026-11-08"}, "training:write"),
    ("add_exercise", {"name": "x", "body_part": "胸"}, "training:write"),
    ("update_exercise", {"exercise": BENCH, "hidden": True}, "training:write"),
    ("record_body", {"weight_kg": 70}, "training:write"),
    ("list_injuries", {}, "training:read"),
    ("record_injury", {"site": "elbow", "side": "left"}, "training:write"),
    ("add_injury_review", {"injury_id": "x", "result": "not_yet"}, "training:write"),
    ("mark_injury_fixed", {"injury_id": "x"}, "training:write"),
    ("update_injury", {"injury_id": "x", "reopen": True}, "training:write"),
    ("delete_injury", {"injury_id": "x"}, "training:write"),
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


def imported(engine, entity_type, entity_id, fields, op="create"):
    """アプリが Health Connect から取り込んで送った変更（origin = import）。"""
    engine.append("alice", [Change(str(uuid.uuid4()), entity_type, entity_id, None, op, fields,
                                   "2026-11-08T10:00:00.000Z", "import")])


def sleep_fields(day, start, end, asleep, awake=0):
    return {"date": day, "start_at": start, "end_at": end, "asleep_min": asleep, "awake_min": awake,
            "source": "health_connect", "external_id": None, "origin_package": "com.example.watch"}


def test_睡眠のまとめ_起きた日ごとに足し_時刻は日本時間_期間の平均(call, engine):
    imported(engine, "sleep_session", "s1", sleep_fields("2026-11-07", "2026-11-06T14:40:00.000Z", "2026-11-06T21:55:00.000Z", 420, 15))
    imported(engine, "sleep_session", "s2", sleep_fields("2026-11-07", "2026-11-07T04:00:00.000Z", "2026-11-07T04:30:00.000Z", 30))
    imported(engine, "sleep_session", "s3", sleep_fields("2026-11-08", "2026-11-07T15:10:00.000Z", "2026-11-07T21:40:00.000Z", 380, 10))
    imported(engine, "sleep_session", "s-old", sleep_fields("2026-10-30", "2026-10-29T15:00:00.000Z", "2026-10-29T22:00:00.000Z", 400))
    imported(engine, "sleep_session", "s-gone", sleep_fields("2026-11-06", "2026-11-05T15:00:00.000Z", "2026-11-05T22:00:00.000Z", 400))
    imported(engine, "sleep_session", "s-gone", None, op="delete")
    result = call("sleep_summary")
    assert (result["from"], result["to"]) == ("2026-11-02", "2026-11-08")
    assert result["nights"] == [
        {"date": "2026-11-07", "asleep_min": 450, "awake_min": 15, "bedtime": "2026-11-06T23:40+09:00",
         "wake_time": "2026-11-07T06:55+09:00", "sessions": 2},
        {"date": "2026-11-08", "asleep_min": 380, "awake_min": 10, "bedtime": "2026-11-08T00:10+09:00",
         "wake_time": "2026-11-08T06:40+09:00", "sessions": 1},
    ]
    assert (result["nights_recorded"], result["average_asleep_min"]) == (2, 415.0)
    assert result["last_app_sync_at"] == "2026-11-08T19:00:00+09:00"
    assert len(call("sleep_summary", days=14)["nights"]) == 3


def test_心拍のまとめ_日ごとの値と安静時心拍の平均(call, engine):
    imported(engine, "heart_rate_day", "h1", {"date": "2026-11-06", "resting_bpm": 56, "avg_bpm": 72.4, "min_bpm": 50,
                                              "max_bpm": 150, "samples": 1200})
    imported(engine, "heart_rate_day", "h2", {"date": "2026-11-07", "resting_bpm": 59, "avg_bpm": None, "min_bpm": None,
                                              "max_bpm": None, "samples": 0})
    imported(engine, "heart_rate_day", "h3", {"date": "2026-11-08", "resting_bpm": None, "avg_bpm": 80, "min_bpm": 60,
                                              "max_bpm": 120, "samples": 30})
    result = call("heart_rate_summary")
    assert result["days"] == [
        {"date": "2026-11-06", "resting_bpm": 56, "avg_bpm": 72.4, "min_bpm": 50, "max_bpm": 150, "samples": 1200},
        {"date": "2026-11-07", "resting_bpm": 59, "avg_bpm": None, "min_bpm": None, "max_bpm": None, "samples": 0},
        {"date": "2026-11-08", "resting_bpm": None, "avg_bpm": 80, "min_bpm": 60, "max_bpm": 120, "samples": 30},
    ]
    assert (result["days_recorded"], result["average_resting_bpm"]) == (3, 57.5)
    assert result["last_app_sync_at"] == "2026-11-08T19:00:00+09:00"


def test_歩数のまとめ_日ごとの合計と平均(call, engine):
    imported(engine, "step_day", "st1", {"date": "2026-11-06", "steps": 8240})
    imported(engine, "step_day", "st2", {"date": "2026-11-08", "steps": 10321})
    imported(engine, "step_day", "st-old", {"date": "2026-10-30", "steps": 3000})  # 7日より前
    imported(engine, "step_day", "st-gone", {"date": "2026-11-07", "steps": 500})
    imported(engine, "step_day", "st-gone", None, op="delete")
    result = call("step_summary")
    assert (result["from"], result["to"]) == ("2026-11-02", "2026-11-08")
    assert result["days"] == [{"date": "2026-11-06", "steps": 8240}, {"date": "2026-11-08", "steps": 10321}]
    assert (result["days_recorded"], result["average_steps"]) == (2, 9281)  # 9280.5 は上げる（アプリと同じ）
    assert result["last_app_sync_at"] == "2026-11-08T19:00:00+09:00"
    assert len(call("step_summary", days=14)["days"]) == 3
    assert [d["date"] for d in call("step_summary", start="2026-11-06", end="2026-11-06")["days"]] == ["2026-11-06"]


@pytest.mark.parametrize("tool", ["sleep_summary", "heart_rate_summary", "step_summary"])
@pytest.mark.parametrize("days", [6, 91])
def test_睡眠と心拍と歩数の期間は7日から90日(call, tool, days):
    with pytest.raises(ToolError):
        call(tool, days=days)


def test_まとめは_start_と_end_で前の期間も読める(call, engine):
    imported(engine, "sleep_session", "s1", sleep_fields("2026-11-03", "2026-11-02T14:00:00.000Z", "2026-11-02T21:00:00.000Z", 420))
    imported(engine, "sleep_session", "s2", sleep_fields("2026-11-05", "2026-11-04T14:00:00.000Z", "2026-11-04T21:00:00.000Z", 360))
    imported(engine, "heart_rate_day", "h1", {"date": "2026-11-03", "resting_bpm": 56, "avg_bpm": None, "min_bpm": None,
                                              "max_bpm": None, "samples": 0})
    call("record_body", day="2026-11-03", weight_kg=70)
    call("record_body", day="2026-11-05", weight_kg=69.5)
    day = {"start": "2026-11-03", "end": "2026-11-03"}  # 前の日のまとめ（1日だけ）
    sleep = call("sleep_summary", **day)
    assert (sleep["from"], sleep["to"], [n["date"] for n in sleep["nights"]]) == ("2026-11-03", "2026-11-03", ["2026-11-03"])
    assert [d["date"] for d in call("heart_rate_summary", **day)["days"]] == ["2026-11-03"]
    body = call("body_progress", **day)
    assert (body["from"], body["to"], [d["weight_kg"] for d in body["days"]]) == ("2026-11-03", "2026-11-03", [70])
    # end だけなら、end までの days 日
    assert (call("sleep_summary", end="2026-11-05")["from"]) == "2026-10-30"
    assert call("body_progress", end="2026-11-05", days=7)["latest"]["date"] == "2026-11-05"


@pytest.mark.parametrize("tool, start, end, message", [
    ("sleep_summary", "2026-11-05", "2026-11-04", "end は start"),
    ("sleep_summary", "2026-08-01", "2026-11-08", "90日"),
    ("heart_rate_summary", "2026-08-01", "2026-11-08", "90日"),
    ("step_summary", "2026-08-01", "2026-11-08", "90日"),
    ("body_progress", "2025-01-01", "2026-11-08", "366日"),
])
def test_まとめの期間を確かめる(call, tool, start, end, message):
    with pytest.raises(ToolError, match=message):
        call(tool, start=start, end=end)


# --- ケガの記録 ---

def shoulder(call, **extra):
    """ベンチプレスで右の三角筋（前）を痛めた記録。原因と直し方は利用者の言葉のまま。"""
    arguments = {"site": "shoulder_front", "side": "right", "day": "2026-11-05", "exercise": BENCH,
                 "phase": "3セット目の下ろすとき", "symptom": "肩の前がピリッとした",
                 "cause": "肘が開いていた", "fix": "肘を45度にたたむ", **extra}
    return call("record_injury", **arguments)["recorded"]


def test_ケガを記録すると_直している途中として_言葉のまま残り_部位の名前を付ける(call):
    recorded = shoulder(call)
    assert {k: recorded[k] for k in ("occurred_on", "site", "side", "site_name", "site_kind", "exercise", "phase",
                                     "symptom", "cause", "fix", "status", "fixed_on", "reviews", "review_count")} == {
        "occurred_on": "2026-11-05", "site": "shoulder_front", "side": "right", "site_name": "右の三角筋（前）",
        "site_kind": "muscle", "exercise": BENCH, "phase": "3セット目の下ろすとき", "symptom": "肩の前がピリッとした",
        "cause": "肘が開いていた", "fix": "肘を45度にたたむ", "status": "fixing", "fixed_on": None, "reviews": [],
        "review_count": 0}
    # 原因と直し方を言っていなければ空のまま（推測で埋めない）。左右のない部位、種目なし、日付は今日
    waist = call("record_injury", site="waist", symptom="朝から重い")["recorded"]
    assert (waist["occurred_on"], waist["side"], waist["site_name"], waist["exercise_id"], waist["cause"],
            waist["fix"]) == ("2026-11-08", None, "腰（関節・下背部）", None, "", "")
    # 左右のある部位で左右を言っていないときは、左右なしで記録する
    assert call("record_injury", site="knee")["recorded"]["site_name"] == "膝"


def test_脊柱起立筋は背中上部と腰に分かれ_どちらも左右を付けて記録_一覧_書き直しできる(call, engine):
    upper = call("record_injury", site="upper_back", side="right", symptom="背中の右上が張る")["recorded"]
    assert (upper["site"], upper["side"], upper["site_name"]) == ("upper_back", "right", "右の脊柱起立筋（背中上部）")
    lower_left = call("record_injury", site="lower_back", side="left")["recorded"]
    lower_right = call("record_injury", site="lower_back", side="right")["recorded"]
    assert (lower_left["site_name"], lower_right["site_name"]) == ("左の脊柱起立筋（腰の筋肉）", "右の脊柱起立筋（腰の筋肉）")
    # 左右を言っていなければ左右なし（左右を持つ前に記録した腰の筋肉と同じ形で、今までどおり読める）
    legacy = call("record_injury", site="lower_back")["recorded"]
    assert (legacy["side"], legacy["site_name"]) == (None, "脊柱起立筋（腰の筋肉）")
    listed = {i["injury_id"]: (i["site"], i["side"], i["site_name"]) for i in call("list_injuries")["injuries"]}
    assert listed[upper["injury_id"]] == ("upper_back", "right", "右の脊柱起立筋（背中上部）")
    assert listed[legacy["injury_id"]] == ("lower_back", None, "脊柱起立筋（腰の筋肉）")
    # 書き直し：腰から背中上部へ（左右は残る）。左右のない部位へ変えると左右は外れる
    moved = call("update_injury", injury_id=lower_left["injury_id"], site="upper_back")["injury"]
    assert (moved["site"], moved["side"]) == ("upper_back", "left")
    to_abs = call("update_injury", injury_id=moved["injury_id"], site="abs")["injury"]
    assert (to_abs["site"], to_abs["side"]) == ("abs", None)


@pytest.mark.parametrize("arguments,message", [
    ({"site": "abs", "side": "left"}, "腹筋には左右がありません"),
    ({"site": "neck", "side": "right"}, "首には左右がありません"),
    ({"site": "elbow", "exercise": "ベンチ"}, "近い名前：ベンチプレス"),  # 種目は名前の完全一致だけ
    ({"site": "elbow", "fix": "あ" * 501}, None),  # 直し方は500文字まで
])
def test_ケガの記録の入力が合わなければ理由を返し_何も書かない(call, engine, arguments, message):
    with pytest.raises(ToolError, match=message):
        call("record_injury", **arguments)
    assert engine.head("alice") == 0


def test_ケガの一覧は新しい順で_状態で絞れ_振り返りも返す(call):
    old = shoulder(call, day="2026-10-01")
    new = shoulder(call, site="wrist", side="left", exercise=None)
    call("add_injury_review", injury_id=old["injury_id"], day="2026-10-10", result="pain", note="まだ痛む")
    call("add_injury_review", injury_id=old["injury_id"], day="2026-10-20", result="fixed",
         note="肘をたたんだら大丈夫だった", exercise=BENCH)
    fixed = call("mark_injury_fixed", injury_id=old["injury_id"], day="2026-10-20")["injury"]
    assert (fixed["status"], fixed["fixed_on"]) == ("fixed", "2026-10-20")
    listed = call("list_injuries")
    assert listed["total"] == 2 and listed["last_app_sync_at"] == "2026-11-08T19:00:00+09:00"
    assert [i["injury_id"] for i in listed["injuries"]] == [new["injury_id"], old["injury_id"]]
    reviews = listed["injuries"][1]["reviews"]
    assert [(r["date"], r["result"], r["note"], r["exercise"]) for r in reviews] == [
        ("2026-10-10", "pain", "まだ痛む", None), ("2026-10-20", "fixed", "肘をたたんだら大丈夫だった", BENCH)]
    assert [i["injury_id"] for i in call("list_injuries", status="fixing")["injuries"]] == [new["injury_id"]]
    assert [i["injury_id"] for i in call("list_injuries", status="fixed")["injuries"]] == [old["injury_id"]]
    assert len(call("list_injuries", limit=1)["injuries"]) == 1


def test_振り返りが直せたでも_ケガの状態は変えない(call):
    injury = shoulder(call)
    after = call("add_injury_review", injury_id=injury["injury_id"], result="fixed")["injury"]
    assert (after["status"], after["review_count"], after["reviews"][0]["date"]) == ("fixing", 1, "2026-11-08")


def test_ケガの記録を書き直し_直している途中に戻す(call):
    injury = shoulder(call)
    call("mark_injury_fixed", injury_id=injury["injury_id"])
    updated = call("update_injury", injury_id=injury["injury_id"], fix="肘を45度にたたみ、肩甲骨を寄せる", cause="",
                   reopen=True)["injury"]
    assert (updated["fix"], updated["cause"], updated["status"], updated["fixed_on"]) == (
        "肘を45度にたたみ、肩甲骨を寄せる", "", "fixing", None)
    assert updated["phase"] == "3セット目の下ろすとき"  # 渡さなかった項目は変えない
    # 左右のない部位に変えると左右は外れる。種目は空の文字で外す
    moved = call("update_injury", injury_id=injury["injury_id"], site="neck", exercise="")["injury"]
    assert (moved["site_name"], moved["side"], moved["exercise_id"]) == ("首", None, None)
    with pytest.raises(ToolError, match="首には左右がありません"):
        call("update_injury", injury_id=injury["injury_id"], side="left")
    with pytest.raises(ToolError, match="直す内容"):
        call("update_injury", injury_id=injury["injury_id"])
    with pytest.raises(ToolError, match="痛めた日.*と同じか後の日"):
        call("mark_injury_fixed", injury_id=injury["injury_id"], day="2026-11-01")


def test_ケガを消すと振り返りも消える_同期にはケガを先に消す(call, engine):
    injury = shoulder(call)
    for result in ("pain", "not_yet"):
        call("add_injury_review", injury_id=injury["injury_id"], result=result)
    head = engine.head("alice")
    assert call("delete_injury", injury_id=injury["injury_id"]) == {
        "deleted_injury_id": injury["injury_id"], "deleted_review_count": 2,
        "last_app_sync_at": "2026-11-08T19:00:00+09:00"}
    entries, _, _ = engine.pull("alice", head, 100, set(REGISTRY.specs))
    assert [(e.change.entity_type, e.change.op) for e in entries] == [
        ("injury", "delete"), ("injury_review", "delete"), ("injury_review", "delete")]
    assert call("list_injuries")["injuries"] == []
    with pytest.raises(ToolError, match="ありません"):
        call("add_injury_review", injury_id=injury["injury_id"], result="pain")


def test_ほかの人のケガは見えず_直せない(call):
    injury = shoulder(call)
    call.login("bob")
    assert call("list_injuries")["injuries"] == []
    for tool, arguments in [("add_injury_review", {"result": "pain"}), ("mark_injury_fixed", {}),
                            ("update_injury", {"fix": "x"}), ("delete_injury", {})]:
        with pytest.raises(ToolError, match="ありません"):
            call(tool, injury_id=injury["injury_id"], **arguments)


def test_ケガと振り返りの数の上限(call, monkeypatch):
    from training.application import commands
    monkeypatch.setattr(commands, "MAX_INJURIES", 2)
    monkeypatch.setattr(commands, "MAX_REVIEWS_PER_INJURY", 1)
    injury = shoulder(call)
    shoulder(call)
    with pytest.raises(ToolError, match="ケガの記録は2件まで"):
        shoulder(call)
    call("add_injury_review", injury_id=injury["injury_id"], result="pain")
    with pytest.raises(ToolError, match="振り返りはケガ1件に1件まで"):
        call("add_injury_review", injury_id=injury["injury_id"], result="pain")
    call("delete_injury", injury_id=injury["injury_id"])  # 消したものは数えない
    shoulder(call)


def test_ケガの変更は_アプリから届く変更と同じ確かめ方を通る(call, engine):
    injury = shoulder(call)
    call("add_injury_review", injury_id=injury["injury_id"], result="not_yet", exercise=BENCH)
    call("mark_injury_fixed", injury_id=injury["injury_id"])
    call("update_injury", injury_id=injury["injury_id"], reopen=True, site="abs")
    call("delete_injury", injury_id=injury["injury_id"])
    entries, _, _ = engine.pull("alice", 0, 100, set(REGISTRY.specs))
    assert {e.change.entity_type for e in entries} == {"injury", "injury_review"}
    for e in entries:
        c = e.change
        raw = {"change_id": str(uuid.uuid4()), "entity_type": c.entity_type, "entity_id": c.entity_id,
               "op": c.op, "fields": c.fields, "changed_at": "2026-11-08T12:00:00Z"}
        if c.op in ("delete", "restore"):
            raw.pop("fields")
        assert isinstance(REGISTRY.parse_change(raw, set(REGISTRY.specs), None), Change), (c, raw)



def test_説明文に_ケガの記録の流れがある():
    for words in ("record_injury", "そのまま記録する", "推測で埋めない", "痛みの強さや体調は聞かない", "診断",
                  "アプリに直すことが出る"):
        assert words in mcp_tools.INSTRUCTIONS


def test_アプリが状態だけを直せたにしたケガも_MCP_で書き直せる(call, engine):
    injury = shoulder(call)
    engine.append("alice", [Change(str(uuid.uuid4()), "injury", injury["injury_id"], None, "update",
                                   {"status": "fixed"}, "2099-01-01T00:00:00.000Z", "app")])  # 受け付けた時刻で切る
    updated = call("update_injury", injury_id=injury["injury_id"], fix="肘をたたむ")["injury"]
    assert (updated["status"], updated["fixed_on"], updated["fix"]) == ("fixed", None, "肘をたたむ")
    fixed = call("mark_injury_fixed", injury_id=injury["injury_id"])["injury"]
    assert (fixed["status"], fixed["fixed_on"]) == ("fixed", "2026-11-08")

