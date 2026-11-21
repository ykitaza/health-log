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


def _day_meal(day: str, side: float, fiber: float, salt: float) -> dict:
    # kcal 1800・脂質 50g（450 ÷ 1800 = 25%）、主食 5・主菜 3・乳 2・果物 2（基本形の欄の幅に入る）
    est = {**RICE_EST, "sv_staple": 5, "sv_side": side, "sv_main": 3, "sv_dairy": 2, "sv_fruit": 2,
           "fiber_g": fiber, "salt_g": salt}
    item = {"name": "定食", "amount": 1, "unit": "個", "kcal": 1800, "protein_g": 80, "fat_g": 50, "carbs_g": 250, **est}
    return {"date": day, "slot": "lunch", "items": [item], "description": "定食", "source": "text"}


def test_今日の状況に_点と前の日との差と伸ばしやすい項目が出る(call):
    call("record_meal", meal=_day_meal("2026-10-11", side=5, fiber=22, salt=6))
    call("record_meal", meal=_day_meal("2026-10-12", side=2, fiber=11, salt=6.5))
    score = call("today_status")["score"]
    # 目標がないので、エネルギーとたんぱく質は記録なし。SV は基本形（2,200±200kcal）の欄。性別がないので厳しいほうの目安
    # 前の日：バランスも控えたいものも満点 → 100
    # 今日：バランス（主食 1、副菜 2/5 = 0.4、主菜 1、乳 1、果物 1、食物繊維 11/22 = 0.5）= 4.9/6 = 0.8167 → 82、
    #   控えたいもの（食塩 6.5g は 6.5g 以下で 1、脂質 25% で 1、菓子 0、お酒 0）= 1 → (0.8167 + 1)/2 = 0.9083 → 91
    # 伸ばしやすいのは副菜：0.6 × 100 ÷ 2 内訳 ÷ 6 項目 = +5（食物繊維は 0.5 × 100 ÷ 12 = 4.17）
    assert (score["points"], score["previous_points"], score["diff"]) == (91, 100, -9)
    assert [p["points"] for p in score["parts"]] == [None, None, 82, 100]
    assert score["easiest"] == {"part": "balance", "item": "sv_side", "advice": "副菜をあと 3 つ", "gain": 5}
    assert score["basis"]["sv_band"] == "2,200±200kcal（基本形）" and score["basis"]["sex"] is None
    assert "厳しいほう" in score["basis"]["note"]
    summary = call("meal_summary", start="2026-10-12", end="2026-10-12")["days"][0]["score"]
    assert (summary["points"], summary["diff"]) == (91, -9)  # 期間の最初の日も、前の日との差が出る
