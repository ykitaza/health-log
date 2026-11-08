"""組み立て：食事と筋トレの両方の種類が登録され、scope ごとに分かれ、MCP の記録と同じ人のデータになる。"""

import asyncio
import json
import uuid
from datetime import date

import boto3
from moto import mock_aws

import main
from application.commands import NewItem, NewMeal
from application.meals import MealService
from domain.values import EatenOn, MealSlot, Nutrition, Quantity, Source, Unit
from infrastructure.subject_as_eater_id import SubjectAsEaterId
from infrastructure.sync_repositories import SyncMealRepository
from sync.engine import SyncEngine
from sync.store import BY_DAY_INDEX, InMemorySyncStore

APP_CLIENT = "app-client"
MEALS = {"meal", "meal_item", "meal_template", "nutrition_goal", "day_type"}
TRAINING = {"body_part", "exercise", "workout_entry", "workout_set", "body_record", "setting"}


def event(method, path, sub="cognito-sub-1", scope="torelog-api/meals.read torelog-api/meals.write "
          "torelog-api/training.read torelog-api/training.write", body=None):
    return {"rawPath": path, "requestContext": {"http": {"method": method}, "authorizer": {"jwt": {"claims": {
        "sub": sub, "scope": scope, "client_id": APP_CLIENT, "token_use": "access"}}}},
        "body": json.dumps(body) if body is not None else None}


def test_食事と筋トレの種類を登録し_scope_で分ける():
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


def test_目標の案のルートもある():
    registry = main.create_registry()
    api = main.create_api(SyncEngine(InMemorySyncStore(registry.index_key), registry), APP_CLIENT)
    res = api.handle(event("POST", "/v1/meals/goal-suggestions", body={"policy": "maintain"}))
    assert res["statusCode"] == 200


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
