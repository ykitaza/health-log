"""正規化（docs/words-design.md の「正規化」）。アプリと同じ決まりにし、testdata/words/search_key.json で両方を確かめる。

search_key：探すときと、同じ表現を見つけるとき（normalized_key）に使う形。
1. Unicode の NFKC（全角の英数字を半角に、半角のカタカナを全角に）
2. 英字を小文字に
3. カタカナをひらがなに（U+30A1〜U+30F6 を U+3041〜U+3096 に、ヽ・ヾ を ゝ・ゞ に）。長音の「ー」と「々」は残す
4. 空白・句読点・記号（Unicode の分類 Z・P・S と、改行・タブ）を除く
送り仮名のゆれや、漢字とかなの違いは正規化しない（読み reading を探す対象に入れる）。

name_key：出会った場所とタグの名前を比べる形（NFKC、大文字小文字・空白を同じに扱う）。
"""

from __future__ import annotations

import unicodedata

_KATA_START, _KATA_END, _KANA_OFFSET = 0x30A1, 0x30F6, 0x60
_ITERATION = {"ヽ": "ゝ", "ヾ": "ゞ"}


def _key_char(ch: str) -> str:
    """NFKC を済ませた1文字を、手順2〜4で変えたもの（除くなら空）。"""
    out = []
    for c in ch.lower():  # 小文字にすると2文字になるものがある（İ など）
        code = ord(c)
        if _KATA_START <= code <= _KATA_END:
            c = chr(code - _KANA_OFFSET)
        else:
            c = _ITERATION.get(c, c)
        if c.isspace() or unicodedata.category(c)[0] in "ZPS":
            continue
        out.append(c)
    return "".join(out)


def keyed(text: str) -> tuple[str, str, list[int]]:
    """（NFKC にした文、正規化した形、正規化した形の1文字ごとの NFKC の文での位置）。抜き出し（grep の snippet）に使う。"""
    nfkc = unicodedata.normalize("NFKC", text)
    key, positions = [], []
    for i, ch in enumerate(nfkc):
        for c in _key_char(ch):
            key.append(c)
            positions.append(i)
    return nfkc, "".join(key), positions


def search_key(text: str) -> str:
    return keyed(text)[1]


def name_key(name: str) -> str:
    return "".join(unicodedata.normalize("NFKC", name).casefold().split())
