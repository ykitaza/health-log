"""部位ごとのセット数（training.domain.part_sets）。アプリと同じ入出力は test_shared_testdata.py（part_sets.json）で確かめる。"""

import pytest

from training.domain import part_sets as ps
from training.domain.model import SetRow
from training.presentation import views

NAMES = {"chest": "胸", "biceps": "上腕二頭筋", "abs": " 腹 ", "neck": "首", "legs": "脚"}


def row(date: str, part: str, weight: float | None = 60, reps: int | None = 10) -> SetRow:
    return SetRow(date, "ex", part, weight, reps)


def counted(rows, start="2026-11-09", end="2026-11-15", today="2026-11-15"):
    return ps.part_sets(rows, NAMES.get, start, end, today)


def test_軸は6つで順番はアプリと同じ():
    assert ps.BALANCE_PARTS == ("胸", "肩", "背中", "腕", "脚", "腹")


@pytest.mark.parametrize("name, axis", [
    ("胸", "胸"), ("上腕二頭筋", "腕"), ("上腕三頭筋", "腕"), ("腕", "腕"), ("腹筋", "腹"), ("腹", "腹"),
    (" 腹 ", "腹"), ("首", None), ("", None)])
def test_部位の名前の軸(name, axis):
    assert ps.axis_of(name) == axis


def test_回数だけの行も負荷量が0の行も1セットと数える():
    rows = [row("2026-11-09", "chest", 60, 10), row("2026-11-09", "chest", None, 15), row("2026-11-09", "chest", 0, 0)]
    assert counted(rows).sets == [3, 0, 0, 0, 0, 0]


def test_非表示の部位も数え_知らない部位と消えた部位は数えない():
    rows = [row("2026-11-10", "biceps"), row("2026-11-10", "abs"), row("2026-11-10", "neck"), row("2026-11-10", "gone")]
    assert counted(rows).sets == [0, 0, 0, 1, 0, 1]


def test_期間は両端を含み_今日より先は数えない():
    rows = [row("2026-11-08", "chest"), row("2026-11-09", "chest"), row("2026-11-12", "chest"), row("2026-11-13", "chest")]
    result = counted(rows, today="2026-11-12")
    assert (result.from_, result.to, result.sets[0]) == ("2026-11-09", "2026-11-12", 2)


@pytest.mark.parametrize("start, end, today, previous", [
    ("2026-11-09", "2026-11-15", "2026-11-20", ("2026-11-02", "2026-11-08")),  # 月曜〜日曜は前の月曜〜日曜
    ("2026-11-09", "2026-11-15", "2026-11-11", ("2026-11-02", "2026-11-04")),  # 月曜〜今日は前の週の同じ曜日まで
    ("2026-11-11", "2026-11-11", "2026-11-11", ("2026-11-04", "2026-11-04")),  # 1日
    ("2026-10-01", "2026-10-31", "2026-11-20", ("2026-08-27", "2026-09-26")),  # 31日は35日前
    ("2026-11-13", "2026-11-19", "2026-11-19", ("2026-11-06", "2026-11-12")),  # 月曜始まりでなくても7日ずらす
])
def test_前の期間は7日の倍数だけずらす(start, end, today, previous):
    result = counted([], start, end, today)
    assert (result.previous_from, result.previous_to) == previous


def test_目安までの距離():
    assert [ps.distance(n) for n in (0, 9, 10, 20, 21, 25)] == [10, 1, 0, 0, 1, 5]


@pytest.mark.parametrize("sets, previous, expected", [
    (12, 5, "toward"),   # 足りない 5 → 目安の中
    (22, 25, "toward"),  # 多い 5 → 多い 2
    (5, 12, "away"),
    (25, 22, "away"),
    (12, 15, "same"),    # どちらも目安の中
    (0, 0, "same"),
    (5, 25, "same"),     # 距離が同じ（足りない 5 と 多い 5）
])
def test_目安に近づいたか(sets, previous, expected):
    assert ps.trend(sets, previous) == expected


def test_ビューは6軸が常にあり_7日までは目安と足りない量を付け_8日からは付けない():
    week = views.part_sets(counted([row("2026-11-10", "chest")] * 22 + [row("2026-11-10", "legs")] * 4))
    assert [p["part"] for p in week["parts"]] == ["胸", "肩", "背中", "腕", "脚", "腹"]
    assert week["band"] == {"min": 10, "max": 20}
    chest, legs = week["parts"][0], week["parts"][4]
    assert (chest["sets"], chest["over"], chest["short"]) == (22, 2, 0)
    assert (legs["sets"], legs["short"], legs["over"], legs["delta"]) == (4, 6, 0, 4)
    month = views.part_sets(counted([], "2026-10-01", "2026-10-31", "2026-11-20"))
    assert "band" not in month and all({"short", "over", "trend"}.isdisjoint(p) for p in month["parts"])
    assert all("trend" not in p for p in month["parts"])
