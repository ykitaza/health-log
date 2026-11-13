"""組み立てた MCP サーバーを、SDK の MCP クライアントから HTTP（Streamable HTTP）で通しで呼んで確かめる。

アクセストークンの検証だけを差し替え（scope を変えられる）、ほかは Lambda と同じ組み立て（create_server・create_app）を使う。
"""

import json
import uuid
from datetime import date

import anyio
import httpx2
import pytest
from mcp.client import Client
from mcp.client.streamable_http import streamable_http_client
from mcp.server.auth.provider import AccessToken

import main
from meals.domain.body_weight import WeightRecord
from meals.domain.values import EaterId
from sync.engine import SyncEngine
from sync.model import Change
from sync.store import InMemorySyncStore

RESOURCE = "http://127.0.0.1:8001/mcp"
ISSUER = "https://authz.example"
ALL_SCOPES = ["meals:read", "meals:write", "training:read", "training:write"]
MEAL_SCOPES = ["meals:read", "meals:write"]  # 筋トレのツールを足す前に同意したコネクタ
LUNCH = {"date": "2026-11-08", "slot": "lunch", "description": "白米", "source": "text",
         "items": [{"name": "白米", "amount": 200, "unit": "g", "kcal": 312, "protein_g": 5, "fat_g": 0.6,
                    "carbs_g": 74}]}
GOALS = {"policy": "bulk", "body_weight_kg": 70, "training_day": {"kcal": 2800, "fat_g": 70, "carbs_g": 380},
         "rest_day": {"kcal": 2400, "fat_g": 70, "carbs_g": 280}}


class FakeVerifier:
    """トークンの文字列が scope の並び（空白区切り）。sub は alice。"""

    async def verify_token(self, token):
        return AccessToken(token=token, client_id="c", scopes=token.split("+"), subject="alice")


class FakeSession:
    def __init__(self):
        self.revoked = []

    async def revoke(self, access_token, client_id):
        self.revoked.append((access_token, client_id))

    def logout_url(self):
        return f"{ISSUER}/logout"


@pytest.fixture
def server():
    registry = main.create_registry()
    engine = SyncEngine(InMemorySyncStore(registry.index_key), registry)
    session = FakeSession()
    mcp = main.create_server(engine, FakeVerifier(), ISSUER, RESOURCE, session, today=lambda: date(2026, 11, 8))
    app = main.create_app(mcp, "127.0.0.1")
    return {"mcp": mcp, "app": app, "engine": engine, "session": session}


def http(server, scopes):
    headers = {"Authorization": f"Bearer {'+'.join(scopes)}"} if scopes is not None else {}
    return httpx2.AsyncClient(transport=httpx2.ASGITransport(app=server["app"]), base_url="http://127.0.0.1:8001",
                              headers=headers)


def run(server, scopes, body):
    """MCP のクライアントでつなぎ、body(client) を動かす。"""
    async def go():
        async with server["mcp"].session_manager.run():
            async with http(server, scopes) as h:
                async with Client(streamable_http_client(RESOURCE, http_client=h)) as client:
                    return await body(client)
    return anyio.run(go)


def data(result):
    assert not result.is_error, result.content[0].text
    return json.loads(result.content[0].text)


def test_食事と筋トレとレポートとログアウトのツールが1つのサーバーにある(server):
    async def body(client):
        return {t.name for t in (await client.list_tools()).tools}

    names = run(server, ALL_SCOPES, body)
    assert {"record_meal", "today_status", "set_day_type", "weekly_review", "record_weight"} <= names
    assert {"record_workout", "get_workout", "exercise_history", "weekly_training_review", "record_body",
            "sleep_summary", "heart_rate_summary", "step_summary"} <= names
    assert {"record_injury", "list_injuries", "add_injury_review", "mark_injury_fixed", "update_injury",
            "delete_injury", "list_phases"} <= names
    assert {"save_report", "list_reports", "get_report", "delete_report"} <= names
    assert {"logout", "period_overview", "meal_summary"} <= names
    assert len(names) == 17 + 22 + 4 + 1 + 1


def test_筋トレを記録すると_その日の食事の目標が筋トレの日になる_本人が決めた日はそちらを優先(server):
    async def body(client):
        data(await client.call_tool("set_goals", GOALS))
        before = data(await client.call_tool("today_status", {}))
        data(await client.call_tool("record_workout", {"exercises": [
            {"exercise": "ベンチプレス", "sets": [{"weight_kg": 80, "reps": 8}]}]}))
        after = data(await client.call_tool("today_status", {}))
        chosen = data(await client.call_tool("set_day_type", {"day_type": "rest"}))
        return before, after, chosen

    before, after, chosen = run(server, ALL_SCOPES, body)
    assert (before["day_type"], before["target"]["kcal"]) == ("rest", 2400)
    assert (after["day_type"], after["target"]["kcal"]) == ("training", 2800)
    assert chosen["day_type"] == "rest"


