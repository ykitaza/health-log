"""食事の対象の種類を、同期の仕組み（sync）に登録する。項目は docs/api/app-api.yaml の *Fields と同じ。

  meal            食事。並びのキーは「日付#区分の順番」（今の MEAL# の day_key と同じ形）で、LSI by_day で期間を探す
  meal_item       食事の中の品目。親の食事と一緒に保存する（parent_id は食事の ID）
  meal_template   いつもの。ID は名前から決める（同じ名前は1つ）
  nutrition_goal  食事の目標。ID は current だけ
  day_type        日の種類。ID は日付
scope は torelog-api/meals.read・meals.write。
"""

from __future__ import annotations

import uuid
from typing import Annotated, Literal

from pydantic import Field

from domain.values import MealSlot
from sync.fields import Day, FieldsModel, Ref, SortOrder, is_date
from sync.model import Doc
from sync.registry import EntitySpec, Registry, Rejection

AREA = "meals"
SLOT_ORDER = [s.value for s in MealSlot]
# いつものの ID は名前から決める（同じ名前は1つ。アプリと MCP で同じ ID になる）
TEMPLATE_NAMESPACE = uuid.UUID("6f1d3c52-6a1e-4f5f-9d0b-2c7a8e0f4b61")

Grams = Annotated[float, Field(ge=0, le=5000)]
Kcal = Annotated[float, Field(ge=0, le=20000)]
Amount = Annotated[float, Field(gt=0, le=100000)]
Unit = Literal["g", "ml", "個", "杯"]
Confidence = Literal["high", "medium", "low"]
ItemName = Annotated[str, Field(min_length=1, max_length=200)]


def template_id(name: str) -> str:
    return str(uuid.uuid5(TEMPLATE_NAMESPACE, name))


def day_key(day: str, slot: str) -> str:
    return f"{day}#{SLOT_ORDER.index(slot)}"


class MealFields(FieldsModel):
    date: Day = None
    slot: Literal["breakfast", "lunch", "dinner", "snack"] = None
    time: Annotated[str, Field(pattern=r"^([01][0-9]|2[0-3]):[0-5][0-9]$")] | None = None
    description: Annotated[str, Field(max_length=2000)] = None
    source: Literal["photo", "text", "numbers", "copy", "template"] = None


class _ItemCore(FieldsModel):
    name: ItemName = None
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
    name: ItemName
    amount: Amount
    unit: Unit
    kcal: Kcal
    protein_g: Grams
    fat_g: Grams
    carbs_g: Grams
    confidence: Confidence


class MealTemplateFields(FieldsModel):
    name: Annotated[str, Field(min_length=1, max_length=100)] = None
    items: Annotated[list[TemplateItem], Field(min_length=1, max_length=50)] = None


class DailyTarget(FieldsModel):
    kcal: Kcal
    fat_g: Grams
    carbs_g: Grams


class Targets(FieldsModel):
    training_day: DailyTarget
    rest_day: DailyTarget


class NutritionGoalFields(FieldsModel):
    policy: Literal["bulk", "maintain", "cut"] = None
    body_weight_kg: Annotated[float, Field(gt=0, le=300)] | None = None
    protein_per_kg: Annotated[float, Field(gt=0, le=5)] | None = None
    targets: Targets | None = None  # 筋トレの日と休みの日の目標。片方だけにならないよう1つの項目にする
    eating_style: Literal["home_cooked", "eating_out", "convenience_store"] | None = None
    target_weight_kg: Annotated[float, Field(ge=30, le=300)] | None = None


class DayTypeFields(FieldsModel):
    day_type: Literal["training", "rest"] = None


def _meal_index(doc: Doc) -> str | None:
    values = doc.own.values if doc.own else {}
    if "date" not in values or "slot" not in values:
        return None
    return day_key(values["date"], values["slot"])


def _template_named(entity_id: str, fields: dict) -> Rejection | None:
    if "name" in fields and entity_id != template_id(fields["name"]):
        return Rejection("invalid_fields", "いつものの entity_id は、名前から決めた ID（uuid5）にしてください",
                         ({"field": "entity_id", "message": f"この名前なら {template_id(fields['name'])}"},))
    return None


def register(registry: Registry) -> None:
    registry.register("meal", EntitySpec(
        MealFields, ("date", "slot", "description", "source"), AREA, index_key=_meal_index))
    registry.register("meal_item", EntitySpec(
        MealItemFields, ("name", "amount", "unit", "kcal", "protein_g", "fat_g", "carbs_g", "confidence", "sort_order"),
        AREA, parent_type="meal"))
    registry.register("meal_template", EntitySpec(MealTemplateFields, ("name", "items"), AREA, check=_template_named))
    registry.register("nutrition_goal", EntitySpec(
        NutritionGoalFields, ("policy",), AREA, valid_id=lambda entity_id: entity_id == "current"))
    registry.register("day_type", EntitySpec(DayTypeFields, ("day_type",), AREA, valid_id=is_date))
