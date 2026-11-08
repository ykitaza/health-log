import boto3
import pytest
from moto import mock_aws

from sync.store import BY_DAY_INDEX, DynamoDBSyncStore, InMemorySyncStore

TABLE = "meals-test"


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
        yield InMemorySyncStore()
        return
    yield DynamoDBSyncStore(request.getfixturevalue("dynamodb_table"))