def test_種目の名前を変えると_過去の記録も新しい名前で出る(server):
    async def body(client):
        recorded = data(await client.call_tool("record_workout", {"day": "2026-11-01", "exercises": [
            {"exercise": "ベンチプレス", "sets": [{"weight_kg": 80, "reps": 8}]}]}))
        renamed = data(await client.call_tool("update_exercise", {"exercise": "ベンチプレス", "name": "バーベルベンチプレス"}))
        past = data(await client.call_tool("get_workout", {"day": "2026-11-01"}))
        return recorded, renamed, past

    recorded, renamed, past = run(server, ALL_SCOPES, body)
    assert renamed["exercise_id"] == recorded["entries"][0]["exercise_id"] and renamed["name"] == "バーベルベンチプレス"
    assert past["entries"][0]["exercise"] == "バーベルベンチプレス"


def test_体重は体組成に一本化していて_食事と筋トレのどちらのツールで記録しても両方から見える(server):
    async def body(client):
        data(await client.call_tool("set_goals", {**GOALS, "target_weight_kg": 65}))
        data(await client.call_tool("record_weight", {"kg": 72.0, "day": "2026-10-25"}))
        data(await client.call_tool("record_body", {"body_fat_pct": 18.0, "day": "2026-10-25"}))  # 同じ日の手入力に足す
        data(await client.call_tool("record_body", {"weight_kg": 71.0, "day": "2026-11-08"}))
        progress = data(await client.call_tool("goal_progress", {}))
        body_ = data(await client.call_tool("body_progress", {}))
        return progress, body_

    progress, body_ = run(server, ALL_SCOPES, body)
    assert progress["latest"]["kg"] == 71.0 and progress["remaining_kg"] == -6.0
    assert [(r["date"], r["kg"]) for r in progress["records"]] == [("2026-10-25", 72.0), ("2026-11-08", 71.0)]
    first = next(d for d in body_["days"] if d["date"] == "2026-10-25")
    assert (first["weight_kg"], first["body_fat_pct"]) == (72.0, 18.0)  # 1日に1つの手入力の記録にまとまる
    assert len(server["engine"].docs_of_type("alice", "body_record")) == 2  # 日ごとに1つ


def test_食事の体重のポートは_日ごとに1つ_本人の分だけ_期間で日付の順に返す(server):
    engine = server["engine"]
    weights = main.BodyRecordWeights(main.create_commands(engine, main.now), main.create_queries(engine))
    alice, bob = EaterId("alice"), EaterId("bob")

    async def go():
        await weights.save(WeightRecord(alice, date(2026, 10, 12), 67.0))
        await weights.save(WeightRecord(alice, date(2026, 10, 1), 66.0))
        await weights.save(WeightRecord(alice, date(2026, 10, 12), 67.4))  # 同じ日は上書き
        await weights.save(WeightRecord(bob, date(2026, 10, 5), 80.0))
        return (await weights.find(alice, date(2026, 10, 1), date(2026, 10, 12)),
                await weights.find(alice, date(2026, 10, 2), date(2026, 10, 11)))

    found, middle = anyio.run(go)
    assert [(r.day.day, r.kg) for r in found] == [(1, 66.0), (12, 67.4)]
    assert middle == []
    assert len(engine.docs_of_type("alice", "body_record")) == 2


def test_応答にアプリの最後の同期の時刻が入る(server):
    engine = server["engine"]

    async def body(client):
        meal = data(await client.call_tool("record_meal", {"meal": LUNCH}))
        workout = data(await client.call_tool("get_workout", {}))
        engine.clock = lambda: "2026-11-08T10:00:00.000Z"  # アプリが同期で送る
        engine.append("alice", [Change(str(uuid.uuid4()), "body_record", str(uuid.uuid4()), None, "create", {
            "date": "2026-11-08", "measured_at": "2026-11-08T09:00:00Z", "source": "manual", "weight_kg": 70.0},
            "2026-11-08T09:00:00.000Z", "app", "pixel")])
        meals = data(await client.call_tool("list_meals", {"start": "2026-11-08", "end": "2026-11-08"}))
        body_ = data(await client.call_tool("body_progress", {}))
        return meal, workout, meals, body_

    meal, workout, meals, body_ = run(server, ALL_SCOPES, body)
    assert meal["last_app_sync_at"] is None and workout["last_app_sync_at"] is None  # MCP の変更では変わらない
    assert meals["last_app_sync_at"] == body_["last_app_sync_at"] == "2026-11-08T19:00:00+09:00"  # 日本時間
    assert body_["latest"]["weight_kg"] == 70.0  # アプリから同期された記録が見える


