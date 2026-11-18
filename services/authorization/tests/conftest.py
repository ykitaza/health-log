"""テストで使う保存先。DynamoDB は moto（ほかのサービスのテストと同じ）。"""

import boto3
import pytest
from moto import mock_aws

from infrastructure.stores import DynamoDBStore

TABLE = "authz-state-test"


@pytest.fixture
def dynamodb_store(monkeypatch):
    monkeypatch.setenv("AWS_DEFAULT_REGION", "ap-northeast-1")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    with mock_aws():
        boto3.client("dynamodb").create_table(
            TableName=TABLE,
            KeySchema=[{"AttributeName": "pk", "KeyType": "HASH"}],
            AttributeDefinitions=[{"AttributeName": "pk", "AttributeType": "S"}],
            BillingMode="PAY_PER_REQUEST",
        )
        yield DynamoDBStore(TABLE)
