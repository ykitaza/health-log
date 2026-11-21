"""手で計算できる小さなデータで、集計の決まりを確かめる（#326）。期待する値は式から出さず、手で計算した数を書く
（実装と同じ式で期待値を作ると、式の誤りを見逃すため）。"""

from training.domain import body, bodyweight, calculations, health, part_sets, phase
from training.domain.model import SetRow, SleepSession
from training.presentation.views import r1, r2

# --- 丸め（アプリの Math.round と同じ。.5 は上げる） ---


def test_小数第1位の丸めは_5を上げる_アプリの_Math_round_と同じ():
    # 458.25・0.25 は2進数でちょうど表せるので、Python の round は偶数へ丸めて 458.2・0.2 になっていた
    assert (r1(458.25), r1(0.25), r1(0.75), r1(1.05), r1(None)) == (458.3, 0.3, 0.8, 1.1, None)
    assert (r1(-0.25), r1(-0.35)) == (-0.2, -0.3)  # Math.round(−2.5) は −2、Math.round(−3.5) は −3


def test_小数第2位の丸めも_5を上げる():
    assert (r2(0.125), r2(-0.875), r2(-0.125), r2(None)) == (0.13, -0.87, -0.12, None)


# --- 1セット ---


def test_推定1RM_は_Epley_1回は重量そのもの_重量か回数がなければ0():
    assert calculations.estimated_1rm(100, 1) == 100
    assert r1(calculations.estimated_1rm(90, 3)) == 99.0  # 90 × (1 + 3/30)
    assert r1(calculations.estimated_1rm(60, 15)) == 90.0  # 60 × 1.5
    assert (calculations.estimated_1rm(None, 10), calculations.estimated_1rm(80, 0)) == (0, 0)


def test_負荷量_重量_回数_自重は体重_割合_回数():
    rows = [SetRow("2026-11-02", "bench", "chest", 80, 8),  # 640
            SetRow("2026-11-02", "pullup", "back", None, 10, 1.0),  # 体重 70 × 1.0 × 10 = 700
            SetRow("2026-11-02", "pushup", "chest", None, 20, 0.65),  # 70 × 0.65 × 20 = 910
            SetRow("2026-11-02", "plank", "abs", None, 60, 0)]  # 割合 0 は 0
    rows = bodyweight.with_bodyweight(rows, [("2026-11-01", 70.0)])
    assert [calculations.row_volume(r) for r in rows] == [640, 700, 910, 0]
    assert calculations.total_volume(rows) == 2250


def test_自重の体重は_その日か前の30日以内_31日前は使わない():
    weights = [("2026-10-01", 60.0), ("2026-10-05", 65.0)]
    assert bodyweight.weight_on(weights, "2026-11-04") == 65.0  # 30日前
    assert bodyweight.weight_on(weights, "2026-11-05") is None  # 31日前
    assert bodyweight.weight_on(weights, "2026-10-04") == 60.0  # 後の日の体重は使わない


# --- 週（月曜始まり）と期間 ---


def test_週は月曜始まり_日曜は前の月曜の週():
    assert calculations.week_start("2026-11-08") == "2026-11-02"  # 日曜
    assert calculations.week_start("2026-11-09") == "2026-11-09"  # 月曜
    assert calculations.week_start("2026-03-01") == "2026-02-23"  # 月をまたぐ
    assert calculations.week_start("2028-03-01") == "2028-02-28"  # うるう年


def test_週ごとの負荷量と直近7日_28日():
    rows = [SetRow("2026-11-02", "a", "p", 100, 1),  # 今週の月曜
            SetRow("2026-11-01", "a", "p", 10, 1),  # 先週の日曜
            SetRow("2026-10-12", "a", "p", 1, 1),  # 3週前の週の月曜（今日から27日前）
            SetRow("2026-10-11", "a", "p", 1000, 1),  # 28日前（直近28日の外）
            SetRow("2026-11-09", "a", "p", 5000, 1)]  # 今日より後は数えない
    assert calculations.weekly_volumes(rows, "2026-11-08", 5) == [100, 10, 0, 1, 1000]  # 10-12 は 3週前の週の月曜、10-11（日曜）は 4週前の週
    totals = calculations.period_totals(rows, "2026-11-08")
    assert (totals.last7, totals.last28, totals.total) == (100, 111, 1111)