def test_MCP_で保存したレポートは_同期の受け取りでアプリに届き_アプリから消せる(server):
    engine = server["engine"]
    report = {"title": "今週のまとめ", "overall_tone": "good", "headline": "よく続いた", "kind": "weekly",
              "period_start": "2026-11-02", "period_end": "2026-11-08", "body": "## 筋トレ"}

    async def body(client):
        saved = data(await client.call_tool("save_report", report))["report"]
        pulled, _, _ = engine.pull("alice", 0, 100, engine.registry.types_in({"training"}))
        # アプリが消す（同期の送信と同じ確かめ方。アプリからは delete だけ）
        change = engine.registry.parse_change({
            "change_id": str(uuid.uuid4()), "entity_type": "report", "entity_id": saved["report_id"], "op": "delete",
            "changed_at": "2026-11-08T12:00:00.000Z"}, {"report"}, "pixel")
        engine.append("alice", [change])
        listed = data(await client.call_tool("list_reports", {}))
        return saved, pulled, listed

    saved, pulled, listed = run(server, ALL_SCOPES, body)
    (entry,) = [e for e in pulled if e.change.entity_type == "report"]
    assert entry.state["entity_id"] == saved["report_id"] and entry.state["fields"]["headline"] == "よく続いた"
    assert listed["reports"] == []


def app_change(engine, entity_type, entity_id, fields):
    """アプリが同期で送った変更（origin = app）。"""
    engine.append("alice", [Change(str(uuid.uuid4()), entity_type, entity_id, None, "create", fields,
                                   "2026-11-08T09:00:00.000Z", "app", "pixel")])


def test_期間の材料を1回で読める_筋トレ_食事_体組成_睡眠_心拍_歩数_目標(server):
    engine = server["engine"]
    for key, value in [("goal_weight_kg", "65"), ("weekly_goal_training_days", "3"), ("weeklyGoalMealDays", "5"),
                       ("weekly_goal_sleep_days", "0"), ("rest_timer_seconds", "90")]:
        app_change(engine, "setting", key, {"value": value})
    app_change(engine, "sleep_session", "s1", {
        "date": "2026-11-03", "start_at": "2026-11-02T14:00:00.000Z", "end_at": "2026-11-02T21:30:00.000Z",
        "asleep_min": 440, "awake_min": 10, "source": "health_connect"})
    app_change(engine, "heart_rate_day", "h1", {"date": "2026-11-03", "resting_bpm": 55, "samples": 10})
    app_change(engine, "heart_rate_day", "h2", {"date": "2026-11-04", "resting_bpm": None, "samples": 0})
    app_change(engine, "step_day", "st1", {"date": "2026-11-03", "steps": 8240})
    app_change(engine, "step_day", "st2", {"date": "2026-11-05", "steps": 5001})
    app_change(engine, "step_day", "st-out", {"date": "2026-11-01", "steps": 20000})  # 期間の外

    async def body(client):
        data(await client.call_tool("set_goals", GOALS))
        data(await client.call_tool("record_workout", {"day": "2026-11-03", "exercises": [
            {"exercise": "ベンチプレス", "sets": [{"weight_kg": 80, "reps": 8}, {"weight_kg": 85, "reps": 3}]}]}))
        data(await client.call_tool("record_workout", {"day": "2026-11-06", "exercises": [
            {"exercise": "スクワット", "sets": [{"weight_kg": 100, "reps": 5}]}]}))
        data(await client.call_tool("record_workout", {"day": "2026-11-01", "exercises": [  # 期間の外
            {"exercise": "ベンチプレス", "sets": [{"weight_kg": 120, "reps": 1}]}]}))
        data(await client.call_tool("record_meal", {"meal": {**LUNCH, "date": "2026-11-03"}}))
        data(await client.call_tool("record_body", {"day": "2026-11-02", "weight_kg": 70.0, "body_fat_pct": 18.0}))
        data(await client.call_tool("record_body", {"day": "2026-11-05", "weight_kg": 69.0}))
        week = data(await client.call_tool("period_overview", {"start": "2026-11-02", "end": "2026-11-08"}))
        today = data(await client.call_tool("period_overview", {}))
        return week, today

    week, today = run(server, ALL_SCOPES, body)
    assert (week["from"], week["to"], week["days"]) == ("2026-11-02", "2026-11-08", 7)
    assert (today["from"], today["to"], today["days"]) == ("2026-11-08", "2026-11-08", 1)
    training = week["training"]
    assert (training["sessions"], training["total_volume"]) == (2, 80 * 8 + 85 * 3 + 100 * 5)
    assert training["days"] == [{"date": "2026-11-03", "volume": 895, "sets": 2},
                                {"date": "2026-11-06", "volume": 500, "sets": 1}]
    assert [(e["exercise"], e["max_estimated_1rm"], e["date"]) for e in training["exercises"]] == [
        ("スクワット", round(100 * (1 + 5 / 30), 1), "2026-11-06"), ("ベンチプレス", round(80 * (1 + 8 / 30), 1), "2026-11-03")]
    meals = week["meals"]
    assert (meals["recorded_days"], meals["total_days"], len(meals["days"])) == (1, 7, 7)
    assert meals["days"][1] == {"date": "2026-11-03", "day_type": "training", "recorded": True, "kcal": 312,
                                "protein_g": 5, "fat_g": 0.6, "carbs_g": 74, "target_kcal": 2800}
    assert "goal" not in meals and "from" not in meals
    assert week["body"] == {
        "days_recorded": 2, "average_weight_kg": 69.5, "average_body_fat_pct": 18.0, "weekly_weight_change_kg": -2.33,
        "days": [{"date": "2026-11-02", "weight_kg": 70.0, "body_fat_pct": 18.0},
                 {"date": "2026-11-05", "weight_kg": 69.0, "body_fat_pct": None}]}
    assert week["sleep"] == {"nights_recorded": 1, "average_asleep_min": 440, "nights": [
        {"date": "2026-11-03", "asleep_min": 440, "bedtime": "2026-11-02T23:00+09:00", "wake_time": "2026-11-03T06:30+09:00"}]}
    assert week["heart_rate"] == {"days_recorded": 1, "average_resting_bpm": 55, "days": [
        {"date": "2026-11-03", "resting_bpm": 55}]}
    assert week["steps"] == {"days_recorded": 2, "average_steps": 6621, "days": [
        {"date": "2026-11-03", "steps": 8240}, {"date": "2026-11-05", "steps": 5001}]}
    assert today["steps"] == {"days_recorded": 0, "average_steps": None, "days": []}
    goals = week["goals"]
    assert goals["meals"]["policy"] == "bulk" and goals["goal_weight_kg"] == 65 and goals["goal_weight_source"] == "setting"
    assert week["phase"] == {"as_of": "2026-11-08", "current": None, "paused": None, "in_period": [],
                             "rehab_in_period": False}
    assert goals["weekly"] == {"training_days": 3, "meal_days": 5, "sleep_days": 0}
    assert week["last_app_sync_at"] is not None  # アプリから同期した記録がある


