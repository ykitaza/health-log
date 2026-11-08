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
from infrastructure import memory_repositories as memory
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
    mcp = main.create_server(engine, memory.InMemoryWeightRepository(), FakeVerifier(), ISSUER, RESOURCE, session,
                             today=lambda: date(2026, 11, 8))
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


def test_食事と筋トレとログアウトのツールが1つのサーバーにある(server):
    async def body(client):
        return {t.name for t in (await client.list_tools()).tools}

    names = run(server, ALL_SCOPES, body)
    assert {"record_meal", "today_status", "set_day_type", "weekly_review", "record_weight"} <= names
    assert {"record_workout", "get_workout", "exercise_history", "weekly_training_review", "record_body"} <= names
    assert "logout" in names
    assert len(names) == 17 + 11 + 1


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
