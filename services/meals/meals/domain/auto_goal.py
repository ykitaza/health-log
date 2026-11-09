"""食事の目標（筋トレの日・休みの日の kcal と PFC）を、体のデータから自動で計算する（Claude に数字を考えさせないため）。

アプリ（apps/mobile/lib/autoGoal.ts）と同じ式・定数・丸めにする（testdata/meals/auto_goal.json で、同じ入力で同じ数字になることを確かめる）。
数字は一般的な目安で、医療のための計算ではない。保存はしない（本人が案を見て決めてから保存する）。

1. 基礎代謝（BMR）：直近の体脂肪率があれば Katch-McArdle（370 + 21.6 × 除脂肪体重）。なければ Mifflin-St Jeor
2. 1日に使うカロリー（TDEE）：BMR × ふだんの活動の量の係数（筋トレの分は含めない）。筋トレの日は TRAINING_KCAL を足す
3. 目標のカロリー：目標体重と今の体重から、減量（週に体重の 0.5%）・維持・増量（週に 0.25%）。1kg ＝ 7,200kcal。
   差が体重の ±1% 以内なら維持。下限は BMR（下回らない）
4. PFC：たんぱく質は体重 1kg あたり 2.0g、脂質はカロリーの 25%、炭水化物は残り
体重・体脂肪率は、いちばん新しい体重の日までの 7 日の平均（ぶれを抑える）

丸めはアプリ（JavaScript の Math.round。0.5 は大きい方へ）と同じにする。Python の round は偶数への丸めなので使わない。
平均の足し算も、アプリと同じく前から順に足す（Python 3.12 の sum は誤差を補正するので、小数の末尾がずれることがある）。
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, timedelta
from enum import Enum

from meals.domain.errors import MealError
from meals.domain.nutrition_goal import DailyTarget, Policy


class Sex(Enum):
    MALE = "male"
    FEMALE = "female"


class Activity(Enum):
    """ふだんの活動の量（アプリの設定の activity_level）。係数は筋トレの分を含めない一般的な活動係数。"""

    SEDENTARY = "sedentary"
    LIGHT = "light"
    MODERATE = "moderate"
    VERY = "very"

    @property
    def factor(self) -> float:
        return ACTIVITY_FACTORS[self]

    @property
    def label(self) -> str:
        return ACTIVITY_LABELS[self]


ACTIVITY_FACTORS = {Activity.SEDENTARY: 1.2, Activity.LIGHT: 1.375, Activity.MODERATE: 1.55, Activity.VERY: 1.725}
ACTIVITY_LABELS = {Activity.SEDENTARY: "ほとんど座っている", Activity.LIGHT: "少し動く",
                   Activity.MODERATE: "よく動く", Activity.VERY: "とてもよく動く"}

# 筋トレの日に足す kcal（(5 METs − 1) × 70kg × 1 時間 ≒ 280kcal。体重や時間で変えない）
TRAINING_KCAL = 280
KCAL_PER_KG = 7200  # 体重 1kg の増減に要る kcal
CUT_RATE = 0.005  # 1週間に変える体重の割合（体重に対して）
BULK_RATE = 0.0025
MAINTAIN_BAND = 0.01  # 目標体重との差がこの割合以内なら維持
PROTEIN_PER_KG = 2.0
FAT_RATIO = 0.25
AVERAGE_DAYS = 7  # 体重・体脂肪率の平均をとる日数（いちばん新しい体重の日を含む）


def js_round(x: float) -> int:
    """JavaScript の Math.round と同じ（0.5 は大きい方へ）。"""
    r = math.floor(x)
    return r + 1 if x - r >= 0.5 else r


def round10(n: float) -> int:
    return js_round(n / 10) * 10


def ceil10(n: float) -> int:
    return math.ceil(n / 10) * 10


def round1(n: float) -> float:
    return js_round(n * 10) / 10


def _mean(xs: list[float]) -> float:
    total = 0
    for x in xs:
        total += x
    return total / len(xs)


def birth_year_range(this_year: int) -> tuple[int, int]:
    """生まれた年の範囲（15〜100歳。式は大人向け）。アプリの birthYearRange と同じ。"""
    return this_year - 100, this_year - 15


def check_birth_year(birth_year: int, this_year: int) -> None:
    low, high = birth_year_range(this_year)
    if not low <= birth_year <= high:
        raise MealError(f"生まれた年は {low}〜{high} の数字で入れてください")  # 入力の値は文に入れない


@dataclass(frozen=True)
class BodyDay:
    """1日の体組成（手入力を優先し、なければ Health Connect の取り込み）。"""

    day: date
    weight_kg: float | None
    body_fat_pct: float | None


@dataclass(frozen=True)
class BodyFatBasis:
    pct: float
    start: date
    end: date
    days: int


@dataclass(frozen=True)
class BodyBasis:
    """計算に使った体重・体脂肪率（平均）と、その日の範囲。"""

    weight_kg: float
    weight_from: date
    weight_to: date
    weight_days: int
    body_fat: BodyFatBasis | None


def body_basis(days: list[BodyDay], today: date) -> BodyBasis | None:
    """今日までで、いちばん新しい体重の日から AVERAGE_DAYS 日の平均。体脂肪率も同じ日の範囲の記録だけを使う。"""
    past = sorted((d for d in days if d.day <= today), key=lambda d: d.day)
    weights = [d for d in past if d.weight_kg is not None]
    if not weights:
        return None
    to = weights[-1].day
    start = to - timedelta(days=AVERAGE_DAYS - 1)
    in_window = [d for d in past if start <= d.day <= to]
    w = [d for d in in_window if d.weight_kg is not None]
    f = [d for d in in_window if d.body_fat_pct is not None]
    fat = BodyFatBasis(_mean([d.body_fat_pct for d in f]), f[0].day, f[-1].day, len(f)) if f else None
    return BodyBasis(_mean([d.weight_kg for d in w]), w[0].day, to, len(w), fat)


@dataclass(frozen=True)
class GoalInput:
    weight_kg: float
    body_fat_pct: float | None
    activity: Activity
    target_weight_kg: float | None
    # 体脂肪率がないとき（Mifflin-St Jeor）だけ使う
    height_cm: float | None
    age: int | None
    sex: Sex | None


@dataclass(frozen=True)
class GoalCalc:
    bmr: float
    bmr_method: str  # katch-mcardle・mifflin-st-jeor
    tdee_rest: float
    tdee_training: float
    policy: Policy
    weekly_kg: float  # 1週間に変える体重（kg。減量は負）
    daily_delta: float  # 1日あたりの差（kcal。減量は負）。下限で削る前の値
    floored: bool  # 下限（BMR）で目標を引き上げた日があるか
    body_weight_kg: float  # 計算に使った体重（0.1kg に丸めた値）
    protein_g: int
    training: DailyTarget
    rest: DailyTarget


def basal_metabolism(weight_kg: float, body_fat_pct: float | None, height_cm: float | None,
                     age: int | None, sex: Sex | None) -> tuple[float, str] | None:
    """基礎代謝（kcal／日）と式。体脂肪率がなく、身長・年齢・性別のどれかもなければ None。"""
    if body_fat_pct is not None:
        return 370 + 21.6 * weight_kg * (1 - body_fat_pct / 100), "katch-mcardle"
    if height_cm is None or age is None or sex is None:
        return None
    return 10 * weight_kg + 6.25 * height_cm - 5 * age + (5 if sex == Sex.MALE else -161), "mifflin-st-jeor"


def policy_for(weight_kg: float, target_weight_kg: float | None) -> tuple[Policy, float]:
    """方針と、1週間に変える体重（kg）。"""
    if target_weight_kg is None or abs(target_weight_kg - weight_kg) <= weight_kg * MAINTAIN_BAND + 1e-9:
        return Policy.MAINTAIN, 0
    if target_weight_kg < weight_kg:
        return Policy.CUT, -weight_kg * CUT_RATE
    return Policy.BULK, weight_kg * BULK_RATE


def calc_goal(i: GoalInput) -> GoalCalc | None:
    """足りない入力があれば None（先に missing_inputs で確かめる）。"""
    body_weight_kg = round1(i.weight_kg)
    b = basal_metabolism(body_weight_kg, i.body_fat_pct, i.height_cm, i.age, i.sex)
    if b is None:
        return None
    bmr, method = b
    tdee_rest = bmr * i.activity.factor
    tdee_training = tdee_rest + TRAINING_KCAL
    policy, weekly_kg = policy_for(body_weight_kg, i.target_weight_kg)
    daily_delta = (weekly_kg * KCAL_PER_KG) / 7
    protein_g = js_round(body_weight_kg * PROTEIN_PER_KG)
    floored = False

    def target(tdee: float) -> DailyTarget:
        nonlocal floored
        raw = tdee + daily_delta
        if raw < bmr:
            floored = True
        kcal = max(round10(raw), ceil10(bmr))
        fat_g = js_round((kcal * FAT_RATIO) / 9)
        carbs_g = js_round(max(kcal - protein_g * 4 - fat_g * 9, 0) / 4)
        return DailyTarget(kcal, fat_g, carbs_g)

    training, rest = target(tdee_training), target(tdee_rest)
    return GoalCalc(bmr, method, tdee_rest, tdee_training, policy, weekly_kg, daily_delta, floored,
                    body_weight_kg, protein_g, training, rest)


# 計算に足りない入力。アプリの Missing と同じ（birthYear は birth_year）
MISSING_LABELS = {"weight": "体重", "sex": "性別", "birth_year": "生まれた年", "height": "身長", "activity": "活動の量"}


def missing_inputs(basis: BodyBasis | None, height_cm: float | None, sex: Sex | None, birth_year: int | None,
                   activity: Activity | None) -> list[str]:
    """体重と活動の量はいつも要る。身長・性別・生まれた年は、体脂肪率がないとき（Mifflin-St Jeor）だけ要る。
    体重がないときは、ほかの項目を聞いても計算できないので、体重だけを返す。"""
    if basis is None:
        return ["weight"]
    out = []
    if basis.body_fat is None:
        if sex is None:
            out.append("sex")
        if birth_year is None:
            out.append("birth_year")
        if height_cm is None:
            out.append("height")
    if activity is None:
        out.append("activity")
    return out