PHASE = {"kind": "normal", "direction": "cut", "name": "", "start_date": "2026-10-05", "end_date": "2026-11-29",
         "target_weight_kg": 66.0, "status": "active", "paused_phase_id": None, "ended_on": None, "meal_targets": None,
         "snapshot": {"weight_kg": 70.0, "body_fat_pct": 20.0, "big3": None, "growth_score": None},
         "target_history": [{"date": "2026-10-05", "target_weight_kg": 66.0, "end_date": "2026-11-29", "weight_kg": 70.0}]}


def test_期間の材料に_フェーズの向き_何週目_目標_ペースが入り_目標体重はフェーズが先(server):
    engine = server["engine"]
    app_change(engine, "setting", "goal_weight_kg", {"value": "80"})
    app_change(engine, "phase", "p1", PHASE)
    # 10/5〜11/29 の8週で 70→66kg。11/2〜11/8 の予定は 68.0〜67.5kg ほど
    for day, kg in [("2026-11-03", 68.1), ("2026-11-05", 67.9), ("2026-11-07", 67.8)]:
        app_change(engine, "body_record", f"b{day}", {"date": day, "measured_at": f"{day}T07:00:00+09:00",
                                                      "weight_kg": kg, "source": "manual"})

    async def body(client):
        week = data(await client.call_tool("period_overview", {"start": "2026-11-02", "end": "2026-11-08"}))
        before = data(await client.call_tool("period_overview", {"start": "2026-09-01", "end": "2026-09-30"}))
        # 療養を始めると、療養が今のフェーズで、通常のフェーズは止まる
        app_change(engine, "phase", "r1", {"kind": "rehab", "start_date": "2026-11-06", "status": "active",
                                           "paused_phase_id": "p1", "name": ""})
        rehab = data(await client.call_tool("period_overview", {"start": "2026-11-02", "end": "2026-11-08"}))
        listed = data(await client.call_tool("list_phases", {}))
        return week, before, rehab, listed

    week, before, rehab, listed = run(server, ALL_SCOPES, body)
    phase = week["phase"]
    current = phase["current"]
    assert (current["kind"], current["direction"], current["label"], current["week"], current["weeks_total"]) == (
        "normal", "cut", "減量 8週", 5, 8)
    assert (current["target_weight_kg"], current["start_weight_kg"], current["remaining_days"]) == (66.0, 70.0, 21)
    assert current["pace"]["status"] == "on_track" and current["pace"]["weigh_ins"] == 3
    assert phase["in_period"] == [current] and phase["paused"] is None and phase["rehab_in_period"] is False
    assert (week["goals"]["goal_weight_kg"], week["goals"]["goal_weight_source"]) == (66.0, "phase")
    # フェーズより前の期間は、フェーズも目標もフェーズのものを使わない
    assert before["phase"]["current"] is None and before["phase"]["in_period"] == []
    assert (before["goals"]["goal_weight_kg"], before["goals"]["goal_weight_source"]) == (80, "setting")
    # 療養中：ペースは判定しない。終わりは療養の日数（11/6〜11/8 の3日）だけ後ろへ
    phase = rehab["phase"]
    assert (phase["current"]["kind"], phase["current"]["label"], phase["current"]["rehab_days"]) == ("rehab", "療養", 3)
    assert phase["paused"]["paused_by_rehab"] is True and phase["paused"]["pace"]["not_judged_reason"] == "paused"
    assert phase["paused"]["effective_end_date"] == "2026-12-02" and phase["rehab_in_period"] is True
    assert (rehab["goals"]["goal_weight_kg"], rehab["goals"]["goal_weight_source"]) == (66.0, "phase")
    assert listed["current"]["phase_id"] == "r1" and listed["paused"]["phase_id"] == "p1"
    assert [p["phase_id"] for p in listed["phases"]] == ["r1", "p1"] and listed["total"] == 2
    assert listed["paused"]["target_history"][0]["weight_kg"] == 70.0 and listed["paused"]["snapshot"]["body_fat_pct"] == 20.0


