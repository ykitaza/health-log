"""ある日の時点の記録（フェーズの振り返りの終わりの値）。アプリの lib/phaseView.ts の measuresFrom と同じ決まり。"""

from training.domain.measures import Measure, big3_best, big3_end_since, week_or_latest
from training.domain.model import SetRow


def test_7日に記録があれば平均_なければ最新_それもなければ_None():
    values = [("2026-09-01", 70.0), ("2026-09-19", 72.0), ("2026-09-25", 72.45), ("2026-09-26", 90.0)]
    assert week_or_latest(values, "2026-09-25") == Measure(72.2, "week")  # 09-19〜09-25（26日は入れない）
    assert week_or_latest(values, "2026-09-15") == Measure(70.0, "latest")
    assert week_or_latest(values, "2026-08-31") == Measure(None, None)
    # .5 は上げる（アプリの Math.round と同じ。Python の round(72.25, 1) は 72.2）
    assert week_or_latest([("2026-09-24", 72.0), ("2026-09-25", 72.5)], "2026-09-25") == Measure(72.3, "week")


def test_BIG3_はその日までの最高の推定1RM_どの役にも記録がなければ_None():
    rows = [SetRow("2026-09-01", "bench", "chest", 100, 5), SetRow("2026-09-10", "bench", "chest", 100, 1),
            SetRow("2026-10-01", "bench", "chest", 150, 1), SetRow("2026-09-05", "other", "chest", 200, 1)]
    roles = {"bench": "bench", "squat": "squat"}
    assert big3_best(rows, roles, "2026-09-30") == {"bench": 116.7, "squat": None, "deadlift": None}
    assert big3_best(rows, roles, "2026-08-31") is None
    assert big3_best(rows, {}, "2026-09-30") is None


def test_終わりの_BIG3_は最後の28日だけ_開始日より前は含めない():
    rows = [SetRow("2026-09-01", "bench", "chest", 100, 5), SetRow("2026-10-20", "bench", "chest", 90, 3)]
    roles = {"bench": "bench"}
    # 減量で 116.7 → 99.0 に下がったのが、終わりの値に出る（その日までの最高だと 116.7 のまま）
    assert big3_best(rows, roles, "2026-10-31", big3_end_since("2026-09-01", "2026-10-31")) == {
        "bench": 99.0, "squat": None, "deadlift": None}
    assert big3_best(rows, roles, "2026-10-31") == {"bench": 116.7, "squat": None, "deadlift": None}
    assert big3_end_since("2026-09-01", "2026-10-31") == "2026-10-04"  # 最後の日を含めて28日
    assert big3_end_since("2026-10-15", "2026-10-31") == "2026-10-15"  # フェーズが短ければ開始日から
    assert big3_best(rows, roles, "2026-10-19", big3_end_since("2026-10-01", "2026-10-19")) is None  # 28日に記録がない
