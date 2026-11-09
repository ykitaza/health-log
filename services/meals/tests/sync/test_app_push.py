"""アプリが送る食事の本文（testdata/meals/app_push.json。apps/mobile/db/__tests__/meals.test.ts が作る）を、
本物の同期の API（SyncHttpApi）に送り、MCP の食事のツールから見えることを確かめる。同じ本文を2回送っても二重にならない。
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
from tests.sync.conftest import REGISTRY, memory_engine
from tests.sync.test_existing_suites import _caller, _repos

TESTDATA = Path(__file__).parents[4] / "testdata" / "meals"
APP_CLIENT = "app-client-id"
SCOPES = "torelog-api/meals.read torelog-api/meals.write"


@pytest.fixture
def engine():
    return memory_engine(clock=lambda: "2026-11-08T12:30:00.000Z")


@pytest.fixture
def app_api(engine):
    api = SyncHttpApi(engine, REGISTRY, APP_CLIENT)

    def call(method, path, body=None):
        claims = {"sub": "alice", "scope": SCOPES, "client_id": APP_CLIENT, "token_use": "access"}
        res = api.handle({
            "rawPath": path, "queryStringParameters": None, "body": json.dumps(body) if body is not None else None,
            "requestContext": {"http": {"method": method}, "authorizer": {"jwt": {"claims": claims}}},
        })
        return res["statusCode"], json.loads(res["body"])

    return call


@pytest.fixture
def tool(monkeypatch, engine):
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


def test_アプリで記録した食事が_MCP_から見える_同じ本文を2回送っても二重にならない(app_api, tool, engine):
    bodies = []
    for push in json.loads((TESTDATA / "app_push.json").read_text())["pushes"]:
        body = copy.deepcopy(push)
        body["device_id"] = "device-1"
        for change in body["changes"]:
            change["change_id"] = str(uuid.uuid4())
        bodies.append(body)
    for body in bodies:
        status, res = app_api("POST", "/v1/sync/changes", body)
        assert status == 200
        assert [r["status"] for r in res["results"]] == ["accepted"] * len(body["changes"]), res
    head = engine.head("alice")
    for body in bodies:
        _, res = app_api("POST", "/v1/sync/changes", body)
        assert [r["status"] for r in res["results"]] == ["duplicate"] * len(body["changes"])
    assert engine.head("alice") == head

    meals = tool("list_meals", start="2026-11-07", end="2026-11-08")["meals"]
    # 量を直した白米（200g → 100g）、鶏むね肉、足したみそ汁。複製は別の日の昼食に同じ品目。消した間食は出ない
    expected_items = [("白米", 100, "g", 156.0), ("鶏むね肉", 100, "g", 108.0), ("みそ汁", 1, "杯", 46.0)]
    assert [(m["date"], m["slot"], m["source"]) for m in meals] == [("2026-11-07", "lunch", "text"), ("2026-11-08", "lunch", "copy")]
    for m in meals:
        assert [(i["name"], i["amount"], i["unit"], i["kcal"]) for i in m["items"]] == expected_items
    assert meals[0]["items"][0]["item_id"] == meals[1]["items"][0]["item_id"]

    today = tool("today_status")
    assert today["day_type"] == "training"
    assert today["total"]["kcal"] == 310.0
    assert today["target"] == {"kcal": 2600.0, "protein_g": 140.0, "fat_g": 72.0, "carbs_g": 340.0}
    assert today["goal"]["policy"] == "bulk" and today["goal"]["target_weight_kg"] == 74

    # アプリで保存したいつもので、MCP から記録できる
    recorded = tool("record_template", name="昼の定番", when={"date": "2026-11-08", "slot": "dinner"})["meals"][0]
    assert [i["name"] for i in recorded["items"]] == ["白米", "鶏むね肉", "みそ汁"]