def test_期間の材料は_あとで終えたフェーズも_その期間には実施中として読む(server):
    engine = server["engine"]
    app_change(engine, "setting", "goal_weight_kg", {"value": "80"})
    # 11/6 に終えた減量と、11/6 に終えた療養（どちらも 11/2〜11/5 の時点では続いていた）
    app_change(engine, "phase", "p1", {**PHASE, "status": "ended", "ended_on": "2026-11-06"})
    app_change(engine, "phase", "r1", {"kind": "rehab", "start_date": "2026-11-04", "status": "ended",
                                       "ended_on": "2026-11-06", "paused_phase_id": "p1", "name": ""})

    async def body(client):
        early = data(await client.call_tool("period_overview", {"start": "2026-11-02", "end": "2026-11-03"}))
        rehab = data(await client.call_tool("period_overview", {"start": "2026-11-02", "end": "2026-11-05"}))
        after = data(await client.call_tool("period_overview", {"start": "2026-11-06", "end": "2026-11-08"}))
        return early, rehab, after

    early, rehab, after = run(server, ALL_SCOPES, body)
    assert (early["phase"]["current"]["phase_id"], early["phase"]["current"]["direction"]) == ("p1", "cut")
    assert early["phase"]["current"]["pace"]["not_judged_reason"] == "few_weigh_ins"  # 終えたからではない
    assert (early["goals"]["goal_weight_kg"], early["goals"]["goal_weight_source"]) == (66.0, "phase")
    # 11/5 の時点は療養中（11/4・11/5 の2日）。そのあとに療養を終えた日は数えない
    assert (rehab["phase"]["current"]["kind"], rehab["phase"]["current"]["rehab_days"]) == ("rehab", 2)
    assert rehab["phase"]["paused"]["effective_end_date"] == "2026-12-01" and rehab["phase"]["rehab_in_period"] is True
    assert (rehab["goals"]["goal_weight_kg"], rehab["goals"]["goal_weight_source"]) == (66.0, "phase")
    # 終えたあとの期間には出ず、目標体重は設定のもの
    assert after["phase"]["current"] is None and after["phase"]["in_period"] == []
    assert (after["goals"]["goal_weight_kg"], after["goals"]["goal_weight_source"]) == (80, "setting")


