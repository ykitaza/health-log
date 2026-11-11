"""アプリと MCP が、次の一歩のチェック（レポートの next_steps_done）を同じ形で扱うこと（testdata/sync/report_checks.json）。

アプリの jest（apps/mobile/db/__tests__/reports.test.ts）は、同じ report を端末に受け取り、checks をチェックしたときに送る変更が
app_change と同じになることを確かめる。ここでは、その変更を本物のアプリ用の API（SyncHttpApi）に送り、
週のまとめの材料の previous_next_steps（MCP の weekly_review・period_overview が返す）に出ることを確かめる。
"""

import asyncio
import json
import uuid
from datetime import date
from pathlib import Path

from reports.main import create_service, register_sync_entities
from reports.presentation.mcp_tools import PreviousNextSteps
from sync.engine import SyncEngine
from sync.model import Change
from sync.presentation.http_api import SyncHttpApi
from sync.registry import Registry
from sync.store import InMemorySyncStore

DATA = json.loads((Path(__file__).parents[3] / "testdata" / "sync" / "report_checks.json").read_text())
APP_CLIENT = "app-client-id"


def push(api, body):
    claims = {"sub": "alice", "scope": "torelog-api/training.write", "client_id": APP_CLIENT, "token_use": "access"}
    res = api.handle({"rawPath": "/v1/sync/changes", "queryStringParameters": None, "body": json.dumps(body),
                      "requestContext": {"http": {"method": "POST"}, "authorizer": {"jwt": {"claims": claims}}}})
    return json.loads(res["body"])["results"]


def test_アプリが送ったチェックが_前の週の次の一歩に出る_2回送っても同じ():
    registry = Registry()
    register_sync_entities(registry)
    engine = SyncEngine(InMemorySyncStore(registry.index_key), registry, clock=lambda: "2026-11-09T01:00:00.000Z")
    engine.append("alice", [Change(str(uuid.uuid4()), "report", DATA["report_id"], None, "create", DATA["report"],
                                   "2026-11-09T01:00:00.000Z", "mcp")])
    api = SyncHttpApi(engine, registry, APP_CLIENT)
    body = {"device_id": "pixel", "changes": [
        {**DATA["app_change"], "change_id": str(uuid.uuid4()), "changed_at": "2026-11-09T03:00:00.000Z"}]}
    assert [r["status"] for r in push(api, body)] == ["accepted"]
    assert [r["status"] for r in push(api, body)] == ["duplicate"]
    got = asyncio.run(PreviousNextSteps(create_service(engine)).previous_next_steps(
        "alice", date.fromisoformat(DATA["review_start"])))
    got.pop("note")
    assert got == DATA["previous_next_steps"]
