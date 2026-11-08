"""入力の決まり。アプリ（apps/mobile/lib/limits.ts・sets.ts）と同じ範囲にする（アプリで直せない記録を作らないため）。"""

from __future__ import annotations

from training.domain.errors import TrainingError
from training.domain.model import Exercise, RecordType

SET_WEIGHT_MAX = 500  # kg。0 より大きい
REPS_MAX = 10000
MEMO_MAX = 1000
NAME_MAX = 40  # 種目と部位の名前（アプリは書記素で40。ここではコードポイントで数えるので、絵文字はアプリより短くなる）
BODY_LIMITS = {  # 項目 → (下限, 上限, 名前)
    "weight_kg": (30, 300, "体重（kg）"),
    "body_fat_pct": (0, 100, "体脂肪率（%）"),
    "muscle_pct": (0, 100, "筋肉率（%）"),
    "waist_cm": (30, 200, "ウエスト（cm）"),
}


def check_set(exercise: Exercise, weight_kg: float | None, reps: int, memo: str) -> None:
    """1セットの入力を確かめる。重量×回数の種目は重量が要る。回数だけの種目は重量を入れない。"""
    if exercise.record_type == RecordType.WEIGHT_REPS:
        if weight_kg is None:
            raise TrainingError(f"{exercise.name}は重量×回数の種目なので、重量（kg）を入れてください")
        if not 0 < weight_kg <= SET_WEIGHT_MAX:
            raise TrainingError(f"重量は 0 より大きく {SET_WEIGHT_MAX}kg までで入れてください")
    elif weight_kg is not None:
        raise TrainingError(f"{exercise.name}は回数だけの種目なので、重量は入れないでください")
    if not 1 <= reps <= REPS_MAX:
        raise TrainingError(f"回数は 1〜{REPS_MAX} で入れてください")
    if len(memo) > MEMO_MAX:
        raise TrainingError(f"メモは{MEMO_MAX}文字までにしてください")


def check_name(what: str, name: str) -> str:
    name = name.strip()
    if not name:
        raise TrainingError(f"{what}の名前を入れてください")
    if len(name) > NAME_MAX:
        raise TrainingError(f"{what}の名前は{NAME_MAX}文字以内にしてください（今は{len(name)}文字）")
    return name


def check_body(values: dict[str, float | None], memo: str | None) -> None:
    if all(v is None for v in values.values()) and memo is None:
        raise TrainingError("体重・体脂肪率・筋肉率・ウエスト・メモのどれかを入れてください")
    for key, value in values.items():
        low, high, label = BODY_LIMITS[key]
        if value is not None and not low <= value <= high:
            raise TrainingError(f"{label}は {low}〜{high} で入れてください")
    if memo is not None and len(memo) > MEMO_MAX:
        raise TrainingError(f"メモは{MEMO_MAX}文字までにしてください")