def test_期間の材料に_ケガの記録が本人の言葉のまま入る_期間外は入らず_ケガがなければ空(server):
    def injury(client, **extra):
        return client.call_tool("record_injury", {"site": "shoulder_front", "side": "right", "exercise": "ベンチプレス",
                                                  "phase": "3セット目", "symptom": "肩の前がピリッとした",
                                                  "cause": "肘が開いていた", "fix": "肘を45度にたたむ", **extra})

    async def body(client):
        empty = data(await client.call_tool("period_overview", {"start": "2026-11-02", "end": "2026-11-08"}))["injuries"]
        in_week = data(await injury(client, day="2026-11-04"))["recorded"]  # 期間に痛め、直している途中
        before = data(await injury(client, day="2026-10-20", site="elbow", side="left", cause="", fix=""))["recorded"]
        fixed_before = data(await injury(client, day="2026-10-01", site="wrist", side="left"))["recorded"]
        data(await client.call_tool("mark_injury_fixed", {"injury_id": fixed_before["injury_id"], "day": "2026-10-10"}))
        fixed_after = data(await injury(client, day="2026-11-03", site="knee", side="right"))["recorded"]
        data(await client.call_tool("mark_injury_fixed", {"injury_id": fixed_after["injury_id"], "day": "2026-11-08"}))
        future = data(await injury(client, day="2026-11-08", site="neck", side=None))["recorded"]
        for day, result in [("2026-11-05", "not_yet"), ("2026-11-06", "pain"), ("2026-11-07", "fixed")]:
            data(await client.call_tool("add_injury_review", {
                "injury_id": before["injury_id"], "day": day, "result": result, "note": f"{day}のメモ"}))
        data(await client.call_tool("add_injury_review", {"injury_id": before["injury_id"], "day": "2026-10-25",
                                                          "result": "pain"}))  # 期間の外の振り返り
        mid = data(await client.call_tool("period_overview", {"start": "2026-11-02", "end": "2026-11-05"}))["injuries"]
        week = data(await client.call_tool("period_overview", {"start": "2026-11-02", "end": "2026-11-08"}))["injuries"]
        return empty, in_week, before, fixed_after, future, mid, week

    empty, in_week, before, fixed_after, future, mid, week = run(server, ALL_SCOPES, body)
    assert empty == {"occurred": [], "occurred_total": 0, "reviewed": [], "reviewed_total": 0, "fixing": [],
                     "fixing_total": 0}
    assert [i["injury_id"] for i in week["occurred"]] == [future["injury_id"], in_week["injury_id"],
                                                          fixed_after["injury_id"]]
    assert week["occurred_total"] == 3
    shoulder = next(i for i in week["occurred"] if i["injury_id"] == in_week["injury_id"])
    assert shoulder == {
        "injury_id": in_week["injury_id"], "occurred_on": "2026-11-04", "site_name": "右の三角筋（前）",
        "exercise": "ベンチプレス", "phase": "3セット目", "symptom": "肩の前がピリッとした",
        "cause": "肘が開いていた", "fix": "肘を45度にたたむ", "status": "fixing", "fixed_on": None}
    # 期間に振り返りを書いたケガ：期間の中の振り返りだけを新しい順に（期間外の 10-25 は入らない）
    assert [i["injury_id"] for i in week["reviewed"]] == [before["injury_id"]] and week["reviewed_total"] == 1
    reviewed = week["reviewed"][0]
    assert (reviewed["site_name"], reviewed["cause"], reviewed["fix"], reviewed["review_count"]) == ("左の肘", "", "", 3)
    assert [(r["date"], r["result"], r["note"], r["exercise"]) for r in reviewed["reviews"]] == [
        ("2026-11-07", "fixed", "2026-11-07のメモ", None), ("2026-11-06", "pain", "2026-11-06のメモ", None),
        ("2026-11-05", "not_yet", "2026-11-05のメモ", None)]
    # 期間の終わりの時点で直している途中：期間より前に痛めて今も途中、end より後に直せたにしたもの。end より後に痛めたもの、
    # end より前に直せたものは入らない
    assert {i["injury_id"] for i in mid["fixing"]} == {before["injury_id"], in_week["injury_id"], fixed_after["injury_id"]}
    assert mid["fixing_total"] == 3 and [i["injury_id"] for i in mid["occurred"]] == [in_week["injury_id"],
                                                                                    fixed_after["injury_id"]]
    assert mid["reviewed_total"] == 1  # 11-05 までの期間には、その日の振り返りだけが入る
    assert [r["date"] for r in mid["reviewed"][0]["reviews"]] == ["2026-11-05"] and mid["reviewed"][0]["review_count"] == 1
    assert {i["injury_id"] for i in week["fixing"]} == {before["injury_id"], in_week["injury_id"], future["injury_id"]}


