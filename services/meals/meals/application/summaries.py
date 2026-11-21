from dataclasses import replace
from datetime import date, timedelta
from typing import Protocol

from meals.domain.auto_goal import Sex
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


class SexSetting(Protocol):
    """アプリの設定の性別（食事のスコアの性別で変わる目安に使う）。つなぐのは組み立ての場所。"""

    async def sex(self, eater_id: EaterId) -> Sex | None:
        """設定していない・同期していなければ None（推測しない）。"""
        ...


class NoSexSetting:
    async def sex(self, eater_id: EaterId) -> Sex | None:
        return None


class SummaryService:
    """今日の合計と残り、週のふり返り。保存せず、その都度計算する。"""

    def __init__(
        self,
        eaters: EaterResolver,
        meals: MealRepository,
        goals: GoalRepository,
        day_types: DayTypeRepository,
        training_days: TrainingDayProvider | None = None,
        sex: SexSetting | None = None,
    ):
        self.eaters, self.meals, self.goals, self.day_types = eaters, meals, goals, day_types
        self.training_days = training_days or NoTrainingDays()
        self.sex = sex or NoSexSetting()

    async def daily(self, subject: str, day: date) -> DailySummary:
        """その日のまとめ。食事のスコアの前の日との差のため、前の日も読む。"""
        return (await self.period(subject, day, day)).days[0]

    async def weekly(self, subject: str, day: date) -> WeeklyReview:
        """day を含む週（月曜〜日曜の7日間）。"""
        start = week_start(day)
        return await self.period(subject, start, start + timedelta(days=6))

    async def period(self, subject: str, start: date, end: date) -> WeeklyReview:
        """start から end まで（両端を含む）の日ごとのまとめ（週・月のふり返り）。期間の長さは呼ぶ側が決める。

        食事のスコアの前の日との差のため、start の前の日も読む（期間の日には入れない）。
        """
        eater = await self.eaters.resolve(subject)
        before = start - timedelta(days=1)
        trained = await self.training_days.training_days(eater, before, end)  # 期間の分を1回で読む
        goal, sex = await self.goals.get(eater), await self.sex.sex(eater)
        previous = await self._daily(eater, before, trained, goal, sex)
        days = []
        for n in range((end - start).days + 1):
            previous = replace(await self._daily(eater, start + timedelta(days=n), trained, goal, sex),
                               previous=replace(previous, previous=None))  # 前の日の前の日は持たない
            days.append(previous)
        return WeeklyReview(tuple(days))

    async def _daily(self, eater: EaterId, day: date, trained: set[date], goal, sex: Sex | None) -> DailySummary:
        # 本人が決めた日の種類がいちばん強い。決めていなければ、筋トレの記録があるか
        chosen = await self.day_types.get(eater, day)
        day_type = chosen or (DayType.TRAINING if day in trained else DEFAULT_DAY_TYPE)
        meals = tuple(await self.meals.find(eater, day, day))
        return DailySummary(day, day_type, meals, goal, sex)
