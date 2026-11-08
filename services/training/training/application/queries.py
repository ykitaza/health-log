"""筋トレの読み取りのユースケース。あとで MCP のツール（presentation）から呼ぶ。本人は検証済みのトークンの sub で受け取る。"""

from __future__ import annotations

from dataclasses import dataclass

from training.domain import body, calculations
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


class TrainingQueries:
    def __init__(self, repository: TrainingRepository):
        self.repository = repository

    async def workout(self, subject: str, day: str) -> Workout:
        return await self.repository.workout(TraineeId(subject), day)

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
