"""筋トレの計算。アプリ（apps/mobile/lib/training.ts・date.ts）と同じ結果になるようにする。

同じ入力と期待する結果を testdata/training/ の JSON に置き、ここの pytest とアプリの jest の両方で確かめる。
足し算の順番もアプリと同じ（行の順）にして、小数の誤差まで同じにする。
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

from training.domain.model import SetRow

# --- 日付（アプリの date.ts と同じ。週は月曜始まり。食事の週のまとめと同じ） ---


def add_days(day: str, n: int) -> str:
    return (date.fromisoformat(day) + timedelta(days=n)).isoformat()


def days_between(a: str, b: str) -> int:
    """b − a の日数。"""
    return (date.fromisoformat(b) - date.fromisoformat(a)).days


def week_start(day: str) -> str:
    """その週の月曜。"""
    d = date.fromisoformat(day)
    return (d - timedelta(days=d.weekday())).isoformat()


# --- 1セット ---


def estimated_1rm(weight_kg: float | None, reps: int | None) -> float:
    """推定1RM。1回なら重量そのもの、2回以上は Epley 式：重量 ×（1 ＋ 回数 ÷ 30）。"""
    if weight_kg is None or reps is None or weight_kg <= 0 or reps <= 0:
        return 0
    if reps == 1:
        return weight_kg
    return weight_kg * (1 + reps / 30)


def set_volume(weight_kg: float | None, reps: int | None, bodyweight_load_kg: float | None = None) -> float:
    """負荷量（重量 × 回数）。回数だけの種目は、自重の負荷（体重 × 割合。training.domain.bodyweight）× 回数。
    自重の負荷がなければ（体重の記録がない）0。"""
    load = weight_kg if weight_kg is not None else bodyweight_load_kg
    if load is None or reps is None or load <= 0 or reps <= 0:
        return 0
    return load * reps


def row_volume(r: SetRow) -> float:
    return set_volume(r.weight_kg, r.reps, r.bodyweight_load_kg)


def total_volume(sets: list[SetRow]) -> float:
    total: float = 0
    for s in sets:
        total += row_volume(s)
    return total


def best_set(sets: list[SetRow]) -> tuple[SetRow, float] | None:
    """推定1RM が最も大きいセットと、その推定1RM。"""
    best: tuple[SetRow, float] | None = None
    for s in sets:
        e1rm = estimated_1rm(s.weight_kg, s.reps)
        if e1rm > 0 and (best is None or e1rm > best[1]):
            best = (s, e1rm)
    return best


def top_set(sets: list[SetRow]) -> SetRow | None:
    """重量が最も大きいセット（同じ重さなら回数の多いもの）。"""
    top: SetRow | None = None
    for s in sets:
        if top is None:
            top = s
            continue
        w, tw = s.weight_kg or 0, top.weight_kg or 0
        if w > tw or (w == tw and (s.reps or 0) > (top.reps or 0)):
            top = s
    return top


# --- 期間 ---


def volume_between(rows: list[SetRow], start: str, end: str) -> float:
    """start〜end（両端を含む）の負荷量の合計。"""
    total: float = 0
    for r in rows:
        if start <= r.date <= end:
            total += row_volume(r)
    return total


@dataclass(frozen=True)
class PeriodTotals:
    last7: float  # 今日を含む7日間
    last28: float
    total: float


def period_totals(rows: list[SetRow], today: str) -> PeriodTotals:
    total: float = 0
    for r in rows:
        if r.date <= today:
            total += row_volume(r)
    return PeriodTotals(volume_between(rows, add_days(today, -6), today),
                        volume_between(rows, add_days(today, -27), today), total)


def weekly_volumes(rows: list[SetRow], today: str, weeks: int = 6) -> list[float]:
    """週ごと（月曜始まり）の負荷量。[0] が今週、[1] が1週前…"""
    this_week = week_start(today)
    out: list[float] = [0] * weeks
    for r in rows:
        if r.date > today:
            continue
        idx = days_between(week_start(r.date), this_week) // 7
        if 0 <= idx < weeks:
            out[idx] += row_volume(r)
    return out


@dataclass(frozen=True)
class WeeklyByPart:
    week_start: str
    by_part: dict[str, float]
    total: float


def weekly_volume_by_body_part(rows: list[SetRow], today: str, weeks: int = 8) -> list[WeeklyByPart]:
    """部位ごとの、週ごとの総負荷量（古い順。最後が今週）。"""
    this_week = week_start(today)
    starts = [add_days(this_week, -7 * i) for i in range(weeks - 1, -1, -1)]
    by_part: list[dict[str, float]] = [{} for _ in starts]
    totals: list[float] = [0] * weeks
    for r in rows:
        if r.date > today:
            continue
        idx = weeks - 1 - days_between(week_start(r.date), this_week) // 7
        if not 0 <= idx < weeks:
            continue
        v = row_volume(r)
        if v == 0:
            continue
        by_part[idx][r.body_part_id] = by_part[idx].get(r.body_part_id, 0) + v
        totals[idx] += v
    return [WeeklyByPart(s, p, t) for s, p, t in zip(starts, by_part, totals)]


@dataclass(frozen=True)
class DailyPoint:
    date: str
    volume: float
    max_1rm: float


def exercise_daily_series(rows: list[SetRow], exercise_id: str) -> list[DailyPoint]:
    """種目ごとの、日ごとの総負荷量と最大の推定1RM（日付の順）。"""
    points: dict[str, list[float]] = {}
    for r in rows:
        if r.exercise_id != exercise_id:
            continue
        p = points.setdefault(r.date, [0, 0])
        p[0] += row_volume(r)
        p[1] = max(p[1], estimated_1rm(r.weight_kg, r.reps))
    return [DailyPoint(d, v, m) for d, (v, m) in sorted(points.items())]


@dataclass(frozen=True)
class PersonalBest:
    exercise_id: str
    e1rm: float
    weight_kg: float
    reps: int
    date: str


def personal_bests(rows: list[SetRow], before_date: str | None = None) -> dict[str, PersonalBest]:
    """種目ごとの自己ベスト（推定1RM が最大のセット）。before_date を渡すと、その日より前だけで見る。"""
    found: dict[str, PersonalBest] = {}
    for r in rows:
        if before_date and r.date >= before_date:
            continue
        e1rm = estimated_1rm(r.weight_kg, r.reps)
        if e1rm <= 0:
            continue
        cur = found.get(r.exercise_id)
        if cur is None or e1rm > cur.e1rm:
            found[r.exercise_id] = PersonalBest(r.exercise_id, e1rm, r.weight_kg, r.reps, r.date)
    return found


def training_dates(rows: list[SetRow]) -> list[str]:
    """トレーニングした日（重複なし、昇順）。"""
    return sorted({r.date for r in rows})


RM_TABLE = ((95, 2), (90, 4), (85, 6), (80, 8), (75, 10), (70, 12))


def rm_table(one_rm: float) -> list[dict]:
    """RM計算機の表：割合と回数の目安。"""
    return [{"pct": pct, "reps": reps, "weight": one_rm * pct / 100} for pct, reps in RM_TABLE]
