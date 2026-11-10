"""アプリと MCP が、同期を通して同じ記録を見ること（testdata/sync の app_push.json・mcp_pull.json）。

- アプリ → MCP：アプリが送る本文（apps/mobile/db/__tests__/sync-shared.test.ts が作る app_push.json。Health Connect の取り込みも含む）を、
  アプリ用の API（SyncHttpApi）に送り、MCP のツール（get_workout など）から見えることを確かめる。同じ本文を2回送っても二重にならない
- MCP → アプリ：MCP のツールで記録したあと、アプリ用の API の受け取り（GET /v1/sync/changes）が返すページを、
  mcp_pull.json と比べる（ID は置き換える）。アプリの jest が同じファイルを端末に当てはめて、画面から見えることを確かめる。
  作り直すとき：UPDATE_TESTDATA=1 uv run pytest tests/test_app_sync.py
"""

import asyncio
import copy
import json
import os
import re
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest
from mcp.server.auth.provider import AccessToken
from mcp.server.mcpserver import MCPServer

from sync.engine import SyncEngine
from sync.presentation.http_api import SyncHttpApi
from sync.registry import Registry
from sync.store import InMemorySyncStore
from training.domain.catalog import SEED_BODY_PARTS, SEED_EXERCISES
from training.main import create_commands, create_queries, register_sync_entities
from training.presentation import mcp_tools

TESTDATA = Path(__file__).parents[3] / "testdata" / "sync"
JST = timezone(timedelta(hours=9))
TODAY = date(2026, 11, 8)
NOW = datetime(2026, 11, 8, 21, 30, tzinfo=JST)
REGISTRY = Registry()
register_sync_entities(REGISTRY)
APP_CLIENT = "app-client-id"
SCOPES = "torelog-api/training.read torelog-api/training.write torelog-api/meals.read torelog-api/meals.write"
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
SEED_IDS = {p.id for p in SEED_BODY_PARTS} | {e.id for e in SEED_EXERCISES}


@pytest.fixture
def engine():
    return SyncEngine(InMemorySyncStore(REGISTRY.index_key), REGISTRY, clock=lambda: "2026-11-08T12:30:00.000Z")


@pytest.fixture
def app_api(engine):
    api = SyncHttpApi(engine, REGISTRY, APP_CLIENT)

    def call(method, path, body=None, query=None):
        claims = {"sub": "alice", "scope": SCOPES, "client_id": APP_CLIENT, "token_use": "access"}
        res = api.handle({
            "rawPath": path, "queryStringParameters": query, "body": json.dumps(body) if body is not None else None,
            "requestContext": {"http": {"method": method}, "authorizer": {"jwt": {"claims": claims}}},
        })
        return res["statusCode"], json.loads(res["body"])

    return call


@pytest.fixture
def tool(monkeypatch, engine):
    token = AccessToken(token="t", client_id="c", scopes=["training:read", "training:write"], subject="alice")
    monkeypatch.setattr(mcp_tools, "get_access_token", lambda: token)
    mcp = MCPServer(name="test")
    mcp_tools.register_training_tools(mcp, create_commands(engine, lambda: NOW), create_queries(engine), today=lambda: TODAY)

    def call(name, **arguments):
        return json.loads(asyncio.run(mcp.call_tool(name, arguments)).content[0].text)

    return call


