"""衝突のルール（docs/sync-design.md の「今の状態への当てはめ」）を、メモリーの保存先で確かめる。"""

import itertools
import uuid

import pytest

from sync.engine import SyncEngine
from sync.model import Change
from sync.store import InMemorySyncStore

USER = "user-1"
NOW = "2026-11-08T10:00:00.000Z"


def change(op="update", fields=None, at="2026-11-08T09:00:00.000Z", origin="app", entity_type="workout_set",
           entity_id="set-1", parent_id=None, change_id=None):
    return Change(change_id or str(uuid.uuid4()), entity_type, entity_id, parent_id, op, fields, at, origin, "pixel")


def engine():
    return SyncEngine(InMemorySyncStore(), clock=lambda: NOW)


def state(e, entity_type="workout_set", entity_id="set-1"):
    doc = e.doc(USER, entity_type, entity_id)
    return doc.own if doc else None


SET = {"entry_id": "entry-1", "set_index": 0, "weight_kg": 60.0, "reps": 10, "memo": "", "done": False}


def test_新しく足したものは両方残る():
    e = engine()
    e.append(USER, [change("create", SET, entity_id="a"), change("create", SET, entity_id="b")])
    assert state(e, entity_id="a") and state(e, entity_id="b")


def test_同じ記録の違う項目は両方を合わせる():
    e = engine()
    e.append(USER, [change("create", SET, at="2026-11-08T08:00:00.000Z")])
    e.append(USER, [change(fields={"reps": 12}, at="2026-11-08T09:00:00.000Z"),
                    change(fields={"weight_kg": 62.5}, at="2026-11-08T08:30:00.000Z")])
    assert (state(e).values["reps"], state(e).values["weight_kg"]) == (12, 62.5)


def test_同じ項目は新しい方が残る_古い変更があとから届いても():
    e = engine()
    e.append(USER, [change("create", SET, at="2026-11-08T08:00:00.000Z")])
    e.append(USER, [change(fields={"reps": 12}, at="2026-11-08T09:00:00.000Z")])
    e.append(USER, [change(fields={"reps": 8}, at="2026-11-08T08:30:00.000Z")])  # 端末が遅れて送った
    assert state(e).values["reps"] == 12


def test_MCP_の変更はサーバーが受け付けた時刻で比べる():
    e = SyncEngine(InMemorySyncStore(), clock=lambda: "2026-11-08T09:10:00.000Z")
    e.append(USER, [change("create", SET, at="2026-11-08T08:00:00.000Z")])
    # アプリで 09:00 に変えたものが、MCP の変更（09:10 に受け付けた）よりあとに届く
    e.append(USER, [change(fields={"reps": 20}, at="2026-11-08T09:10:00.000Z", origin="mcp")])
    e.append(USER, [change(fields={"reps": 11}, at="2026-11-08T09:00:00.000Z")])
    assert state(e).values["reps"] == 20


def test_同じ時刻なら_あとに受け付けた方が残る():
    e = engine()
    e.append(USER, [change("create", SET)])
    e.append(USER, [change(fields={"reps": 1}, at="2026-11-08T09:30:00.000Z")])
    e.append(USER, [change(fields={"reps": 2}, at="2026-11-08T09:30:00.000Z")])
    assert state(e).values["reps"] == 2


def test_MCP_が同じミリ秒の中で記録して直しても_直した値が残る():
    e = engine()  # 受け付けた時刻はいつも同じ
    e.append(USER, [change("create", SET, at=NOW, origin="mcp")])
    e.append(USER, [change(fields={"reps": 5}, at=NOW, origin="mcp")])
    assert state(e).values["reps"] == 5


def test_端末の時計が進んでいても_受け付けた時刻で切る():
    e = engine()  # 受け付けた時刻は 10:00
    e.append(USER, [change("create", SET, at="2026-11-08T08:00:00.000Z")])
    e.append(USER, [change(fields={"reps": 99}, at="2030-01-01T00:00:00.000Z")])  # 未来の時刻
    later = SyncEngine(e.store, clock=lambda: "2026-11-08T11:00:00.000Z")
    later.append(USER, [change(fields={"reps": 10}, at="2026-11-08T10:30:00.000Z")])
    assert state(e).values["reps"] == 10


def test_削除と変更は削除が勝つ_あとの変更でも戻らない():
    e = engine()
    e.append(USER, [change("create", SET, at="2026-11-08T08:00:00.000Z")])
    e.append(USER, [change("delete", at="2026-11-08T08:30:00.000Z")])
    e.append(USER, [change(fields={"reps": 15}, at="2026-11-08T09:00:00.000Z")])
    s = state(e)
    assert s.deleted and s.view()["deleted_at"] == "2026-11-08T08:30:00.000Z"
    assert s.values["reps"] == 15  # 値は当てはめておく（戻したときに見える）


def test_消したものは_restore_で戻せる_古い_restore_では戻らない():
    e = engine()
    e.append(USER, [change("create", SET, at="2026-11-08T08:00:00.000Z")])
    e.append(USER, [change("delete", at="2026-11-08T08:30:00.000Z")])
    e.append(USER, [change("restore", at="2026-11-08T08:10:00.000Z")])
    assert state(e).deleted
    e.append(USER, [change("restore", at="2026-11-08T09:00:00.000Z")])
    assert not state(e).deleted


