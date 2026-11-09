from dataclasses import dataclass, replace
from datetime import date

from meals.domain.auto_goal import (
    BodyBasis,
    GoalCalc,
    GoalInput,
    Sex,
    body_basis,
    calc_goal,
    check_birth_year,
    missing_inputs,
)
from meals.domain.nutrition_goal import NutritionGoal
from meals.domain.ports import BodyDataProvider, DayTypeRepository, EaterResolver, GoalRepository, GoalSettings
from meals.domain.values import DayType


@dataclass(frozen=True)
class AutoGoal:
    """目標の自動計算の結果。missing が空でなければ calc は None（足りない入力を先に入れてもらう）。"""

    missing: tuple[str, ...]
    basis: BodyBasis | None
    settings: GoalSettings
    target_weight_kg: float | None  # 設定の目標体重。なければ今の目標の目標体重
    current: NutritionGoal | None
    calc: GoalCalc | None


class GoalService:
    """目標と日の種類。どちらも食べた人ごとに決める。"""

    def __init__(self, eaters: EaterResolver, goals: GoalRepository, day_types: DayTypeRepository,
                 body: BodyDataProvider):
        self.eaters, self.goals, self.day_types, self.body = eaters, goals, day_types, body

    async def suggest(self, subject: str, today: date, sex: Sex | None = None,
                      birth_year: int | None = None) -> AutoGoal:
        """体組成の記録と設定から目標の案を計算する（アプリの自動計算と同じ）。保存はしない。

        性別と生まれた年は、体脂肪率がないとき（Mifflin-St Jeor）だけ使う。計算に使うだけで、保存もログもしない。
        """
        if birth_year is not None:
            check_birth_year(birth_year, today.year)
        eater = await self.eaters.resolve(subject)
        days, settings = await self.body.body_days(eater), await self.body.goal_settings(eater)
        current = await self.goals.get(eater)
        basis = body_basis(days, today)
        # アプリと同じく、設定の目標体重を先に使い、なければ今の目標の目標体重
        target = settings.goal_weight_kg if settings.goal_weight_kg is not None else (
            current.target_weight_kg if current else None)
        missing = tuple(missing_inputs(basis, settings.height_cm, sex, birth_year, settings.activity))
        calc = None
        if not missing:
            calc = calc_goal(GoalInput(
                basis.weight_kg, basis.body_fat.pct if basis.body_fat else None, settings.activity, target,
                settings.height_cm, None if birth_year is None else today.year - birth_year, sex))
        return AutoGoal(missing, basis, settings, target, current, calc)

    async def current(self, subject: str) -> NutritionGoal | None:
        return await self.goals.get(await self.eaters.resolve(subject))

    async def set_goals(self, subject: str, goal: NutritionGoal) -> NutritionGoal:
        """goal の eater_id は無視し、トークンの本人のものとして保存する。"""
        goal = replace(goal, eater_id=await self.eaters.resolve(subject))
        await self.goals.save(goal)
        return goal

    async def set_day_type(self, subject: str, day: date, day_type: DayType) -> None:
        await self.day_types.set(await self.eaters.resolve(subject), day, day_type)
