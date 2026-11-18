"""ことばのドメインの型（表現と例文・出会い・出会った場所・タグとつながり・使えた・聞いた記録）。設計は docs/words-design.md の「データ」。

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
MAX_EXAMPLES, MAX_EXAMPLE = 8, 200  # 例文は本人のものと Claude のものを合わせて8件まで、各200文字
CLAUDE_EXAMPLES_MIN, CLAUDE_EXAMPLES_MAX = 2, 3  # 補うときに Claude が書く話し言葉の例文の数
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
MAX_USAGES = 500  # 使えたの記録。表現1つ
MAX_USAGE_NOTE = 300
MAX_LISTEN_SECONDS = 24 * 3600  # 聞いた記録1回の秒数
MAX_SOURCES = 50  # 1人
MAX_TAGS = 200  # 1人


class Place(StrEnum):
    COLLECTED = "collected"  # 拾った
    HAND = "hand"  # 手札
    OWN = "own"  # 自分の言葉


class Stage(StrEnum):
    UNDERSTOOD = "understood"  # 意味がわかる（手札に入れたとき）
    USED = "used"  # 使えた


class Register(StrEnum):
    SPOKEN = "spoken"
    WRITTEN = "written"
    FORMAL = "formal"


REGISTER_NAMES = {Register.SPOKEN: "話し言葉", Register.WRITTEN: "書き言葉", Register.FORMAL: "改まった"}
PLACE_NAMES = {Place.COLLECTED: "拾った", Place.HAND: "手札", Place.OWN: "自分の言葉"}
STAGE_NAMES = {Stage.UNDERSTOOD: "意味がわかる", Stage.USED: "使えた"}


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


@dataclass(frozen=True)
class Schedule:
    """手札の間隔の項目（聞いた・使えたで一緒に変わる組）。"""

    stage: Stage | None = None
    interval_days: int = 1
    due_on: date | None = None
    listened_at: str | None = None  # 最後に聞いた時刻（RFC 3339）
    listen_count: int = 0
    use_count: int = 0
    last_used_on: date | None = None


@dataclass(frozen=True)
class Example:
    """例文1つ。本人のもの（origin user。いつも確かめた扱い）と Claude のもの（補うときに書く。本人が確かめたら confirmed）。"""

    text: str
    origin: By
    confirmed: bool
    created_at: str = ""
    updated_at: str = ""


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
    examples: tuple[Example, ...] = ()
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
class Usage:
    """実際の会話で使えた1回（追記だけ）。"""

    id: str
    expression_id: str
    used_on: date
    scene: str = ""
    note: str = ""
    created_at: str = ""


@dataclass(frozen=True)
class ListenSession:
    """アプリで聞いた1回（車の中などで続けて流したまとまり。追記だけ）。"""

    id: str
    started_at: str
    listened_on: date
    seconds: int
    items: int


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
