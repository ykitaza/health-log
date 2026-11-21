"""食事のスコアに使う推定（SV・食物繊維・食塩相当量・菓子と嗜好飲料・純アルコール）が、記録から同期・読み取りまで通ることを確かめる。

どれも省ける。前の版のアプリ（送らない）や、推定していない記録が今までどおり動くことも確かめる。
"""

import uuid

from sync.model import Change
from sync.registry import Rejection
from tests.presentation.test_mcp_server import LUNCH
from tests.sync.conftest import REGISTRY
from tests.sync.test_mcp_changes import call, engine  # noqa: F401（fixture）

RICE_EST = {"sv_staple": 2, "sv_side": 0, "sv_main": 0, "sv_dairy": 0, "sv_fruit": 0,
            "fiber_g": 0.6, "salt_g": 0, "alcohol_g": 0, "is_snack_or_sweet_drink": False}
NONE_EST = {k: None for k in RICE_EST}
LUNCH_EST = {**LUNCH, "items": [{**LUNCH["items"][0], **RICE_EST}, LUNCH["items"][1]]}


def _pulled(engine, entity_type):
    entries, _, _ = engine.pull("alice", 0, 1000, set(REGISTRY.specs))
    return [e.change for e in entries if e.change.entity_type == entity_type]


def _app_change(c: Change) -> dict:
    raw = {"change_id": str(uuid.uuid4()), "entity_type": c.entity_type, "entity_id": c.entity_id,
           "parent_id": c.parent_id, "op": c.op, "fields": c.fields, "changed_at": "2026-10-12T12:00:00Z"}
    if c.op in ("delete", "restore"):
        raw.pop("fields")
    return raw


def test_推定を付けて記録すると_同期に書かれ_get_meal_で読める(call, engine):
    meal = call("record_meal", meal=LUNCH_EST)["meals"][0]
    rice, chicken = meal["items"]
    assert {k: rice[k] for k in RICE_EST} == RICE_EST
    assert {k: chicken[k] for k in RICE_EST} == NONE_EST  # 推定していない品目は null
    creates = {c.fields["name"]: c.fields for c in _pulled(engine, "meal_item") if c.op == "create"}
    assert {k: creates["白米"][k] for k in RICE_EST} == RICE_EST
    assert not set(RICE_EST) & set(creates["鶏むね肉"])  # 推定していない項目は書かない（null も書かない）
    assert call("get_meal", meal_id=meal["meal_id"])["items"][0]["sv_staple"] == 2
    for c in _pulled(engine, "meal_item"):  # アプリから送り返しても通る
        assert isinstance(REGISTRY.parse_change(_app_change(c), set(REGISTRY.specs), None), Change)


def test_量を変えると推定の量も同じ割合で変わり_菓子かどうかは変わらない(call, engine):
    meal = call("record_meal", meal=LUNCH_EST)["meals"][0]
    rice = meal["items"][0]["item_id"]
    after = call("update_meal", meal_id=meal["meal_id"], change_amounts=[{"item_id": rice, "amount": 300}])
    item = after["meals"][0]["items"][0]
    # 200g → 300g（1.5倍）：主食 2 → 3、食物繊維 0.6 → 0.9
    assert (item["sv_staple"], item["fiber_g"], item["is_snack_or_sweet_drink"]) == (3, 0.9, False)


def test_推定のない食事を直しても_推定の項目に_null_を書かない(call, engine):
    meal = call("record_meal", meal=LUNCH)["meals"][0]
    chicken = meal["items"][1]["item_id"]
    call("update_meal", meal_id=meal["meal_id"], change_amounts=[{"item_id": chicken, "amount": 150}])
    updates = [c.fields for c in _pulled(engine, "meal_item") if c.op == "update"]
    assert updates and all(not set(RICE_EST) & set(u) for u in updates)


def test_複製といつものも推定を持ち越す(call, engine):
    meal = call("record_meal", meal=LUNCH_EST)["meals"][0]
    copy = call("copy_meal", meal_id=meal["meal_id"], to={"date": "2026-10-13", "slot": "lunch"})["meals"][0]
    assert copy["items"][0]["sv_staple"] == 2
    call("save_template", meal_id=meal["meal_id"], name="いつもの昼")
    templates = [c.fields for c in _pulled(engine, "meal_template")]
    assert templates[0]["items"][0]["sv_staple"] == 2 and "sv_staple" not in templates[0]["items"][1]
    used = call("record_template", name="いつもの昼", when={"date": "2026-10-14", "slot": "lunch"})["meals"][0]
    assert {k: used["items"][0][k] for k in RICE_EST} == RICE_EST


def _item(fields: dict) -> dict:
    base = {"name": "白米", "amount": 200, "unit": "g", "kcal": 312, "protein_g": 5, "fat_g": 0.6, "carbs_g": 74,
            "confidence": "medium", "sort_order": 0}
    return {"change_id": str(uuid.uuid4()), "entity_type": "meal_item", "entity_id": "i1", "parent_id": "m1",
            "op": "create", "fields": {**base, **fields}, "changed_at": "2026-10-12T12:00:00Z"}


def test_アプリからは_推定を送っても送らなくても受け付け_おかしな値は断る():
    types = set(REGISTRY.specs)
    assert isinstance(REGISTRY.parse_change(_item({}), types, None), Change)  # 前の版のアプリ
    assert isinstance(REGISTRY.parse_change(_item(RICE_EST), types, None), Change)
    assert isinstance(REGISTRY.parse_change(_item(NONE_EST), types, None), Change)
    for bad in ({"sv_side": -1}, {"sv_side": 101}, {"salt_g": "2"}, {"is_snack_or_sweet_drink": 1}):
        assert isinstance(REGISTRY.parse_change(_item(bad), types, None), Rejection), bad
