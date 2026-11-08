"""アプリ（apps/mobile/db/__tests__/sync-shared.test.ts）と同じテストのデータ（testdata/sync/conflicts.json）で、
同期の衝突の決まりを確かめる。端末やチャットの変更を、受け付けた順に当てはめた結果が expected になること。

端末（app）と取り込み（import）の変更は、アプリの API と同じく、項目の形を確かめてから当てはめる。
MCP の変更は、MCP のリポジトリと同じく、受け付けた時刻を changed_at にして当てはめる。
"""

import json
import uuid
from pathlib import Path

import pytest

from sync.engine import SyncEngine
from sync.model import Change
from sync.registry import Registry, Rejection
from sync.store import InMemorySyncStore
from training.main import register_sync_entities

TESTDATA = Path(__file__).parents[3] / "testdata" / "sync"
REGISTRY = Registry()
register_sync_entities(REGISTRY)
USER = "user-1"
CASES = json.loads((TESTDATA / "conflicts.json").read_text())["cases"]


def to_change(raw: dict) -> Change:
    body = {"change_id": str(uuid.uuid4()), **{k: raw[k] for k in ("entity_type", "entity_id", "op", "changed_at")}}
    if "fields" in raw:
        body["fields"] = raw["fields"]
    if raw["origin"] == "mcp":
        return Change(body["change_id"], raw["entity_type"], raw["entity_id"], None, raw["op"], raw.get("fields"),
                      raw["received_at"], "mcp")
    change = REGISTRY.parse_change({**body, "origin": raw["origin"]}, REGISTRY.types_in({"training"}), "device-1")
    assert not isinstance(change, Rejection), change
    return change


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_衝突の決まり(case):
    now = {"at": ""}
    engine = SyncEngine(InMemorySyncStore(REGISTRY.index_key), REGISTRY, clock=lambda: now["at"])
    for raw in case["changes"]:
        now["at"] = raw["received_at"]
        engine.append(USER, [to_change(raw)])
    for expected in case["expected"]:
        state = engine.doc(USER, expected["entity_type"], expected["entity_id"]).own.view()
        assert (state["fields"], state["deleted"]) == (expected["fields"], expected["deleted"])
