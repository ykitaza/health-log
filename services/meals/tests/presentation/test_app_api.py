"""アプリ用の API の入口。API Gateway（HTTP API、形式 2.0）のイベントを作って呼ぶ。"""

import asyncio
import base64
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
from presentation.app_api import AppApi
from sync.engine import SyncEngine
from sync.store import InMemorySyncStore

APP_CLIENT = "app-client-id"
ALL_SCOPES = "openid torelog-api/meals.read torelog-api/meals.write torelog-api/training.read torelog-api/training.write"
SET = {"entry_id": "e1", "set_index": 0, "weight_kg": 60, "reps": 10, "memo": "", "done": False}
MEAL = {"date": "2026-11-08", "slot": "lunch", "time": "12:30", "description": "定食", "source": "text"}


@pytest.fixture
def engine():
    return SyncEngine(InMemorySyncStore(), clock=lambda: "2026-11-08T10:00:00.000Z")


@pytest.fixture
def api(engine):
    goals = GoalService(SubjectAsEaterId(), synced.SyncGoalRepository(engine), synced.SyncDayTypeRepository(engine))
    app = AppApi(engine, goals, APP_CLIENT)

    def call(method, path, body=None, query=None, sub="alice", scope=ALL_SCOPES, claims=None, raw_body=None):
        if claims is None:
            claims = {"sub": sub, "scope": scope, "client_id": APP_CLIENT, "token_use": "access"}
        event = {
            "rawPath": path,
            "requestContext": {"http": {"method": method}, "authorizer": {"jwt": {"claims": claims}}},
            "queryStringParameters": query,
            "body": raw_body if raw_body is not None else (json.dumps(body) if body is not None else None),
        }
        res = app.handle(event)
        return res["statusCode"], json.loads(res["body"]), res["headers"]["content-type"]

    return call


def change(entity_type="workout_set", entity_id="s1", op="create", fields=SET, **extra):
    c = {"change_id": str(uuid.uuid4()), "entity_type": entity_type, "entity_id": entity_id, "op": op,
         "changed_at": "2026-11-08T09:00:00.000Z", **extra}
    if fields is not None and op in ("create", "update"):
        c["fields"] = fields
    return c


def push(api, *changes, **kwargs):
    return api("POST", "/v1/sync/changes", {"device_id": "pixel", "changes": list(changes)}, **kwargs)


# --- 正常 ---

def test_送った変更を受け取れる(api):
    status, body, _ = push(api, change(), change("meal", "m1", fields=MEAL))
    assert status == 200 and [r["status"] for r in body["results"]] == ["accepted", "accepted"]
    assert body["cursor"] == 2
    status, page, _ = api("GET", "/v1/sync/changes", query={"after": "0"})
    assert status == 200 and not page["has_more"] and page["next_cursor"] == 2
    first = page["entries"][0]
    assert first["change"]["origin"] == "app" and first["change"]["device_id"] == "pixel"
    assert first["state"]["fields"]["reps"] == 10 and first["state"]["deleted"] is False


def test_同じ本文を送り直しても1回分(api):
    body = [change()]
    push(api, *body)
    status, again, _ = push(api, *body)
    assert again["results"][0]["status"] == "duplicate" and again["results"][0]["seq"] == 1
    assert len(api("GET", "/v1/sync/changes")[1]["entries"]) == 1


def test_カーソルのページ送り(api):
    push(api, *[change(entity_id=f"s{n}") for n in range(5)])
    _, page, _ = api("GET", "/v1/sync/changes", query={"after": "0", "limit": "2"})
    assert [e["change"]["seq"] for e in page["entries"]] == [1, 2] and page["has_more"]
    _, page, _ = api("GET", "/v1/sync/changes", query={"after": str(page["next_cursor"]), "limit": "2"})
    assert [e["change"]["seq"] for e in page["entries"]] == [3, 4]


def test_スナップショットのページ送り(api):
    push(api, *[change(entity_id=f"s{n}") for n in range(3)])
    push(api, change(entity_id="s1", op="delete"))
    _, first, _ = api("GET", "/v1/sync/snapshot", query={"limit": "2"})
    assert first["cursor"] == 4 and first["next_page_token"]
    _, second, _ = api("GET", "/v1/sync/snapshot", query={"limit": "2", "page_token": first["next_page_token"]})
    states = first["states"] + second["states"]
    assert second["next_page_token"] is None
    assert {s["entity_id"]: s["deleted"] for s in states} == {"s0": False, "s1": True, "s2": False}


