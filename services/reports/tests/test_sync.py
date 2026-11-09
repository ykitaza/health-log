"""レポートの種類（report）を同期に登録した決まり：アプリからは消すだけ、項目の確かめ、前の形のレポートを読む。"""

import asyncio
import uuid

import pytest

from reports.infrastructure.sync_repository import SyncReportRepository
from reports.main import register_sync_entities
from sync.engine import SyncEngine
from sync.model import Change
from sync.registry import Registry, Rejection
from sync.store import InMemorySyncStore

REGISTRY = Registry()
register_sync_entities(REGISTRY)
REPORT_ID = "0b6f7a52-3c1e-4f5f-9d0b-2c7a8e0f4b61"
FIELDS = {"title": "今週のまとめ", "body": "本文", "kind": "weekly"}


def raw(op, fields=None, entity_id=REPORT_ID):
    out = {"change_id": str(uuid.uuid4()), "entity_type": "report", "entity_id": entity_id, "op": op,
           "changed_at": "2026-11-09T01:00:00.000Z"}
    return {**out, "fields": fields} if fields is not None else out


@pytest.mark.parametrize("op", ["create", "update", "restore"])
def test_アプリからは_消す以外を断る(op):
    result = REGISTRY.parse_change(raw(op, FIELDS if op != "restore" else None), {"report"}, "device")
    assert isinstance(result, Rejection) and result.code == "op_not_allowed"


def test_アプリから消すのは受け付ける():
    change = REGISTRY.parse_change(raw("delete"), {"report"}, "device")
    assert not isinstance(change, Rejection) and change.op == "delete"


def test_筋トレの_scope_で扱う():
    assert REGISTRY.types_in({"training"}) == {"report"}
    assert REGISTRY.types_in({"meals"}) == set()


def test_ID_は_UUID():
    assert isinstance(REGISTRY.parse_change(raw("delete", entity_id="abc"), {"report"}, "d"), Rejection)


@pytest.mark.parametrize("fields", [
    {**FIELDS, "unknown": 1},
    {**FIELDS, "overall_tone": "bad"},
    {**FIELDS, "highlights": [{"area": "training", "tone": "good", "text": "x", "metric": {"label": "a", "value": "1"}}]},
    {**FIELDS, "period_start": "2026-11-08", "period_end": "2026-11-01"},
    {**FIELDS, "body": "😀" * 15000},
    {**FIELDS, "kind": "daily", "period_start": "2026-11-08", "period_end": "2026-11-09"},
    {**FIELDS, "kind": "daily"},
])
def test_項目を確かめる(fields):
    result = REGISTRY.check_fields("report", "create", fields)
    if not isinstance(result, Rejection):
        result = REGISTRY.specs["report"].check(REPORT_ID, result)
    assert isinstance(result, Rejection)


def test_日のまとめは_その日だけの期間なら受け付ける():
    fields = {**FIELDS, "kind": "daily", "period_start": "2026-11-09", "period_end": "2026-11-09"}
    result = REGISTRY.check_fields("report", "create", fields)
    assert not isinstance(result, Rejection)
    assert REGISTRY.specs["report"].check(REPORT_ID, result) is None


def test_前の形のレポート_本文だけ_も読める():
    engine = SyncEngine(InMemorySyncStore(REGISTRY.index_key), REGISTRY, clock=lambda: "2026-11-09T01:00:00.000Z")
    engine.append("alice", [Change(str(uuid.uuid4()), "report", REPORT_ID, None, "create", FIELDS,
                                   "2026-11-09T01:00:00.000Z", "mcp")])
    report = asyncio.run(SyncReportRepository(engine).get("alice", REPORT_ID))
    assert (report.title, report.overall_tone, report.highlights, report.next_steps) == ("今週のまとめ", None, (), ())
