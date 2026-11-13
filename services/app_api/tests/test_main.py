"""組み立て：食事・筋トレ・レポートの種類が登録され、scope ごとに分かれ、MCP の記録と同じ人のデータになる。"""

import asyncio
import json
import uuid
from datetime import date

import boto3
from moto import mock_aws

import main
from meals.application.commands import NewItem, NewMeal
from meals.application.meals import MealService
from meals.domain.values import EatenOn, MealSlot, Nutrition, Quantity, Source, Unit
from meals.infrastructure.subject_as_eater_id import SubjectAsEaterId
from meals.infrastructure.sync_repositories import SyncMealRepository
from sync.engine import SyncEngine
from sync.store import BY_DAY_INDEX, InMemorySyncStore

APP_CLIENT = "app-client"
MEALS = {"meal", "meal_item", "meal_template", "nutrition_goal", "day_type"}
TRAINING = {"body_part", "exercise", "workout_entry", "workout_set", "body_record", "setting", "sleep_session",
            "heart_rate_day", "step_day", "injury", "injury_review", "phase", "report"}  # レポートは筋トレの scope で扱う（reports/infrastructure/sync_entities.py）


def event(method, path, sub="cognito-sub-1", scope="torelog-api/meals.read torelog-api/meals.write "
          "torelog-api/training.read torelog-api/training.write", body=None):
    return {"rawPath": path, "requestContext": {"http": {"method": method}, "authorizer": {"jwt": {"claims": {
        "sub": sub, "scope": scope, "client_id": APP_CLIENT, "token_use": "access"}}}},
        "body": json.dumps(body) if body is not None else None}


def test_食事と筋トレとレポートの種類を登録し_scope_で分ける():
    registry = main.create_registry()
    assert registry.types_in({"meals"}) == MEALS and registry.types_in({"training"}) == TRAINING


def test_MCP_で記録した人と_アプリの人は_同じ_sub_なら同じデータ():
    registry = main.create_registry()
    engine = SyncEngine(InMemorySyncStore(registry.index_key), registry)
    api = main.create_api(engine, APP_CLIENT)
    # MCP の本人は、認可API のアクセストークンの sub（＝ Cognito の sub。services/authorization のテストで確かめている）
    meals = MealService(SubjectAsEaterId(), SyncMealRepository(engine))
    rice = NewItem("白米", Quantity(200, Unit.GRAM), Nutrition(312, 5, 0.6, 74))
    asyncio.run(meals.record("cognito-sub-1", NewMeal(EatenOn(date(2026, 11, 8), MealSlot.LUNCH), (rice,), "白米", Source.TEXT)))
    mine = json.loads(api.handle(event("GET", "/v1/sync/snapshot"))["body"])["states"]
    other = json.loads(api.handle(event("GET", "/v1/sync/snapshot", sub="cognito-sub-2"))["body"])["states"]
    assert {s["entity_type"] for s in mine} == {"meal", "meal_item"} and other == []
    # 食事の scope だけなら、筋トレの記録は書けず、食事の記録だけが読める
    push = {"device_id": "pixel", "changes": [{"change_id": str(uuid.uuid4()), "entity_type": "setting",
                                               "entity_id": "weight_unit", "op": "create", "fields": {"value": "kg"},
                                               "changed_at": "2026-11-08T09:00:00Z"}]}
    res = json.loads(api.handle(event("POST", "/v1/sync/changes", scope="torelog-api/meals.write", body=push))["body"])
    assert res["results"][0]["error"]["code"] == "insufficient_scope"
    res = json.loads(api.handle(event("POST", "/v1/sync/changes", scope="torelog-api/training.write", body=push))["body"])
    assert res["results"][0]["status"] == "accepted"
    meals_only = json.loads(api.handle(event("GET", "/v1/sync/snapshot", scope="torelog-api/meals.read"))["body"])
    assert {s["entity_type"] for s in meals_only["states"]} == {"meal", "meal_item"}


def test_レポートはアプリから消せて_次の一歩のチェックだけ書ける_作ったり書き換えたりするのは断る():
    registry = main.create_registry()
    engine = SyncEngine(InMemorySyncStore(registry.index_key), registry)
    api = main.create_api(engine, APP_CLIENT)
    report_id = str(uuid.uuid4())

    def push(op, fields=None):
        change = {"change_id": str(uuid.uuid4()), "entity_type": "report", "entity_id": report_id, "op": op,
                  "changed_at": "2026-11-09T09:00:00Z", **({"fields": fields} if fields else {})}
        res = api.handle(event("POST", "/v1/sync/changes", body={"device_id": "pixel", "changes": [change]}))
        return json.loads(res["body"])["results"][0]

    created = push("create", {"title": "偽のレポート", "body": "x", "kind": "other"})
    assert (created["status"], created["error"]["code"]) == ("rejected", "op_not_allowed")
    assert push("update", {"title": "書き換え"})["error"]["code"] == "op_not_allowed"
    assert push("update", {"next_steps_done": [0]})["status"] == "accepted"
    assert push("delete")["status"] == "accepted"


