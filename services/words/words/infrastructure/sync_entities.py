"""ことばの種類を、同期の仕組み（sync）に登録する。項目と範囲は docs/words-design.md の「データ」と同じ。

ことばの種類は WordsTable 用の別の Registry（create_registry）に登録する。KARADA のアプリ用の API と同期の流れには入らない。
scope の対象（area）は training（torelog-api/training.read・training.write）。ログインの情報を KARADA と共通にし、
新しい scope を作らないため（レポートと同じ）。
種類ごとの決まり：
- source・tag：アプリからは create・update・restore だけ（消すのは hidden）。MCP は create だけ
- expression：補う項目（意味・ニュアンス・例文・言い換え・役立ち度）はアプリから書けない（app_fields）。
  並びのキー（LSI by_day の day_key）に normalized_key を入れ、同じ表現を範囲の検索で探す
- expression_tag：ID は表現とタグから決める（違えば断る）。表現と一緒に消える（owner）
- encounter・usage（使えた）：表現と一緒に消える（owner）。usage は追記だけ（アプリからは create・delete）
- listen_session（聞いた1回）：アプリだけが書く。追記だけ（create・delete）。活動の記録（stats）に使う
- 例文（expression.examples）は本人と Claude の両方が書く一覧（項目ごとの後勝ちなので、一覧ごと置き換わる）
項目ごとに後勝ちで当てはめるので、項目の組み合わせは、同じ変更に両方の項目があるときだけ確かめる。
"""

from __future__ import annotations

import warnings
from typing import Annotated, Literal

from pydantic import Field

from sync.fields import Day, FieldsModel, Moment, Ref, SortOrder
from sync.model import Doc
from sync.registry import UUID_PATTERN, EntitySpec, Registry, Rejection
from words.domain import model as m
from words.domain.catalog import expression_tag_id

AREA = "training"
SOURCE, EXPRESSION, TAG, EXPRESSION_TAG, ENCOUNTER, USAGE, LISTEN_SESSION = (
    "source", "expression", "tag", "expression_tag", "encounter", "usage", "listen_session")
ENTITY_TYPES = (SOURCE, EXPRESSION, TAG, EXPRESSION_TAG, ENCOUNTER, USAGE, LISTEN_SESSION)


def _text(max_length: int, min_length: int = 0):
    return Annotated[str, Field(min_length=min_length, max_length=max_length)]


Count = Annotated[int, Field(ge=0, le=1_000_000)]
IconKey = Annotated[str, Field(min_length=1, max_length=40, pattern=r"^[a-z0-9_-]+$")]  # 知らない名前はアプリが other として表示する


class SourceFields(FieldsModel):
    name: _text(m.MAX_SOURCE_NAME, 1) = None
    icon_key: IconKey = None
    sort_order: SortOrder = None
    hidden: bool = None


class TagFields(FieldsModel):
    kind: Literal["situation", "feeling"] = None
    name: _text(m.MAX_TAG_NAME, 1) = None
    sort_order: SortOrder = None
    hidden: bool = None
    created_by: Literal["user", "claude", "seed"] = None


class ExampleFields(FieldsModel):
    """例文1つ。本人のもの（origin user）と Claude のもの（補う）。confirmed は本人が確かめたか（本人のものはいつも true）。"""

    text: _text(m.MAX_EXAMPLE, 1)
    origin: Literal["user", "claude"]
    confirmed: bool
    created_at: Moment
    updated_at: Moment


# 項目の名前 register（硬さ）は設計どおり。pydantic の ABC の register と名前が重なる警告は出さない
warnings.filterwarnings("ignore", message='Field name "register"', category=UserWarning)


