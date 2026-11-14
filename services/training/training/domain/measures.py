"""ある日の時点の記録（体重・体脂肪率・BIG3）。フェーズの開始時の記録（snapshot）と同じ出し方で、終わりの時点の値を出す
（フェーズの振り返りの材料。アプリの apps/mobile/lib/phaseView.ts の measuresFrom と同じ決まり）。

- 体重・体脂肪率：その日までの7日（その日を含む）の平均（0.1 に丸める）。7日に記録がなければ、その日までの最新の値
- BIG3：役ごとに、その日までの最高の推定1RM（アプリの big3Trend の current と同じ）
成長スコアはアプリだけが計算する（食事・睡眠・部位の記録から出すため）ので、ここでは出さない。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from training.domain.calculations import add_days, estimated_1rm
from training.domain.model import SetRow

WINDOW_DAYS = 7
Basis = Literal["week", "latest"]


@dataclass(frozen=True)
class Measure:
    value: float | None
    basis: Basis | None  # week：7日の平均、latest：7日に記録がないので最新の値、None：記録がない


def week_or_latest(values: list[tuple[str, float]], day: str) -> Measure:
    """values は日ごとの値（日付の順でなくてよい）。"""
    first = add_days(day, -(WINDOW_DAYS - 1))
    week = [v for d, v in values if first <= d <= day]
    if week:
        return Measure(round(sum(week) / len(week), 1), "week")
    past = [(d, v) for d, v in values if d <= day]
    return Measure(max(past)[1], "latest") if past else Measure(None, None)


def big3_best(rows: list[SetRow], assignments: dict[str, str], day: str) -> dict[str, float | None] | None:
    """役 → その日までの最高の推定1RM（0.1kg に丸める）。どの役にも記録がなければ None（アプリの big3Gauge が null のとき）。"""
    if not assignments:
        return None
    out: dict[str, float | None] = {}
    for role in ("bench", "squat", "deadlift"):
        exercise_id = assignments.get(role)
        best = max((estimated_1rm(r.weight_kg, r.reps) for r in rows
                    if exercise_id is not None and r.exercise_id == exercise_id and r.date <= day), default=0)
        out[role] = round(best, 1) if best > 0 else None
    return out if any(v is not None for v in out.values()) else None
