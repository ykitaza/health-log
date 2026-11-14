"""ある日の時点の記録（体重・体脂肪率・BIG3）。フェーズの開始時の記録（snapshot）と同じ出し方で、終わりの時点の値を出す
（フェーズの振り返りの材料。アプリの apps/mobile/lib/phaseView.ts の measuresFrom と同じ決まり）。

- 体重・体脂肪率：その日までの7日（その日を含む）の平均（0.1 に丸める。.5 は上げる）。7日に記録がなければ、その日までの最新の値
- BIG3：役ごとに、最高の推定1RM（0.1 に丸める）。開始時の記録（snapshot）はその日までの全部から、終わりの時点の値は
  フェーズの最後の28日（BIG3_END_DAYS。フェーズの開始より前は含めない）から出す（アプリの lib/phaseView.ts の big3Best と同じ）。
  終わりも「その日までの最高」にすると、減量で BIG3 が下がっても前の最高が残り、「BIG3 を保つ」から外れないため。
  28日に記録がない役は null（比べない）
成長スコアはアプリだけが計算する（食事・睡眠・部位の記録から出すため）ので、ここでは出さない。
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

from training.domain.calculations import add_days, estimated_1rm
from training.domain.model import SetRow

WINDOW_DAYS = 7
BIG3_END_DAYS = 28  # 終わりの時点の BIG3 を見る日数（アプリの lib/phaseView.ts の BIG3_END_DAYS と同じ）


def round1(x: float) -> float:
    """0.1 に丸める（.5 は上げる。アプリの Math.round(x * 10) / 10 と同じ。Python の round は偶数への丸め）。"""
    return math.floor(x * 10 + 0.5) / 10
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
        return Measure(round1(sum(week) / len(week)), "week")
    past = [(d, v) for d, v in values if d <= day]
    return Measure(max(past)[1], "latest") if past else Measure(None, None)


def big3_best(rows: list[SetRow], assignments: dict[str, str], day: str,
              since: str | None = None) -> dict[str, float | None] | None:
    """役 → since〜day（両端を含む。since が None ならその日まで全部）の最高の推定1RM（0.1kg に丸める）。
    どの役にも記録がなければ None。"""
    if not assignments:
        return None
    out: dict[str, float | None] = {}
    for role in ("bench", "squat", "deadlift"):
        exercise_id = assignments.get(role)
        best = max((estimated_1rm(r.weight_kg, r.reps) for r in rows
                    if exercise_id is not None and r.exercise_id == exercise_id and r.date <= day
                    and (since is None or since <= r.date)), default=0)
        out[role] = round1(best) if best > 0 else None
    return out if any(v is not None for v in out.values()) else None


def big3_end_since(start_date: str, last: str) -> str:
    """終わりの時点の BIG3 を見る最初の日：最後の日から28日前（最後の日を含めて28日）。フェーズの開始日より前にはしない。"""
    return max(start_date, add_days(last, -(BIG3_END_DAYS - 1)))
