"""食事のスコア（#331）。期待する値は、式を写さずに手で計算した数を書く（計算はコメントに残す）。"""

from datetime import date

import pytest

from meals.domain.auto_goal import Sex
from meals.domain.meal import FoodItem, Meal
from meals.domain.meal_score import meal_score, sv_band
from meals.domain.nutrition_goal import Target
from meals.domain.values import DietEstimate, EatenOn, MealSlot, Nutrition, Quantity, Source, Unit
from tests.domain.factories import EATER

DAY = date(2026, 11, 20)
NO_EST = dict.fromkeys(("sv_staple", "sv_side", "sv_main", "sv_dairy", "sv_fruit", "fiber_g", "salt_g", "alcohol_g",
                        "is_snack_or_sweet_drink"))
ZERO = {"sv_staple": 0, "sv_side": 0, "sv_main": 0, "sv_dairy": 0, "sv_fruit": 0, "fiber_g": 0, "salt_g": 0,
        "alcohol_g": 0, "is_snack_or_sweet_drink": False}


def item(n: int, kcal: float, protein: float = 0, fat: float = 0, **est) -> FoodItem:
    return FoodItem(f"i{n}", f"品目{n}", Quantity(1, Unit.PIECE), Nutrition(kcal, protein, fat, 0),
                    estimate=DietEstimate(**{**NO_EST, **est}))


def day_of(*items: FoodItem) -> tuple[Meal, ...]:
    return (Meal("m", EATER, EatenOn(DAY, MealSlot.LUNCH), items, "", Source.TEXT),)


# 合計：kcal 2160、たんぱく質 126g、脂質 60g、主食 6、副菜 1、主菜 4、牛乳・乳製品 2、果物 1、食物繊維 11g、食塩 9g、お酒 0、菓子 0
FULL_DAY = (
    item(1, 1000, 40, 20, **{**ZERO, "sv_staple": 4, "sv_side": 1, "sv_main": 1, "fiber_g": 6, "salt_g": 4}),
    item(2, 900, 70, 30, **{**ZERO, "sv_staple": 2, "sv_main": 3, "fiber_g": 3, "salt_g": 5}),
    item(3, 260, 16, 10, **{**ZERO, "sv_dairy": 2, "sv_fruit": 1, "fiber_g": 2}),
)
TARGET = Target(kcal=2400, protein_g=140)


def points(score, key):
    return score.part_points(next(p for p in score.parts if p.key == key))


def test_全部そろった日():
    s = meal_score(day_of(*FULL_DAY), TARGET, Sex.MALE)
    # エネルギー：2160 は 2400 の −10%（±10% 以内）→ 100
    # たんぱく質：126 は 140 の 90% → 100
    # バランス（2400kcal は基本形の欄）：主食 6（5〜7）1、副菜 1/5 = 0.2、主菜 4（3〜5）1、乳 2（2）1、果物 1/2 = 0.5、
    #   食物繊維 11/22 = 0.5 → 4.2/6 = 0.7 → 70
    # 控えたいもの：食塩 9g（男性 7.5g）1 − 1.5/7.5 = 0.8、脂質 60×9/2160 = 25%（20〜30%）1、菓子 0 で 1、お酒 0 で 1 → 3.8/4 = 0.95 → 95
    # 点：(1 + 1 + 0.7 + 0.95)/4 = 0.9125 → 91
    assert [points(s, k) for k in ("energy", "protein", "balance", "moderation")] == [100, 100, 70, 95]
    assert s.score == 91
    # 伸ばしやすいのは副菜：(1 − 0.2) × 100 / 4 内訳 / 6 項目 = 3.33… → +3。果物・食物繊維は 0.5 × 100/24 = 2.08…
    e = s.easiest
    assert (e.part, e.item.key, e.item.advice, e.gain) == ("balance", "sv_side", "副菜をあと 4 つ", 3)


def test_推定のない品目が1つでもある日は_推定の項目が記録なしになり_点を下げない():
    app_item = item(4, 0.0001)  # アプリで手入力した品目（推定なし。kcal はほぼ 0 にして合計を変えない）
    s = meal_score(day_of(*FULL_DAY, app_item), TARGET, Sex.MALE)
    # バランスは全部記録なし。控えたいものは脂質（PFC はどの品目にもある）だけ：25% で 1
    # 点：(1 + 1 + 1)/3 = 1 → 100（記録なしの内訳で下がらない）
    assert points(s, "balance") is None
    assert [i.key for i in next(p for p in s.parts if p.key == "moderation").available] == ["fat_ratio"]
    assert s.score == 100
    assert s.easiest is None  # 全部満点


def test_食塩だけ推定がない日は_食塩だけを除いて割り直す():
    no_salt = item(4, 0.0001, **{**ZERO, "salt_g": None})
    s = meal_score(day_of(*FULL_DAY, no_salt), TARGET, Sex.MALE)
    # 控えたいもの：脂質 1、菓子 1、お酒 1 の 3 つで 1 → 100。点：(1 + 1 + 0.7 + 1)/4 = 0.925 → 92.5 は 93（.5 は上げる）
    assert points(s, "moderation") == 100
    assert s.score == 93


