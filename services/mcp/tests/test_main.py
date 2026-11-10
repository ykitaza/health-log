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
            "sleep_summary", "heart_rate_summary"} <= names
    assert {"save_report", "list_reports", "get_report", "delete_report"} <= names
    assert {"logout", "period_overview", "meal_summary"} <= names
    assert len(names) == 17 + 14 + 4 + 1 + 1


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


def test_期間の材料を1回で読める_筋トレ_食事_体組成_睡眠_心拍_目標(server):
    engine = server["engine"]
    for key, value in [("goal_weight_kg", "65"), ("weekly_goal_training_days", "3"), ("weeklyGoalMealDays", "5"),
                       ("weekly_goal_sleep_days", "0"), ("rest_timer_seconds", "90")]:
        app_change(engine, "setting", key, {"value": value})
    app_change(engine, "sleep_session", "s1", {
        "date": "2026-11-03", "start_at": "2026-11-02T14:00:00.000Z", "end_at": "2026-11-02T21:30:00.000Z",
        "asleep_min": 440, "awake_min": 10, "source": "health_connect"})
    app_change(engine, "heart_rate_day", "h1", {"date": "2026-11-03", "resting_bpm": 55, "samples": 10})
    app_change(engine, "heart_rate_day", "h2", {"date": "2026-11-04", "resting_bpm": None, "samples": 0})

    async def body(client):
        data(await client.call_tool("set_goals", GOALS))
        data(await client.call_tool("record_workout", {"day": "2026-11-03", "exercises": [
            {"exercise": "ベンチプレス", "sets": [{"weight_kg": 80, "reps": 8}, {"weight_kg": 85, "reps": 3}]}]}))
        data(await client.call_tool("record_workout", {"day": "2026-11-06", "exercises": [
            {"exercise": "スクワット", "sets": [{"weight_kg": 100, "reps": 5}]}]}))
        data(await client.call_tool("record_workout", {"day": "2026-11-01", "exercises": [  # 期間の外
            {"exercise": "ベンチプレス", "sets": [{"weight_kg": 120, "reps": 1}]}]}))
        data(await client.call_tool("record_meal", {"meal": {**LUNCH, "date": "2026-11-03"}}))
        data(await client.call_tool("record_body", {"day": "2026-11-02", "weight_kg": 70.0, "body_fat_pct": 18.0,
                                                    "waist_cm": 80.0}))
        data(await client.call_tool("record_body", {"day": "2026-11-05", "weight_kg": 69.0}))
        data(await client.call_tool("record_body", {"day": "2026-11-07", "waist_cm": 79.0}))  # ウエストだけの日は出さない
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
    goals = week["goals"]
    assert goals["meals"]["policy"] == "bulk" and goals["goal_weight_kg"] == 65
    assert goals["weekly"] == {"training_days": 3, "meal_days": 5, "sleep_days": 0}
    assert week["last_app_sync_at"] is not None  # アプリから同期した記録がある


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
