"""目標の自動計算（アプリの lib/autoGoal.ts と同じ式）。アプリと突き合わせる値は testdata/meals/auto_goal.json にもある。"""

from datetime import date

import pytest

from meals.domain.auto_goal import (
    Activity,
    BodyDay,
    GoalInput,
    Sex,
    basal_metabolism,
    body_basis,
    calc_goal,
    ceil10,
    check_birth_year,
    js_round,
    missing_inputs,
    policy_for,
    round1,
    round10,
)
from meals.domain.errors import MealError
from meals.domain.nutrition_goal import DailyTarget, Policy

TODAY = date(2026, 11, 9)


def test_代表の値_Katch_McArdle_減量():
    goal = calc_goal(GoalInput(80.0, 20.0, Activity.MODERATE, 72, None, None, None))
    assert goal.bmr == pytest.approx(370 + 21.6 * 64)  # 除脂肪体重 64kg → 1752.4
    assert goal.bmr_method == "katch-mcardle"
    assert goal.policy == Policy.CUT and goal.weekly_kg == pytest.approx(-0.4)
    assert goal.daily_delta == pytest.approx(-0.4 * 7200 / 7)  # −411.4
    # 休み：1752.4 × 1.55 − 411.4 ≒ 2304.8 → 2300。脂質 2300 × 25% ÷ 9 ≒ 64、炭水化物 (2300 − 160×4 − 64×9) ÷ 4 = 271
    assert goal.rest == DailyTarget(2300, 64, 271)
    assert goal.training == DailyTarget(2580, 72, 323)  # +280kcal。(2580 − 640 − 72×9) ÷ 4 = 323
    assert goal.protein_g == 160 and not goal.floored


def test_代表の値_Mifflin_St_Jeor_性別で定数が変わる():
    male = basal_metabolism(70, None, 175, 30, Sex.MALE)
    female = basal_metabolism(70, None, 175, 30, Sex.FEMALE)
    assert male == (10 * 70 + 6.25 * 175 - 5 * 30 + 5, "mifflin-st-jeor")
    assert male[0] - female[0] == 166


def test_体脂肪率がなく_身長_年齢_性別のどれかがなければ計算しない():
    assert basal_metabolism(70, None, None, 30, Sex.MALE) is None
    assert calc_goal(GoalInput(70, None, Activity.LIGHT, None, 175, None, Sex.MALE)) is None


@pytest.mark.parametrize(("target", "policy"), [
    (None, Policy.MAINTAIN), (70.7, Policy.MAINTAIN), (69.3, Policy.MAINTAIN),  # ちょうど ±1% は維持
    (70.71, Policy.BULK), (69.29, Policy.CUT),
])
def test_方針の境目は体重の1パーセント(target, policy):
    assert policy_for(70, target)[0] == policy


def test_週のペースは減量0_5パーセント_増量0_25パーセント():
    assert policy_for(80, 70) == (Policy.CUT, -0.4)
    assert policy_for(80, 90) == (Policy.BULK, 0.2)


def test_下限は基礎代謝を10kcal単位で切り上げた値():
    goal = calc_goal(GoalInput(50, None, Activity.SEDENTARY, 45, 150, 60, Sex.FEMALE))
    assert goal.bmr == pytest.approx(976.5)
    assert goal.floored and goal.rest.kcal == 980


def test_丸めは0_5を大きい方へ_Pythonのroundと違う():
    assert (js_round(2.5), js_round(-2.5), js_round(0.49999999999999994)) == (3, -2, 0)
    assert round1(70.25) == 70.3  # round(70.25, 1) は 70.2
    assert (round10(2305), round10(2304.9), ceil10(976.5), ceil10(980)) == (2310, 2300, 980, 980)


def test_体重と体脂肪率は_いちばん新しい体重の日を含む7日の平均():
    days = [BodyDay(date(2026, 11, 1), 90, 30), BodyDay(date(2026, 11, 2), 80, None),
            BodyDay(date(2026, 11, 5), None, 20), BodyDay(date(2026, 11, 8), 81, 22), BodyDay(date(2026, 11, 10), 60, 10)]
    b = body_basis(days, TODAY)
    assert (b.weight_kg, b.weight_from, b.weight_to, b.weight_days) == (80.5, date(2026, 11, 2), date(2026, 11, 8), 2)
    assert (b.body_fat.pct, b.body_fat.start, b.body_fat.end, b.body_fat.days) == (21, date(2026, 11, 5), date(2026, 11, 8), 2)
    assert body_basis([BodyDay(TODAY, None, 20)], TODAY) is None


def test_平均はアプリと同じく前から順に足す():
    # sum() は誤差を補正するので 0.1 + 0.2 + 0.3 の末尾が JavaScript とずれる
    b = body_basis([BodyDay(date(2026, 11, d), w, None) for d, w in ((7, 0.1), (8, 0.2), (9, 0.3))], TODAY)
    assert b.weight_kg == (0.1 + 0.2 + 0.3) / 3


def test_足りない入力():
    b = body_basis([BodyDay(TODAY, 70, None)], TODAY)
    with_fat = body_basis([BodyDay(TODAY, 70, 18)], TODAY)
    assert missing_inputs(None, 175, Sex.MALE, 1990, Activity.LIGHT) == ["weight"]
    assert missing_inputs(b, None, None, None, None) == ["sex", "birth_year", "height", "activity"]
    assert missing_inputs(b, 175, Sex.MALE, 1990, Activity.LIGHT) == []
    assert missing_inputs(with_fat, None, None, None, None) == ["activity"]


@pytest.mark.parametrize(("year", "ok"), [(1926, True), (2011, True), (1925, False), (2012, False)])
def test_生まれた年は15から100歳(year, ok):
    if ok:
        check_birth_year(year, 2026)
    else:
        with pytest.raises(MealError, match="1926〜2011") as e:
            check_birth_year(year, 2026)
        assert str(year) not in str(e.value)  # 入力の値は文に入れない
