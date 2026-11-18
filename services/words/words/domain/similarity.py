"""同じ表現・似た表現の判定（docs/words-design.md の「同じ表現の見つけ方」）。

normalized_key が同じなら同じ表現。同じでなくても、2文字ずつの組の重なり（Jaccard）が 0.5 以上か、
片方がもう片方を含むなら似た表現として候補にする（サーバーは推測で選ばない。Claude が same_as で選ぶ）。
しきい値は testdata/words/similarity.json でアプリと確かめる。
"""

from __future__ import annotations

SIMILAR_THRESHOLD = 0.5
MAX_CANDIDATES = 5


def bigrams(key: str) -> set[str]:
    if len(key) < 2:
        return {key} if key else set()
    return {key[i:i + 2] for i in range(len(key) - 1)}


def jaccard(a: str, b: str) -> float:
    x, y = bigrams(a), bigrams(b)
    if not x or not y:
        return 0.0
    return len(x & y) / len(x | y)


def is_similar(a: str, b: str) -> bool:
    if not a or not b or a == b:
        return False
    return a in b or b in a or jaccard(a, b) >= SIMILAR_THRESHOLD
