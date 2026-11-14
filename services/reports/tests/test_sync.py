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


@pytest.mark.parametrize("op, fields", [
    ("create", FIELDS), ("restore", None), ("update", {"title": "書き換え"}),
    ("update", {"next_steps_done": [0], "title": "書き換え"}), ("create", {"next_steps_done": [0]}),
])
def test_アプリからは_消すのと次の一歩のチェック以外を断る(op, fields):
    result = REGISTRY.parse_change(raw(op, fields), {"report"}, "device")
    assert isinstance(result, Rejection) and result.code == "op_not_allowed"


def test_アプリから次の一歩のチェックを書ける():
    change = REGISTRY.parse_change(raw("update", {"next_steps_done": [0, 2]}), {"report"}, "device")
    assert not isinstance(change, Rejection) and change.fields == {"next_steps_done": [0, 2]}
    cleared = REGISTRY.parse_change(raw("update", {"next_steps_done": []}), {"report"}, "device")
    assert not isinstance(cleared, Rejection) and cleared.fields == {"next_steps_done": []}


@pytest.mark.parametrize("done", [[3], [-1], [1, 0], [0, 0], [0, 1, 2, 2], ["0"], None, [True]])
def test_次の一歩のチェックの番号を確かめる(done):
    result = REGISTRY.parse_change(raw("update", {"next_steps_done": done}), {"report"}, "device")
    assert isinstance(result, Rejection) and result.code == "invalid_fields"


def test_チェックは次の一歩にある番号だけを読む_前の形のレポートでも読める():
    engine = SyncEngine(InMemorySyncStore(REGISTRY.index_key), REGISTRY, clock=lambda: "2026-11-09T01:00:00.000Z")
    engine.append("alice", [Change(str(uuid.uuid4()), "report", REPORT_ID, None, "create",
                                   {**FIELDS, "next_steps": ["脚の日を2回", "たんぱく質130g"]},
                                   "2026-11-09T01:00:00.000Z", "mcp")])
    repo = SyncReportRepository(engine)
    assert asyncio.run(repo.get("alice", REPORT_ID)).next_steps_done == ()
    engine.append("alice", [Change(str(uuid.uuid4()), "report", REPORT_ID, None, "update", {"next_steps_done": [1, 2]},
                                   "2026-11-09T02:00:00.000Z", "app")])
    assert asyncio.run(repo.get("alice", REPORT_ID)).next_steps_done == (1,)


def test_まだないレポートへのチェックは_一覧に出ない():
    engine = SyncEngine(InMemorySyncStore(REGISTRY.index_key), REGISTRY, clock=lambda: "2026-11-09T01:00:00.000Z")
    engine.append("alice", [Change(str(uuid.uuid4()), "report", REPORT_ID, None, "update", {"next_steps_done": [0]},
                                   "2026-11-09T02:00:00.000Z", "app")])
    assert asyncio.run(SyncReportRepository(engine).list("alice")) == []


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
    {**FIELDS, "kind": "phase", "period_start": "2026-07-01", "period_end": "2026-10-20"},  # phase_id がない
    {**FIELDS, "kind": "phase", "phase_id": "p1"},  # 期間がない
    {**FIELDS, "kind": "phase", "phase_id": "p 1", "period_start": "2026-07-01", "period_end": "2026-10-20"},
    {**FIELDS, "phase_id": "p1"},  # ほかの種類は持てない
    {**FIELDS, "kind": "phase", "phase_id": "p1", "period_start": "2023-01-01", "period_end": "2026-10-20"},  # 3年を超える
])
def test_項目を確かめる(fields):
    result = REGISTRY.check_fields("report", "create", fields)
    if not isinstance(result, Rejection):
        result = REGISTRY.specs["report"].check(REPORT_ID, result)
    assert isinstance(result, Rejection)


def test_フェーズの振り返りは_phase_id_と期間があれば受け付け_366日より長くてもよい():
    fields = {**FIELDS, "kind": "phase", "phase_id": "p1", "period_start": "2025-01-01", "period_end": "2026-10-20"}
    result = REGISTRY.check_fields("report", "create", fields)
    assert not isinstance(result, Rejection)
    assert REGISTRY.specs["report"].check(REPORT_ID, result) is None


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


def test_同期の項目の列挙は_ドメインの列挙と同じ値_同じ並び():
    from reports.domain.report import Area, Kind, ReviewTarget, Tone
    from reports.infrastructure.sync_entities import HighlightFields, LinkFields, ReportFields, ReviewFields

    def enum_of(model, name):  # 1つだけの列挙は const になる
        prop = model.model_json_schema()["properties"][name]
        return next(s.get("enum", [s.get("const")]) for s in prop.get("anyOf", [prop]) if "enum" in s or "const" in s)

    assert enum_of(ReportFields, "kind") == [k.value for k in Kind]
    assert enum_of(ReportFields, "overall_tone") == [t.value for t in Tone]
    assert enum_of(HighlightFields, "tone") == [t.value for t in Tone]
    assert enum_of(HighlightFields, "area") == enum_of(LinkFields, "from_area") == [a.value for a in Area]
    assert enum_of(ReviewFields, "target") == [t.value for t in ReviewTarget]
