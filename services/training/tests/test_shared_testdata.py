"""アプリ（apps/mobile/lib/__tests__/shared-testdata.test.ts）と同じテストのデータで、計算を確かめる。"""

import json
from dataclasses import asdict
from pathlib import Path

import pytest

from training.application.queries import phase_progress
from training.domain import big3, body, bodyweight, phase
from training.domain import calculations as c
from training.domain.model import BodyRecord, Exercise, RecordType, SetRow

TESTDATA = Path(__file__).parents[3] / "testdata" / "training"


def load(name: str) -> dict:
    return json.loads((TESTDATA / name).read_text())


@pytest.mark.parametrize("case", load("estimated_1rm.json")["cases"])
def test_推定1RM(case):
    assert c.estimated_1rm(case["weight_kg"], case["reps"]) == case["expected"]


@pytest.mark.parametrize("case", load("set_volume.json")["cases"])
def test_負荷量(case):
    assert c.set_volume(case["weight_kg"], case["reps"]) == case["expected"]


def test_集計():
    data = load("aggregates.json")
    rows = [SetRow(**r) for r in data["rows"]]
    today, e = data["today"], data["expected"]
    assert c.total_volume(rows) == e["total_volume"]
    assert asdict(c.period_totals(rows, today)) == e["period_totals"]
    assert c.weekly_volumes(rows, today, e["weekly_volumes"]["weeks"]) == e["weekly_volumes"]["result"]
    by_part = c.weekly_volume_by_body_part(rows, today, e["weekly_volume_by_body_part"]["weeks"])
    assert [asdict(w) for w in by_part] == e["weekly_volume_by_body_part"]["result"]
    for exercise_id, points in e["exercise_daily_series"].items():
        assert [asdict(p) for p in c.exercise_daily_series(rows, exercise_id)] == points
    assert {k: asdict(v) for k, v in c.personal_bests(rows).items()} == e["personal_bests"]
    before = e["personal_bests_before"]
    assert {k: asdict(v) for k, v in c.personal_bests(rows, before["before"]).items()} == before["result"]
    assert c.training_dates(rows) == e["training_dates"]
    best = c.best_set(rows)
    assert (rows.index(best[0]), best[1]) == (e["best_set"]["index"], e["best_set"]["e1rm"])
    assert rows.index(c.top_set(rows)) == e["top_set"]["index"]
    assert c.rm_table(e["rm_table"]["one_rm"]) == e["rm_table"]["result"]


def test_自重の負荷量():
    data = load("bodyweight.json")
    for case in data["default_ratio"]:
        assert bodyweight.default_ratio(case["name"]) == case["expected"], case["name"]
    weights = [(w["date"], w["weight_kg"]) for w in data["weights"]]
    for case in data["weight_on"]:
        assert bodyweight.weight_on(weights, case["date"]) == case["expected"], case["date"]
    rows = bodyweight.with_bodyweight([SetRow(**r) for r in data["rows"]], weights)
    today, e = data["today"], data["expected"]
    assert [r.bodyweight_load_kg for r in rows] == e["bodyweight_load_kg"]
    assert [c.row_volume(r) for r in rows] == e["volumes"]
    assert c.total_volume(rows) == e["total_volume"]
    assert asdict(c.period_totals(rows, today)) == e["period_totals"]
    assert c.weekly_volumes(rows, today, e["weekly_volumes"]["weeks"]) == e["weekly_volumes"]["result"]
    by_part = c.weekly_volume_by_body_part(rows, today, e["weekly_volume_by_body_part"]["weeks"])
    assert [asdict(w) for w in by_part] == e["weekly_volume_by_body_part"]["result"]
    for exercise_id, points in e["exercise_daily_series"].items():
        assert [asdict(p) for p in c.exercise_daily_series(rows, exercise_id)] == points
    assert {k: asdict(v) for k, v in c.personal_bests(rows).items()} == e["personal_bests"]  # 自重の種目は推定1RM を出さない
    assert bodyweight.missing_bodyweight(rows) == e["missing_bodyweight"]


@pytest.mark.parametrize("case", load("big3.json")["cases"], ids=lambda c: c["name"])
def test_BIG3_の割り当て(case):
    exercises = [Exercise(e["id"], "part", e["name"], RecordType(e.get("record_type", "weight_reps")), 0,
                          e.get("hidden", False), big3=e.get("big3")) for e in case["exercises"]]
    assert big3.assignments(exercises) == case["expected"]


def test_体組成():
    data = load("body.json")
    for case in data["bmi"]:
        assert body.bmi(case["weight_kg"], case["height_cm"]) == case["expected"]
    for name, fn in (("fat_mass", body.fat_mass), ("lean_mass", body.lean_mass)):
        for case in data[name]:
            assert fn(case["weight_kg"], case["pct"]) == case["expected"]
    for case in data["weekly_pace"]:
        points = [(p["date"], p["weight_kg"]) for p in case["points"]]
        assert body.weekly_pace(points, case["today"], case["days"]) == case["expected"]
    for case in data["goal_progress"]:
        assert asdict(body.goal_progress(case["current_kg"], case["goal_kg"], case["pace_per_week"])) == case["expected"]
    records = [BodyRecord(f"r{n}", r["date"], r["measured_at"], r["weight_kg"], r["body_fat_pct"], r["memo"],
                          r["source"], r["updated_at"])
               for n, r in enumerate(data["daily_body_values"]["records"])]
    assert [asdict(d) for d in body.daily_body_values(records)] == data["daily_body_values"]["expected"]


def test_週の始まりは月曜():
    assert [c.week_start(d) for d in ("2026-11-08", "2026-11-09", "2026-11-11", "2026-11-15", "2026-11-16")] == [
        "2026-11-02", "2026-11-09", "2026-11-09", "2026-11-09", "2026-11-16"]


def _phase(d: dict) -> phase.Phase:
    history = tuple(phase.TargetChange(c["date"], c["target_weight_kg"], c["end_date"], c.get("weight_kg"))
                    for c in d["target_history"])
    return phase.Phase(d["id"], d["kind"], d["direction"], d["name"], d["start_date"], d["end_date"],
                       d["target_weight_kg"], d["meal_targets"], d["snapshot"], d["status"], d["paused_phase_id"],
                       history, d["ended_on"], d["created_at"])


@pytest.mark.parametrize("group", load("phases.json")["groups"], ids=lambda g: g["name"])
def test_フェーズの計算(group):
    phases = [_phase(d) for d in group["phases"]]
    weights = [(d, kg) for d, kg in group["weights"]]
    for check in group["checks"]:
        p = next(x for x in phases if x.id == check["phase_id"])
        pp = phase_progress(p, phases, weights, check["as_of"])
        pace = None if pp.pace is None else {
            "status": pp.pace.status, "reason": pp.pace.reason, "weigh_ins": pp.pace.weigh_ins,
            "week_avg_kg": pp.pace.week_avg_kg, "plan_kg": pp.pace.plan_kg, "diff_kg": pp.pace.diff_kg}
        assert {"label": phase.label(p), "paused": pp.paused, "week": pp.week, "weeks_total": pp.weeks_total,
                "effective_end": pp.effective_end, "remaining_days": pp.remaining_days, "rehab_days": pp.rehab_days,
                "plan_kg": pp.plan_kg, "pace": pace} == check["expected"], (check["phase_id"], check["as_of"])
    for c in group["current"]:
        current, paused = phase.current(phases, c["as_of"])
        assert (current and current.id, paused and paused.id) == (c["current"], c["paused"]), c["as_of"]