def test_目標の案は_同期した体組成と設定から_アプリと同じ式で計算する():
    registry = main.create_registry()
    api = main.create_api(SyncEngine(InMemorySyncStore(registry.index_key), registry), APP_CLIENT,
                          today=lambda: date(2026, 11, 9))

    def change(entity_type, entity_id, fields):
        return {"change_id": str(uuid.uuid4()), "entity_type": entity_type, "entity_id": entity_id, "op": "create",
                "fields": fields, "changed_at": "2026-11-08T09:00:00Z"}

    record = {"date": "2026-11-08", "measured_at": "2026-11-08T07:00:00+09:00", "weight_kg": 80.0}
    push = {"device_id": "pixel", "changes": [
        change("body_record", str(uuid.uuid4()), {**record, "body_fat_pct": 20.0, "source": "health_connect"}),
        change("body_record", str(uuid.uuid4()), {**record, "source": "manual"}),  # 手入力の体重 ＋ 取り込みの体脂肪率
        change("setting", "height_cm", {"value": "175"}), change("setting", "goal_weight_kg", {"value": "72"}),
        change("setting", "activity_level", {"value": "moderate"})]}
    results = json.loads(api.handle(event("POST", "/v1/sync/changes", body=push))["body"])["results"]
    assert {r["status"] for r in results} == {"accepted"}
    res = api.handle(event("POST", "/v1/meals/goal-suggestions", body={}))
    result = json.loads(res["body"])
    assert res["statusCode"] == 200 and result["status"] == "ok"
    assert result["goal"]["targets"]["rest_day"] == {"kcal": 2300, "fat_g": 64, "carbs_g": 271}
    assert result["basis"]["activity"]["factor"] == 1.55 and result["basis"]["target_weight_kg"] == 72


def test_設定の値が数でないか知らない活動の量なら_ないものとして足りないと返す():
    registry = main.create_registry()
    api = main.create_api(SyncEngine(InMemorySyncStore(registry.index_key), registry), APP_CLIENT,
                          today=lambda: date(2026, 11, 9))
    changes = [{"change_id": str(uuid.uuid4()), "entity_type": t, "entity_id": i, "op": "create", "fields": f,
                "changed_at": "2026-11-08T09:00:00Z"} for t, i, f in [
        ("body_record", str(uuid.uuid4()), {"date": "2026-11-09", "measured_at": "2026-11-09T07:00:00+09:00",
                                            "weight_kg": 70.0, "source": "manual"}),
        ("setting", "height_cm", {"value": "abc"}), ("setting", "activity_level", {"value": "athlete"})]]
    api.handle(event("POST", "/v1/sync/changes", body={"device_id": "pixel", "changes": changes}))
    result = json.loads(api.handle(event("POST", "/v1/meals/goal-suggestions",
                                         body={"sex": "male", "birth_year": 1990}))["body"])
    assert [m["item"] for m in result["missing"]] == ["height", "activity"]


def test_Lambda_のハンドラーは環境変数のテーブルを使う(monkeypatch):
    monkeypatch.setenv("AWS_DEFAULT_REGION", "ap-northeast-1")
    monkeypatch.setenv("MEALS_TABLE", "meals")
    monkeypatch.setenv("APP_CLIENT_ID", APP_CLIENT)
    monkeypatch.setattr(main, "_api", None)
    with mock_aws():
        boto3.client("dynamodb").create_table(
            TableName="meals", BillingMode="PAY_PER_REQUEST",
            AttributeDefinitions=[{"AttributeName": n, "AttributeType": "S"} for n in ("pk", "sk", "day_key")],
            KeySchema=[{"AttributeName": "pk", "KeyType": "HASH"}, {"AttributeName": "sk", "KeyType": "RANGE"}],
            LocalSecondaryIndexes=[{"IndexName": BY_DAY_INDEX, "KeySchema": [
                {"AttributeName": "pk", "KeyType": "HASH"}, {"AttributeName": "day_key", "KeyType": "RANGE"}],
                "Projection": {"ProjectionType": "ALL"}}])
        res = main.handler(event("GET", "/v1/sync/changes"), None)
    assert res["statusCode"] == 200 and json.loads(res["body"])["entries"] == []
