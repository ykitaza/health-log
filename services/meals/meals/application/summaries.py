from datetime import date, timedelta

from meals.domain.ports import DayTypeRepository, EaterResolver, GoalRepository, MealRepository, TrainingDayProvider
from meals.domain.summary import DailySummary, WeeklyReview
from meals.domain.values import DayType, EaterId

# 日の種類を本人が決めていない日は、筋トレの記録があれば筋トレの日、なければ休みの日として計算する（利用者に聞かない）
DEFAULT_DAY_TYPE = DayType.REST


def week_start(day: date) -> date:
    """その週の月曜（週は月曜〜日曜。筋トレの週と同じ）。"""
    return day - timedelta(days=day.weekday())


class NoTrainingDays:
    """筋トレの記録をつながないとき（食事だけで動かすとき）。どの日も筋トレの記録はない。"""

    async def training_days(self, eater_id: EaterId, start: date, end: date) -> set[date]:
        return set()


class SummaryService:
    """今日の合計と残り、週のふり返り。保存せず、その都度計算する。"""

    def __init__(
        self,
        eaters: EaterResolver,
        meals: MealRepository,
        goals: GoalRepository,
        day_types: DayTypeRepository,
        training_days: TrainingDayProvider | None = None,
    ):
        self.eaters, self.meals, self.goals, self.day_types = eaters, meals, goals, day_types
        self.training_days = training_days or NoTrainingDays()

    async def daily(self, subject: str, day: date) -> DailySummary:
        eater = await self.eaters.resolve(subject)
        return await self._daily(eater, day, await self.training_days.training_days(eater, day, day))

    async def weekly(self, subject: str, day: date) -> WeeklyReview:
        """day を含む週（月曜〜日曜の7日間）。"""
        start = week_start(day)
        return await self.period(subject, start, start + timedelta(days=6))

    async def period(self, subject: str, start: date, end: date) -> WeeklyReview:
        """start から end まで（両端を含む）の日ごとのまとめ（週・月のふり返り）。期間の長さは呼ぶ側が決める。"""
        eater = await self.eaters.resolve(subject)
        trained = await self.training_days.training_days(eater, start, end)  # 期間の分を1回で読む
        return WeeklyReview(tuple(
            [await self._daily(eater, start + timedelta(days=n), trained) for n in range((end - start).days + 1)]))

    async def _daily(self, eater: EaterId, day: date, trained: set[date]) -> DailySummary:
        # 本人が決めた日の種類がいちばん強い。決めていなければ、筋トレの記録があるか
        chosen = await self.day_types.get(eater, day)
        day_type = chosen or (DayType.TRAINING if day in trained else DEFAULT_DAY_TYPE)
        meals = tuple(await self.meals.find(eater, day, day))
        return DailySummary(day, day_type, meals, await self.goals.get(eater))