class ExpressionFields(FieldsModel):
    text: _text(m.MAX_TEXT, 1) = None
    source_id: Ref | None = None
    normalized_key: _text(m.MAX_TEXT * 3) = None
    scene: _text(m.MAX_SCENE) = None
    note: _text(m.MAX_NOTE) = None
    star: bool = None
    place: Literal["collected", "hand", "own"] = None
    stage: Literal["understood", "used"] | None = None
    moved_at: Moment = None
    hand_since: Day | None = None
    interval_days: Annotated[int, Field(ge=1, le=m.MAX_INTERVAL)] = None
    due_on: Day | None = None
    listened_at: Moment | None = None  # 最後に聞いた時刻
    listen_count: Count = None
    use_count: Count = None
    last_used_on: Day | None = None
    reading: _text(m.MAX_READING) = None
    use_note: _text(m.MAX_USE_NOTE) = None
    meaning: _text(m.MAX_MEANING) = None
    nuance: _text(m.MAX_NUANCE) = None
    register: Literal["spoken", "written", "formal"] | None = None
    register_by: Literal["user", "claude"] | None = None
    examples: Annotated[list[ExampleFields], Field(max_length=m.MAX_EXAMPLES)] = None
    similar: Annotated[list[_text(m.MAX_SIMILAR_TEXT, 1)], Field(max_length=m.MAX_SIMILAR)] = None
    usefulness: Annotated[int, Field(ge=1, le=3)] | None = None
    usefulness_reason: _text(m.MAX_USEFULNESS_REASON) = None
    usefulness_until: Day | None = None
    enriched_at: Moment | None = None


# 補う項目（Claude だけが書く）。アプリは書けない（例文は本人も書くので、ここに入れない）
ENRICH_FIELDS = ("meaning", "nuance", "similar", "usefulness", "usefulness_reason", "usefulness_until", "enriched_at")
EXPRESSION_APP_FIELDS = tuple(f for f in ExpressionFields.model_fields if f not in ENRICH_FIELDS)
# 間隔の項目（聞いた・使えたで一緒に変わる組。アプリは syncSpec.ts の together で送る）
SCHEDULE_FIELDS = ("stage", "interval_days", "due_on", "listened_at", "listen_count", "use_count", "last_used_on")


class ExpressionTagFields(FieldsModel):
    expression_id: Ref = None
    tag_id: Ref = None
    added_by: Literal["user", "claude"] = None
    status: Literal["confirmed", "proposed", "rejected"] = None
    confirmed_at: Moment | None = None


class EncounterFields(FieldsModel):
    expression_id: Ref = None
    source_id: Ref | None = None
    title: _text(m.MAX_TITLE) = None
    locator: _text(m.MAX_LOCATOR) = None
    met_on: Day | None = None
    time_hint: _text(m.MAX_TIME_HINT) = None
    scene: _text(m.MAX_SCENE) = None
    surrounding_text: _text(m.MAX_SURROUNDING) = None
    wording: _text(m.MAX_WORDING) = None
    captured_via: Literal["mcp", "app"] = None
    note: _text(m.MAX_ENCOUNTER_NOTE) = None


class UsageFields(FieldsModel):
    expression_id: Ref = None
    used_on: Day = None  # 使えた日（日本時間の午前4時で区切った日）
    scene: _text(m.MAX_USAGE_NOTE) = None  # どんな場面で使えたか（本人の言葉）
    note: _text(m.MAX_USAGE_NOTE) = None


class ListenSessionFields(FieldsModel):
    started_at: Moment = None
    listened_on: Day = None
    seconds: Annotated[int, Field(ge=0, le=m.MAX_LISTEN_SECONDS)] = None  # 流した時間
    items: Annotated[int, Field(ge=0, le=1000)] = None  # 流し終えた表現の数


REQUIRED: dict[str, tuple[str, ...]] = {
    SOURCE: ("name", "icon_key", "sort_order", "hidden"),
    TAG: ("kind", "name", "sort_order", "hidden"),
    EXPRESSION: ("text", "normalized_key", "place"),
    EXPRESSION_TAG: ("expression_id", "tag_id", "added_by", "status"),
    ENCOUNTER: ("expression_id",),
    USAGE: ("expression_id", "used_on"),
    LISTEN_SESSION: ("started_at", "listened_on", "seconds", "items"),
}