def test_目標がない日は_エネルギーとたんぱく質が記録なしで_SV_は基本形の欄():
    s = meal_score(day_of(*FULL_DAY), None, Sex.MALE)
    # (0.7 + 0.95)/2 = 0.825 → 82.5 は 83
    assert (points(s, "energy"), points(s, "protein")) == (None, None)
    assert (s.band.label, s.band_from_target) == ("2,200±200kcal（基本形）", False)
    assert s.score == 83


@pytest.mark.parametrize("kcal, label", [
    (1200, "1,400〜2,000kcal"),  # 欄より下は、いちばん下の欄
    (1999, "1,400〜2,000kcal"),
    (2000, "2,200±200kcal（基本形）"),  # 境目 2,000 は基本形
    (2400, "2,200±200kcal（基本形）"),  # 境目 2,400 も基本形
    (2401, "2,400〜3,000kcal"),
    (3500, "2,400〜3,000kcal"),  # 欄より上は、いちばん上の欄
])
def test_SVの目安の欄は目標kcalで選ぶ(kcal, label):
    assert sv_band(kcal)[0].label == label


def test_目標kcalが2600なら_2400から3000の欄でバランスを見る():
    s = meal_score(day_of(*FULL_DAY), Target(kcal=2600, protein_g=140), Sex.MALE)
    # 主食 6（6〜8）1、副菜 1/6、主菜 4（4〜6）1、乳 2（2〜3）1、果物 1/2、食物繊維 0.5
    # → (1 + 0.1667 + 1 + 1 + 0.5 + 0.5)/6 = 4.1667/6 = 0.6944 → 69
    assert points(s, "balance") == 69


# 控えたいものだけを見る日：合計 kcal 2000、脂質 50g（450/2000 = 22.5%）、食塩 9g、純アルコール 20g、菓子 300kcal
MODERATION_DAY = (
    item(1, 1500, 0, 50, salt_g=9, alcohol_g=0, is_snack_or_sweet_drink=False),
    item(2, 200, 0, 0, salt_g=0, alcohol_g=20, is_snack_or_sweet_drink=False),  # ビール 500ml（お酒は菓子に数えない）
    item(3, 300, 0, 0, salt_g=0, alcohol_g=0, is_snack_or_sweet_drink=True),  # ケーキ
)


@pytest.mark.parametrize("sex, expected", [
    # 女性：食塩 1 − 2.5/6.5 = 0.6154、脂質 1、菓子 1 − 100/200 = 0.5、お酒 20g は 20g 以上 → 1 − 20/40 = 0.5
    #   → 2.6154/4 = 0.6538 → 65
    (Sex.FEMALE, 65),
    # 男性：食塩 1 − 1.5/7.5 = 0.8、脂質 1、菓子 0.5、お酒 20g は 40g 未満 → 1 → 3.3/4 = 0.825 → 83
    (Sex.MALE, 83),
    # 性別がない：厳しいほう（食塩 6.5g、お酒 20g）→ 女性と同じ 65
    (None, 65),
])
def test_控えたいものは性別の目安で見る_性別がなければ厳しいほう(sex, expected):
    s = meal_score(day_of(*MODERATION_DAY), None, sex)
    assert points(s, "moderation") == expected
    assert s.score == expected  # ほかの内訳は記録なし


def test_性別がないときの食物繊維は22g():
    s = meal_score(day_of(item(1, 100, fiber_g=11)), None, None)
    fiber = next(i for i in next(p for p in s.parts if p.key == "balance").items if i.key == "fiber_g")
    assert (fiber.low, fiber.ratio) == (22, 0.5)


@pytest.mark.parametrize("fat, expected", [
    (2000 * 0.40 / 9, 0),  # 40%：30% から 10 ポイント → 0
    (2000 * 0.15 / 9, 50),  # 15%：20% から 5 ポイント → 0.5
    (2000 * 0.35 / 9, 50),  # 35%：30% から 5 ポイント → 0.5
])
def test_脂質のエネルギー比(fat, expected):
    s = meal_score(day_of(item(1, 2000, 0, fat)), None, Sex.MALE)
    assert points(s, "moderation") == expected


@pytest.mark.parametrize("kcal, expected", [
    (2200, 100),  # +10%
    (2600, 50),  # +30%：1 − (0.3 − 0.1)/0.4 = 0.5
    (1400, 50),  # −30%
    (3100, 0),  # +55%
])
def test_エネルギーは目標との差(kcal, expected):
    s = meal_score(day_of(item(1, kcal, 0, kcal * 0.25 / 9)), Target(kcal=2000), Sex.MALE)
    assert points(s, "energy") == expected


def test_たんぱく質は多くても下げない_足りなければ90パーセントに対する割合():
    over = meal_score(day_of(item(1, 900, 200, 25)), Target(protein_g=100), Sex.MALE)
    short = meal_score(day_of(item(1, 900, 45, 25)), Target(protein_g=100), Sex.MALE)
    assert (points(over, "protein"), points(short, "protein")) == (100, 50)  # 45/90 = 0.5
    assert short.easiest.item.advice == "たんぱく質をあと 55 g"


def test_食事がない日は点を出さない():
    assert meal_score((), TARGET, Sex.MALE) is None
