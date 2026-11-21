"""アプリ（apps/karada/lib/__tests__/meals-shared.test.ts）と同じテストのデータ（testdata/meals/*.json）で確かめる。

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
from meals.domain.auto_goal import Sex
from meals.domain.meal import FoodItem, Meal
from meals.domain.meal_score import meal_score, sv_band
from meals.domain.nutrition_goal import DailyTarget, NutritionGoal, Policy, Target
from meals.domain.summary import DailySummary, WeeklyReview
from meals.domain.values import (
    ESTIMATE_FIELDS, Confidence, DayType, DietEstimate, EatenOn, EaterId, MealSlot, Nutrition, NutritionGap, Quantity, Source, Unit,
)
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


# --- slots.json：時刻から決める食事の区分（アプリの slotAt と同じ） ---

def test_時刻から決める区分はアプリと同じ():
    from datetime import time

    from meals.domain.values import MealSlot

    cases = load("slots.json")["cases"]
    assert [c["hour"] for c in cases] == list(range(24))
    assert [MealSlot.from_time(time(c["hour"], 0)).value for c in cases] == [c["slot"] for c in cases]
    assert [MealSlot.from_time(time(c["hour"], 59)).value for c in cases] == [c["slot"] for c in cases]


# --- auto_goal.json：目標の自動計算（アプリの lib/autoGoal.ts と同じ数字） ---

def _basis_view(b):
    if b is None:
        return None
    fat = b.body_fat
    return {"weight_kg": b.weight_kg, "weight_from": b.weight_from.isoformat(), "weight_to": b.weight_to.isoformat(),
            "weight_days": b.weight_days, "body_fat": None if fat is None else {
                "pct": fat.pct, "from": fat.start.isoformat(), "to": fat.end.isoformat(), "days": fat.days}}


def _target_view(t):
    return {"kcal": t.kcal, "fat_g": t.fat_g, "carbs_g": t.carbs_g}


@pytest.mark.parametrize("case", load("auto_goal.json")["cases"], ids=lambda c: c["name"])
def test_目標の自動計算はアプリと同じ(case):
    """アプリの画面と同じ組み立て（設定の目標体重 → 今の目標の目標体重、年齢は今日の年 − 生まれた年）を、GoalService で通す。"""
    from meals.application.goals import GoalService
    from meals.domain.auto_goal import Activity, BodyDay
    from meals.domain.ports import GoalSettings
    from meals.infrastructure import memory_repositories as memory

    eaters, goals, body = SubjectAsEaterId(), memory.InMemoryGoalRepository(), memory.InMemoryBodyData()
    eater = EaterId(USER)
    body.days[eater] = [BodyDay(date.fromisoformat(d["date"]), d["weight_kg"], d["body_fat_pct"]) for d in case["days"]]
    s = case["settings"]
    body.settings[eater] = GoalSettings(s["height_cm"], s["goal_weight_kg"], Activity(s["activity"]) if s["activity"] else None)
    if case["current_goal_target_weight_kg"] is not None:
        asyncio.run(goals.save(NutritionGoal(eater, Policy.MAINTAIN, target_weight_kg=case["current_goal_target_weight_kg"])))
    p = case["profile"]
    service = GoalService(eaters, goals, memory.InMemoryDayTypeRepository(), body)
    r = asyncio.run(service.suggest(USER, date.fromisoformat(case["today"]),
                                    Sex(p["sex"]) if p["sex"] else None, p["birth_year"]))
    expected = case["expected"]
    assert list(r.missing) == expected["missing"]
    assert _basis_view(r.basis) == expected["basis"]
    c = r.calc
    got = None if c is None else {
        "bmr": c.bmr, "bmr_method": c.bmr_method, "tdee_rest": c.tdee_rest, "tdee_training": c.tdee_training,
        "policy": c.policy.value, "weekly_kg": c.weekly_kg, "daily_delta": c.daily_delta, "floored": c.floored,
        "body_weight_kg": c.body_weight_kg, "protein_g": c.protein_g,
        "training": _target_view(c.training), "rest": _target_view(c.rest)}
    assert got == expected["calc"]


# --- meal_score.json：食事のスコア（アプリの lib/mealScore.ts と同じ点。期待する値は手で計算した数） ---

def _score_item(n: int, v: dict) -> FoodItem:
    return FoodItem(f"i{n}", f"品目{n}", Quantity(1, Unit.PIECE), Nutrition(v["kcal"], v["protein_g"], v["fat_g"], 0),
                    estimate=DietEstimate.of(v))


@pytest.mark.parametrize("case", load("meal_score.json")["cases"], ids=lambda c: c["name"])
def test_食事のスコアはアプリと同じ(case):
    items = tuple(_score_item(n, v) for n, v in enumerate(case["items"]))
    meals = (Meal("m", EaterId(USER), EatenOn(date(2026, 11, 20), MealSlot.LUNCH), items, "", Source.TEXT),) if items else ()
    t = case["target"]
    target = None if t is None else Target(kcal=t["kcal"], protein_g=t["protein_g"])
    s = meal_score(meals, target, Sex(case["sex"]) if case["sex"] else None, case["in_progress"])
    got = None if s is None else {
        "score": s.score,
        "parts": {p.key: s.part_points(p) for p in s.parts},
        "easiest": None if s.easiest is None else {"part": s.easiest.part, "key": s.easiest.item.key,
                                                   "advice": s.easiest.item.advice, "gain": s.easiest.gain},
        "band": {"label": s.band.label, "from_target": s.band_from_target},
        "deferred": [p.key for p in s.parts if p.deferred],
    }
    assert got == case["expected"]


def _score_meals(items: list[dict], day: date) -> tuple[Meal, ...]:
    found = tuple(_score_item(n, v) for n, v in enumerate(items))
    return (Meal(f"m{day}", EaterId(USER), EatenOn(day, MealSlot.LUNCH), found, "", Source.TEXT),) if found else ()


@pytest.mark.parametrize("case", load("meal_score.json")["diffs"], ids=lambda c: c["name"])
def test_前の日との差は同じ規則で数えた点どうし_アプリと同じ(case):
    today, before = date(2026, 11, 20), date(2026, 11, 19)
    sex = Sex(case["sex"]) if case["sex"] else None
    goal, day_type = _goal(case["goal"]), DayType(case["day_type"])
    previous = DailySummary(before, day_type, _score_meals(case["previous"], before), goal, sex)
    s = DailySummary(today, day_type, _score_meals(case["today"], today), goal, sex, previous, in_progress=case["in_progress"])
    assert {"points": s.score.score, "previous_points": s.previous_score.score, "diff": s.score_diff} == case["expected"]


@pytest.mark.parametrize("case", load("meal_score.json")["bands"], ids=lambda c: str(c["kcal"]))
def test_SVの目安の欄はアプリと同じ(case):
    band, from_target = sv_band(case["kcal"])
    assert (band.label, from_target) == (case["label"], case["from_target"])


@pytest.mark.parametrize("case", load("meal_score.json")["change_amount"], ids=lambda c: c["name"])
def test_量を変えると推定も同じ割合で変わる(case):
    b = case["before"]
    item = FoodItem("x", "品目", Quantity(b["amount"], Unit(b["unit"])), Nutrition(b["kcal"], b["protein_g"], b["fat_g"], b["carbs_g"]),
                    Confidence.HIGH, DietEstimate.of(b))
    after = item.with_amount(case["amount"])
    assert {"amount": after.quantity.amount, "unit": after.quantity.unit.value, **nutrition(after.nutrition),
            **{k: getattr(after.estimate, k) for k in ESTIMATE_FIELDS}} == case["after"]
