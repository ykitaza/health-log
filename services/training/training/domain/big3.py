"""BIG3（ベンチプレス・スクワット・デッドリフト）の役と種目の対応。アプリ（apps/mobile/lib/exercises.ts）と同じ結果になるようにする
（testdata/training/big3.json で確かめる）。

- 種目の big3（bench・squat・deadlift）で決める。1つの役は1つの種目だけ（アプリが前の種目から外して送る）。
  端末どうしの同期で重なったときは、ID の小さいほうにする
- どの種目にも役がない（割り当てる前）ときは、名前で決める：名前に「ベンチプレス」「スクワット」「デッドリフト」を含み、
  インクライン・ダンベルなど別の種目を表す言葉を含まない、表示中の重量×回数の種目。いくつもあれば、名前がちょうど同じもの、
  短いもの、ID の小さいものの順
"""

from __future__ import annotations

from typing import Iterable, Protocol

from training.domain.catalog import normalize
from training.domain.model import RecordType

ROLES: tuple[str, ...] = ("bench", "squat", "deadlift")
ROLE_NAMES = {"bench": "ベンチプレス", "squat": "スクワット", "deadlift": "デッドリフト"}
# 名前にこれを含むものは、BIG3 とは別の種目とみなす（名前で決めるときだけ）
EXCLUDED_WORDS: tuple[str, ...] = (
    "インクライン", "デクライン", "ダンベル", "スミス", "マシン", "ケーブル", "ナロー", "フロント", "ゴブレット", "ハック",
    "ブルガリアン", "スプリット", "ジャンプ", "シシー", "片足", "自重", "ルーマニアン", "スティッフ",
)


class _Exercise(Protocol):
    id: str
    name: str
    record_type: RecordType
    hidden: bool
    big3: str | None


def assignments(exercises: Iterable[_Exercise]) -> dict[str, str]:
    """役 → 種目の ID。割り当てのない役は入れない。"""
    exercises = list(exercises)
    explicit = sorted((e for e in exercises if e.big3 in ROLES), key=lambda e: e.id)
    if explicit:
        out: dict[str, str] = {}
        for e in explicit:
            out.setdefault(e.big3, e.id)
        return out
    out = {}
    excluded = [normalize(w) for w in EXCLUDED_WORDS]
    for role in ROLES:
        word = normalize(ROLE_NAMES[role])
        candidates = [e for e in exercises if not e.hidden and e.record_type == RecordType.WEIGHT_REPS
                      and word in normalize(e.name) and not any(x in normalize(e.name) for x in excluded)]
        if candidates:
            best = min(candidates, key=lambda e: (normalize(e.name) != word, len(normalize(e.name)), e.id))
            out[role] = best.id
    return out
