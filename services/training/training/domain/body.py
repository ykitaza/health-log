"""体組成の計算。アプリ（apps/mobile/lib/body.ts）と同じ結果になるようにする（testdata/training/body.json で確かめる）。"""

from __future__ import annotations

import math
from dataclasses import dataclass

from training.domain.calculations import add_days, days_between
from training.domain.model import BodyRecord


def bmi(weight_kg: float | None, height_cm: float | None) -> float | None:
    """BMI ＝ 体重 ÷ 身長(m)²"""
    if weight_kg is None or height_cm is None or height_cm <= 0:
        return None
    m = height_cm / 100
    return weight_kg / (m * m)


def fat_mass(weight_kg: float | None, body_fat_pct: float | None) -> float | None:
    if weight_kg is None or body_fat_pct is None:
        return None
    return weight_kg * body_fat_pct / 100


def lean_mass(weight_kg: float | None, body_fat_pct: float | None) -> float | None:
    f = fat_mass(weight_kg, body_fat_pct)
    return None if f is None or weight_kg is None else weight_kg - f


def weekly_pace(points: list[tuple[str, float]], today: str, days: int = 28) -> float | None:
    """直近 days 日の体重のペース（kg／週）。最初と最後の記録から出す。2つ未満か同じ日だけなら None。"""
    start = add_days(today, -(days - 1))
    in_range = sorted((p for p in points if start <= p[0] <= today), key=lambda p: p[0])
    if len(in_range) < 2:
        return None
    (first_day, first_kg), (last_day, last_kg) = in_range[0], in_range[-1]
    span = days_between(first_day, last_day)
    if span <= 0:
        return None
    return (last_kg - first_kg) / span * 7


@dataclass(frozen=True)
class WeightGoalProgress:
    remaining: float
    direction: str  # lose・gain・reached
    weeks: int | None  # 今のペースでの週数（ペースが目標の向きでなければ None）


def goal_progress(current_kg: float, goal_kg: float, pace_per_week: float | None) -> WeightGoalProgress:
    diff = goal_kg - current_kg  # 減らすなら負
    remaining = abs(diff)
    weeks = None
    if pace_per_week and remaining > 0 and math.copysign(1, pace_per_week) == math.copysign(1, diff):
        weeks = math.ceil(remaining / abs(pace_per_week))
    return WeightGoalProgress(remaining, "lose" if diff < 0 else "gain" if diff > 0 else "reached", weeks)


@dataclass(frozen=True)
class DailyBody:
    date: str
    weight_kg: float | None
    body_fat_pct: float | None
    memo: str


FIELDS = ("weight_kg", "body_fat_pct")


def daily_body_values(records: list[BodyRecord]) -> list[DailyBody]:
    """1日に1つの値：項目ごとに、その日の手入力の記録のうちいちばん新しいもの（measured_at、同じなら updated_at）の、
    空でない値。手入力の値がない項目だけ、取り込み（Health Connect）の記録から同じ決まりで選ぶ。"""
    newest_first = sorted(records, key=lambda r: (r.measured_at, r.updated_at), reverse=True)
    manual_first = sorted(newest_first, key=lambda r: r.source != "manual")  # 安定な並べ替えなので、中は新しい順のまま
    days: dict[str, dict] = {}
    for r in manual_first:
        d = days.setdefault(r.date, {"date": r.date, **{f: None for f in FIELDS}, "memo": ""})
        for f in FIELDS:
            if d[f] is None and getattr(r, f) is not None:
                d[f] = getattr(r, f)
        if d["memo"] == "" and r.memo != "":
            d["memo"] = r.memo
    return [DailyBody(**days[k]) for k in sorted(days)]