def test_品目は_parent_id_つきで受け取れる(api):
    item = {"name": "白米", "amount": 200, "unit": "g", "kcal": 312, "protein_g": 5, "fat_g": 0.6, "carbs_g": 74,
            "confidence": "medium", "sort_order": 0}
    push(api, change("meal", "m1", fields=MEAL), change("meal_item", "rice", fields=item, parent_id="m1"))
    _, snap, _ = api("GET", "/v1/sync/snapshot")
    assert [(s["entity_type"], s["parent_id"]) for s in snap["states"]] == [("meal", None), ("meal_item", "m1")]


# --- 不正な入力 ---

@pytest.mark.parametrize("bad,code", [
    ({"fields": {**SET, "reps": "10"}}, "invalid_fields"),  # 型
    ({"fields": {**SET, "reps": -1}}, "invalid_fields"),  # 範囲
    ({"fields": {**SET, "weight": 60}}, "invalid_fields"),  # 知らない項目
    ({"fields": {**SET, "done": 1}}, "invalid_fields"),  # 真偽値に数
    ({"fields": {"set_index": 0}}, "missing_fields"),  # create に要る項目がない
    ({"entity_type": "workout"}, "invalid_fields"),  # 知らない種類
    ({"op": "upsert"}, "invalid_fields"),
    ({"changed_at": "2026-11-08T09:00:00"}, "invalid_fields"),  # 時差がない
    ({"origin": "mcp"}, "invalid_fields"),  # アプリは mcp を名乗れない
    ({"parent_id": "m1"}, "parent_id_not_allowed"),
    ({"entity_id": "../x"}, "invalid_fields"),
    ({"extra": 1}, "invalid_fields"),
])
def test_不正な変更はその変更だけ断る(api, bad, code):
    status, body, _ = push(api, {**change(entity_id="bad"), **bad}, change(entity_id="good"))
    assert status == 200
    assert body["results"][0]["status"] == "rejected" and body["results"][0]["error"]["code"] == code
    assert body["results"][1]["status"] == "accepted"
    _, snap, _ = api("GET", "/v1/sync/snapshot")
    assert [s["entity_id"] for s in snap["states"]] == ["good"]


def test_項目の誤りは場所つきで返す(api):
    _, body, _ = push(api, change(fields={**SET, "reps": -1}))
    assert body["results"][0]["error"]["errors"][0]["field"] == "changes[0].fields.reps"


def test_品目に_parent_id_がないと断る_null_にできない項目に_null_も断る(api):
    item = {"name": "白米"}
    _, body, _ = push(api, change("meal_item", "rice", op="update", fields=item),
                      change("meal", "m1", op="update", fields={"slot": None}))
    assert [r["error"]["code"] for r in body["results"]] == ["missing_parent_id", "invalid_fields"]


def test_目標と日の種類の_ID_は決まった形だけ(api):
    _, body, _ = push(api, change("nutrition_goal", "other", fields={"policy": "bulk"}),
                      change("day_type", "2026-13-01", fields={"day_type": "rest"}),
                      change("day_type", "2026-11-08", fields={"day_type": "rest"}))
    assert [r["status"] for r in body["results"]] == ["rejected", "rejected", "accepted"]


def test_いつものの_ID_は名前から決めたものだけ(api):
    from sync.entities import template_id

    item = {"name": "白米", "amount": 200, "unit": "g", "kcal": 312, "protein_g": 5, "fat_g": 0.6, "carbs_g": 74,
            "confidence": "medium"}
    fields = {"name": "いつもの昼", "items": [item]}
    _, body, _ = push(api, change("meal_template", str(uuid.uuid4()), fields=fields),
                      change("meal_template", template_id("いつもの昼"), fields=fields))
    assert [r["status"] for r in body["results"]] == ["rejected", "accepted"]


def test_削除に_fields_は入れない(api):
    _, body, _ = push(api, {**change(op="delete", fields=None), "fields": SET})
    assert body["results"][0]["error"]["code"] == "fields_not_allowed"


@pytest.mark.parametrize("body", [
    {"device_id": "pixel"},
    {"device_id": "", "changes": [change()]},
    {"device_id": "pixel", "changes": []},
    {"device_id": "pixel", "changes": [change(entity_id=f"s{n}") for n in range(26)]},
    {"device_id": "pixel", "changes": [{**change(), "change_id": "not-a-uuid"}]},
    {"device_id": "pixel", "changes": ["x"]},
    {"device_id": "pixel", "changes": [change()], "user": "bob"},  # 利用者は本文で決めない
])
def test_本文の形が違えば_400_で1件も受け付けない(api, body):
    status, problem, content_type = api("POST", "/v1/sync/changes", body)
    assert status == 400 and content_type == "application/problem+json" and problem["status"] == 400
    assert api("GET", "/v1/sync/changes")[1]["entries"] == []


