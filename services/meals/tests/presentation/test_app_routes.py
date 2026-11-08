"""アプリ用の API のうち、食事の部分。同期の入口（sync）に、食事の種類とルートを登録して呼ぶ。"""

import asyncio
import json
import uuid
from datetime import date

import pytest

from application.commands import NewItem, NewMeal
from application.goals import GoalService
from application.meals import MealService
from domain.values import EatenOn, MealSlot, Nutrition, Quantity, Source, Unit
from infrastructure import sync_repositories as synced
from infrastructure.subject_as_eater_id import SubjectAsEaterId
from infrastructure.sync_entities import template_id
from presentation.app_routes import meal_routes
from sync.model import Change
from sync.presentation.http_api import SyncHttpApi
from tests.sync.conftest import REGISTRY, memory_engine

APP_CLIENT = "app-client-id"
ALL_SCOPES = "openid torelog-api/meals.read torelog-api/meals.write"
MEAL = {"date": "2026-11-08", "slot": "lunch", "time": "12:30", "description": "定食", "source": "text"}
ITEM = {"name": "白米", "amount": 200, "unit": "g", "kcal": 312, "protein_g": 5, "fat_g": 0.6, "carbs_g": 74,
        "confidence": "medium"}


@pytest.fixture
def engine():
    return memory_engine(clock=lambda: "2026-11-08T10:00:00.000Z")


@pytest.fixture
def api(engine):
    goals = GoalService(SubjectAsEaterId(), synced.SyncGoalRepository(engine), synced.SyncDayTypeRepository(engine))
    app = SyncHttpApi(engine, REGISTRY, APP_CLIENT, routes=meal_routes(goals))

    def call(method, path, body=None, query=None, sub="alice", scope=ALL_SCOPES):
        claims = {"sub": sub, "scope": scope, "client_id": APP_CLIENT, "token_use": "access"}
        event = {"rawPath": path, "requestContext": {"http": {"method": method}, "authorizer": {"jwt": {"claims": claims}}},
                 "queryStringParameters": query, "body": json.dumps(body) if body is not None else None}
        res = app.handle(event)
        return res["statusCode"], json.loads(res["body"]), res["headers"]["content-type"]

    return call


def change(entity_type, entity_id, op="create", fields=None, **extra):
    c = {"change_id": str(uuid.uuid4()), "entity_type": entity_type, "entity_id": entity_id, "op": op,
         "changed_at": "2026-11-08T09:00:00.000Z", **extra}
    if fields is not None:
        c["fields"] = fields
    return c


def push(api, *changes, **kwargs):
    return api("POST", "/v1/sync/changes", {"device_id": "pixel", "changes": list(changes)}, **kwargs)


# --- 食事の種類の決まり ---

def test_食事と品目を送れる(api):
    _, body, _ = push(api, change("meal", "m1", fields=MEAL),
                      change("meal_item", "rice", fields={**ITEM, "sort_order": 0}, parent_id="m1"))
    assert [r["status"] for r in body["results"]] == ["accepted", "accepted"]


@pytest.mark.parametrize("bad", [
    change("meal_item", "rice", fields={**ITEM, "sort_order": 0}),  # parent_id がない
    change("meal_item", "rice", fields={**ITEM, "unit": "kg", "sort_order": 0}, parent_id="m1"),  # 単位
    change("meal", "m1", fields={**MEAL, "time": "25:00"}),
    change("meal", "m1", fields={**MEAL, "slot": None}),
    change("nutrition_goal", "other", fields={"policy": "bulk"}),  # ID は current だけ
    change("day_type", "2026-13-01", fields={"day_type": "rest"}),  # ID は日付
    change("meal_template", str(uuid.uuid4()), fields={"name": "いつもの昼", "items": [ITEM]}),  # ID は名前から
    change("nutrition_goal", "current", fields={"policy": "bulk", "targets": {"training_day": {"kcal": 2800, "fat_g": 70, "carbs_g": 380}}}),
])
def test_食事の決まりに合わない変更は断る(api, bad):
    assert push(api, bad)[1]["results"][0]["status"] == "rejected"


def test_いつものの_ID_は名前から決めたものなら受け付ける(api):
    _, body, _ = push(api, change("meal_template", template_id("いつもの昼"), fields={"name": "いつもの昼", "items": [ITEM]}))
    assert body["results"][0]["status"] == "accepted"


def test_食事の_scope_だけでは_筋トレの種類は知らない種類として断る(api):
    _, body, _ = push(api, change("workout_set", "s1", fields={"reps": 1}))
    assert body["results"][0]["error"]["code"] == "invalid_fields"  # この組み立てには食事の種類しか登録していない


def test_読む_scope_しかなければ書けない(api):
    _, body, _ = push(api, change("meal", "m1", fields=MEAL), scope="torelog-api/meals.read")
    assert body["results"][0]["error"]["code"] == "insufficient_scope"


