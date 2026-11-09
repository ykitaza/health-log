"""MCP の食事のツールで書いた変更が、アプリから届く変更と同じ決まりを通ることを確かめる。

MCP で書いた変更も同期でアプリに降りるので、アプリから送り返されたときに断られる値を書いてはいけない。
アプリから届いた値をドメインが断るときは、その対象だけを飛ばし、ログに残す（一覧ごとは失敗しない）。
"""

import asyncio
import logging
import uuid
from datetime import date

import pytest
from mcp.server.auth.provider import AccessToken
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

from meals.application.goals import GoalService
from meals.application.meals import MealService
from meals.application.summaries import SummaryService
from meals.application.templates import TemplateService
from meals.application.weights import WeightService
from meals.domain.values import EaterId
from meals.infrastructure import memory_repositories as memory
from meals.infrastructure import sync_repositories as synced
from meals.infrastructure.subject_as_eater_id import SubjectAsEaterId
from meals.presentation import mcp_server
from sync.model import Change
from tests.presentation.test_mcp_server import GOALS, LUNCH
from tests.sync.conftest import REGISTRY, memory_engine
from tests.sync.test_existing_suites import _caller, _repos

ALICE = EaterId("alice")


@pytest.fixture
def engine():
    return memory_engine()


@pytest.fixture
def call(monkeypatch, engine):
    """同期の実装の上で、食事のツールを呼ぶ（engine で書いた変更を見られるように）。"""
    token = AccessToken(token="t", client_id="c", scopes=["meals:read", "meals:write"], subject="alice")
    monkeypatch.setattr(mcp_server, "get_access_token", lambda: token)
    meals, templates, goals, day_types = _repos(engine)
    eaters = SubjectAsEaterId()
    services = mcp_server.Services(
        MealService(eaters, meals), TemplateService(eaters, meals, templates), GoalService(eaters, goals, day_types),
        SummaryService(eaters, meals, goals, day_types), WeightService(eaters, memory.InMemoryWeightRepository(), goals))
    mcp = MCPServer(name="test")
    mcp_server.register_meal_tools(mcp, services, today=lambda: date(2026, 10, 12))
    return _caller(mcp, None)


def test_書いた変更は_アプリから届く変更と同じ確かめ方を通る(call, engine):
    meal = call("record_meal", meal=LUNCH)["meals"][0]
    call("record_meals", meals=[{**LUNCH, "slot": "dinner", "time": "19:30"}])
    rice, chicken = (i["item_id"] for i in meal["items"])
    call("update_meal", meal_id=meal["meal_id"], change_amounts=[{"item_id": rice, "amount": 150}],
         add_items=[{**LUNCH["items"][0], "name": "味噌汁", "unit": "杯", "amount": 1}], remove_item_ids=[chicken],
         move_to={"date": "2026-10-11", "slot": "dinner"})
    copy = call("copy_meal", meal_id=meal["meal_id"], to={"date": "2026-10-12", "slot": "breakfast"})["meals"][0]
    call("save_template", meal_id=meal["meal_id"], name="いつもの昼")
    call("record_template", name="いつもの昼", when={"date": "2026-10-13", "slot": "lunch"})
    call("set_goals", **GOALS, eating_style="home_cooked", target_weight_kg=72)
    call("set_goals", policy="maintain")
    call("set_day_type", day_type="training")
    call("delete_meal", meal_id=copy["meal_id"])

    entries, _, _ = engine.pull("alice", 0, 1000, set(REGISTRY.specs))
    assert {e.change.entity_type for e in entries} == set(REGISTRY.specs)  # 食事の種類はどれも書いた
    assert {e.change.op for e in entries} == {"create", "update", "delete"}
    for e in entries:
        c = e.change
        raw = {"change_id": str(uuid.uuid4()), "entity_type": c.entity_type, "entity_id": c.entity_id,
               "parent_id": c.parent_id, "op": c.op, "fields": c.fields, "changed_at": "2026-10-12T12:00:00Z"}
        if c.op in ("delete", "restore"):
            raw.pop("fields")
        assert isinstance(REGISTRY.parse_change(raw, set(REGISTRY.specs), None), Change), (c, raw)