def test_取り込みより手入力が勝つ_取り込みの方が新しくても():
    record = {"date": "2026-11-08", "measured_at": "2026-11-08T07:00:00+09:00", "weight_kg": 70.0,
              "source": "health_connect"}
    e = engine()
    e.append(USER, [change("create", record, at="2026-11-08T07:00:00.000Z", origin="import",
                           entity_type="body_record", entity_id="b1")])
    e.append(USER, [change(fields={"weight_kg": 69.5}, at="2026-11-08T08:00:00.000Z",
                           entity_type="body_record", entity_id="b1")])
    e.append(USER, [change("create", {**record, "weight_kg": 70.2}, at="2026-11-08T09:00:00.000Z",
                           origin="import", entity_type="body_record", entity_id="b1")])
    assert state(e, "body_record", "b1").values["weight_kg"] == 69.5


def test_消した取り込みの記録は_取り込み直しても戻らない():
    record = {"date": "2026-11-08", "measured_at": "2026-11-08T07:00:00Z", "source": "health_connect"}
    e = engine()
    e.append(USER, [change("create", record, origin="import", entity_type="body_record", entity_id="b1")])
    e.append(USER, [change("delete", at="2026-11-08T09:10:00.000Z", entity_type="body_record", entity_id="b1")])
    e.append(USER, [change("create", record, origin="import", at="2026-11-08T09:20:00.000Z",
                           entity_type="body_record", entity_id="b1")])
    assert state(e, "body_record", "b1").deleted


def test_同じ変更を2回送っても1回分():
    e = engine()
    create = change("create", SET)
    first = e.append(USER, [create])
    again = e.append(USER, [create])
    assert first[0].seq == again[0].seq == 1 and not first[0].duplicate and again[0].duplicate
    entries, _, _ = e.pull(USER, 0, 100, {"workout_set"})
    assert len(entries) == 1


def test_順番が入れ替わって届いても_同じ状態になる():
    changes = [
        change("create", SET, at="2026-11-08T08:00:00.000Z"),
        change(fields={"reps": 12}, at="2026-11-08T08:10:00.000Z"),
        change(fields={"reps": 9, "memo": "重い"}, at="2026-11-08T08:20:00.000Z"),
        change("delete", at="2026-11-08T08:30:00.000Z"),
        change("restore", at="2026-11-08T08:40:00.000Z"),
        change(fields={"done": True}, at="2026-11-08T08:05:00.000Z"),
    ]
    views = set()
    for order in itertools.permutations(changes):
        e = engine()
        for c in order:
            e.append(USER, [c])
        v = state(e).view()
        views.add(repr((sorted(v["fields"].items()), v["deleted"], v["created_at"], v["updated_at"])))
    assert len(views) == 1
    assert "('reps', 9)" in views.pop()


def test_負けた変更も変更の記録に残る():
    e = engine()
    e.append(USER, [change("create", SET, at="2026-11-08T08:00:00.000Z")])
    e.append(USER, [change(fields={"reps": 12}, at="2026-11-08T09:00:00.000Z")])
    e.append(USER, [change(fields={"reps": 8}, at="2026-11-08T08:30:00.000Z")])
    entries, _, _ = e.pull(USER, 0, 100, {"workout_set"})
    assert [en.change.fields.get("reps") for en in entries] == [10, 12, 8]
    assert entries[-1].state["fields"]["reps"] == 12  # 当てはめたあとの状態は勝った値


def test_品目が食事より先に届いても_あとで食事が埋まる():
    item = {"name": "白米", "amount": 200, "unit": "g", "kcal": 312, "protein_g": 5, "fat_g": 0.6,
            "carbs_g": 74, "confidence": "medium", "sort_order": 0}
    e = engine()
    e.append(USER, [change("create", item, entity_type="meal_item", entity_id="rice", parent_id="m1")])
    doc = e.doc(USER, "meal", "m1")
    assert doc.own is None and "rice" in doc.children
    e.append(USER, [change("create", {"date": "2026-11-08", "slot": "lunch", "description": "", "source": "text"},
                           entity_type="meal", entity_id="m1")])
    doc = e.doc(USER, "meal", "m1")
    assert doc.own.values["slot"] == "lunch" and doc.children["rice"].values["kcal"] == 312


def test_ほかの人の記録には届かない():
    e = engine()
    e.append(USER, [change("create", SET)])
    assert e.doc("user-2", "workout_set", "set-1") is None
    assert e.pull("user-2", 0, 100, {"workout_set"})[0] == []
    assert e.snapshot("user-2", None, 100, {"workout_set"})[0] == []


@pytest.mark.parametrize("after,expected", [(0, [1, 2]), (2, [3, 4]), (4, [5])])
def test_カーソルのページ送り(after, expected):
    e = engine()
    for n in range(5):
        e.append(USER, [change("create", SET, entity_id=f"s{n}")])
    entries, next_cursor, more = e.pull(USER, after, 2, {"workout_set"})
    assert [en.change.seq for en in entries] == expected
    assert next_cursor == expected[-1] and more == (expected[-1] < 5)