def test_同じ_change_id_が2回あれば_400(api):
    c = change()
    assert push(api, c, c)[0] == 400


@pytest.mark.parametrize("raw", ["not json", '{"device_id": "p", "changes": [NaN]}'])
def test_JSON_でなければ_400(api, raw):
    assert api("POST", "/v1/sync/changes", raw_body=raw)[0] == 400


@pytest.mark.parametrize("query", [{"after": "-1"}, {"after": "x"}, {"limit": "0"}, {"limit": "501"}])
def test_カーソルと件数が範囲の外なら_400(api, query):
    assert api("GET", "/v1/sync/changes", query=query)[0] == 400


@pytest.mark.parametrize("token", ["!!!", base64.urlsafe_b64encode(b'{"after": "SYNC#LOG#1"}').decode(),
                                   base64.urlsafe_b64encode(b"[]").decode()])
def test_壊れた_page_token_は_400(api, token):
    assert api("GET", "/v1/sync/snapshot", query={"page_token": token})[0] == 400


def test_ないパスは_404(api):
    assert api("GET", "/v1/sync/unknown")[0] == 404


# --- 利用者と scope ---

def test_ほかの人のデータは見えない_同じ_ID_を送っても別のもの(api):
    push(api, change(), sub="alice")
    assert api("GET", "/v1/sync/changes", sub="bob")[1]["entries"] == []
    assert api("GET", "/v1/sync/snapshot", sub="bob")[1]["states"] == []
    push(api, change(op="update", fields={"reps": 1}), sub="bob")  # bob の s1 は alice の s1 と別
    _, alice, _ = api("GET", "/v1/sync/snapshot", sub="alice")
    assert alice["states"][0]["fields"]["reps"] == 10


def test_ほかの人の_page_token_を使っても自分の分しか読めない(api):
    push(api, *[change(entity_id=f"s{n}") for n in range(3)], sub="alice")
    _, first, _ = api("GET", "/v1/sync/snapshot", query={"limit": "1"}, sub="alice")
    _, bob, _ = api("GET", "/v1/sync/snapshot", query={"page_token": first["next_page_token"]}, sub="bob")
    assert bob["states"] == []


@pytest.mark.parametrize("claims", [
    {},  # オーソライザーを通っていない（設定の誤り）
    {"scope": ALL_SCOPES, "client_id": APP_CLIENT, "token_use": "access"},  # sub がない
    {"sub": "alice", "client_id": APP_CLIENT, "token_use": "id"},  # ID トークン
    {"sub": "alice", "scope": ALL_SCOPES, "client_id": "authz-api-client", "token_use": "access"},  # 別のクライアント
])
def test_クレームがない_または別のトークンなら_401(api, claims):
    status, problem, _ = api("GET", "/v1/sync/changes", claims=claims)
    assert status == 401 and problem["status"] == 401


def test_書く_scope_がない種類は断る(api):
    status, body, _ = push(api, change(), change("meal", "m1", fields=MEAL),
                           scope="torelog-api/meals.write")
    assert [r["status"] for r in body["results"]] == ["rejected", "accepted"]
    assert body["results"][0]["error"]["code"] == "insufficient_scope"


def test_読む_scope_がない種類は受け取らない(api):
    push(api, change(), change("meal", "m1", fields=MEAL))
    _, page, _ = api("GET", "/v1/sync/changes", scope="torelog-api/meals.read")
    assert [e["change"]["entity_type"] for e in page["entries"]] == ["meal"] and page["next_cursor"] == 2
    _, snap, _ = api("GET", "/v1/sync/snapshot", scope="torelog-api/training.read")
    assert [s["entity_type"] for s in snap["states"]] == ["workout_set"]


def test_別のリソースサーバーの_scope_は数えない(api):
    _, body, _ = push(api, change(), scope="other-api/training.write training.write")
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


@pytest.mark.parametrize("body,status", [
    ({"policy": "gain"}, 400), ({"policy": "bulk", "age": "30"}, 400), ({"policy": "bulk", "extra": 1}, 400),
    ({"policy": "maintain", "pace_kg_per_week": 0.5}, 422), ({"policy": "bulk", "pace_kg_per_week": 0.25, "age": 5}, 422),
    ({"policy": "bulk"}, 422),  # 増量なのにペースがない
])
def test_目標の案の不正な入力(api, body, status):
    code, problem, content_type = api("POST", "/v1/meals/goal-suggestions", body)
    assert code == status and content_type == "application/problem+json"
