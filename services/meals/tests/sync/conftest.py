"""食事の対象を登録した同期の仕組みと、CDK と同じ形の DynamoDB のテーブル（moto）。"""

import boto3
import pytest
from moto import mock_aws

from infrastructure.sync_entities import register
from sync.engine import SyncEngine
from sync.registry import Registry
from sync.store import BY_DAY_INDEX, DynamoDBSyncStore, InMemorySyncStore

TABLE = "meals-test"
REGISTRY = Registry()
register(REGISTRY)


def memory_engine(clock=None) -> SyncEngine:
    store = InMemorySyncStore(REGISTRY.index_key)
    return SyncEngine(store, REGISTRY, clock=clock) if clock else SyncEngine(store, REGISTRY)


def dynamodb_engine() -> SyncEngine:
    return SyncEngine(DynamoDBSyncStore(TABLE, REGISTRY.index_key), REGISTRY)


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
def sync_engine(request):
    if request.param == "memory":
        yield memory_engine()
        return
    request.getfixturevalue("dynamodb_table")
    yield dynamodb_engine()