def test_期間の材料のケガは_件数の上限で切り_全部の数を返す(server):
    async def body(client):
        for n in range(12):
            injury = data(await client.call_tool("record_injury", {"site": "knee", "day": f"2026-11-{n + 1:02d}"}))
            for m in range(7):
                data(await client.call_tool("add_injury_review", {
                    "injury_id": injury["recorded"]["injury_id"], "day": f"2026-11-{m + 1:02d}", "result": "not_yet"}))
        return data(await client.call_tool("period_overview", {"start": "2026-11-01", "end": "2026-11-08"}))["injuries"]

    injuries = run(server, ALL_SCOPES, body)
    assert (injuries["occurred_total"], len(injuries["occurred"])) == (8, 8)  # 痛めた日が期間の中の8件
    assert (injuries["fixing_total"], len(injuries["fixing"])) == (8, 8)
    assert (injuries["reviewed_total"], len(injuries["reviewed"])) == (12, 10)
    assert injuries["reviewed"][0]["review_count"] == 7 and len(injuries["reviewed"][0]["reviews"]) == 5
    assert injuries["reviewed"][0]["reviews"][0]["date"] == "2026-11-07"


def test_週のまとめの材料に_前の週のまとめの次の一歩とアプリのチェックが出る(server):
    steps = ["脚の日を2回入れる", "たんぱく質を毎日130gとる", "0時までに寝る日を4日つくる"]

    async def body(client):
        saved = data(await client.call_tool("save_report", {
            "title": "今週のまとめ", "overall_tone": "good", "headline": "脚の日が増えた", "kind": "weekly",
            "period_start": "2026-10-26", "period_end": "2026-11-01", "next_steps": steps}))["report"]
        server["engine"].append("alice", [Change(str(uuid.uuid4()), "report", saved["report_id"], None, "update",
                                                 {"next_steps_done": [1]}, "2026-11-08T01:00:00.000Z", "app")])
        week = data(await client.call_tool("period_overview", {"start": "2026-11-02", "end": "2026-11-08"}))
        review = data(await client.call_tool("weekly_review", {}))
        earlier = data(await client.call_tool("period_overview", {"start": "2026-10-26", "end": "2026-11-01"}))
        return saved["report_id"], week, review, earlier

    report_id, week, review, earlier = run(server, ALL_SCOPES, body)
    expected = [{"text": steps[0], "done": False}, {"text": steps[1], "done": True}, {"text": steps[2], "done": False}]
    assert week["previous_next_steps"]["report_id"] == report_id
    assert week["previous_next_steps"]["steps"] == expected and week["previous_next_steps"]["done_count"] == 1
    assert review["previous_next_steps"]["steps"] == expected  # 食事の週のふり返り（今週）にも
    assert earlier["previous_next_steps"] is None


class CountingStore(InMemorySyncStore):
    """種類ごとの全件読み（docs_of_type）の回数を数える。日付の範囲の読み（docs_by_index）の中で使う分は数えない。"""

    def __init__(self, index_key):
        super().__init__(index_key)
        self.type_reads: list[tuple[str, str]] = []
        self._in_index = False

    def docs_of_type(self, user, entity_type):
        if not self._in_index:
            self.type_reads.append((user, entity_type))
        return super().docs_of_type(user, entity_type)

    def docs_by_index(self, user, entity_type, start, end):
        self._in_index = True
        try:
            return super().docs_by_index(user, entity_type, start, end)
        finally:
            self._in_index = False


def test_期間の材料は_1回の実行の中で同じ種類を1回だけ読み_中身は使い回さないときと同じ(server, monkeypatch):
    import contextlib
    from connector import period_overview

    registry = main.create_registry()
    store = CountingStore(registry.index_key)
    engine = SyncEngine(store, registry)
    mcp = main.create_server(engine, FakeVerifier(), ISSUER, RESOURCE, FakeSession(), today=lambda: date(2026, 11, 8))
    counted = {**server, "mcp": mcp, "app": main.create_app(mcp, "127.0.0.1")}
    app_change(engine, "setting", "goal_weight_kg", {"value": "80"})
    app_change(engine, "phase", "p1", PHASE)
    app_change(engine, "body_record", "b1", {"date": "2026-11-03", "measured_at": "2026-11-03T07:00:00+09:00",
                                             "weight_kg": 68.1, "source": "manual"})

    async def body(client):
        data(await client.call_tool("record_workout", {"day": "2026-11-03", "exercises": [
            {"exercise": "ベンチプレス", "sets": [{"weight_kg": 80, "reps": 8}]}]}))
        data(await client.call_tool("record_meal", {"meal": {**LUNCH, "date": "2026-11-03"}}))
        store.type_reads.clear()
        week = data(await client.call_tool("period_overview", {"start": "2026-11-02", "end": "2026-11-08"}))
        reads = list(store.type_reads)
        # 次の呼び出しでは読み直す（前の実行の中身は残らない）。書いた記録も見える
        app_change(engine, "body_record", "b2", {"date": "2026-11-05", "measured_at": "2026-11-05T07:00:00+09:00",
                                                 "weight_kg": 67.9, "source": "manual"})
        again = data(await client.call_tool("period_overview", {"start": "2026-11-02", "end": "2026-11-08"}))
        # 使い回さないとき（範囲を開かない）と比べる
        monkeypatch.setattr(period_overview, "read_cache_scope", contextlib.nullcontext)
        store.type_reads.clear()
        plain = data(await client.call_tool("period_overview", {"start": "2026-11-02", "end": "2026-11-08"}))
        return week, reads, again, plain, list(store.type_reads)

    week, reads, again, plain, plain_reads = run(counted, ALL_SCOPES, body)
    # スレッドに渡した読み取り（anyio.to_thread）の間でも使い回せている
    assert len(reads) == len(set(reads)) and {"phase", "body_record", "workout_set", "setting"} <= {t for _, t in reads}
    assert all(user == "alice" for user, _ in reads)
    assert week["phase"]["current"]["pace"]["weigh_ins"] == 1 and again["phase"]["current"]["pace"]["weigh_ins"] == 2
    assert plain == again
    assert len(plain_reads) > len(set(plain_reads))  # 範囲がなければ同じ種類を何度も読む


