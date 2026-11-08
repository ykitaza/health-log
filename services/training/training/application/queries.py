"""筋トレの読み取りのユースケース（MCP のツールから呼ぶ）。本人は検証済みのトークンの sub で受け取る。"""

from __future__ import annotations

from dataclasses import dataclass

from training.domain import body, calculations
from training.domain.catalog import Catalog
from training.domain.model import TraineeId, Workout
from training.domain.ports import TrainingRepository


@dataclass(frozen=True)
class WeeklyTrainingReview:
    today: str
    totals: calculations.PeriodTotals
    weekly_volumes: list[float]  # [0] が今週
    by_body_part: list[calculations.WeeklyByPart]  # 古い順
    training_days: list[str]


@dataclass(frozen=True)
class ExerciseHistory:
    exercise_id: str
    series: list[calculations.DailyPoint]
    personal_best: calculations.PersonalBest | None


@dataclass(frozen=True)
class BodyProgress:
    days: list[body.DailyBody]  # 期間の中の、日ごとの値（古い順）
    latest: body.DailyBody | None  # 期間の中でいちばん新しい日
    weekly_pace: float | None  # 直近28日の体重のペース（kg／週）


class TrainingQueries:
    def __init__(self, repository: TrainingRepository):
        self.repository = repository

    async def catalog(self, subject: str) -> Catalog:
        return await self.repository.catalog(TraineeId(subject))

    async def workout(self, subject: str, day: str) -> Workout:
        return await self.repository.workout(TraineeId(subject), day)

    async def workouts(self, subject: str, start: str, end: str) -> list[Workout]:
        return await self.repository.workouts(TraineeId(subject), start, end)

    async def training_dates(self, subject: str, start: str, end: str) -> list[str]:
        """start から end まで（両端を含む）の、セットの記録がある日。"""
        rows = await self.repository.set_rows(TraineeId(subject))
        return [d for d in calculations.training_dates(rows) if start <= d <= end]

    async def personal_bests_before(self, subject: str, day: str) -> dict[str, calculations.PersonalBest]:
        """その日より前の、種目ごとの自己ベスト（その日の記録が自己ベストを超えたかを見るため）。"""
        return calculations.personal_bests(await self.repository.set_rows(TraineeId(subject)), before_date=day)

    async def weekly_review(self, subject: str, today: str, weeks: int = 8) -> WeeklyTrainingReview:
        rows = await self.repository.set_rows(TraineeId(subject))
        return WeeklyTrainingReview(
            today,
            calculations.period_totals(rows, today),
            calculations.weekly_volumes(rows, today, weeks),
            calculations.weekly_volume_by_body_part(rows, today, weeks),
            [d for d in calculations.training_dates(rows) if d <= today],
        )

    async def exercise_history(self, subject: str, exercise_id: str) -> ExerciseHistory:
        rows = await self.repository.set_rows(TraineeId(subject))
        return ExerciseHistory(exercise_id, calculations.exercise_daily_series(rows, exercise_id),
                               calculations.personal_bests(rows).get(exercise_id))

    async def daily_body(self, subject: str) -> list[body.DailyBody]:
        return body.daily_body_values(await self.repository.body_records(TraineeId(subject)))

    async def body_progress(self, subject: str, start: str, today: str) -> BodyProgress:
        all_days = await self.daily_body(subject)
        days = [d for d in all_days if start <= d.date <= today]
        weights = [(d.date, d.weight_kg) for d in all_days if d.weight_kg is not None]
        return BodyProgress(days, days[-1] if days else None, body.weekly_pace(weights, today))
