"""探すための文（search document）。docs/words-design.md の「探すための文」。

表現1つにつき、決まった順で項目をつないだ文を作る。MCP の grep_words が探す対象で、v2 の埋め込みの元にもなる。
順番や項目を変えたら SEARCH_DOC_VERSION を上げる。空の項目は行ごと省く。
前後の文（surrounding_text）と本・人の名前（title）は文に入れず、grep_words で項目を名指ししたときだけ探す（search_fields の extra）。
"""

from __future__ import annotations

from words.domain.model import REGISTER_NAMES, Encounter, Expression, Tag, TagKind, TagStatus

SEARCH_DOC_VERSION = 1
MAX_ENCOUNTER_SCENES = 5

# 項目の名前と、文の見出し（この順で並べる）
DOC_FIELDS: tuple[tuple[str, str], ...] = (
    ("text", "表現"),
    ("reading", "読み"),
    ("meaning", "意味"),
    ("nuance", "ニュアンス"),
    ("register", "硬さ"),
    ("situations", "使う場面"),
    ("feelings", "気持ち"),
    ("use_note", "こういう時に使えそう"),
    ("scene", "場面"),
    ("encounter_scenes", "出会いの場面"),
    ("note", "メモ"),
)
EXTRA_FIELDS = ("surrounding_text", "title")  # 名指ししたときだけ探す
ALL_FIELDS = tuple(name for name, _ in DOC_FIELDS) + EXTRA_FIELDS


def newest_encounters(encounters: list[Encounter], limit: int) -> list[Encounter]:
    return sorted(encounters, key=lambda e: (e.created_at, e.id), reverse=True)[:limit]


def search_fields(expression: Expression, tags: list[tuple[Tag, TagStatus]], encounters: list[Encounter],
                  extra: bool = False) -> dict[str, str]:
    """項目の名前 → 値（空のものは入れない）。tags は表現に付いたタグと状態（rejected は入れない）。"""
    def tag_names(kind: TagKind) -> str:
        chosen = [t for t, status in tags if t.kind is kind and status is not TagStatus.REJECTED]
        return "、".join(t.name for t in sorted(chosen, key=lambda t: (t.sort_order, t.name, t.id)))

    scenes = [e.scene for e in newest_encounters(encounters, MAX_ENCOUNTER_SCENES) if e.scene]
    values = {
        "text": expression.text,
        "reading": expression.reading,
        "meaning": expression.meaning,
        "nuance": expression.nuance,
        "register": REGISTER_NAMES[expression.register] if expression.register else "",
        "situations": tag_names(TagKind.SITUATION),
        "feelings": tag_names(TagKind.FEELING),
        "use_note": expression.use_note,
        "scene": expression.scene,
        "encounter_scenes": "、".join(scenes),
        "note": expression.note,
    }
    if extra:
        ordered = newest_encounters(encounters, len(encounters))
        values["surrounding_text"] = "\n".join(e.surrounding_text for e in ordered if e.surrounding_text)
        values["title"] = "、".join(dict.fromkeys(e.title for e in ordered if e.title))
    return {k: v for k, v in values.items() if v}


def search_document(expression: Expression, tags: list[tuple[Tag, TagStatus]], encounters: list[Encounter]) -> str:
    values = search_fields(expression, tags, encounters)
    return "\n".join(f"{label}：{values[name]}" for name, label in DOC_FIELDS if name in values)
