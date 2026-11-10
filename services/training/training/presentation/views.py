"""ツールの出力の形。重さは kg、小数第1位で丸める（推定1RM などの計算の結果も同じ）。"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from training.application.queries import (
    BodyProgress,
    ExerciseHistory,
    HeartRateSummary,
    PeriodTraining,
    SleepSummary,
    StepSummary,
    WeeklyTrainingReview,
)
from training.domain import big3, body, bodyweight, calculations, health
from training.domain.catalog import Catalog
from training.domain.model import Exercise, SetRow, Workout


def r1(value: float | None) -> float | None:
    return None if value is None else round(value, 1)


def exercise(e: Exercise, catalog: Catalog) -> dict:
    part = catalog.body_part(e.body_part_id)
    ratio = bodyweight.ratio_of(e)
    return {"exercise_id": e.id, "name": e.name, "body_part": part.name if part else None,
            "record_type": e.record_type.value, "hidden": e.hidden,
            **({"bodyweight_ratio": ratio} if ratio is not None else {})}


MISSING_BODYWEIGHT = "体重の記録がないため、自重の種目の{n}セットは総負荷量に入っていません（体重を記録すると入ります）"


def _rows(w: Workout, catalog: Catalog, weights: list[tuple[str, float]]) -> dict[str, list[SetRow]]:
    """種目（entry_id）ごとのセットの行。回数だけのセットには、自重の負荷（体重 × 割合）を入れる。"""
    out = {}
    for e in w.entries:
        found = catalog.exercise(e.exercise_id)
        ratio = bodyweight.ratio_of(found) if found else None
        rows = [SetRow(w.date, e.exercise_id, found.body_part_id if found else "", s.weight_kg, s.reps, ratio)
                for s in e.sets]
        out[e.id] = bodyweight.with_bodyweight(rows, weights)
    return out


def catalog_view(catalog: Catalog, include_hidden: bool) -> dict:
    """部位と種目の一覧。BIG3 の役（アプリと同じく、割り当てがなければ名前で決めたもの）とフォームの動画のリンクは、ある種目だけに付ける。"""
    roles = {exercise_id: role for role, exercise_id in big3.assignments(catalog.exercises).items()}
    parts = []
    for p in catalog.body_parts:
        if p.hidden and not include_hidden:
            continue
        exercises = [{"exercise_id": e.id, "name": e.name, "record_type": e.record_type.value,
                      **({"bodyweight_ratio": bodyweight.ratio_of(e)} if e.record_type.value == "reps_only" else {}),
                      **({"big3": roles[e.id]} if e.id in roles else {}),
                      **({"form_video_url": e.form_video_url} if e.form_video_url else {}),
                      **({"hidden": True} if e.hidden else {})}
                     for e in catalog.exercises if e.body_part_id == p.id and (include_hidden or not e.hidden)]
        parts.append({"body_part_id": p.id, "body_part": p.name, **({"hidden": True} if p.hidden else {}),
                      "exercises": exercises})
    return {"body_parts": parts}


def workout(w: Workout, catalog: Catalog, bests_before: dict[str, calculations.PersonalBest],
            weights: list[tuple[str, float]]) -> dict:
    """その日の記録。種目ごとに総負荷量・いちばん重いセット・推定1RM の最大と、自己ベストを超えたかを付ける。
    自重の種目（回数だけ）の負荷量は、体重 × 種目の割合 × 回数（weights は日ごとの体重）。"""
    entries, total = [], 0.0
    rows_by_entry = _rows(w, catalog, weights)
    for e in w.entries:
        found = catalog.exercise(e.exercise_id)
        part = catalog.body_part(found.body_part_id) if found else None
        rows = rows_by_entry[e.id]
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
                      "volume": r1(calculations.row_volume(r)),
                      "estimated_1rm": r1(calculations.estimated_1rm(s.weight_kg, s.reps)) or None}
                     for i, (s, r) in enumerate(zip(e.sets, rows))],
            "volume": r1(volume),
            "max_estimated_1rm": r1(best[1]) if best else None,
            # これまで（この日より前）の推定1RM の最大を超えたか。初めての種目は null
            "new_personal_best": (best[1] > previous.e1rm) if best and previous else None,
        })
    all_rows = [r for rows in rows_by_entry.values() for r in rows]
    return {"date": w.date, "entries": entries, "total_volume": r1(total), **_bodyweight_note(w.date, all_rows, weights)}


def _bodyweight_note(day: str, rows: list[SetRow], weights: list[tuple[str, float]]) -> dict:
    """自重のセットがあれば、使った体重（kg）と、体重がなくて入らなかったときの説明。"""
    if not any(r.bodyweight_ratio is not None for r in rows):
        return {}
    missing = bodyweight.missing_bodyweight(rows)
    return {"bodyweight_kg": bodyweight.weight_on(weights, day),
            **({"note": MISSING_BODYWEIGHT.format(n=missing)} if missing else {})}


def workout_summary(w: Workout, catalog: Catalog, weights: list[tuple[str, float]]) -> dict:
    rows = [r for rows in _rows(w, catalog, weights).values() for r in rows]
    names = []
    for e in w.entries:
        found = catalog.exercise(e.exercise_id)
        names.append(found.name if found else "（消した種目）")
    return {"date": w.date, "exercises": names, "sets": len(rows),
            "total_volume": r1(calculations.total_volume(rows)), **_bodyweight_note(w.date, rows, weights)}


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
    """週は月曜始まり（アプリと同じ）。by_body_part は今週と先週、weeks は古い順の週ごとの総負荷量。"""
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
        **({"note": MISSING_BODYWEIGHT.format(n=review.missing_bodyweight_sets)}
           if review.missing_bodyweight_sets else {}),
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


def whole(value: float | None) -> int | None:
    """整数に丸める（.5 は上げる。アプリの Math.round と同じ。歩数は正なので）。"""
    return None if value is None else int(value + 0.5)


def step_summary(s: StepSummary, start: str, end: str) -> dict:
    return {
        "from": start,
        "to": end,
        "days_recorded": len(s.days),
        "average_steps": whole(s.average_steps),
        "days": [{"date": d.date, "steps": d.steps} for d in s.days],
    }


# --- 期間の材料（レポートを書くための period_overview）。大きくなりすぎないよう、項目を絞る ---


def period_training(p: PeriodTraining, catalog: Catalog, max_exercises: int) -> dict:
    """日ごとの総負荷量と、種目ごとの最高の推定1RM（大きい順に max_exercises 件まで。自重の種目は出さない）。"""
    exercises = []
    for b in p.bests[:max_exercises]:
        found = catalog.exercise(b.exercise_id)
        part = catalog.body_part(found.body_part_id) if found else None
        exercises.append({"exercise": found.name if found else "（消した種目）", "body_part": part.name if part else None,
                          "max_estimated_1rm": r1(b.e1rm), "weight_kg": b.weight_kg, "reps": b.reps, "date": b.date})
    return {
        "sessions": len(p.days),
        "total_volume": r1(p.total_volume),
        "days": [{"date": d.date, "volume": r1(d.volume), "sets": d.sets} for d in p.days],
        "exercises": exercises,
        "exercises_omitted": max(0, len(p.bests) - max_exercises),
        **({"note": MISSING_BODYWEIGHT.format(n=p.missing_bodyweight_sets)} if p.missing_bodyweight_sets else {}),
    }


def period_body(p: BodyProgress) -> dict:
    """体重と体脂肪率だけ（ウエストと筋肉率は入れない）。平均は記録がある日だけで出す。"""
    days = [d for d in p.days if d.weight_kg is not None or d.body_fat_pct is not None]
    return {
        "days_recorded": len(days),
        "average_weight_kg": r1(health.average([d.weight_kg for d in days if d.weight_kg is not None])),
        "average_body_fat_pct": r1(health.average([d.body_fat_pct for d in days if d.body_fat_pct is not None])),
        "weekly_weight_change_kg": None if p.weekly_pace is None else round(p.weekly_pace, 2),
        "days": [{"date": d.date, "weight_kg": d.weight_kg, "body_fat_pct": d.body_fat_pct} for d in days],
    }


def period_sleep(s: SleepSummary) -> dict:
    return {
        "nights_recorded": len(s.nights),
        "average_asleep_min": r1(s.average_asleep_min),
        "nights": [{"date": n.date, "asleep_min": n.asleep_min, "bedtime": jst(n.start_at), "wake_time": jst(n.end_at)}
                   for n in s.nights],
    }


def period_heart_rate(s: HeartRateSummary) -> dict:
    """安静時心拍だけ（ある日だけ）。"""
    return {
        "days_recorded": len([d for d in s.days if d.resting_bpm is not None]),
        "average_resting_bpm": r1(s.average_resting_bpm),
        "days": [{"date": d.date, "resting_bpm": r1(d.resting_bpm)} for d in s.days if d.resting_bpm is not None],
    }


def period_steps(s: StepSummary) -> dict:
    return {
        "days_recorded": len(s.days),
        "average_steps": whole(s.average_steps),
        "days": [{"date": d.date, "steps": d.steps} for d in s.days],
    }
