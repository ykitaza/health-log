"""アプリ（apps/mobile/lib/__tests__/shared-testdata.test.ts）と同じテストのデータで、計算を確かめる。"""

import json
from dataclasses import asdict
from pathlib import Path

import pytest

from training.domain import body
from training.domain import calculations as c
from training.domain.model import BodyRecord, SetRow

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


def test_体組成():
    data = load("body.json")
    for case in data["bmi"]:
        assert body.bmi(case["weight_kg"], case["height_cm"]) == case["expected"]
    for name, fn in (("fat_mass", body.fat_mass), ("lean_mass", body.lean_mass), ("muscle_mass", body.muscle_mass)):
        for case in data[name]:
            assert fn(case["weight_kg"], case["pct"]) == case["expected"]
    for case in data["weekly_pace"]:
        points = [(p["date"], p["weight_kg"]) for p in case["points"]]
        assert body.weekly_pace(points, case["today"], case["days"]) == case["expected"]
    for case in data["goal_progress"]:
        assert asdict(body.goal_progress(case["current_kg"], case["goal_kg"], case["pace_per_week"])) == case["expected"]
    records = [BodyRecord(f"r{n}", r["date"], r["measured_at"], r["weight_kg"], r["body_fat_pct"], r["muscle_pct"],
                          r["waist_cm"], r["memo"], r["source"], r["updated_at"])
               for n, r in enumerate(data["daily_body_values"]["records"])]
    assert [asdict(d) for d in body.daily_body_values(records)] == data["daily_body_values"]["expected"]


def test_週の始まりは日曜():
    assert [c.week_start(d) for d in ("2026-11-08", "2026-11-11", "2026-11-14", "2026-11-15")] == [
        "2026-11-08", "2026-11-08", "2026-11-08", "2026-11-15"]
