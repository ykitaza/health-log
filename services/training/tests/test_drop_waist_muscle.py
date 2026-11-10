"""一度だけ動かす scripts/drop_waist_muscle.py：同期の状態と変更の記録から、筋肉率とウエストを除く（数えるだけのときは書かない）。"""

import importlib.util
import json
import sys
import uuid
from pathlib import Path

from sync.engine import SyncEngine
from sync.model import Change, Doc, LogEntry
from sync.registry import Registry
from sync.store import InMemorySyncStore, log_sk
from training.main import register_sync_entities

spec = importlib.util.spec_from_file_location("drop_waist_muscle", Path(__file__).parents[1] / "scripts" / "drop_waist_muscle.py")
script = sys.modules[spec.name] = importlib.util.module_from_spec(spec)
spec.loader.exec_module(script)

REGISTRY = Registry()
register_sync_entities(REGISTRY)
USER = "user-1"
BASE = {"measured_at": "2026-11-01T07:00:00Z", "source": "manual", "memo": ""}


def old_app_change(entity_id, op, fields, at):
    """前の版のアプリが送り、前の版のサーバーが受け付けた変更（今のサーバーは2つの項目を捨てるので、直接作る）。"""
    return Change(str(uuid.uuid4()), "body_record", entity_id, None, op, fields, at, "app")


def items_of(engine_store):
    raw = engine_store._users[USER]
    docs = [{"pk": "EATER#" + USER, "sk": sk, "data": data} for sk, data in raw["docs"].items()]
    logs = [{"pk": "EATER#" + USER, "sk": log_sk(seq), "data": data} for seq, data in raw["log"].items()]
    return docs + logs


def test_数えて_除いたものはそのまま読める():
    store = InMemorySyncStore(REGISTRY.index_key)
    engine = SyncEngine(store, REGISTRY, clock=lambda: "2026-11-08T10:00:00.000Z")
    engine.append(USER, [
        old_app_change("waist-only", "create", {**BASE, "date": "2026-11-01", "weight_kg": None, "waist_cm": 80},
                       "2026-11-01T07:00:00.000Z"),
        old_app_change("both", "create", {**BASE, "date": "2026-11-03", "weight_kg": 70, "muscle_pct": 40, "waist_cm": 81},
                       "2026-11-03T07:00:00.000Z"),
        old_app_change("both", "update", {"weight_kg": 69.5}, "2026-11-03T08:00:00.000Z"),
        old_app_change("plain", "create", {**BASE, "date": "2026-11-05", "weight_kg": 69}, "2026-11-05T07:00:00.000Z"),
        Change(str(uuid.uuid4()), "setting", "weight_unit", None, "create", {"value": "kg"}, "2026-11-05T07:00:00.000Z", "app"),
    ])

    summary = script.run(None, apply=False, items=items_of(store))
    assert summary.records == {"muscle_pct": 1, "waist_cm": 2}
    assert sorted(summary.days) == ["2026-11-01", "2026-11-03"]
    assert summary.empty_after == 1  # waist-only
    assert summary.log_changes == {"muscle_pct": 1, "waist_cm": 2}
    assert summary.log_states == 3  # both の update のあとの状態にも残っている
    assert summary.to_rewrite == 2 + 3
    assert summary.rewritten == 0
    assert "利用者: 1" in summary.lines()
    assert not any("80" in line or "81" in line or "40" in line for line in summary.lines()[1:])  # 値は出さない

    for item in items_of(store):
        data = json.loads(item["data"])
        if item["sk"].startswith("SYNC#STATE#"):
            new = script.scrub_state(data)
            if new is None:
                continue
            own = Doc.from_json(new).own
            assert not set(script.DROPPED) & (own.values.keys() | own.keys.keys())
        else:
            new = script.scrub_log(data)
            if new is None:
                continue
            entry = LogEntry.from_json(new)
            assert not set(script.DROPPED) & ((entry.change.fields or {}).keys() | entry.state["fields"].keys())
            assert entry.change.seq == json.loads(item["data"])["change"]["seq"]
    assert script.scrub_state(json.loads(store._users[USER]["docs"]["SYNC#STATE#body_record#plain"])) is None