def test_アプリで記録したものが_MCP_から見える_同じ本文を2回送っても二重にならない(app_api, tool, engine):
    pushes = json.loads((TESTDATA / "app_push.json").read_text())["pushes"]
    bodies = []
    for push in pushes:
        body = copy.deepcopy(push)
        body["device_id"] = "device-1"
        for change in body["changes"]:
            change["change_id"] = str(uuid.uuid4())
        bodies.append(body)
    for body in bodies:
        status, res = app_api("POST", "/v1/sync/changes", body)
        assert status == 200
        assert [r["status"] for r in res["results"]] == ["accepted"] * len(body["changes"]), res
    head = engine.head("alice")
    for body in bodies:  # 応答を受け取れずに送り直したとき
        status, res = app_api("POST", "/v1/sync/changes", body)
        assert [r["status"] for r in res["results"]] == ["duplicate"] * len(body["changes"])
    assert engine.head("alice") == head

    workout = tool("get_workout", day="2026-11-08")
    assert [(e["exercise"], [(s["weight_kg"], s["reps"]) for s in e["sets"]]) for e in workout["entries"]] == [
        ("ベンチプレス", [(80.0, 8), (82.5, 6)]),
        ("懸垂", [(None, 10)]),
        ("ブルガリアンスクワット", [(20.0, 12)]),
    ]
    assert workout["entries"][0]["sets"][1]["memo"] == "最後は補助あり"
    exercises = {e["name"]: e for p in tool("list_exercises", include_hidden=True)["body_parts"] for e in p["exercises"]}
    assert exercises["スクワット"]["hidden"] is True
    assert exercises["ブルガリアンスクワット"]["record_type"] == "weight_reps" and not exercises["ブルガリアンスクワット"].get("hidden")
    # BIG3 の役（スクワットの代わりにブルガリアンスクワット）とフォームの動画のリンク
    assert {name: e["big3"] for name, e in exercises.items() if "big3" in e} == {
        "ベンチプレス": "bench", "ブルガリアンスクワット": "squat", "デッドリフト": "deadlift"}
    assert exercises["ブルガリアンスクワット"]["form_video_url"] == "https://youtu.be/bss"
    # 11/7 は体重計の取り込みだけ。11/8 は手入力よりあとに体重計の取り込みがあるが、手入力が先
    body = tool("body_progress", days=7)["days"]
    assert [(d["date"], d["weight_kg"], d["body_fat_pct"], d["waist_cm"]) for d in body] == [
        ("2026-11-07", 70.1, None, None), ("2026-11-08", 70.4, 18.2, 80.0)]
    # Health Connect の睡眠（origin = import）
    sleeps = [c for p in pushes for c in p["changes"] if c["entity_type"] == "sleep_session"]
    assert [c["origin"] for c in sleeps] == ["import"]
    state = engine.doc("alice", "sleep_session", sleeps[0]["entity_id"]).own.view()
    assert (state["deleted"], state["fields"]["date"], state["fields"]["asleep_min"]) == (False, "2026-11-08", 420)
    # 心拍の日のまとめ（サンプルそのものは送らない）
    hearts = [c for p in pushes for c in p["changes"] if c["entity_type"] == "heart_rate_day"]
    assert [(c["origin"], set(c["fields"])) for c in hearts] == [
        ("import", {"date", "resting_bpm", "avg_bpm", "min_bpm", "max_bpm", "samples"})]
    state = engine.doc("alice", "heart_rate_day", hearts[0]["entity_id"]).own.view()
    assert state["fields"] == {"date": "2026-11-07", "resting_bpm": 54, "avg_bpm": 94, "min_bpm": 62, "max_bpm": 131, "samples": 3}
    # MCP の睡眠と心拍のまとめから見える
    nights = tool("sleep_summary")["nights"]
    assert [(n["date"], n["asleep_min"], n["bedtime"], n["wake_time"]) for n in nights] == [
        ("2026-11-08", 420, "2026-11-07T23:40+09:00", "2026-11-08T06:55+09:00")]
    hearts = tool("heart_rate_summary")
    assert [(d["date"], d["resting_bpm"], d["avg_bpm"], d["samples"]) for d in hearts["days"]] == [("2026-11-07", 54, 94, 3)]


def normalize(value, ids: dict):
    """MCP が作る ID（UUID）を、出てきた順に決まった UUID に置き換える（初期の部位・種目の ID はそのまま）。"""
    if isinstance(value, dict):
        return {k: normalize(v, ids) for k, v in value.items()}
    if isinstance(value, list):
        return [normalize(v, ids) for v in value]
    if isinstance(value, str) and UUID.match(value) and value not in SEED_IDS:
        return ids.setdefault(value, f"00000000-0000-4000-8000-{len(ids) + 1:012d}")
    return value


def test_MCP_で記録したものを_アプリが受け取るページ(app_api, tool):
    tool("record_workout", day="2026-11-07", exercises=[
        {"exercise": "ベンチプレス", "sets": [{"weight_kg": 100, "reps": 5}, {"weight_kg": 100, "reps": 4}]},
        {"exercise": "懸垂", "sets": [{"reps": 12}]},
    ])
    tool("record_body", day="2026-11-07", weight_kg=71.3, body_fat_pct=17.5)
    status, page = app_api("GET", "/v1/sync/changes", query={"after": "0"})
    assert status == 200 and page["has_more"] is False
    page = normalize(page, {})
    path = TESTDATA / "mcp_pull.json"
    if os.environ.get("UPDATE_TESTDATA"):
        path.write_text(json.dumps({
            "description": "MCP のツールで筋トレ（2026-11-07 のベンチプレスと懸垂）と体組成を記録したあと、アプリ用の API の受け取り"
                           "（GET /v1/sync/changes?after=0）が返すページ。ID は決まった UUID に置き換えている。"
                           "services/training/tests/test_app_sync.py が作り、apps/mobile/db/__tests__/sync-shared.test.ts と E2E が端末に当てはめる。",
            "page": page,
        }, ensure_ascii=False, indent=2) + "\n")
    assert page == json.loads(path.read_text())["page"]
