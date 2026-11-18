"""出会った場所とタグの初期の行、ことばの名前空間。

初期の行の ID は固定の UUID（ことばの名前空間とキーから uuid5 で決める）。アプリ（apps/words の db/seed.ts）も同じ値を持つ。
値の一覧は testdata/words/catalog.json にあり、サーバー（tests/test_shared_testdata.py）とアプリの両方で確かめる。
初期の行は、本人が変えるまで同期で送らない。同期に同じ ID の記録があれば、そちらを使う（名前を変えた・隠したもの）。
"""

from __future__ import annotations

import uuid

from words.domain.model import Source, Tag, TagKind

# ことばの名前空間。初期の行の ID と、表現とタグのつながりの ID（expression_tag_id）を決める
WORDS_NAMESPACE = uuid.UUID("8a3f5c2e-6d1b-4c7a-9e0f-2b4d6a8c1e3f")

# アプリのアイコンの名前。知らない名前は other として表示する（アプリが決める）
ICON_KEYS = ("headphones", "tablet", "book", "chat", "film", "podcast", "note", "other")


def seed_id(key: str) -> str:
    return str(uuid.uuid5(WORDS_NAMESPACE, key))


def expression_tag_id(expression_id: str, tag_id: str) -> str:
    """表現とタグのつながりの ID。2つの端末や MCP が同じタグを付けても1つになる。ID は小文字にそろえてから決める。"""
    return str(uuid.uuid5(WORDS_NAMESPACE, f"{expression_id.lower()}:{tag_id.lower()}"))


SEED_SOURCES: tuple[Source, ...] = tuple(
    Source(seed_id(f"source:{key}"), name, icon, n, False, seed=True) for n, (key, name, icon) in enumerate([
        ("audible", "Audible", "headphones"),
        ("kindle", "Kindle", "tablet"),
        ("book", "紙の本", "book"),
        ("conversation", "会話", "chat"),
        ("video", "動画", "film"),
    ]))

_SITUATIONS = ["励ます", "慰める", "謝る", "断る", "頼む", "お礼", "ほめる", "反論する", "まとめる", "会議で", "雑談で",
               "目上に", "初対面で"]
_FEELINGS = ["安堵", "皮肉", "敬意", "共感", "ためらい", "驚き", "感心"]

SEED_TAGS: tuple[Tag, ...] = tuple(
    [Tag(seed_id(f"tag:situation:{name}"), TagKind.SITUATION, name, n, False, "seed") for n, name in enumerate(_SITUATIONS)]
    + [Tag(seed_id(f"tag:feeling:{name}"), TagKind.FEELING, name, n, False, "seed") for n, name in enumerate(_FEELINGS)])
