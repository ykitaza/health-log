"""日の種類：本人が決めた日はそれを、決めていない日は筋トレの記録があれば筋トレの日にする。"""

import asyncio
from datetime import date

from application.summaries import SummaryService
from domain.nutrition_goal import DailyTarget, NutritionGoal, Policy
from domain.values import DayType, EaterId
from infrastructure import memory_repositories as memory
from infrastructure.subject_as_eater_id import SubjectAsEaterId

MON, TUE, WED = date(2026, 11, 2), date(2026, 11, 3), date(2026, 11, 4)


class FakeTrainingDays:
    """TrainingDayProvider の代わり。alice は月と火に筋トレの記録がある。"""

    def __init__(self):
        self.calls = []

    async def training_days(self, eater_id, start, end):
        self.calls.append((start, end))
        days = {MON, TUE} if eater_id == EaterId("alice") else set()
        return {d for d in days if start <= d <= end}


def service(training_days=None):
    goals, day_types = memory.InMemoryGoalRepository(), memory.InMemoryDayTypeRepository()
    asyncio.run(goals.save(NutritionGoal(EaterId("alice"), Policy.BULK, 70, 2.0, DailyTarget(2800, 70, 380),
                                         DailyTarget(2400, 70, 280))))
    return SummaryService(SubjectAsEaterId(), memory.InMemoryMealRepository(), goals, day_types,
                          training_days), day_types


def test_筋トレの記録がある日は筋トレの日の目標になる():
    s, _ = service(FakeTrainingDays())
    assert asyncio.run(s.daily("alice", MON)).day_type == DayType.TRAINING
    assert asyncio.run(s.daily("alice", MON)).target.kcal == 2800
    assert asyncio.run(s.daily("alice", WED)).day_type == DayType.REST
    assert asyncio.run(s.daily("bob", MON)).day_type == DayType.REST  # ほかの人の記録では決まらない


def test_本人が決めた日の種類を優先する():
    s, day_types = service(FakeTrainingDays())
    asyncio.run(day_types.set(EaterId("alice"), MON, DayType.REST))
    asyncio.run(day_types.set(EaterId("alice"), WED, DayType.TRAINING))
    assert asyncio.run(s.daily("alice", MON)).day_type == DayType.REST
    assert asyncio.run(s.daily("alice", WED)).day_type == DayType.TRAINING


def test_週のふり返りは7日分を1回で読む():
    provider = FakeTrainingDays()
    s, _ = service(provider)
    review = asyncio.run(s.weekly("alice", date(2026, 11, 8)))
    assert [d.day_type for d in review.days][:3] == [DayType.TRAINING, DayType.TRAINING, DayType.REST]
    assert provider.calls == [(MON, date(2026, 11, 8))]


def test_筋トレをつながないときは_今までどおり休みの日():
    s, _ = service()
    assert asyncio.run(s.daily("alice", MON)).day_type == DayType.REST
