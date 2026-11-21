"""アプリで食事を同じ日の別の区分へ移したときの本文（testdata/meals/app_move.json。apps/karada/db/__tests__/meals.test.ts が作る）を、
本物の同期の API（SyncHttpApi）に送り、MCP の list_meals で新しい区分に見えることを確かめる（#328）。
2回目の送信は、食事の slot だけの update。並びのキー（日付#区分の順番。DynamoDB の LSI by_day）も新しい区分に変わる。
"""

import copy
import json
import uuid
from datetime import date
from pathlib import Path

import pytest
from mcp.server.auth.provider import AccessToken
from mcp.server.mcpserver import MCPServer

from meals.application.goals import GoalService
from meals.application.meals import MealService
from meals.application.summaries import SummaryService
from meals.application.templates import TemplateService
from meals.application.weights import WeightService
from meals.infrastructure import memory_repositories as memory
from meals.infrastructure.subject_as_eater_id import SubjectAsEaterId
from meals.presentation import mcp_server
from sync.presentation.http_api import SyncHttpApi
from tests.sync.conftest import REGISTRY
from tests.sync.test_existing_suites import _caller, _repos

TESTDATA = Path(__file__).parents[4] / "testdata" / "meals"
APP_CLIENT = "app-client-id"
SCOPES = "torelog-api/meals.read torelog-api/meals.write"


def _app_api(engine):
    api = SyncHttpApi(engine, REGISTRY, APP_CLIENT)

    def call(body):
        claims = {"sub": "alice", "scope": SCOPES, "client_id": APP_CLIENT, "token_use": "access"}
        res = api.handle({
            "rawPath": "/v1/sync/changes", "queryStringParameters": None, "body": json.dumps(body),
            "requestContext": {"http": {"method": "POST"}, "authorizer": {"jwt": {"claims": claims}}},
        })
        return res["statusCode"], json.loads(res["body"])

    return call


def _tool(monkeypatch, engine):
    token = AccessToken(token="t", client_id="c", scopes=["meals:read", "meals:write"], subject="alice")
    monkeypatch.setattr(mcp_server, "get_access_token", lambda: token)
    meals, templates, goals, day_types = _repos(engine)
    eaters = SubjectAsEaterId()
    services = mcp_server.Services(
        MealService(eaters, meals), TemplateService(eaters, meals, templates), GoalService(eaters, goals, day_types, memory.InMemoryBodyData()),
        SummaryService(eaters, meals, goals, day_types), WeightService(eaters, memory.InMemoryWeightRepository(), goals))
    mcp = MCPServer(name="test")
    mcp_server.register_meal_tools(mcp, services, today=lambda: date(2026, 11, 8))
    return _caller(mcp, None)


def _bodies():
    bodies = []
    for push in json.loads((TESTDATA / "app_move.json").read_text())["pushes"]:
        body = copy.deepcopy(push)
        body["device_id"] = "device-1"
        for change in body["changes"]:
            change["change_id"] = str(uuid.uuid4())
        bodies.append(body)
    return bodies


def test_本文の2回目は食事の区分だけの_update():
    first, moved = json.loads((TESTDATA / "app_move.json").read_text())["pushes"]
    assert [(c["entity_type"], c["op"]) for c in first["changes"]] == [("meal", "create"), ("meal_item", "create"), ("meal_item", "create")]
    assert [(c["entity_type"], c["op"], c["fields"]) for c in moved["changes"]] == [("meal", "update", {"slot": "snack"})]


def test_アプリで別の区分へ移した食事が_MCP_で新しい区分に見える(monkeypatch, sync_engine):
    app_api, tool = _app_api(sync_engine), _tool(monkeypatch, sync_engine)
    first, moved = _bodies()

    status, res = app_api(first)
    assert status == 200 and [r["status"] for r in res["results"]] == ["accepted"] * 3, res
    meals = tool("list_meals", start="2026-11-08", end="2026-11-08")["meals"]
    assert [(m["slot"], [i["name"] for i in m["items"]]) for m in meals] == [("dinner", ["白米", "鶏むね肉"])]

    status, res = app_api(moved)
    assert status == 200 and [r["status"] for r in res["results"]] == ["accepted"], res
    meals = tool("list_meals", start="2026-11-08", end="2026-11-08")["meals"]
    # 品目と日付はそのまま、区分だけが間食に変わる。期間で探しても1件（前の区分に残らない）
    assert [(m["date"], m["slot"], [i["name"] for i in m["items"]]) for m in meals] == [("2026-11-08", "snack", ["白米", "鶏むね肉"])]


@pytest.mark.parametrize("slot", ["breakfast", "lunch", "dinner"])
def test_元に戻す_区分だけの_update_をもう一度送ると元の区分に戻る(monkeypatch, sync_engine, slot):
    app_api, tool = _app_api(sync_engine), _tool(monkeypatch, sync_engine)
    first, moved = _bodies()
    app_api(first)
    app_api(moved)
    back = copy.deepcopy(moved)
    back["changes"][0].update(change_id=str(uuid.uuid4()), changed_at="2026-11-08T03:02:00.000Z", fields={"slot": slot})
    status, res = app_api(back)
    assert status == 200 and [r["status"] for r in res["results"]] == ["accepted"], res
    assert [m["slot"] for m in tool("list_meals", start="2026-11-08", end="2026-11-08")["meals"]] == [slot]
