"""ツールの出力の形。重さは kg、小数第1位で丸める（推定1RM などの計算の結果も同じ）。"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from training.application.queries import BodyProgress, ExerciseHistory, HeartRateSummary, SleepSummary, WeeklyTrainingReview
from training.domain import body, calculations
from training.domain.catalog import Catalog
from training.domain.model import Exercise, SetRow, Workout


def r1(value: float | None) -> float | None:
    return None if value is None else round(value, 1)


def exercise(e: Exercise, catalog: Catalog) -> dict:
    part = catalog.body_part(e.body_part_id)
    return {"exercise_id": e.id, "name": e.name, "body_part": part.name if part else None,
            "record_type": e.record_type.value, "hidden": e.hidden}


def catalog_view(catalog: Catalog, include_hidden: bool) -> dict:
    parts = []
    for p in catalog.body_parts:
        if p.hidden and not include_hidden:
            continue
        exercises = [{"exercise_id": e.id, "name": e.name, "record_type": e.record_type.value,
                      **({"hidden": True} if e.hidden else {})}
                     for e in catalog.exercises if e.body_part_id == p.id and (include_hidden or not e.hidden)]
        parts.append({"body_part_id": p.id, "body_part": p.name, **({"hidden": True} if p.hidden else {}),
                      "exercises": exercises})
    return {"body_parts": parts}


def workout(w: Workout, catalog: Catalog, bests_before: dict[str, calculations.PersonalBest]) -> dict:
    """その日の記録。種目ごとに総負荷量・いちばん重いセット・推定1RM の最大と、自己ベストを超えたかを付ける。"""
    entries, total = [], 0.0
    for e in w.entries:
        found = catalog.exercise(e.exercise_id)
        part = catalog.body_part(found.body_part_id) if found else None
        rows = [SetRow(w.date, e.exercise_id, found.body_part_id if found else "", s.weight_kg, s.reps) for s in e.sets]
        volume = calculations.total_volume(rows)
        best = calculations.best_set(rows)
        previous = bests_before.get(e.exercise_id)
        total += volume
        entries.append({
            "entry_id": e.id,
            "exercise_id": e.exercise_id,
            "exercise": found.name if found else "（消した種目）",
            "body_part": part.name if part else None,
            "sets": [{"set_id": s.id, "set_no": i + 1, "weight_kg": s.weight_kg, "reps": s.reps, "memo": s.memo,
                      "volume": r1(calculations.set_volume(s.weight_kg, s.reps)),
                      "estimated_1rm": r1(calculations.estimated_1rm(s.weight_kg, s.reps)) or None}
                     for i, s in enumerate(e.sets)],
            "volume": r1(volume),
            "max_estimated_1rm": r1(best[1]) if best else None,
            # これまで（この日より前）の推定1RM の最大を超えたか。初めての種目は null
            "new_personal_best": (best[1] > previous.e1rm) if best and previous else None,
        })
    return {"date": w.date, "entries": entries, "total_volume": r1(total)}


def workout_summary(w: Workout, catalog: Catalog) -> dict:
    rows = [SetRow(w.date, e.exercise_id, "", s.weight_kg, s.reps) for e in w.entries for s in e.sets]
    names = []
    for e in w.entries:
        found = catalog.exercise(e.exercise_id)
        names.append(found.name if found else "（消した種目）")
    return {"date": w.date, "exercises": names, "sets": len(rows),
            "total_volume": r1(calculations.total_volume(rows))}


def history(h: ExerciseHistory, e: Exercise, catalog: Catalog, start: str, end: str) -> dict:
    series = [p for p in h.series if start <= p.date <= end]
    pb = h.personal_best
    return {
        **exercise(e, catalog),
        "from": start,
        "to": end,
        "days": [{"date": p.date, "volume": r1(p.volume), "max_estimated_1rm": r1(p.max_1rm) or None} for p in series],
        # 自己ベストは期間によらず、これまでの全部から出す
        "personal_best": {"date": pb.date, "weight_kg": pb.weight_kg, "reps": pb.reps,
                          "estimated_1rm": r1(pb.e1rm)} if pb else None,
        "sessions": len(series),
    }


def weekly(review: WeeklyTrainingReview, catalog: Catalog) -> dict:
    """週は日曜始まり（アプリと同じ）。by_body_part は今週と先週、weeks は古い順の週ごとの総負荷量。"""
    this_week, last_week = review.by_body_part[-1], review.by_body_part[-2]
    week_end = calculations.add_days(this_week.week_start, 6)
    sessions = [d for d in review.training_days if this_week.week_start <= d <= review.today]
    last_sessions = [d for d in review.training_days if last_week.week_start <= d < this_week.week_start]
    last_day = review.training_days[-1] if review.training_days else None

    def parts(week: calculations.WeeklyByPart) -> list[dict]:
        out = []
        for p in catalog.body_parts:
            volume = week.by_part.get(p.id, 0)
            if p.hidden and volume == 0:
                continue
            out.append({"body_part": p.name, "volume": r1(volume),
                        "share_pct": r1(volume / week.total * 100) if week.total else 0})
        for part_id, volume in week.by_part.items():  # 消した部位の記録
            if catalog.body_part(part_id) is None:
                out.append({"body_part": "（消した部位）", "volume": r1(volume),
                            "share_pct": r1(volume / week.total * 100) if week.total else 0})
        return out

    this_parts = parts(this_week)
    return {
        "week": {"from": this_week.week_start, "to": week_end, "until": review.today},
        "sessions": len(sessions),
        "training_days": sessions,
        "total_volume": r1(this_week.total),
        "by_body_part": this_parts,
        "untrained_body_parts": [p["body_part"] for p in this_parts if p["volume"] == 0],
        "last_week": {"from": last_week.week_start, "sessions": len(last_sessions),
                      "total_volume": r1(last_week.total), "by_body_part": parts(last_week)},
        "days_since_last_training": calculations.days_between(last_day, review.today) if last_day else None,
        "last_training_day": last_day,
        "weeks": [{"week_start": w.week_start, "total_volume": r1(w.total)} for w in review.by_body_part],
        "last_7_days_volume": r1(review.totals.last7),
        "last_28_days_volume": r1(review.totals.last28),
    }


def daily_body(d: body.DailyBody) -> dict:
    return {
        "date": d.date, "weight_kg": d.weight_kg, "body_fat_pct": d.body_fat_pct, "muscle_pct": d.muscle_pct,
        "waist_cm": d.waist_cm, "memo": d.memo,
        "fat_mass_kg": r1(body.fat_mass(d.weight_kg, d.body_fat_pct)),
        "lean_mass_kg": r1(body.lean_mass(d.weight_kg, d.body_fat_pct)),
        "muscle_mass_kg": r1(body.muscle_mass(d.weight_kg, d.muscle_pct)),
    }


def body_progress(p: BodyProgress, start: str, end: str) -> dict:
    return {
        "from": start,
        "to": end,
        "latest": daily_body(p.latest) if p.latest else None,
        "weekly_weight_change_kg": None if p.weekly_pace is None else round(p.weekly_pace, 2),
        "days": [daily_body(d) for d in p.days],
    }


# 時刻は日本時間で返す（MCP の「今日」と last_app_sync_at と同じ。services/mcp/main.py）
JST = timezone(timedelta(hours=9))


def jst(moment: str) -> str:
    return datetime.fromisoformat(moment.replace("Z", "+00:00")).astimezone(JST).isoformat(timespec="minutes")


def sleep_summary(s: SleepSummary, start: str, end: str) -> dict:
    return {
        "from": start,
        "to": end,
        "nights_recorded": len(s.nights),
        "average_asleep_min": r1(s.average_asleep_min),
        "nights": [{"date": n.date, "asleep_min": n.asleep_min, "awake_min": n.awake_min,
                    "bedtime": jst(n.start_at), "wake_time": jst(n.end_at), "sessions": n.sessions} for n in s.nights],
    }


def heart_rate_summary(s: HeartRateSummary, start: str, end: str) -> dict:
    return {
        "from": start,
        "to": end,
        "days_recorded": len(s.days),
        "average_resting_bpm": r1(s.average_resting_bpm),
        "days": [{"date": d.date, "resting_bpm": r1(d.resting_bpm), "avg_bpm": r1(d.avg_bpm), "min_bpm": r1(d.min_bpm),
                  "max_bpm": r1(d.max_bpm), "samples": d.samples} for d in s.days],
    }