@pytest.mark.parametrize("item", [
    {"name": "   "},  # 空白だけ（同期とドメインでそろえる）
    {"name": "x" * 201},
    {"kcal": 20001},
    {"protein_g": 5001},
    {"amount": 100001},
])
def test_同期の上限を超える入力は断る(call, engine, item):
    with pytest.raises(ToolError):
        call("record_meal", meal={**LUNCH, "items": [{**LUNCH["items"][0], **item}]})
    assert engine.head("alice") == 0


@pytest.mark.parametrize("tool, arguments", [
    ("set_goals", {"policy": "bulk", "protein_per_kg": 6}),
    ("set_goals", {"policy": "bulk", "body_weight_kg": 301}),
    ("set_goals", {"policy": "bulk", "training_day": {"kcal": 20001, "fat_g": 1, "carbs_g": 1},
                   "rest_day": {"kcal": 2000, "fat_g": 1, "carbs_g": 1}}),
    ("record_meal", {"meal": {**LUNCH, "description": "x" * 2001}}),
])
def test_同期の上限を超える目標や説明は断る(call, engine, tool, arguments):
    with pytest.raises(ToolError):
        call(tool, **arguments)
    assert engine.head("alice") == 0


def test_空白だけの名前のいつものは断る(call, engine):
    meal = call("record_meal", meal=LUNCH)["meals"][0]
    head = engine.head("alice")
    with pytest.raises(ToolError):
        call("save_template", meal_id=meal["meal_id"], name="  ")
    assert engine.head("alice") == head


def test_量を変えて同期の上限を超えるときは_何も書かずに断る(call, engine):
    meal = call("record_meal", meal=LUNCH)["meals"][0]  # 白米 200g で 312kcal
    head = engine.head("alice")
    with pytest.raises(ToolError, match="kcal"):
        call("update_meal", meal_id=meal["meal_id"],
             change_amounts=[{"item_id": meal["items"][0]["item_id"], "amount": 20000}])  # 31200kcal になる
    assert engine.head("alice") == head
    assert call("get_meal", meal_id=meal["meal_id"])["items"][0]["amount"] == 200


def _app_writes(engine, *changes):
    """アプリから届いた形の変更を、確かめずに書く（前の形のデータや、決まりを変える前に届いた値の代わり）。"""
    engine.append("alice", [Change(str(uuid.uuid4()), t, i, p, "create", f, "2026-10-12T00:00:00.000Z", "app")
                            for t, i, p, f in changes])


ITEM = {"amount": 1, "unit": "個", "kcal": 1, "protein_g": 0, "fat_g": 0, "carbs_g": 0, "confidence": "high",
        "sort_order": 0}


def test_ドメインが断る食事は_一覧から飛ばしてログに残す(call, engine, caplog):
    call("record_meal", meal=LUNCH)
    _app_writes(engine, ("meal", "bad", None, {"date": "2026-10-12", "slot": "dinner", "description": "", "source": "text"}),
                ("meal_item", "i1", "bad", {**ITEM, "name": "  "}))
    with caplog.at_level(logging.WARNING, logger=synced.__name__):
        meals = call("list_meals", start="2026-10-12", end="2026-10-12")["meals"]
    assert [m["slot"] for m in meals] == ["lunch"]
    assert "bad" in caplog.text


def test_ドメインが断るいつものは_一覧から飛ばしてログに残す(engine, caplog):
    _, templates, _, _ = _repos(engine)
    good = {"name": "朝", "items": [{**{k: v for k, v in ITEM.items() if k != "sort_order"}, "name": "卵"}]}
    bad = {"name": "  ", "items": good["items"]}
    _app_writes(engine, ("meal_template", "t-good", None, good), ("meal_template", "t-bad", None, bad))
    with caplog.at_level(logging.WARNING, logger=synced.__name__):
        found = asyncio.run(templates.list(ALICE))
    assert [t.name for t in found] == ["朝"]
    assert "t-bad" in caplog.text


