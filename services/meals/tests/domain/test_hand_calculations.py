"""手で計算できる小さなデータで、食事のまとめと体重の道のりの決まりを確かめる（#326）。期待する値は手で計算した数を書く。"""

import asyncio
from datetime import date, timedelta

import pytest

from meals.application.summaries import week_start
from meals.application.weights import WeightService
from meals.domain.body_weight import GoalProgress, WeightRecord
from meals.domain.meal import FoodItem, Meal
from meals.domain.nutrition_goal import DailyTarget, NutritionGoal, Policy
from meals.domain.summary import DailySummary, WeeklyReview
from meals.domain.values import DayType, EatenOn, MealSlot, Nutrition, Quantity, Source, Unit
from meals.presentation import views
from tests.domain.factories import EATER

TODAY = date(2026, 11, 8)  # 日曜
GOAL = NutritionGoal(EATER, Policy.BULK, body_weight_kg=70, protein_per_kg=2.0,
                     training_day=DailyTarget(2800, 70, 380), rest_day=DailyTarget(2400, 70, 280))


def meal(day: date, kcal: float, protein: float = 0, fat: float = 0, carbs: float = 0) -> Meal:
    item = FoodItem("i", "品目", Quantity(1, Unit.PIECE), Nutrition(kcal, protein, fat, carbs))
    return Meal(f"m-{day}-{kcal}", EATER, EatenOn(day, MealSlot.LUNCH), (item,), "", Source.NUMBERS)


def test_週は月曜始まり():
    assert (week_start(TODAY), week_start(date(2026, 11, 9)), week_start(date(2026, 3, 1))) == (
        date(2026, 11, 2), date(2026, 11, 9), date(2026, 2, 23))


def test_期間の平均は記録した日だけ_目標は記録した日の目標の平均_差は平均から目標を引く():
    days = (
        DailySummary(date(2026, 11, 2), DayType.TRAINING, (meal(date(2026, 11, 2), 2000, 100, 50, 300),
                                                           meal(date(2026, 11, 2), 1000, 40, 30, 100)), GOAL),
        DailySummary(date(2026, 11, 3), DayType.REST, (), GOAL),  # 記録がない日は平均に入れない
        DailySummary(date(2026, 11, 4), DayType.REST, (meal(date(2026, 11, 4), 2000, 120, 70, 200),), GOAL),
    )
    review = WeeklyReview(days)
    view = views.weekly(review)
    assert (view["recorded_days"], view["total_days"]) == (2, 3)
    # (3000 + 2000) ÷ 2 ＝ 2500、たんぱく質 (140 + 120) ÷ 2 ＝ 130、脂質 (80 + 70) ÷ 2 ＝ 75、炭水化物 (400 + 200) ÷ 2 ＝ 300
    assert view["average_of_recorded_days"] == {"kcal": 2500, "protein_g": 130, "fat_g": 75, "carbs_g": 300}
    # 目標は筋トレの日 2800 と休みの日 2400 の平均 2600。たんぱく質は 70kg × 2.0 ＝ 140
    assert view["average_target"] == {"kcal": 2600, "protein_g": 140, "fat_g": 70, "carbs_g": 330}
    assert view["gap"] == {"kcal": -100, "protein_g": -10, "fat_g": 5, "carbs_g": -30}
    assert view["days"][1] == {"date": "2026-11-03", "day_type": "rest", "recorded": False, "kcal": 0, "protein_g": 0,
                               "fat_g": 0, "carbs_g": 0, "target_kcal": 2400}


def test_栄養の丸めは_5を上げる_アプリの_Math_round_と同じ():
    # 12.25・0.25 は2進数でちょうど表せるので、Python の round は偶数へ丸めて 12.2・0.2 にしていた
    assert views.nutrition(Nutrition(12.25, 0.25, 0.75, 2.5)) == {"kcal": 12.3, "protein_g": 0.3, "fat_g": 0.8,
                                                                   "carbs_g": 2.5}
    summary = DailySummary(TODAY, DayType.REST, (meal(TODAY, 312.25),), None)
    assert views.daily(summary)["meals"][0]["kcal"] == 312.3


def records(*kgs_by_days_ago):
    return tuple(WeightRecord(EATER, TODAY - timedelta(days=d), kg) for d, kg in sorted(kgs_by_days_ago, reverse=True))


def test_週あたりの変化は_今日を含めて28日の記録から_28日前は入れない():
    goal = NutritionGoal(EATER, Policy.CUT, target_weight_kg=60.0)
    # 28日前（10-11）の 80kg は窓の外（以前は 29日の窓で入り、(70 − 80) ÷ 4週 ＝ −2.5 になっていた）
    # 27日前（10-12）の 72kg 〜 今日の 70kg：−2 ÷ (27 ÷ 7) ＝ −0.5185…
    p = GoalProgress(goal, records((28, 80.0), (27, 72.0), (0, 70.0)), TODAY)
    assert p.weekly_change_kg == pytest.approx(-2 / 27 * 7)
    assert views.progress(p)["weekly_change_kg"] == -0.52
    # あと 10kg、−0.5185…kg／週で 19.28…週
    assert (views.progress(p)["remaining_kg"], views.progress(p)["weeks_to_goal"]) == (-10.0, 19.3)


def test_週あたりの変化の丸めも_5を上げる():
    # 14日で +0.25kg → 週 0.125kg。Python の round(0.125, 2) は 0.12、アプリの Math.round では 0.13
    p = GoalProgress(GOAL, records((14, 70.0), (0, 70.25)), TODAY)
    assert views.progress(p)["weekly_change_kg"] == 0.13


class _Eaters:
    async def resolve(self, subject):
        return EATER


class _Weights:
    def __init__(self):
        self.asked = None

    async def find(self, eater, start, end):
        self.asked = (start, end)
        return []


class _Goals:
    async def get(self, eater):
        return None


def test_道のりの体重は今日を含めて90日():
    weights = _Weights()
    asyncio.run(WeightService(_Eaters(), weights, _Goals()).progress("alice", TODAY))
    assert weights.asked == (TODAY - timedelta(days=89), TODAY)  # 08-11〜11-08（以前は 91日）
