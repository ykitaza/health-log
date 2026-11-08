"""アプリ（apps/mobile/lib/__tests__/meals-shared.test.ts）と同じテストのデータ（testdata/meals/*.json）で確かめる。

summaries.json：アプリから届く変更（changes）を同期の仕組みで当てはめ、
- 当てはめたあとの状態（states。同じ項目は新しい方、削除が勝つ）が、アプリが受け取る状態と同じ
- その状態から読んだ1日の合計・目標・残りと、週のふり返り（平均は記録した日だけ）が expected と同じ
になることを確かめる。アプリは states から同じ計算をして、同じ expected になることを確かめる（小数の誤差まで）。
"""

import asyncio
import json
from datetime import date
from pathlib import Path

import pytest

from meals.application.summaries import SummaryService
from meals.domain.meal import FoodItem
from meals.domain.nutrition_goal import DailyTarget, NutritionGoal, Policy, Target
from meals.domain.summary import DailySummary, WeeklyReview
from meals.domain.values import Confidence, DayType, EaterId, Nutrition, NutritionGap, Quantity, Unit
from meals.infrastructure.subject_as_eater_id import SubjectAsEaterId
from meals.infrastructure.sync_entities import template_id
from meals.infrastructure.sync_repositories import SyncDayTypeRepository, SyncGoalRepository, SyncMealRepository
from sync.model import Change
from tests.sync.conftest import memory_engine

TESTDATA = Path(__file__).parents[3] / "testdata" / "meals"
USER = "alice"
# 受け付けた時刻。どの変更の時刻よりもあとにして、変更の時刻（changed_at）で当てはめる
RECEIVED_AT = "2026-11-09T00:00:00.000Z"


def load(name: str) -> dict:
    return json.loads((TESTDATA / name).read_text())


def nutrition(n: Nutrition | NutritionGap | Target | None) -> dict | None:
    if n is None:
        return None
    return {"kcal": n.kcal, "protein_g": n.protein_g, "fat_g": n.fat_g, "carbs_g": n.carbs_g}


class Trained:
    def __init__(self, days: list[str]):
        self.days = {date.fromisoformat(d) for d in days}

    async def training_days(self, eater_id, start, end):
        return {d for d in self.days if start <= d <= end}


def daily_view(s: DailySummary) -> dict:
    return {
        "date": s.day.isoformat(), "day_type": s.day_type.value,
        "meals": [{"meal_id": m.id, "slot": m.eaten_on.slot.value, "item_ids": [i.id for i in m.items],
                   "total": nutrition(m.total())} for m in s.meals],
        "total": nutrition(s.total), "target": nutrition(s.target), "remaining": nutrition(s.remaining),
    }


def weekly_view(r: WeeklyReview) -> dict:
    return {
        "recorded_days": len(r.recorded_days), "average": nutrition(r.average),
        "average_target": nutrition(r.average_target), "gap": nutrition(r.gap),
        "days": [{"date": d.day.isoformat(), "day_type": d.day_type.value, "recorded": bool(d.meals),
                  "total": nutrition(d.total)} for d in r.days],
    }


def compute(data: dict) -> dict:
    """changes を当てはめ、状態と、1日・週のまとめを出す（期待値の生成にも使う）。"""
    engine = memory_engine(clock=lambda: RECEIVED_AT)
    engine.append(USER, [Change(**c) for c in data["changes"]])
    summaries = SummaryService(SubjectAsEaterId(), SyncMealRepository(engine), SyncGoalRepository(engine),
                               SyncDayTypeRepository(engine), Trained(data["training_days"]))
    week = asyncio.run(summaries.weekly(USER, date.fromisoformat(data["last_day"])))
    return {"daily": [daily_view(d) for d in week.days], "weekly": weekly_view(week), "engine": engine}


def state_view(engine, entity_type: str, entity_id: str, parent_id: str | None) -> dict:
    doc = engine.doc(USER, "meal" if entity_type == "meal_item" else entity_type, parent_id or entity_id)
    state = doc.children[entity_id] if entity_type == "meal_item" else doc.own
    v = state.view()
    return {k: v[k] for k in ("entity_type", "entity_id", "parent_id", "fields", "deleted", "created_at")}


def test_当てはめた状態が_アプリの受け取る状態と同じ():
    data = load("summaries.json")
    engine = compute(data)["engine"]
    for expected in data["states"]:
        assert state_view(engine, expected["entity_type"], expected["entity_id"], expected["parent_id"]) == expected


def test_1日のまとめと週のふり返り():
    data = load("summaries.json")
    result = compute(data)
    assert result["daily"] == data["expected"]["daily"]
    assert result["weekly"] == data["expected"]["weekly"]


def _goal(fields: dict | None) -> NutritionGoal | None:
    if fields is None:
        return None
    t = fields.get("targets")
    return NutritionGoal(EaterId(USER), Policy(fields["policy"]), fields.get("body_weight_kg"), fields.get("protein_per_kg"),
                         DailyTarget(**t["training_day"]) if t else None, DailyTarget(**t["rest_day"]) if t else None)


@pytest.mark.parametrize("case", load("targets.json")["cases"], ids=lambda c: c["name"])
def test_目標と残り(case):
    eaten = Nutrition(**case["eaten"])
    summary = DailySummary(date(2026, 11, 8), DayType(case["day_type"]), (), _goal(case["goal"]))
    target = summary.target
    assert nutrition(target) == case["target"]
    assert nutrition(target.remaining(eaten) if target else None) == case["remaining"]


@pytest.mark.parametrize("case", load("templates.json")["template_ids"])
def test_いつもののIDは名前から決める(case):
    assert template_id(case["name"]) == case["id"]


@pytest.mark.parametrize("case", load("templates.json")["change_amount"])
def test_量を変えると栄養も同じ割合で変わる(case):
    before = case["before"]
    item = FoodItem("x", "白米", Quantity(before["amount"], Unit(before["unit"])),
                    Nutrition(before["kcal"], before["protein_g"], before["fat_g"], before["carbs_g"]), Confidence.HIGH)
    after = item.with_amount(case["amount"])
    assert {"amount": after.quantity.amount, "unit": after.quantity.unit.value, **nutrition(after.nutrition)} == case["after"]
