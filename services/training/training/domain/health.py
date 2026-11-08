"""睡眠と心拍のまとめ（アプリが Health Connect から取り込んだものを読むだけ）。アプリの体組成のタブと同じ選び方にする
（apps/mobile/db/repositories/health.ts）：睡眠は起きた日ごとに足し、寝た時刻・起きた時刻はいちばん長い睡眠のもの。"""

from __future__ import annotations

from dataclasses import dataclass

from training.domain.model import HeartRateDay, SleepSession


@dataclass(frozen=True)
class SleepNight:
    date: str  # 起きた日
    asleep_min: int  # その日に起きた睡眠の合計（昼寝も含む）
    awake_min: int
    start_at: str  # いちばん長い睡眠の、寝た時刻と起きた時刻
    end_at: str
    sessions: int


def sleep_nights(sessions: list[SleepSession]) -> list[SleepNight]:
    """起きた日ごとのまとめ（古い順）。"""
    by_date: dict[str, list[SleepSession]] = {}
    for s in sessions:
        by_date.setdefault(s.date, []).append(s)
    nights = []
    for day in sorted(by_date):
        items = sorted(by_date[day], key=lambda s: (-(s.asleep_min + s.awake_min), s.start_at))
        nights.append(SleepNight(day, sum(s.asleep_min for s in items), sum(s.awake_min for s in items),
                                 items[0].start_at, items[0].end_at, len(items)))
    return nights


def average(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def heart_rate_days_between(days: list[HeartRateDay], start: str, end: str) -> list[HeartRateDay]:
    """期間（両端を含む）の日（古い順）。"""
    return sorted((d for d in days if start <= d.date <= end), key=lambda d: d.date)
