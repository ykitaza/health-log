"""ことばのドメインの型（表現・出会い・出会った場所・タグとつながり・振り返りの記録）。設計は docs/words-design.md の「データ」。

どれも読み取り専用（frozen）。書き換えは dataclasses.replace で新しいものを作る（読んだものを使い回しても壊れないように）。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from enum import StrEnum

# 上限（書く側が確かめる。docs/words-design.md）
MAX_TEXT = 200
MAX_SCENE = 300
MAX_NOTE = 1000
MAX_READING = 100
MAX_USE_NOTE = 300
MAX_MEANING = 300
MAX_NUANCE = 500
MAX_EXAMPLES, MAX_EXAMPLE = 3, 200
MAX_SIMILAR, MAX_SIMILAR_TEXT = 5, 100
MAX_USEFULNESS_REASON = 200
MAX_SOURCE_NAME = 40
MAX_TAG_NAME = 20
MAX_TITLE = 200
MAX_LOCATOR = 100
MAX_TIME_HINT = 50
MAX_SURROUNDING = 1000
MAX_WORDING = 200
MAX_ENCOUNTER_NOTE = 500
MAX_INTERVAL = 60

MAX_EXPRESSIONS = 5000  # 1人
MAX_ENCOUNTERS = 50  # 表現1つ
MAX_REVIEWS = 500  # 表現1つ
MAX_SOURCES = 50  # 1人
MAX_TAGS = 200  # 1人


class Place(StrEnum):
    COLLECTED = "collected"  # 拾った
    HAND = "hand"  # 手札
    OWN = "own"  # 自分の言葉


class Stage(StrEnum):
    UNDERSTOOD = "understood"  # 意味がわかる
    SAYABLE = "sayable"  # 言えそう
    USED = "used"  # 使えた


class Register(StrEnum):
    SPOKEN = "spoken"
    WRITTEN = "written"
    FORMAL = "formal"


REGISTER_NAMES = {Register.SPOKEN: "話し言葉", Register.WRITTEN: "書き言葉", Register.FORMAL: "改まった"}
PLACE_NAMES = {Place.COLLECTED: "拾った", Place.HAND: "手札", Place.OWN: "自分の言葉"}
STAGE_NAMES = {Stage.UNDERSTOOD: "意味がわかる", Stage.SAYABLE: "言えそう", Stage.USED: "使えた"}


class By(StrEnum):
    USER = "user"
    CLAUDE = "claude"


class TagKind(StrEnum):
    SITUATION = "situation"  # 使う場面
    FEELING = "feeling"  # 気持ち・ニュアンス


class TagStatus(StrEnum):
    CONFIRMED = "confirmed"
    PROPOSED = "proposed"
    REJECTED = "rejected"


TAG_WEIGHTS = {TagStatus.CONFIRMED: 1.0, TagStatus.PROPOSED: 0.5}  # rejected は使わない


class ReviewKind(StrEnum):
    RECALL = "recall"
    USE = "use"


class RecallResult(StrEnum):
    SAID = "said"  # 言えた
    CLOSE = "close"  # 惜しい
    BLANK = "blank"  # 出てこなかった


class Trigger(StrEnum):
    SELF = "self"
    NOTIFICATION = "notification"
    CHAT = "chat"


@dataclass(frozen=True)
class Schedule:
    """手札の間隔の項目（1回の振り返りで一緒に変わる組）。"""

    stage: Stage | None = None
    interval_days: int = 1
    due_on: date | None = None
    last_reviewed_on: date | None = None
    success_streak: int = 0
    lapse_streak: int = 0
    review_count: int = 0
    lapse_count: int = 0
    use_count: int = 0
    last_used_on: date | None = None


@dataclass(frozen=True)
class Expression:
    id: str
    text: str
    normalized_key: str
    place: Place
    schedule: Schedule = field(default_factory=Schedule)
    source_id: str | None = None
    scene: str = ""
    note: str = ""
    star: bool = False
    moved_at: str | None = None
    hand_since: date | None = None
    reading: str = ""
    use_note: str = ""
    meaning: str = ""
    nuance: str = ""
    register: Register | None = None
    register_by: By | None = None
    examples: tuple[str, ...] = ()
    similar: tuple[str, ...] = ()
    usefulness: int | None = None
    usefulness_reason: str = ""
    usefulness_until: date | None = None
    enriched_at: str | None = None
    created_at: str = ""
    updated_at: str = ""


@dataclass(frozen=True)
class Encounter:
    id: str
    expression_id: str
    source_id: str | None = None
    title: str = ""
    locator: str = ""
    met_on: date | None = None
    time_hint: str = ""
    scene: str = ""
    surrounding_text: str = ""
    wording: str = ""
    captured_via: str = "mcp"
    note: str = ""
    created_at: str = ""


@dataclass(frozen=True)
class Review:
    id: str
    expression_id: str
    kind: ReviewKind
    reviewed_at: str
    result: RecallResult | None = None
    interval_before: int | None = None
    interval_after: int | None = None
    session_id: str | None = None
    trigger: Trigger | None = None


@dataclass(frozen=True)
class Source:
    id: str
    name: str
    icon_key: str
    sort_order: int
    hidden: bool = False
    seed: bool = False  # 初期の行のまま（同期にまだない）


@dataclass(frozen=True)
class Tag:
    id: str
    kind: TagKind
    name: str
    sort_order: int
    hidden: bool = False
    created_by: str = "seed"


@dataclass(frozen=True)
class ExpressionTag:
    id: str
    expression_id: str
    tag_id: str
    added_by: By
    status: TagStatus
    confirmed_at: str | None = None
