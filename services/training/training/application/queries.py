"""筋トレの読み取りのユースケース（MCP のツールから呼ぶ）。本人は検証済みのトークンの sub で受け取る。"""

from __future__ import annotations

from dataclasses import dataclass

from training.domain import body, bodyweight, calculations, health
from training.domain import phase as phase_rules
from training.domain.catalog import Catalog
from training.domain.injury import Injury, InjuryReview
from training.domain.phase import Pace, Phase
from training.domain.model import HeartRateDay, SetRow, StepDay, TraineeId, Workout
from training.domain.ports import TrainingRepository


@dataclass(frozen=True)
class WeeklyTrainingReview:
    today: str
    totals: calculations.PeriodTotals
    weekly_volumes: list[float]  # [0] が今週
    by_body_part: list[calculations.WeeklyByPart]  # 古い順
    training_days: list[str]
    missing_bodyweight_sets: int = 0  # 体重の記録がないため、この週の総負荷量に入らなかった自重のセット


@dataclass(frozen=True)
class ExerciseHistory:
    exercise_id: str
    series: list[calculations.DailyPoint]
    personal_best: calculations.PersonalBest | None


@dataclass(frozen=True)
class TrainingDay:
    date: str
    volume: float  # その日の総負荷量（自重の種目を含む）
    sets: int


@dataclass(frozen=True)
class PeriodTraining:
    days: list[TrainingDay]  # 期間の中の、セットの記録がある日（古い順）
    total_volume: float
    bests: list[calculations.PersonalBest]  # 期間の中の、種目ごとの推定1RM が最大のセット（大きい順）
    missing_bodyweight_sets: int = 0  # 体重の記録がないため、総負荷量に入らなかった自重のセット


@dataclass(frozen=True)
class BodyProgress:
    days: list[body.DailyBody]  # 期間の中の、日ごとの値（古い順）
    latest: body.DailyBody | None  # 期間の中でいちばん新しい日
    weekly_pace: float | None  # 直近28日の体重のペース（kg／週）


@dataclass(frozen=True)
class SleepSummary:
    nights: list[health.SleepNight]  # 期間の中の、起きた日ごとのまとめ（古い順。記録がない日は含めない）
    average_asleep_min: float | None  # 記録がある日の平均


@dataclass(frozen=True)
class HeartRateSummary:
    days: list[HeartRateDay]  # 期間の中の、日ごとのまとめ（古い順。記録がない日は含めない）
    average_resting_bpm: float | None  # 安静時心拍がある日の平均


@dataclass(frozen=True)
class StepSummary:
    days: list[StepDay]  # 期間の中の、日ごとの合計（古い順。記録がない日は含めない）
    average_steps: float | None  # 記録がある日の平均


@dataclass(frozen=True)
class InjuryRecord:
    injury: Injury
    reviews: list[InjuryReview]  # 古い順（試した日、同じなら記録した順）


@dataclass(frozen=True)
class PhaseProgress:
    """フェーズの as_of の時点の進み具合（training.domain.phase の決まり）。"""

    phase: Phase
    as_of: str
    paused: bool  # 療養で止まっている（通常のフェーズだけ）
    week: int  # 何週目（通常は止まった日を数えない。療養は開始日から）
    weeks_total: int | None
    effective_end: str | None  # 実際の終わり（止まった日数だけ後ろにずれる）
    remaining_days: int | None
    rehab_days: int  # 通常：療養で止まった日数。療養：開始日から as_of まで（終わったものは終わった日まで）の日数
    pace: Pace | None  # 通常のフェーズだけ
    plan_kg: float | None  # as_of の予定の体重


