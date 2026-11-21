"""食事のスコア（1日 0〜100 点）。サーバーが毎回同じ規則で計算する（AI は計算し直さない）。issue #331。

内訳は 4 つで、重みは同じ（各 25 点）。内訳の中の項目も同じ重み。
  エネルギー    目標の kcal との差。±10% 以内なら満点、そこから離れるほど下げ、±50% で 0
  たんぱく質    目標の 90% 以上で満点。足りない分だけ下げる（多いぶんは下げない。筋トレのための目標のため）
  バランス      食事バランスガイドの 5 区分の「つ（SV）」が目安の幅に入っているか（少なければ 量/下限、多ければ 上限/量）と、
                食物繊維（目標量以上で満点。足りなければ 量/目標量）
  控えたいもの  食塩相当量・菓子と嗜好飲料（kcal）：目安以下で満点、超えたら目安の 2 倍で 0 になるまでまっすぐ下げる
                脂質のエネルギー比：20〜30% で満点、幅から 10 ポイント離れると 0
                純アルコール：生活習慣病のリスクを高める量の未満なら満点、その量に達したら 量/(2×その量) を引く（その量で半分、2 倍で 0）

推定がない（その日の品目のどれかに値がない）項目は「記録なし」にして、点を下げない（残りの項目だけで割合を出す）。
1 つでも値のない品目があると、足した量は少なく（塩やお酒は少なく）出てしまうので、その日のその項目ごと記録なしにする。
目標の kcal・たんぱく質がなければ、その内訳は記録なし。内訳が全部記録なしなら点は出さない。
お酒は純アルコール（alcohol_g）だけで数え、菓子・嗜好飲料には数えない（同じものを二度引かないため）。

目安の数字と出典（2026-11 に公式の資料で確かめた）：
- 食事バランスガイド（厚生労働省・農林水産省、2005）の「一日分の適量」（農林水産省「実践食育ナビ」の適量チャート
  https://www.maff.go.jp/j/syokuiku/zissen_navi/balance/required.html の画像 required_img2.gif）
    1,400〜2,000kcal        主食 4〜5、副菜 5〜6、主菜 3〜4、牛乳・乳製品 2、果物 2
    2,200±200kcal（基本形）  主食 5〜7、副菜 5〜6、主菜 3〜5、牛乳・乳製品 2、果物 2
    2,400〜3,000kcal        主食 6〜8、副菜 6〜7、主菜 4〜6、牛乳・乳製品 2〜3、果物 2〜3
  SV の数え方：https://www.maff.go.jp/j/balance_guide/b_report/gaiyou.html
  （主食は炭水化物 約40g、副菜は主材料 約70g、主菜はたんぱく質 約6g、牛乳・乳製品はカルシウム 約100mg、果物は 約100g で 1 つ）
- 菓子・嗜好飲料：1 日 200kcal 程度（農林水産省「実践食育ナビ」 https://www.maff.go.jp/j/syokuiku/zissen_navi/use/concept.html
  「目安は一日200kcal。楽しく適度に」）
- 日本人の食事摂取基準（2025年版）策定検討会報告書（厚生労働省 https://www.mhlw.go.jp/stf/newpage_44138.html）
    食塩相当量の目標量（18 歳以上）：男性 7.5g/日未満、女性 6.5g/日未満（ミネラル（多量ミネラル）の章 ナトリウムの表）
    食物繊維の目標量（g/日以上）：男性 18〜29歳 20、30〜49歳 22、50〜64歳 22、65〜74歳 21、75歳以上 20
                                  女性 18〜64歳 18、65〜74歳 18、75歳以上 17（炭水化物の章の表）
    脂質の目標量（エネルギー比）：20〜30%（1 歳以上。エネルギー産生栄養素バランスの表）
- 健康日本21（第三次）の「生活習慣病（NCDs）のリスクを高める量」：1 日当たりの純アルコール摂取量 男性 40g 以上、女性 20g 以上
  （厚生労働省「健康に配慮した飲酒に関するガイドライン」2024 https://www.mhlw.go.jp/content/12200000/001223643.pdf）

性別で変わる値は、アプリの設定の性別を使う。サーバーに性別がない（設定していない・同期していない）ときは推測せず、
男女のうち厳しいほうを使う：食塩 6.5g、純アルコール 20g、食物繊維 22g。
年齢はサーバーにないので、食物繊維は 18〜64 歳の欄のうちいちばん高い値（男性 22g、女性 18g）を使う。
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from meals.domain.auto_goal import Sex, js_round
from meals.domain.meal import FoodItem, Meal
from meals.domain.nutrition_goal import Target

PART_LABELS = {"energy": "エネルギー", "protein": "たんぱく質", "balance": "バランス", "moderation": "控えたいもの"}

# 食事バランスガイドの 5 区分（DietEstimate の項目名、名前）
SV_GROUPS = (("sv_staple", "主食"), ("sv_side", "副菜"), ("sv_main", "主菜"), ("sv_dairy", "牛乳・乳製品"),
             ("sv_fruit", "果物"))


@dataclass(frozen=True)
class SvBand:
    """食事バランスガイドの、エネルギーの欄ごとの「つ（SV）」の幅（下限, 上限）。"""

    label: str
    ranges: dict[str, tuple[float, float]]


SV_BANDS = (
    SvBand("1,400〜2,000kcal", {"sv_staple": (4, 5), "sv_side": (5, 6), "sv_main": (3, 4), "sv_dairy": (2, 2),
                                "sv_fruit": (2, 2)}),
    SvBand("2,200±200kcal（基本形）", {"sv_staple": (5, 7), "sv_side": (5, 6), "sv_main": (3, 5), "sv_dairy": (2, 2),
                                     "sv_fruit": (2, 2)}),
    SvBand("2,400〜3,000kcal", {"sv_staple": (6, 8), "sv_side": (6, 7), "sv_main": (4, 6), "sv_dairy": (2, 3),
                                "sv_fruit": (2, 3)}),
)
BASIC_BAND = SV_BANDS[1]

ENERGY_FULL, ENERGY_ZERO = 0.10, 0.50  # 目標の kcal との差の割合：ここまで満点、ここで 0
PROTEIN_FULL = 0.90  # 目標のたんぱく質のこの割合以上で満点
FAT_RATIO = (20, 30)  # 脂質のエネルギー比（%）
FAT_ZERO_DISTANCE = 10  # 幅からこのポイント離れると 0
FAT_KCAL_PER_G = 9
SNACK_KCAL = 200  # 菓子・嗜好飲料（kcal/日）
SALT_G = {Sex.MALE: 7.5, Sex.FEMALE: 6.5, None: 6.5}  # 食塩相当量（g/日）。性別がなければ厳しいほう
FIBER_G = {Sex.MALE: 22, Sex.FEMALE: 18, None: 22}  # 食物繊維（g/日）。性別がなければ厳しいほう
ALCOHOL_G = {Sex.MALE: 40, Sex.FEMALE: 20, None: 20}  # 純アルコール（g/日）。この量以上がリスクを高める量


def sv_band(target_kcal: float | None) -> tuple[SvBand, bool]:
    """本人の目標 kcal に合う欄と、目標 kcal から選んだか（False なら目標がないので基本形）。

    欄は境目で重なる（2,000 と 2,400）ので、2,000 未満は 1,400〜2,000、2,000〜2,400 は基本形、2,400 より上は 2,400〜3,000。
    1,400 未満は 1,400〜2,000、3,000 より上は 2,400〜3,000 の欄を使う（ガイドにそれより外の欄はない）。
    """
    if target_kcal is None:
        return BASIC_BAND, False
    if target_kcal < 2000:
        return SV_BANDS[0], True
    if target_kcal <= 2400:
        return BASIC_BAND, True
    return SV_BANDS[2], True


@dataclass(frozen=True)
class SubScore:
    """内訳の中の項目。ratio は 0〜1（None は記録なし）。advice はいちばん伸ばしやすいときに見せる一言。"""

    key: str
    label: str
    ratio: float | None
    value: float | None = None  # その日の量（記録なしは None）
    low: float | None = None  # 目安の下限（なければ None）
    high: float | None = None  # 目安の上限（なければ None）
    unit: str = ""
    advice: str | None = None


@dataclass(frozen=True)
class PartScore:
    key: str
    items: tuple[SubScore, ...]

    @property
    def label(self) -> str:
        return PART_LABELS[self.key]

    @property
    def available(self) -> tuple[SubScore, ...]:
        return tuple(i for i in self.items if i.ratio is not None)

    @property
    def ratio(self) -> float | None:
        got = self.available
        return _mean([i.ratio for i in got]) if got else None


@dataclass(frozen=True)
class Improvement:
    """いちばん伸ばしやすい項目。gain はその項目を満点にしたときに上がる点（その日の重みで）。"""

    part: str
    item: SubScore
    gain: int


@dataclass(frozen=True)
class MealScore:
    parts: tuple[PartScore, ...]
    band: SvBand
    band_from_target: bool
    sex: Sex | None

    @property
    def available_parts(self) -> tuple[PartScore, ...]:
        return tuple(p for p in self.parts if p.ratio is not None)

    @property
    def score(self) -> int | None:
        got = self.available_parts
        return js_round(100 * _mean([p.ratio for p in got])) if got else None

    def part_points(self, part: PartScore) -> int | None:
        """内訳を 0〜100 点で（内訳の中の割合 × 100）。"""
        return None if part.ratio is None else js_round(100 * part.ratio)

    @property
    def easiest(self) -> Improvement | None:
        """満点にしたときにいちばん点が上がる項目（同じなら内訳・項目の並びの先）。満点ばかりなら None。"""
        got = self.available_parts
        best: tuple[float, PartScore, SubScore] | None = None
        for part in got:
            for item in part.available:
                gain = 100 * (1 - item.ratio) / len(got) / len(part.available)
                if gain > 0 and (best is None or gain > best[0]):
                    best = (gain, part, item)
        return None if best is None else Improvement(best[1].key, best[2], js_round(best[0]))


def _mean(xs: list[float]) -> float:
    total = 0.0
    for x in xs:  # 前から順に足す（アプリの計算と同じ並びにする）
        total += x
    return total / len(xs)


def _clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))


def _ceil(x: float, digits: int = 0) -> float:
    """あと何つ・何 g を、切り上げて見せる（小数の誤差で 1 つ多くならないよう、わずかに引いてから）。"""
    scale = 10 ** digits
    n = math.ceil(x * scale - 1e-9) / scale
    return int(n) if digits == 0 else n


def _sum(items: list[FoodItem], key: str) -> float | None:
    """その日のすべての品目に推定があれば合計、1 つでもなければ None（記録なし）。"""
    total = 0.0
    for item in items:
        v = getattr(item.estimate, key)
        if v is None:
            return None
        total += v
    return total


def _energy(kcal: float, target: float | None) -> SubScore:
    if target is None or target <= 0:
        return SubScore("kcal", "エネルギー", None, unit="kcal")
    diff = (kcal - target) / target
    ratio = 1.0 if abs(diff) <= ENERGY_FULL else _clamp01(1 - (abs(diff) - ENERGY_FULL) / (ENERGY_ZERO - ENERGY_FULL))
    gap = js_round(abs(kcal - target))
    advice = f"エネルギーをあと {gap} kcal" if kcal < target else f"エネルギーを {gap} kcal 控えめに"
    return SubScore("kcal", "エネルギー", ratio, kcal, target, target, "kcal", advice)


def _protein(protein_g: float, target: float | None) -> SubScore:
    if target is None or target <= 0:
        return SubScore("protein_g", "たんぱく質", None, unit="g")
    full = target * PROTEIN_FULL
    ratio = 1.0 if protein_g >= full else protein_g / full
    advice = f"たんぱく質をあと {_ceil(target - protein_g)} g"
    return SubScore("protein_g", "たんぱく質", ratio, protein_g, target, None, "g", advice)


def _sv(key: str, label: str, value: float | None, low: float, high: float) -> SubScore:
    if value is None:
        return SubScore(key, label, None, None, low, high, "つ")
    if value < low:
        return SubScore(key, label, value / low, value, low, high, "つ", f"{label}をあと {_ceil(low - value)} つ")
    if value > high:
        return SubScore(key, label, high / value, value, low, high, "つ", f"{label}を {_ceil(value - high)} つ控えめに")
    return SubScore(key, label, 1.0, value, low, high, "つ")


def _fiber(value: float | None, target: float) -> SubScore:
    if value is None:
        return SubScore("fiber_g", "食物繊維", None, None, target, None, "g")
    ratio = min(1.0, value / target)
    return SubScore("fiber_g", "食物繊維", ratio, value, target, None, "g", f"食物繊維をあと {_ceil(target - value)} g")


def _cap(value: float, limit: float) -> float:
    """目安以下なら 1、超えたら目安の 2 倍で 0 になるまでまっすぐ下げる。"""
    return 1.0 if value <= limit else _clamp01(1 - (value - limit) / limit)


def _salt(value: float | None, limit: float) -> SubScore:
    if value is None:
        return SubScore("salt_g", "食塩", None, None, None, limit, "g")
    return SubScore("salt_g", "食塩", _cap(value, limit), value, None, limit, "g",
                    f"食塩を {_ceil(value - limit, 1)} g 控えめに")


def _fat_ratio(fat_g: float, kcal: float) -> SubScore:
    low, high = FAT_RATIO
    if kcal <= 0:
        return SubScore("fat_ratio", "脂質", None, None, low, high, "%")
    pct = fat_g * FAT_KCAL_PER_G / kcal * 100
    distance = low - pct if pct < low else pct - high if pct > high else 0
    ratio = _clamp01(1 - distance / FAT_ZERO_DISTANCE)
    advice = "脂質を控えめに（揚げ物を焼き・蒸しに替えるなど）" if pct > high else "脂質をもう少し（油・ナッツ・魚など）"
    return SubScore("fat_ratio", "脂質", ratio, pct, low, high, "%", advice)


def _snack(items: list[FoodItem]) -> SubScore:
    if any(i.estimate.is_snack_or_sweet_drink is None for i in items):
        return SubScore("snack_kcal", "菓子・嗜好飲料", None, None, None, SNACK_KCAL, "kcal")
    kcal = sum(i.nutrition.kcal for i in items if i.estimate.is_snack_or_sweet_drink)
    return SubScore("snack_kcal", "菓子・嗜好飲料", _cap(kcal, SNACK_KCAL), kcal, None, SNACK_KCAL, "kcal",
                    f"菓子・甘い飲み物を {js_round(kcal - SNACK_KCAL)} kcal 控えめに")


def _alcohol(value: float | None, limit: float) -> SubScore:
    if value is None:
        return SubScore("alcohol_g", "お酒", None, None, None, limit, "g")
    ratio = 1.0 if value < limit else _clamp01(1 - value / (2 * limit))
    return SubScore("alcohol_g", "お酒", ratio, value, None, limit, "g",
                    f"お酒を控えめに（純アルコール {limit} g 未満が目安）")


def meal_score(meals: tuple[Meal, ...], target: Target | None, sex: Sex | None) -> MealScore | None:
    """1 日の食事のスコア。食事がない日は None。"""
    items = [item for meal in meals for item in meal.items]
    if not items:
        return None
    kcal = protein = fat = 0.0
    for item in items:
        kcal += item.nutrition.kcal
        protein += item.nutrition.protein_g
        fat += item.nutrition.fat_g
    target = target or Target()
    band, from_target = sv_band(target.kcal)
    balance = tuple(_sv(key, label, _sum(items, key), *band.ranges[key]) for key, label in SV_GROUPS)
    parts = (
        PartScore("energy", (_energy(kcal, target.kcal),)),
        PartScore("protein", (_protein(protein, target.protein_g),)),
        PartScore("balance", balance + (_fiber(_sum(items, "fiber_g"), FIBER_G[sex]),)),
        PartScore("moderation", (_salt(_sum(items, "salt_g"), SALT_G[sex]), _fat_ratio(fat, kcal), _snack(items),
                                 _alcohol(_sum(items, "alcohol_g"), ALCOHOL_G[sex]))),
    )
    return MealScore(parts, band, from_target, sex)
