"""WordsTable（moto）の上で、MCP の書き込み・アプリ用の API の送信と受け取り・同じ表現の範囲の検索を確かめる。

テーブルは cdk/lib/words-stack.ts と同じ形（pk・sk、LSI by_day の day_key）。
"""

import json
import uuid

import boto3
import pytest
from moto import mock_aws

import app_api
from sync.store import state_sk
from tests.conftest import Clock
from words.domain.catalog import SEED_SOURCES
from words.main import create_engine, create_service

TABLE = "words-test"
APP_CLIENT = "torelog-app-client-id"


@pytest.fixture
def table(monkeypatch):
    monkeypatch.setenv("AWS_DEFAULT_REGION", "ap-northeast-1")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    with mock_aws():
        boto3.client("dynamodb").create_table(
            TableName=TABLE,
            KeySchema=[{"AttributeName": "pk", "KeyType": "HASH"}, {"AttributeName": "sk", "KeyType": "RANGE"}],
            AttributeDefinitions=[{"AttributeName": n, "AttributeType": "S"} for n in ("pk", "sk", "day_key")],
            LocalSecondaryIndexes=[{"IndexName": "by_day", "KeySchema": [
                {"AttributeName": "pk", "KeyType": "HASH"}, {"AttributeName": "day_key", "KeyType": "RANGE"}],
                "Projection": {"ProjectionType": "ALL"}}],
            BillingMode="PAY_PER_REQUEST")
        yield TABLE


def event(method, path, body=None, query=None, scope="torelog-api/training.read torelog-api/training.write",
          client_id=APP_CLIENT):
    return {"rawPath": path, "requestContext": {"http": {"method": method}, "authorizer": {"jwt": {"claims": {
        "sub": "alice", "token_use": "access", "client_id": client_id, "scope": scope}}}},
        "body": json.dumps(body) if body is not None else None, "queryStringParameters": query}


def push(api, changes):
    res = api.handle(event("POST", "/v1/sync/changes", {"device_id": "phone", "changes": changes}))
    return res["statusCode"], json.loads(res["body"])


def app_change(entity_type, op, fields=None, entity_id=None):
    c = {"change_id": str(uuid.uuid4()), "entity_type": entity_type, "entity_id": entity_id or str(uuid.uuid4()),
         "parent_id": None, "op": op, "changed_at": "2026-11-18T12:00:00Z"}
    if fields is not None:
        c["fields"] = fields
    return c


def test_MCP_で拾ったものをアプリが受け取り_アプリで書いたものを_MCP_が読む(table):
    import anyio

    engine = create_engine(table)
    service = create_service(engine, Clock())
    api = app_api.create_api(engine, APP_CLIENT)
    from words.application.service import CaptureInput

    (captured,) = anyio.run(service.capture, "alice", [CaptureInput("腑に落ちる", source="Audible", scene="本で")])
    expression_id = captured["expression"]["id"]

    res = api.handle(event("GET", "/v1/sync/changes", query={"after": "0"}))
    entries = json.loads(res["body"])["entries"]
    assert {e["change"]["entity_type"] for e in entries} == {"expression", "encounter"}
    assert all(e["change"]["origin"] == "mcp" for e in entries)

    status, body = push(api, [
        app_change("expression", "update", {"star": True, "note": "アプリで書いた"}, expression_id),
        app_change("source", "update", {"hidden": True}, SEED_SOURCES[1].id),  # 初期の行は変えた項目だけ
    ])
    assert status == 200 and [r["status"] for r in body["results"]] == ["accepted", "accepted"]
    state = anyio.run(service.state, "alice")
    assert state.expressions[expression_id].star and state.expressions[expression_id].note == "アプリで書いた"
    kindle = state.source(SEED_SOURCES[1].id)
    assert kindle.hidden and kindle.name == "Kindle"
    assert anyio.run(service.last_app_sync_at, "alice") is not None

    # 同じ表現は、並びのキー（normalized_key）の範囲の検索で見つかる
    found = engine.docs_by_index("alice", "expression", "腑に落ちる", "腑に落ちる")
    assert [d.entity_id for d in found] == [expression_id]
    item = boto3.resource("dynamodb").Table(table).get_item(
        Key={"pk": "EATER#alice", "sk": state_sk("expression", expression_id)})["Item"]
    assert item["day_key"] == "腑に落ちる"


def test_アプリからは決まりに合わない変更を断る(table):
    api = app_api.create_api(create_engine(table), APP_CLIENT)
    status, body = push(api, [
        app_change("expression", "update", {"meaning": "補う項目"}),
        app_change("source", "delete"),
        app_change("review", "update", {"result": "said"}),
        app_change("expression", "create", {"text": "腑に落ちる", "normalized_key": "腑に落ちる", "place": "collected"}),
    ])
    assert status == 200
    assert [r["status"] for r in body["results"]] == ["rejected", "rejected", "rejected", "accepted"]
    assert {r["error"]["code"] for r in body["results"][:3]} == {"op_not_allowed"}


def test_アプリ用の_API_は_torelog_app_のトークンと_training_の_scope_だけ(table):
    api = app_api.create_api(create_engine(table), APP_CLIENT)
    other_client = api.handle(event("GET", "/v1/sync/snapshot", client_id="authz-api"))
    assert other_client["statusCode"] == 401
    meals_only = api.handle(event("GET", "/v1/sync/snapshot", scope="torelog-api/meals.read"))
    assert meals_only["statusCode"] == 200 and json.loads(meals_only["body"])["states"] == []
    status, body = push(api, [app_change("expression", "create", {"text": "x", "normalized_key": "x",
                                                                  "place": "collected"})])
    assert body["results"][0]["status"] == "accepted"
    res = api.handle(event("POST", "/v1/sync/changes", {"device_id": "d", "changes": [app_change(
        "expression", "create", {"text": "y", "normalized_key": "y", "place": "collected"})]},
        scope="torelog-api/training.read"))
    assert json.loads(res["body"])["results"][0]["error"]["code"] == "insufficient_scope"


def test_ハンドラーは環境変数のテーブルとクライアントで作る(table, monkeypatch):
    monkeypatch.setenv("WORDS_TABLE", table)
    monkeypatch.setenv("APP_CLIENT_ID", APP_CLIENT)
    monkeypatch.setattr(app_api, "_api", None)
    res = app_api.handler(event("GET", "/v1/sync/snapshot"), None)
    assert res["statusCode"] == 200 and json.loads(res["body"])["states"] == []
    assert app_api.handler(event("GET", "/v1/meals/goal-suggestions"), None)["statusCode"] == 404