def phase_progress(p: Phase, phases: list[Phase], weights: list[tuple[str, float]], as_of: str) -> PhaseProgress:
    if p.kind == "rehab":
        last = as_of if p.status == "active" or not p.ended_on else min(as_of, calculations.add_days(p.ended_on, -1))
        days = max(0, calculations.days_between(p.start_date, last) + 1)
        return PhaseProgress(p, as_of, False, max(0, days - 1) // 7 + 1, None, None, None, days, None, None)
    spans = phase_rules.pauses(p, phases, as_of)
    plan = phase_rules.plan_value(p, spans, as_of)
    return PhaseProgress(
        p, as_of, phase_rules.is_paused(spans, as_of), phase_rules.week(p, spans, as_of), phase_rules.weeks_total(p),
        phase_rules.effective_end(p, spans), phase_rules.remaining_days(p, spans, as_of), phase_rules.paused_days(spans),
        phase_rules.pace(p, phases, weights, as_of), None if plan is None else phase_rules.cents(plan) / 100)


class TrainingQueries:
    def __init__(self, repository: TrainingRepository):
        self.repository = repository

    async def catalog(self, subject: str) -> Catalog:
        return await self.repository.catalog(TraineeId(subject))

    async def workout(self, subject: str, day: str) -> Workout:
        return await self.repository.workout(TraineeId(subject), day)

    async def workouts(self, subject: str, start: str, end: str) -> list[Workout]:
        return await self.repository.workouts(TraineeId(subject), start, end)

    async def body_weights(self, subject: str) -> list[tuple[str, float]]:
        """日ごとの体重（体組成の記録。Health Connect の取り込みを含む）。自重の種目の負荷量に使う。"""
        return [(d.date, d.weight_kg) for d in await self.daily_body(subject) if d.weight_kg is not None]

    async def set_rows(self, subject: str) -> list[SetRow]:
        """集計に使うセット。回数だけのセットには、自重の負荷（体重 × 割合）を入れる。"""
        rows = await self.repository.set_rows(TraineeId(subject))
        return bodyweight.with_bodyweight(rows, await self.body_weights(subject))

    async def training_dates(self, subject: str, start: str, end: str) -> list[str]:
        """start から end まで（両端を含む）の、セットの記録がある日。"""
        rows = await self.repository.set_rows(TraineeId(subject))
        return [d for d in calculations.training_dates(rows) if start <= d <= end]

    async def personal_bests_before(self, subject: str, day: str) -> dict[str, calculations.PersonalBest]:
        """その日より前の、種目ごとの自己ベスト（その日の記録が自己ベストを超えたかを見るため）。"""
        return calculations.personal_bests(await self.repository.set_rows(TraineeId(subject)), before_date=day)

    async def weekly_review(self, subject: str, today: str, weeks: int = 8) -> WeeklyTrainingReview:
        rows = await self.set_rows(subject)
        start = calculations.week_start(today)
        return WeeklyTrainingReview(
            today,
            calculations.period_totals(rows, today),
            calculations.weekly_volumes(rows, today, weeks),
            calculations.weekly_volume_by_body_part(rows, today, weeks),
            [d for d in calculations.training_dates(rows) if d <= today],
            bodyweight.missing_bodyweight([r for r in rows if start <= r.date <= today]),
        )

    async def period_training(self, subject: str, start: str, end: str) -> PeriodTraining:
        """start から end まで（両端を含む）の筋トレ：日ごとの総負荷量とセット数、期間の合計、種目ごとの最高の推定1RM。"""
        rows = [r for r in await self.set_rows(subject) if start <= r.date <= end]
        by_day: dict[str, list[float]] = {}
        for r in rows:
            day = by_day.setdefault(r.date, [0, 0])
            day[0] += calculations.row_volume(r)
            day[1] += 1
        bests = sorted(calculations.personal_bests(rows).values(), key=lambda b: (-b.e1rm, b.exercise_id))
        return PeriodTraining([TrainingDay(d, v, int(n)) for d, (v, n) in sorted(by_day.items())],
                              calculations.total_volume(rows), bests, bodyweight.missing_bodyweight(rows))

    async def exercise_history(self, subject: str, exercise_id: str) -> ExerciseHistory:
        rows = await self.set_rows(subject)
        return ExerciseHistory(exercise_id, calculations.exercise_daily_series(rows, exercise_id),
                               calculations.personal_bests(rows).get(exercise_id))

    async def daily_body(self, subject: str) -> list[body.DailyBody]:
        return body.daily_body_values(await self.repository.body_records(TraineeId(subject)))

    async def body_progress(self, subject: str, start: str, today: str) -> BodyProgress:
        all_days = await self.daily_body(subject)
        days = [d for d in all_days if start <= d.date <= today]
        weights = [(d.date, d.weight_kg) for d in all_days if d.weight_kg is not None]
        return BodyProgress(days, days[-1] if days else None, body.weekly_pace(weights, today))

    async def sleep_summary(self, subject: str, start: str, end: str) -> SleepSummary:
        nights = [n for n in health.sleep_nights(await self.repository.sleep_sessions(TraineeId(subject)))
                  if start <= n.date <= end]
        return SleepSummary(nights, health.average([n.asleep_min for n in nights]))

    async def heart_rate_summary(self, subject: str, start: str, end: str) -> HeartRateSummary:
        days = health.heart_rate_days_between(await self.repository.heart_rate_days(TraineeId(subject)), start, end)
        return HeartRateSummary(days, health.average([d.resting_bpm for d in days if d.resting_bpm is not None]))

    async def step_summary(self, subject: str, start: str, end: str) -> StepSummary:
        days = health.step_days_between(await self.repository.step_days(TraineeId(subject)), start, end)
        return StepSummary(days, health.average([d.steps for d in days]))

    async def injuries(self, subject: str, status: str | None = None) -> list[InjuryRecord]:
        """ケガと振り返り。新しい順（痛めた日、同じなら記録した順の新しいもの）。status を渡すとその状態だけ。"""
        trainee = TraineeId(subject)
        reviews: dict[str, list[InjuryReview]] = {}
        for r in sorted(await self.repository.injury_reviews(trainee), key=lambda r: (r.date, r.created_at, r.id)):
            reviews.setdefault(r.injury_id, []).append(r)
        found = [i for i in await self.repository.injuries(trainee) if status is None or i.status == status]
        found.sort(key=lambda i: (i.occurred_on, i.created_at, i.id), reverse=True)
        return [InjuryRecord(i, reviews.get(i.id, [])) for i in found]

    async def phases(self, subject: str) -> list[Phase]:
        """フェーズ。新しい順（開始日、同じなら記録の新しいもの）。"""
        found = await self.repository.phases(TraineeId(subject))
        return sorted(found, key=lambda p: (p.start_date, p.created_at, p.id), reverse=True)

    async def phase_progresses(self, subject: str, as_of: str, start: str | None = None,
                               limit: int = 50) -> tuple[list[PhaseProgress], PhaseProgress | None, PhaseProgress | None]:
        """(一覧, 今のフェーズ, 療養で止まっている通常のフェーズ)。どれも as_of の時点。
        start を渡すと、一覧は [start, as_of] に重なるものだけ（中断したものも含む）。渡さなければ全部（これから始まるものも）。一覧は新しい順に limit 件まで。"""
        phases = await self.phases(subject)
        if not phases:  # フェーズがなければ体重は読まない
            return [], None, None
        weights = await self.body_weights(subject)
        current, paused = phase_rules.current(phases, as_of)
        listed = [p for p in phases if start is None
                  or (p.start_date <= as_of and phase_rules.end_of(p, phases, as_of) >= start)][:limit]

        def progress(p: Phase | None) -> PhaseProgress | None:
            return None if p is None else phase_progress(p, phases, weights, as_of)

        return [phase_progress(p, phases, weights, as_of) for p in listed], progress(current), progress(paused)
