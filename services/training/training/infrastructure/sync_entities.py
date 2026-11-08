"""筋トレの対象の種類を、同期の仕組み（sync）に登録する。項目はアプリの SQLite（apps/mobile/db/migrations.ts）と同じ。

範囲はアプリの apps/mobile/lib/limits.ts に合わせる（アプリで通った記録を、同期で断らないように）。
名前の長さは、アプリが書記素（絵文字も1文字）で40文字までにしているので、ここではコードポイントで200までにする。
scope は torelog-api/training.read・training.write。
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import Field

from sync.fields import Day, FieldsModel, Memo, Moment, Ref, SortOrder
from sync.registry import EntitySpec, Registry

AREA = "training"
Name = Annotated[str, Field(min_length=1, max_length=200)]


class BodyPartFields(FieldsModel):
    name: Name = None
    sort_order: SortOrder = None
    hidden: bool = None


class ExerciseFields(FieldsModel):
    body_part_id: Ref = None
    name: Name = None
    record_type: Literal["weight_reps", "reps_only"] = None
    sort_order: SortOrder = None
    hidden: bool = None


class WorkoutEntryFields(FieldsModel):
    date: Day = None
    exercise_id: Ref = None
    sort_order: SortOrder = None


class WorkoutSetFields(FieldsModel):
    entry_id: Ref = None
    set_index: Annotated[int, Field(ge=0, le=1000)] = None
    weight_kg: Annotated[float, Field(gt=0, le=500)] | None = None  # 回数だけの種目は null
    reps: Annotated[int, Field(ge=0, le=10000)] = None
    memo: Memo = None
    done: bool = None


class BodyRecordFields(FieldsModel):
    date: Day = None
    measured_at: Moment = None
    weight_kg: Annotated[float, Field(ge=30, le=300)] | None = None
    body_fat_pct: Annotated[float, Field(ge=0, le=100)] | None = None
    muscle_pct: Annotated[float, Field(ge=0, le=100)] | None = None
    lean_mass_kg: Annotated[float, Field(ge=0, le=300)] | None = None
    waist_cm: Annotated[float, Field(ge=30, le=200)] | None = None
    memo: Memo = None
    source: Literal["manual", "health_connect"] = None
    external_id: Annotated[str, Field(max_length=200)] | None = None
    origin_package: Annotated[str, Field(max_length=200)] | None = None


class SettingFields(FieldsModel):
    value: Annotated[str, Field(max_length=1000)] | None = None


def register(registry: Registry) -> None:
    registry.register("body_part", EntitySpec(BodyPartFields, ("name", "sort_order", "hidden"), AREA))
    registry.register("exercise", EntitySpec(
        ExerciseFields, ("body_part_id", "name", "record_type", "sort_order", "hidden"), AREA))
    registry.register("workout_entry", EntitySpec(WorkoutEntryFields, ("date", "exercise_id", "sort_order"), AREA))
    registry.register("workout_set", EntitySpec(WorkoutSetFields, ("entry_id", "set_index", "reps"), AREA,
                                                owner=("workout_entry", "entry_id")))
    registry.register("body_record", EntitySpec(BodyRecordFields, ("date", "measured_at", "source"), AREA))
    registry.register("setting", EntitySpec(SettingFields, ("value",), AREA))
