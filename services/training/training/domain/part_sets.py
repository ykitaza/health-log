"""部位ごとのセット数（週の「部位の量」）。アプリ（apps/mobile/lib/partBalance.ts）と同じ数え方にする。

AI が週のレポートに書く部位のセット数が、アプリのカードの数字と食い違わないよう、同じ規則を移した。
同じ入力と期待する結果を testdata/training/part_sets.json に置き、ここの pytest とアプリの jest の両方で確かめる。

数え方：1行（SetRow）が1セット。種目の部位（body_part_id）の名前を軸（胸・肩・背中・腕・脚・腹）にそろえて足す。
完了の印などでは絞らない（アプリにない）。回数だけの行も、負荷量が 0 の行も数える。非表示の部位も数える。
名前を付け替えた部位は、新しい名前が軸にあたるときだけ数える。知らない名前（首など）と、消えて名前が引けない部位は数えない。
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import date

from training.domain.calculations import add_days
from training.domain.model import SetRow

# 6軸（アプリの BALANCE_PARTS と同じ順）
BALANCE_PARTS = ("胸", "肩", "背中", "腕", "脚", "腹")

# 部位の名前 → 軸（アプリの PART_AXIS と同じ）。上腕二頭筋・上腕三頭筋は腕、腹筋は腹。名前を付け替えたとき用に「腕」「腹」も
PART_AXIS: dict[str, str] = {
    "胸": "胸", "背中": "背中", "肩": "肩", "脚": "脚",
    "上腕二頭筋": "腕", "上腕三頭筋": "腕", "腕": "腕",
    "腹筋": "腹", "腹": "腹",
}

BAND_MIN, BAND_MAX = 10, 20  # 週の目安（1部位あたりのセット数）


def axis_of(name: str) -> str | None:
    """部位の名前の軸。前後の空白を除いて引く（アプリの trim と同じ）。知らない名前は None（数えない）。"""
    return PART_AXIS.get(name.strip())


def count_sets(rows: list[SetRow], part_name: Callable[[str], str | None], start: str, end: str) -> list[int]:
    """start〜end（両端を含む）の軸ごとのセット数（BALANCE_PARTS の順）。part_name は部位の ID から名前を引く（引けなければ None）。"""
    sets = [0] * len(BALANCE_PARTS)
    for r in rows:
        if r.date < start or r.date > end:
            continue
        name = part_name(r.body_part_id)
        axis = axis_of(name) if name is not None else None
        if axis is not None:
            sets[BALANCE_PARTS.index(axis)] += 1
    return sets


@dataclass(frozen=True)
class PartSets:
    """今の期間と、その前の期間（同じ長さ）の、軸ごとのセット数。from_ は start、to は as_of（end と今日の早いほう）。"""

    from_: str
    to: str
    previous_from: str
    previous_to: str
    days: int  # 頼まれた期間の日数（end − start + 1）。as_of で短くなっても変えない
    sets: list[int]
    previous: list[int]


def part_sets(rows: list[SetRow], part_name: Callable[[str], str | None], start: str, end: str, today: str) -> PartSets:
    """期間（start〜end）の部位ごとのセット数と、前の期間との比べ。

    今の期間は start〜as_of（as_of ＝ end と今日の早いほう。今日より先は数えない）。
    前の期間は、今の期間を 7 × ceil(日数 ÷ 7) 日だけ前にずらしたもの：月曜〜日曜なら前の週の月曜〜日曜、
    月曜〜今日なら前の週の月曜〜同じ曜日。
    """
    days = (date.fromisoformat(end) - date.fromisoformat(start)).days + 1
    as_of = min(end, today)
    shift = 7 * -(-days // 7)
    previous_from, previous_to = add_days(start, -shift), add_days(as_of, -shift)
    return PartSets(start, as_of, previous_from, previous_to, days,
                    count_sets(rows, part_name, start, as_of), count_sets(rows, part_name, previous_from, previous_to))


def distance(sets: int) -> int:
    """目安（BAND_MIN〜BAND_MAX）までの距離。目安の中なら 0。"""
    return max(0, BAND_MIN - sets) + max(0, sets - BAND_MAX)


def trend(sets: int, previous: int) -> str:
    """前の期間より目安に近づいたか（週＝7日までの期間だけ使う。views.part_sets）：toward（近づいた）・away（離れた）・same（同じ）。"""
    now, before = distance(sets), distance(previous)
    return "toward" if now < before else "away" if now > before else "same"