def test_期間の材料は31日まで(server):
    async def body(client):
        return (await client.call_tool("period_overview", {"start": "2026-10-08", "end": "2026-11-08"}),
                await client.call_tool("period_overview", {"start": "2026-11-08", "end": "2026-11-07"}),
                data(await client.call_tool("period_overview", {"start": "2026-10-09", "end": "2026-11-08"})))

    too_long, reversed_, month = run(server, ALL_SCOPES, body)
    assert too_long.is_error and "31日" in too_long.content[0].text
    assert reversed_.is_error and "end は start" in reversed_.content[0].text
    assert month["days"] == 31 and month["goals"]["weekly"] == {"training_days": None, "meal_days": None, "sleep_days": None}
    assert month["goals"]["goal_weight_kg"] is None and month["goals"]["meals"] is None


def test_期間の材料は_筋トレの_scope_がなければ断る(server):
    async def body(client):
        return await client.call_tool("period_overview", {})

    result = run(server, MEAL_SCOPES, body)
    assert result.is_error and "training:read" in result.content[0].text


def test_筋トレの_scope_がない今のコネクタも_食事のツールはそのまま使え_筋トレは断られる(server):
    async def body(client):
        meal = data(await client.call_tool("record_meal", {"meal": LUNCH}))
        refused = await client.call_tool("get_workout", {})
        return meal, refused

    meal, refused = run(server, MEAL_SCOPES, body)
    assert meal["today"]["total"]["kcal"] == 312
    assert refused.is_error and "training:read" in refused.content[0].text


def test_食事の_scope_が足りなければ接続で断る(server):
    async def go():
        async with server["mcp"].session_manager.run():
            async with http(server, ["meals:read", "training:read", "training:write"]) as h:
                forbidden = await h.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
                                         headers={"Accept": "application/json, text/event-stream"})
            async with http(server, None) as h:
                unauthorized = await h.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
            return forbidden, unauthorized

    forbidden, unauthorized = anyio.run(go)
    assert forbidden.status_code == 403 and "meals:write" in forbidden.text
    assert unauthorized.status_code == 401 and "resource_metadata" in unauthorized.headers["www-authenticate"]


def test_保護されたリソースの文書には_筋トレの_scope_も並べる(server):
    async def go():
        async with http(server, None) as h:
            return (await h.get("/.well-known/oauth-protected-resource/mcp")).json()

    metadata = anyio.run(go)
    assert metadata["scopes_supported"] == ALL_SCOPES
    assert metadata["resource"] == RESOURCE and metadata["authorization_servers"] == [ISSUER]


def test_ログアウトは本人のトークンで連携を取り消し_リンクを返す(server):
    async def body(client):
        return data(await client.call_tool("logout", {}))

    result = run(server, ALL_SCOPES, body)
    assert server["session"].revoked == [("+".join(ALL_SCOPES), "c")]
    assert result["logout_url"] == "https://authz.example/logout"


def test_アイコンは認証なしで返す(server):
    async def go():
        async with http(server, None) as h:
            return await h.get("/favicon.ico")

    assert anyio.run(go).status_code == 200


@pytest.mark.parametrize("value, expected", [("3", 3), ("0", 0), ("7", 7), ("8", None), ("-1", None), ("2.5", None),
                                             ("abc", None), ("", None), (None, None)])
def test_今週の目標は0から7の整数だけを読む(server, value, expected):
    engine = server["engine"]
    app_change(engine, "setting", "weekly_goal_training_days", {"value": value})
    app_change(engine, "setting", "weeklyGoalTrainingDays", {"value": "5"})  # snake_case を先に読む
    body = main.SyncedBodyData(engine, main.create_queries(engine))
    assert anyio.run(body.weekly_goals, EaterId("alice"))["training_days"] == expected