def test_自己ベストは推定1RM_の最大_その日より前だけでも見られる():
    rows = [SetRow("2026-11-01", "bench", "chest", 100, 5),  # 116.66…
            SetRow("2026-11-05", "bench", "chest", 110, 1),  # 110
            SetRow("2026-11-08", "bench", "chest", 105, 5)]  # 122.5
    assert calculations.personal_bests(rows)["bench"].date == "2026-11-08"
    before = calculations.personal_bests(rows, before_date="2026-11-08")["bench"]
    assert (before.date, round(before.e1rm, 2)) == ("2026-11-01", 116.67)


# --- 体組成 ---


def test_体重のペースは直近28日の最初と最後から():
    points = [("2026-10-11", 80.0), ("2026-10-12", 72.0), ("2026-11-05", 70.0), ("2026-11-09", 60.0)]
    # 11-08 までの28日（10-12〜）：72.0 → 70.0 を 24日で。−2 ÷ 24 × 7 ＝ −0.5833…
    assert r2(body.weekly_pace(points, "2026-11-08")) == -0.58
    assert body.weekly_pace([("2026-11-05", 70.0)], "2026-11-08") is None


# --- 睡眠 ---


def test_睡眠は起きた日ごとに足し_時刻はいちばん長い睡眠のもの():
    sessions = [SleepSession("a", "2026-11-07", "2026-11-06T14:40:00.000Z", "2026-11-06T21:55:00.000Z", 420, 15),
                SleepSession("b", "2026-11-07", "2026-11-07T04:00:00.000Z", "2026-11-07T04:30:00.000Z", 30, 0)]
    [night] = health.sleep_nights(sessions)
    assert (night.asleep_min, night.awake_min, night.start_at, night.sessions) == (450, 15, "2026-11-06T14:40:00.000Z", 2)
    assert health.average([450, 380]) == 415 and health.average([]) is None


# --- 部位のセット数（前の期間） ---


def test_部位のセット数の前の期間は_7の倍数の日だけ前():
    names = {"chest": "胸", "legs": "脚", "neck": "首"}
    rows = [SetRow("2026-11-02", "a", "chest", 80, 8), SetRow("2026-11-02", "a", "chest", 80, 8),
            SetRow("2026-10-26", "a", "chest", 80, 8), SetRow("2026-11-03", "b", "legs", None, 0),
            SetRow("2026-11-03", "c", "neck", 10, 10)]
    p = part_sets.part_sets(rows, names.get, "2026-11-02", "2026-11-08", "2026-11-05")
    assert (p.to, p.previous_from, p.previous_to) == ("2026-11-05", "2026-10-26", "2026-10-29")
    assert (p.sets, p.previous) == ([2, 0, 0, 0, 1, 0], [1, 0, 0, 0, 0, 0])  # 首は数えない
    month = part_sets.part_sets(rows, names.get, "2026-11-01", "2026-11-30", "2026-11-30")
    assert (month.previous_from, month.previous_to) == ("2026-09-27", "2026-10-26")  # 30日 → 35日前


# --- フェーズのペース ---


def _cut(**extra) -> phase.Phase:
    return phase.Phase("p1", "normal", "cut", "", "2026-10-05", "2026-11-29", 66.0, None,
                       {"weight_kg": 70.0}, "active", None, (), None, **extra)


def test_フェーズの予定の線とペース_差が0_3kg_以内なら順調():
    p = _cut()
    # 10-05〜11-29（55日）で 70 → 66kg。11-02 は 28日目：70 − 4 × 28/55 ＝ 67.963…
    assert phase.cents(phase.plan_value(p, [], "2026-11-02")) == 6796
    weights = [("2026-11-02", 68.0), ("2026-11-08", 67.6)]
    # 予定：11-02 は 67.963…、11-08 は 70 − 4 × 34/55 ＝ 67.527…。平均 67.745…。体重の平均 67.8。差 0.05
    pace = phase.pace(p, [p], weights, "2026-11-08")
    assert (pace.status, pace.week_avg_kg, pace.plan_kg, pace.diff_kg) == ("on_track", 67.8, 67.75, 0.05)
    slow = phase.pace(p, [p], [("2026-11-02", 68.5), ("2026-11-08", 68.1)], "2026-11-08")
    assert (slow.status, slow.diff_kg) == ("slow", 0.55)  # 減量で予定より重い
    few = phase.pace(p, [p], [("2026-11-08", 67.6)], "2026-11-08")
    assert (few.status, few.reason) == (None, "few_weigh_ins")