def _reject(field: str, message: str, detail: str) -> Rejection:
    return Rejection("invalid_fields", message, ({"field": f"fields.{field}", "message": detail},))


def _not_blank(field: str, fields: dict) -> Rejection | None:
    if field in fields and not fields[field].strip():
        return _reject(field, f"{field} を空白だけにはできません", "空白以外の文字が要ります")
    return None


def _check_source(entity_id: str, fields: dict) -> Rejection | None:
    return _not_blank("name", fields)


def _check_tag(entity_id: str, fields: dict) -> Rejection | None:
    return _not_blank("name", fields)


def _check_expression(entity_id: str, fields: dict) -> Rejection | None:
    if rejection := _not_blank("text", fields):
        return rejection
    place, stage = fields.get("place"), fields.get("stage")
    if "place" in fields and "stage" in fields and (place == "hand") != (stage is not None):
        return _reject("stage", "段階（stage）は手札（place が hand）のときだけ入れてください", "hand なら段階、ほかは null")
    return None


def _check_expression_tag(entity_id: str, fields: dict) -> Rejection | None:
    expression_id, tag_id = fields.get("expression_id"), fields.get("tag_id")
    if expression_id and tag_id and entity_id.lower() != expression_tag_id(expression_id, tag_id):
        return _reject("tag_id", "ID は表現とタグから決めてください（uuid5(ことばの名前空間, \"<expression_id>:<tag_id>\")）",
                       "expression_tag_id と同じ")
    return None


def expression_index_key(doc: Doc) -> str | None:
    """表現の並びのキー（LSI by_day の day_key）。空の形はキーにできないので None。"""
    if doc.entity_type != EXPRESSION or doc.own is None:
        return None
    key = doc.own.values.get("normalized_key")
    return key if isinstance(key, str) and key else None


def _uuid(entity_id: str) -> bool:
    return bool(UUID_PATTERN.match(entity_id))


def register(registry: Registry) -> None:
    hidden_only = ("create", "update", "restore")  # 消すのは隠すこと
    registry.register(SOURCE, EntitySpec(SourceFields, REQUIRED[SOURCE], AREA, valid_id=_uuid, check=_check_source,
                                         app_ops=hidden_only))
    registry.register(TAG, EntitySpec(TagFields, REQUIRED[TAG], AREA, valid_id=_uuid, check=_check_tag,
                                      app_ops=hidden_only))
    registry.register(EXPRESSION, EntitySpec(ExpressionFields, REQUIRED[EXPRESSION], AREA, valid_id=_uuid,
                                             check=_check_expression, index_key=expression_index_key,
                                             app_fields=EXPRESSION_APP_FIELDS))
    registry.register(EXPRESSION_TAG, EntitySpec(ExpressionTagFields, REQUIRED[EXPRESSION_TAG], AREA, valid_id=_uuid,
                                                 check=_check_expression_tag, owner=(EXPRESSION, "expression_id")))
    registry.register(ENCOUNTER, EntitySpec(EncounterFields, REQUIRED[ENCOUNTER], AREA, valid_id=_uuid,
                                            owner=(EXPRESSION, "expression_id")))
    registry.register(USAGE, EntitySpec(UsageFields, REQUIRED[USAGE], AREA, valid_id=_uuid,
                                        owner=(EXPRESSION, "expression_id"), app_ops=("create", "delete")))
    registry.register(LISTEN_SESSION, EntitySpec(ListenSessionFields, REQUIRED[LISTEN_SESSION], AREA, valid_id=_uuid,
                                                 app_ops=("create", "delete")))


def create_registry() -> Registry:
    """WordsTable で扱う種類（ことばだけ）。"""
    registry = Registry()
    register(registry)
    return registry
