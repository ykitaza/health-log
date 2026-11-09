"""自重の種目（回数だけ）の負荷量。アプリ（apps/mobile/lib/bodyweight.ts）と同じ結果になるようにする
（testdata/training/bodyweight.json で確かめる）。

自重の負荷量 ＝ その日の体重 × 種目の割合（体重に対する割合、0〜1）× 回数（セットごと）。
体重は、その日の体重。なければ、その前のいちばん近い日の体重（30日以内）。それもなければ入れない。
割合は種目ごとに持つ。持っていない種目（割合を足す前の種目、MCP で割合を省いて足した種目）は、名前から決める。
推定1RM は今までどおり重量のあるセットだけで出す（自重の種目は出さない）。
"""

from __future__ import annotations

from dataclasses import replace

from training.domain.calculations import days_between
from training.domain.catalog import normalize
from training.domain.model import Exercise, RecordType, SetRow

LOOKBACK_DAYS = 30
DEFAULT_RATIO = 0.65  # 名前で決まらない自重の種目

# 名前に含む言葉と割合。上から順に見る（「膝つき腕立て」を「腕立て」より先に見る）。プランクなど時間で行う種目は入れない
NAME_RATIOS: tuple[tuple[str, float], ...] = (
    ("プランク", 0),
    ("膝つき", 0.5),
    ("懸垂", 1),
    ("チンニング", 1),
    ("チンアップ", 1),
    ("プルアップ", 1),
    ("ディップス", 0.95),
    ("スクワット", 0.7),
    ("腕立て", 0.65),
    ("プッシュアップ", 0.65),
    ("クランチ", 0.3),
    ("腹筋", 0.3),
    ("シットアップ", 0.3),
    ("レッグレイズ", 0.3),
    ("アブローラー", 0.3),
)


def default_ratio(name: str) -> float:
    """名前から決める割合（種目の割合の初期値）。"""
    key = normalize(name)
    return next((ratio for word, ratio in NAME_RATIOS if normalize(word) in key), DEFAULT_RATIO)


def ratio_of(exercise: Exercise) -> float | None:
    """その種目の割合。重量×回数の種目は None（重量で出す）。"""
    if exercise.record_type != RecordType.REPS_ONLY:
        return None
    return exercise.bodyweight_ratio if exercise.bodyweight_ratio is not None else default_ratio(exercise.name)


def weight_on(weights: list[tuple[str, float]], day: str) -> float | None:
    """その日の体重。なければ、その前のいちばん近い日の体重（30日以内）。weights は日ごとの体重（日付の順でなくてよい）。"""
    best: tuple[str, float] | None = None
    for d, kg in weights:
        if d <= day and days_between(d, day) <= LOOKBACK_DAYS and (best is None or d > best[0]):
            best = (d, kg)
    return best[1] if best else None


def with_bodyweight(rows: list[SetRow], weights: list[tuple[str, float]]) -> list[SetRow]:
    """回数だけのセット（割合のある行）に、自重の負荷（体重 × 割合）を入れる。体重がなければ None のまま。"""
    out = []
    for r in rows:
        if r.weight_kg is None and r.bodyweight_ratio is not None:
            kg = weight_on(weights, r.date)
            r = replace(r, bodyweight_load_kg=None if kg is None else kg * r.bodyweight_ratio)
        out.append(r)
    return out


def missing_bodyweight(rows: list[SetRow]) -> int:
    """体重の記録がないため、負荷量に入らなかった自重のセットの数（割合が 0 の種目は数えない）。"""
    return sum(1 for r in rows if r.weight_kg is None and (r.reps or 0) > 0 and (r.bodyweight_ratio or 0) > 0
               and r.bodyweight_load_kg is None)
