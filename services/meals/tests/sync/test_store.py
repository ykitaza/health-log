"""保存先の約束（store.py）を、メモリー版と DynamoDB 版（moto）の両方で確かめる。"""

import json
import uuid

import boto3
import pytest

from sync.engine import SyncEngine
from sync.model import Change
from sync.store import Conflict, pk
from tests.sync.conftest import TABLE

NOW = "2026-11-08T10:00:00.000Z"
SET = {"entry_id": "e1", "set_index": 0, "weight_kg": 60.0, "reps": 10, "memo": "", "done": False}
MEAL = {"date": "2026-11-08", "slot": "lunch", "time": None, "description": "", "source": "text"}


def change(op="create", fields=SET, entity_type="workout_set", entity_id="s1", parent_id=None):
    return Change(str(uuid.uuid4()), entity_type, entity_id, parent_id, op, fields, "2026-11-08T09:00:00.000Z", "app")


def test_送ると状態と変更の記録が残り_何度送っても1回分(sync_store):
    e = SyncEngine(sync_store, clock=lambda: NOW)
    c = change()
    assert [a.seq for a in e.append("u1", [c, change(entity_id="s2")])] == [1, 2]
    assert e.append("u1", [c])[0].duplicate
    assert e.head("u1") == 2
    assert e.doc("u1", "workout_set", "s1").own.values["reps"] == 10
    entries, cursor, more = e.pull("u1", 0, 10, {"workout_set"})
    assert [en.change.seq for en in entries] == [1, 2] and cursor == 2 and not more
    assert entries[0].change.received_at == NOW and entries[0].state["fields"]["reps"] == 10


def test_ページ送りとスナップショット(sync_store):
    e = SyncEngine(sync_store, clock=lambda: NOW)
    e.append("u1", [change(entity_id=f"s{n}") for n in range(5)])
    entries, cursor, more = e.pull("u1", 0, 2, {"workout_set"})
    assert [en.change.seq for en in entries] == [1, 2] and cursor == 2 and more
    entries, cursor, more = e.pull("u1", 4, 2, {"workout_set"})
    assert [en.change.seq for en in entries] == [5] and cursor == 5 and not more
    seen, start = [], None
    while True:
        states, start = e.snapshot("u1", start, 2, {"workout_set"})
        seen += [s["entity_id"] for s in states]
        if start is None:
            break
    assert sorted(seen) == [f"s{n}" for n in range(5)]


def test_読めない種類は飛ばし_カーソルは進む(sync_store):
    e = SyncEngine(sync_store, clock=lambda: NOW)
    e.append("u1", [change(), change(entity_type="meal", entity_id="m1", fields=MEAL)])
    entries, cursor, _ = e.pull("u1", 0, 10, {"meal"})
    assert [en.change.entity_type for en in entries] == ["meal"] and cursor == 2
    assert [s["entity_type"] for s in e.snapshot("u1", None, 10, {"meal"})[0]] == ["meal"]


def test_ほかの人の記録には届かない(sync_store):
    e = SyncEngine(sync_store, clock=lambda: NOW)
    e.append("u1", [change(), change(entity_type="meal", entity_id="m1", fields=MEAL)])
    assert e.head("u2") == 0 and e.doc("u2", "workout_set", "s1") is None
    assert e.pull("u2", 0, 10, {"workout_set", "meal"})[0] == []
    assert e.snapshot("u2", None, 10, {"workout_set", "meal"})[0] == []
    assert e.meal_docs_between("u2", "2026-11-08#0", "2026-11-08#3") == []
    assert len(e.meal_docs_between("u1", "2026-11-08#0", "2026-11-08#3")) == 1


def test_先頭が変わっていたら書かない(sync_store):
    e = SyncEngine(sync_store, clock=lambda: NOW)
    e.append("u1", [change()])
    with pytest.raises(Conflict):
        sync_store.commit("u1", 0, 1, [], {}, [])  # 先頭は 1 になっている
    assert e.head("u1") == 1


def test_重なったらやり直す(sync_store):
    e = SyncEngine(sync_store, clock=lambda: NOW)
    original, calls = sync_store.head, []

    def racing_head(user):
        if not calls:  # 1回目に読んだあと、ほかの書き込みが先に入る
            calls.append(1)
            head = original(user)
            SyncEngine(sync_store, clock=lambda: NOW).append(user, [change(entity_id="other")])
            return head
        return original(user)

    sync_store.head = racing_head
    assert e.append("u1", [change()])[0].seq == 2


def test_移行の前の食事の項目は_期間の検索に混ざらない(dynamodb_table):
    from sync.store import DynamoDBSyncStore

    boto3.resource("dynamodb").Table(TABLE).put_item(Item={
        "pk": pk("u1"), "sk": "MEAL#old", "day_key": "2026-11-08#1", "data": json.dumps({})})
    e = SyncEngine(DynamoDBSyncStore(TABLE), clock=lambda: NOW)
    e.append("u1", [change(entity_type="meal", entity_id="m1", fields=MEAL)])
    assert [d.entity_id for d in e.meal_docs_between("u1", "2026-11-08#0", "2026-11-08#3")] == ["m1"]
    assert [s["entity_id"] for s in e.snapshot("u1", None, 10, {"meal"})[0]] == ["m1"]
