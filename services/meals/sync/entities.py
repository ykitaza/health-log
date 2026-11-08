"""同期する対象の種類と項目。docs/api/app-api.yaml の *Fields と同じ決まりで、送られた変更を確かめる。

項目は「型が違う」「範囲の外」「知らない項目」を断る。null にできない項目に null を送っても断る
（既定値の None は確かめないので、送らなかった項目は None のまま捨てる）。
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, ValidationError

from sync.model import APP_ORIGINS, OPS, Change, parse_timestamp

ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
# いつものの ID は名前から決める（同じ名前は1つ。アプリと MCP で同じ ID になる）
TEMPLATE_NAMESPACE = uuid.UUID("6f1d3c52-6a1e-4f5f-9d0b-2c7a8e0f4b61")


def template_id(name: str) -> str:
    return str(uuid.uuid5(TEMPLATE_NAMESPACE, name))

UUID_PATTERN = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


def _date(text: str) -> str:
    date.fromisoformat(text)
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        raise ValueError("YYYY-MM-DD で入力してください")
    return text


def _datetime(text: str) -> str:
    if datetime.fromisoformat(text.replace("Z", "+00:00")).tzinfo is None:
        raise ValueError("時差（Z か +09:00 など）がありません")
    return text


Day = Annotated[str, AfterValidator(_date)]
Moment = Annotated[str, AfterValidator(_datetime)]
Ref = Annotated[str, Field(pattern=ID_PATTERN.pattern)]
Grams = Annotated[float, Field(ge=0, le=5000)]
Kcal = Annotated[float, Field(ge=0, le=20000)]
Amount = Annotated[float, Field(gt=0, le=100000)]
SortOrder = Annotated[int, Field(ge=0, le=100000)]
Memo = Annotated[str, Field(max_length=1000)]
Unit = Literal["g", "ml", "個", "杯"]
Confidence = Literal["high", "medium", "low"]


class _Fields(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)


class MealFields(_Fields):
    date: Day = None
    slot: Literal["breakfast", "lunch", "dinner", "snack"] = None
    time: Annotated[str, Field(pattern=r"^([01][0-9]|2[0-3]):[0-5][0-9]$")] | None = None
    description: Annotated[str, Field(max_length=2000)] = None
    source: Literal["photo", "text", "numbers", "copy", "template"] = None


class _ItemCore(_Fields):
    name: Annotated[str, Field(min_length=1, max_length=200)] = None
    amount: Amount = None
    unit: Unit = None
    kcal: Kcal = None
    protein_g: Grams = None
    fat_g: Grams = None
    carbs_g: Grams = None
    confidence: Confidence = None


class MealItemFields(_ItemCore):
    sort_order: SortOrder = None


class TemplateItem(_ItemCore):
    item_id: Ref | None = None  # 省くとサーバーが並び順から決める
    name: Annotated[str, Field(min_length=1, max_length=200)]
    amount: Amount
    unit: Unit
    kcal: Kcal
    protein_g: Grams
    fat_g: Grams
    carbs_g: Grams
    confidence: Confidence


class MealTemplateFields(_Fields):
    name: Annotated[str, Field(min_length=1, max_length=100)] = None
    items: Annotated[list[TemplateItem], Field(min_length=1, max_length=50)] = None


class DailyTarget(_Fields):
    kcal: Kcal
    fat_g: Grams
    carbs_g: Grams


class Targets(_Fields):
    training_day: DailyTarget
    rest_day: DailyTarget


class NutritionGoalFields(_Fields):
    policy: Literal["bulk", "maintain", "cut"] = None
    body_weight_kg: Annotated[float, Field(gt=0, le=300)] | None = None
    protein_per_kg: Annotated[float, Field(gt=0, le=5)] | None = None
    targets: Targets | None = None
    eating_style: Literal["home_cooked", "eating_out", "convenience_store"] | None = None
    target_weight_kg: Annotated[float, Field(ge=30, le=300)] | None = None


class DayTypeFields(_Fields):
    day_type: Literal["training", "rest"] = None


class BodyPartFields(_Fields):
    name: Annotated[str, Field(min_length=1, max_length=100)] = None
    sort_order: SortOrder = None
    hidden: bool = None


class ExerciseFields(_Fields):
    body_part_id: Ref = None
    name: Annotated[str, Field(min_length=1, max_length=100)] = None
    record_type: Literal["weight_reps", "reps_only"] = None
    sort_order: SortOrder = None
    hidden: bool = None


class WorkoutEntryFields(_Fields):
    date: Day = None
    exercise_id: Ref = None
    sort_order: SortOrder = None


class WorkoutSetFields(_Fields):
    entry_id: Ref = None
    set_index: Annotated[int, Field(ge=0, le=1000)] = None
    weight_kg: Annotated[float, Field(ge=0, le=1000)] | None = None
    reps: Annotated[int, Field(ge=0, le=10000)] = None
    memo: Memo = None
    done: bool = None


class BodyRecordFields(_Fields):
    date: Day = None
    measured_at: Moment = None
    weight_kg: Annotated[float, Field(ge=20, le=400)] | None = None
    body_fat_pct: Annotated[float, Field(ge=0, le=100)] | None = None
    muscle_pct: Annotated[float, Field(ge=0, le=100)] | None = None
    lean_mass_kg: Annotated[float, Field(ge=0, le=400)] | None = None
    waist_cm: Annotated[float, Field(ge=0, le=300)] | None = None
    memo: Memo = None
    source: Literal["manual", "health_connect"] = None
    external_id: Annotated[str, Field(max_length=200)] | None = None
    origin_package: Annotated[str, Field(max_length=200)] | None = None


class SettingFields(_Fields):
    value: Annotated[str, Field(max_length=1000)] | None = None


@dataclass(frozen=True)
class EntitySpec:
    fields: type[_Fields]
    required: tuple[str, ...]  # create で要る項目
    area: Literal["meals", "training"]  # scope の対象（meals.* か training.*）


SPECS: dict[str, EntitySpec] = {
    "meal": EntitySpec(MealFields, ("date", "slot", "description", "source"), "meals"),
    "meal_item": EntitySpec(MealItemFields, (
        "name", "amount", "unit", "kcal", "protein_g", "fat_g", "carbs_g", "confidence", "sort_order"), "meals"),
    "meal_template": EntitySpec(MealTemplateFields, ("name", "items"), "meals"),
    "nutrition_goal": EntitySpec(NutritionGoalFields, ("policy",), "meals"),
    "day_type": EntitySpec(DayTypeFields, ("day_type",), "meals"),
    "body_part": EntitySpec(BodyPartFields, ("name", "sort_order", "hidden"), "training"),
    "exercise": EntitySpec(ExerciseFields, ("body_part_id", "name", "record_type", "sort_order", "hidden"), "training"),
    "workout_entry": EntitySpec(WorkoutEntryFields, ("date", "exercise_id", "sort_order"), "training"),
    "workout_set": EntitySpec(WorkoutSetFields, ("entry_id", "set_index", "reps"), "training"),
    "body_record": EntitySpec(BodyRecordFields, ("date", "measured_at", "source"), "training"),
    "setting": EntitySpec(SettingFields, ("value",), "training"),
}


def types_in(areas: set[str]) -> set[str]:
    return {t for t, spec in SPECS.items() if spec.area in areas}


@dataclass(frozen=True)
class Rejection:
    code: str
    message: str
    errors: tuple[dict, ...] = ()

    def view(self) -> dict:
        return {"code": self.code, "message": self.message, "errors": list(self.errors)}


CHANGE_KEYS = {"change_id", "entity_type", "entity_id", "parent_id", "op", "fields", "changed_at", "origin"}


def check_fields(entity_type: str, op: str, fields: object, path: str = "fields") -> dict | Rejection:
    """項目を確かめ、送られた項目だけの dict を返す。"""
    spec = SPECS[entity_type]
    if not isinstance(fields, dict):
        return Rejection("invalid_fields", "fields はオブジェクトにしてください")
    try:
        model = spec.fields.model_validate(fields)
    except ValidationError as e:
        errors = tuple(
            {"field": ".".join([path, *map(str, err["loc"])]), "message": err["msg"]} for err in e.errors())
        return Rejection("invalid_fields", "項目の形が違います", errors)
    values = model.model_dump(mode="json", exclude_unset=True)
    if op == "create":
        missing = [name for name in spec.required if name not in values]
        if missing:
            return Rejection("missing_fields", "create に要る項目がありません",
                             tuple({"field": f"{path}.{n}", "message": "必須です"} for n in missing))
    elif not values:
        return Rejection("invalid_fields", "update には変えた項目を1つ以上入れてください")
    return values


def parse_change(raw: dict, allowed_types: set[str], device_id: str | None) -> Change | Rejection:
    """アプリから届いた変更を確かめる。change_id は呼ぶ側が確かめておく。"""
    unknown = set(raw) - CHANGE_KEYS
    if unknown:
        return Rejection("invalid_fields", f"知らない項目があります：{', '.join(sorted(unknown))}")
    entity_type = raw.get("entity_type")
    if entity_type not in SPECS:
        return Rejection("invalid_fields", "entity_type が違います")
    if entity_type not in allowed_types:
        return Rejection("insufficient_scope", f"{entity_type} を書く scope がありません")
    entity_id, parent_id, op = raw.get("entity_id"), raw.get("parent_id"), raw.get("op")
    if not isinstance(entity_id, str) or not ID_PATTERN.match(entity_id) or not _valid_id(entity_type, entity_id):
        return Rejection("invalid_fields", "entity_id が違います")
    if entity_type == "meal_item":
        if parent_id is None:
            return Rejection("missing_parent_id", "meal_item には parent_id（食事の ID）が要ります")
        if not isinstance(parent_id, str) or not ID_PATTERN.match(parent_id):
            return Rejection("invalid_fields", "parent_id が違います")
    elif parent_id is not None:
        return Rejection("parent_id_not_allowed", "parent_id は meal_item だけに入れます")
    if op not in OPS:
        return Rejection("invalid_fields", "op が違います")
    origin = raw.get("origin", "app")
    if origin not in APP_ORIGINS:
        return Rejection("invalid_fields", "origin は app か import にしてください")
    try:
        changed_at = parse_timestamp(raw["changed_at"]) if isinstance(raw.get("changed_at"), str) else None
    except ValueError:
        changed_at = None
    if changed_at is None:
        return Rejection("invalid_fields", "changed_at は RFC 3339 の時刻（時差つき）にしてください")
    fields = raw.get("fields")
    if op in ("delete", "restore"):
        if fields is not None:
            return Rejection("fields_not_allowed", f"{op} には fields を入れません")
    else:
        fields = check_fields(entity_type, op, fields)
        if isinstance(fields, Rejection):
            return fields
        if entity_type == "meal_template" and "name" in fields and entity_id != template_id(fields["name"]):
            return Rejection("invalid_fields", "いつものの entity_id は、名前から決めた ID（uuid5）にしてください",
                             ({"field": "entity_id", "message": f"この名前なら {template_id(fields['name'])}"},))
    return Change(raw["change_id"].lower(), entity_type, entity_id, parent_id, op, fields, changed_at, origin,
                  device_id)


def _valid_id(entity_type: str, entity_id: str) -> bool:
    if entity_type == "nutrition_goal":
        return entity_id == "current"
    if entity_type == "day_type":
        try:
            return _date(entity_id) == entity_id
        except ValueError:
            return False
    return True
