"""grep_words の探し方（docs/words-design.md の「grep_words の決まり」）。

- パターンと項目の値の両方に正規化（search_key）をかけてから比べる（カタカナとひらがな、全角と半角を同じに扱う）
- 正規表現は . * + ? | [] ^ $ だけを受け付け、1つ50文字まで。かっこ（入れ子の繰り返し (a+)+ など）・{}・\\ は断る（遅くならないように）
- 抜き出しは当たった所の前後15文字ずつ、全体で40文字まで
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from words.domain.errors import WordsError
from words.domain.normalize import keyed, search_key

MAX_PATTERNS = 8
MAX_PATTERN_LENGTH = 50
SNIPPET_CONTEXT = 15
SNIPPET_MAX = 40
_META = set(".*+?|^$")
_FORBIDDEN = set("(){}\\")

# 当たった項目の順位（小さいほど先）：表現・読み → 意味・ニュアンス → 使う場面・気持ち・こういう時に使えそう・例文 → それ以外
FIELD_RANK = {"text": 0, "reading": 0, "meaning": 1, "nuance": 1, "situations": 2, "feelings": 2, "use_note": 2,
              "examples": 2}


def field_rank(name: str) -> int:
    return FIELD_RANK.get(name, 3)


def compile_pattern(pattern: str) -> re.Pattern:
    """パターンを確かめ、文字の所だけを正規化して組み立てる（記号の . * などは正規化で消えるので、分けて扱う）。"""
    if not isinstance(pattern, str) or not pattern.strip():
        raise WordsError("パターンが空です")
    if len(pattern) > MAX_PATTERN_LENGTH:
        raise WordsError(f"パターンは1つ{MAX_PATTERN_LENGTH}文字までにしてください")
    if bad := sorted(set(pattern) & _FORBIDDEN):
        raise WordsError(f"パターンに使えない文字があります（{' '.join(bad)}）。正規表現は . * + ? | [] ^ $ だけです")
    out, literal, i = [], False, 0
    while i < len(pattern):
        ch = pattern[i]
        if ch == "[":
            end = pattern.find("]", i + 1)
            if end < 0:
                raise WordsError("[ に対応する ] がありません")
            body = pattern[i + 1:end]
            negate = body.startswith("^")
            chars = []
            for c in body[1:] if negate else body:
                if c == "-":
                    chars.append("-")
                else:
                    chars.extend(re.escape(k) for k in search_key(c))
            if not chars:
                raise WordsError("[] の中に文字がありません")
            out.append("[" + ("^" if negate else "") + "".join(chars) + "]")
            literal = True
            i = end + 1
            continue
        if ch == "]":
            raise WordsError("] に対応する [ がありません")
        if ch in _META:
            out.append(ch)
        else:
            k = search_key(ch)
            if k:
                out.append(re.escape(k))
                literal = True
        i += 1
    if not literal and "." not in pattern:
        raise WordsError("パターンに探す文字がありません（記号と空白は探す前に除きます）")
    try:
        return re.compile("".join(out))
    except re.error as e:
        raise WordsError(f"パターンの形が違います（{e}）") from e


def compile_patterns(patterns: list[str]) -> list[re.Pattern]:
    if not 1 <= len(patterns) <= MAX_PATTERNS:
        raise WordsError(f"patterns は1〜{MAX_PATTERNS}個にしてください")
    return [compile_pattern(p) for p in patterns]


@dataclass(frozen=True)
class FieldMatch:
    field: str
    snippet: str
    rank: int


def snippet(nfkc: str, start: int, end: int) -> str:
    """NFKC の文の start〜end（含まない）が当たった所。前後15文字ずつ、全体で40文字まで。改行は空白にする。"""
    a = max(0, start - SNIPPET_CONTEXT)
    b = min(len(nfkc), end + SNIPPET_CONTEXT, a + SNIPPET_MAX)
    return " ".join(nfkc[a:b].split("\n"))


def match_fields(fields: dict[str, str], patterns: list[re.Pattern]) -> tuple[int, FieldMatch | None]:
    """（当たったパターンの数、いちばん上の項目の当たり）。どのパターンにも当たらなければ (0, None)。"""
    keyed_fields = {name: keyed(value) for name, value in fields.items()}
    hit_patterns, best = 0, None
    for pattern in patterns:
        hit = False
        for name, (nfkc, key, positions) in keyed_fields.items():
            m = pattern.search(key)
            if m is None:
                continue
            hit = True
            rank = field_rank(name)
            if best is None or rank < best.rank:
                if m.end() > m.start():
                    s, e = positions[m.start()], positions[m.end() - 1] + 1
                else:  # ^ や $ だけに当たった（空の当たり）
                    s = e = positions[m.start()] if m.start() < len(positions) else len(nfkc)
                best = FieldMatch(name, snippet(nfkc, s, e), rank)
        hit_patterns += hit
    return hit_patterns, best