def test_ドメインが断る目標は_未設定として扱いログに残す(call, engine, caplog):
    target = {"kcal": -1, "fat_g": 1, "carbs_g": 1}
    _app_writes(engine, ("nutrition_goal", "current", None,
                         {"policy": "bulk", "targets": {"training_day": target, "rest_day": target}}))
    with caplog.at_level(logging.WARNING, logger=synced.__name__):
        status = call("today_status")
    assert status["goal"] is None and "note" in status
    assert "nutrition_goal" in caplog.text
    call("set_goals", policy="maintain")  # 保存し直せる
    assert call("today_status")["goal"]["policy"] == "maintain"


@pytest.mark.parametrize("entity_type, entity_id, parent_id, fields", [
    ("meal_item", "i1", "m1", {**ITEM, "name": " 　"}),  # 全角の空白も
    ("meal_template", synced.template_id("  "), None, {"name": "  ", "items": [{
        **{k: v for k, v in ITEM.items() if k != "sort_order"}, "name": "卵"}]}),
])
def test_アプリから届く空白だけの名前も断る(entity_type, entity_id, parent_id, fields):
    # ドメインと同じく、前後の空白を除いてから確かめる（値は変えずに保存する）
    raw = {"change_id": str(uuid.uuid4()), "entity_type": entity_type, "entity_id": entity_id,
           "parent_id": parent_id, "op": "create", "fields": fields, "changed_at": "2026-10-12T12:00:00Z"}
    assert not isinstance(REGISTRY.parse_change(raw, set(REGISTRY.specs), None), Change)
    raw["fields"] = {**fields, "name": " 卵 "}
    raw["entity_id"] = synced.template_id(" 卵 ") if entity_type == "meal_template" else entity_id
    assert isinstance(REGISTRY.parse_change(raw, set(REGISTRY.specs), None), Change)


def test_推定の根拠を記録すると_同期の項目に入り_複製にも残り_量を直しても消えない(call, engine):
    basis = "ごはんは茶碗1杯 150g として"
    meal = call("record_meal", meal={**LUNCH, "basis": basis})["meals"][0]
    assert meal["basis"] == basis
    rice = meal["items"][0]["item_id"]
    call("update_meal", meal_id=meal["meal_id"], change_amounts=[{"item_id": rice, "amount": 100}])
    assert call("get_meal", meal_id=meal["meal_id"])["basis"] == basis
    copy = call("copy_meal", meal_id=meal["meal_id"], to={"date": "2026-10-13", "slot": "lunch"})["meals"][0]
    assert copy["basis"] == basis
    doc = engine.doc("alice", "meal", meal["meal_id"])
    assert doc.own.values["basis"] == basis


def test_推定の根拠がない食事は_basis_を書かず_null_を返す(call, engine):
    meal = call("record_meal", meal=LUNCH)["meals"][0]
    assert meal["basis"] is None
    assert "basis" not in engine.doc("alice", "meal", meal["meal_id"]).own.values


def test_推定の根拠は1000文字まで(call):
    with pytest.raises(ToolError, match="basis"):
        call("record_meal", meal={**LUNCH, "basis": "あ" * 1001})


def test_アプリの食事の_basis_は_null_でも受け付ける():
    raw = {"change_id": str(uuid.uuid4()), "entity_type": "meal", "entity_id": str(uuid.uuid4()), "op": "create",
           "fields": {"date": "2026-10-12", "slot": "lunch", "time": None, "description": "", "source": "text",
                      "basis": None}, "changed_at": "2026-10-12T12:00:00Z"}
    assert isinstance(REGISTRY.parse_change(raw, set(REGISTRY.specs), "pixel"), Change)