# --- MCP との行き来 ---

def test_MCP_で記録した食事を_同期で受け取れる(api, engine):
    meals = MealService(SubjectAsEaterId(), synced.SyncMealRepository(engine))
    rice = NewItem("白米", Quantity(200, Unit.GRAM), Nutrition(312, 5, 0.6, 74))
    meal = asyncio.run(meals.record("alice", NewMeal(EatenOn(date(2026, 11, 8), MealSlot.LUNCH), (rice,), "白米", Source.TEXT)))
    _, page, _ = api("GET", "/v1/sync/changes", sub="alice")
    assert [(e["change"]["entity_type"], e["change"]["origin"]) for e in page["entries"]] == [
        ("meal", "mcp"), ("meal_item", "mcp")]
    assert page["entries"][0]["state"]["entity_id"] == meal.id
    assert page["entries"][1]["state"]["parent_id"] == meal.id
    assert api("GET", "/v1/sync/changes", sub="bob")[1]["entries"] == []


def test_アプリで変えた量が_MCP_に見える(api, engine):
    meals = MealService(SubjectAsEaterId(), synced.SyncMealRepository(engine))
    rice = NewItem("白米", Quantity(200, Unit.GRAM), Nutrition(312, 5, 0.6, 74))
    meal = asyncio.run(meals.record("alice", NewMeal(EatenOn(date(2026, 11, 8), MealSlot.LUNCH), (rice,), "白米", Source.TEXT)))
    later = {"change_id": str(uuid.uuid4()), "entity_type": "meal_item", "entity_id": meal.items[0].id,
             "parent_id": meal.id, "op": "update", "fields": {"amount": 100, "kcal": 156},
             "changed_at": "2026-11-08T10:00:00.000Z"}
    assert push(api, later)[1]["results"][0]["status"] == "accepted"
    again = asyncio.run(meals.get("alice", meal.id))
    assert (again.items[0].quantity.amount, again.items[0].nutrition.kcal) == (100, 156)
    asyncio.run(meals.delete("alice", meal.id))
    _, page, _ = api("GET", "/v1/sync/changes", query={"after": "3"})
    assert page["entries"][0]["state"]["deleted"] is True


# --- 目標の案 ---

def test_目標の案を計算する_保存はしない(api, engine):
    body = {"policy": "bulk", "pace_kg_per_week": 0.25, "sex": "male", "age": 30, "height_cm": 172,
            "weight_kg": 67, "daily_activity": "low", "training_minutes": 60}
    status, result, _ = api("POST", "/v1/meals/goal-suggestions", body)
    assert status == 200 and result["goal"]["targets"]["rest_day"]["kcal"] == 2200
    assert result["used"]["age"] == 30
    assert engine.head("alice") == 0


def test_目標の案の形は_同期の目標の項目と同じ(api):
    # アプリは、案をそのまま nutrition_goal の fields として送れる（docs/api/app-api.yaml の NutritionGoalFields）
    _, result, _ = api("POST", "/v1/meals/goal-suggestions", {"policy": "maintain", "eating_style": "eating_out"})
    assert result["goal"] == {"policy": "maintain", "body_weight_kg": None, "protein_per_kg": None, "targets": None,
                              "eating_style": "eating_out", "target_weight_kg": None}
    body = {"policy": "cut", "pace_kg_per_week": 0.5, "sex": "female", "age": 40, "height_cm": 160,
            "weight_kg": 60, "daily_activity": "moderate", "training_minutes": 30, "target_weight_kg": 55}
    goal = api("POST", "/v1/meals/goal-suggestions", body)[1]["goal"]
    assert set(goal) == {"policy", "body_weight_kg", "protein_per_kg", "targets", "eating_style", "target_weight_kg"}
    assert set(goal["targets"]) == {"training_day", "rest_day"}
    assert set(goal["targets"]["rest_day"]) == {"kcal", "fat_g", "carbs_g"}
    fields = {"change_id": "0b8f0c39-5f8e-4b0a-9a39-2a0c3f0e7a11", "entity_type": "nutrition_goal",
              "entity_id": "current", "op": "create", "fields": goal, "changed_at": "2026-10-12T00:00:00Z"}
    assert isinstance(REGISTRY.parse_change(fields, set(REGISTRY.specs), None), Change)


@pytest.mark.parametrize("body,status", [
    ({"policy": "gain"}, 400), ({"policy": "bulk", "age": "30"}, 400), ({"policy": "bulk", "extra": 1}, 400),
    ({"policy": "maintain", "pace_kg_per_week": 0.5}, 422), ({"policy": "bulk", "pace_kg_per_week": 0.25, "age": 5}, 422),
    ({"policy": "bulk"}, 422),  # 増量なのにペースがない
])
def test_目標の案の不正な入力(api, body, status):
    code, problem, content_type = api("POST", "/v1/meals/goal-suggestions", body)
    assert code == status and content_type == "application/problem+json"
