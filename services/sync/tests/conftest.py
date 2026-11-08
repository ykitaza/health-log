"""テスト用の種類と保存先。

sync はコンテキストのドメインを知らないので、ここでテスト用の種類を登録する（本物は各コンテキストが登録する）。
名前と項目は本物に似せてあるが、中身はこのテストだけのもの。
"""

from typing import Annotated, Literal

import boto3
import pytest
from moto import mock_aws
from pydantic import Field

from sync.fields import Day, FieldsModel, Moment, Ref
from sync.registry import EntitySpec, Registry, Rejection
from sync.store import BY_DAY_INDEX, DynamoDBSyncStore, InMemorySyncStore

TABLE = "meals-test"


class SetFields(FieldsModel):
    entry_id: Ref = None
    set_index: Annotated[int, Field(ge=0, le=1000)] = None
    weight_kg: Annotated[float, Field(gt=0, le=500)] | None = None
    reps: Annotated[int, Field(ge=0, le=10000)] = None
    memo: Annotated[str, Field(max_length=1000)] = None
    done: bool = None


class RecordFields(FieldsModel):
    date: Day = None
    measured_at: Moment = None
    weight_kg: Annotated[float, Field(ge=30, le=300)] | None = None
    source: Literal["manual", "health_connect"] = None


class MealFields(FieldsModel):
    date: Day = None
    slot: Literal["breakfast", "lunch", "dinner", "snack"] = None
    time: str | None = None
    description: str = None
    source: str = None


class ItemFields(FieldsModel):
    name: str = None
    amount: Annotated[float, Field(gt=0)] = None
    kcal: Annotated[float, Field(ge=0)] = None


class GoalFields(FieldsModel):
    policy: Literal["bulk", "maintain", "cut"] = None


def _meal_key(doc):
    v = doc.own.values if doc.own else {}
    return f"{v['date']}#{v['slot']}" if "date" in v and "slot" in v else None


def _named(entity_id, fields):
    if "name" in fields and entity_id != f"named-{fields['name']}":
        return Rejection("invalid_fields", "ID は名前から決める")
    return None


def make_registry() -> Registry:
    r = Registry()
    r.register("workout_set", EntitySpec(SetFields, ("entry_id", "set_index", "reps"), "training"))
    r.register("body_record", EntitySpec(RecordFields, ("date", "measured_at", "source"), "training"))
    r.register("meal", EntitySpec(MealFields, ("date", "slot"), "meals", index_key=_meal_key))
    r.register("meal_item", EntitySpec(ItemFields, ("name",), "meals", parent_type="meal"))
    r.register("nutrition_goal", EntitySpec(GoalFields, ("policy",), "meals", valid_id=lambda i: i == "current"))
    r.register("named", EntitySpec(ItemFields, ("name",), "meals", check=_named))
    return r


REGISTRY = make_registry()


def create_meals_table() -> None:
    """CDK の MealsTable と同じ形（pk・sk、LSI by_day）。"""
    boto3.client("dynamodb").create_table(
        TableName=TABLE,
        BillingMode="PAY_PER_REQUEST",
        AttributeDefinitions=[{"AttributeName": n, "AttributeType": "S"} for n in ("pk", "sk", "day_key")],
        KeySchema=[{"AttributeName": "pk", "KeyType": "HASH"}, {"AttributeName": "sk", "KeyType": "RANGE"}],
        LocalSecondaryIndexes=[{
            "IndexName": BY_DAY_INDEX,
            "KeySchema": [{"AttributeName": "pk", "KeyType": "HASH"}, {"AttributeName": "day_key", "KeyType": "RANGE"}],
            "Projection": {"ProjectionType": "ALL"},
        }],
    )


@pytest.fixture
def dynamodb_table(monkeypatch):
    monkeypatch.setenv("AWS_DEFAULT_REGION", "ap-northeast-1")
    with mock_aws():
        create_meals_table()
        yield TABLE


@pytest.fixture(params=["memory", "dynamodb"])
def sync_store(request):
    if request.param == "memory":
        yield InMemorySyncStore(REGISTRY.index_key)
        return
    yield DynamoDBSyncStore(request.getfixturevalue("dynamodb_table"), REGISTRY.index_key)
