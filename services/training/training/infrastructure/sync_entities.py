"""筋トレの対象の種類を、同期の仕組み（sync）に登録する。項目はアプリの SQLite（apps/mobile/db/migrations.ts）と同じ。

範囲はアプリの apps/mobile/lib/limits.ts に合わせる（アプリで通った記録を、同期で断らないように）。
名前の長さは、アプリが書記素（絵文字も1文字）で40文字までにしているので、ここではコードポイントで200までにする。
scope は torelog-api/training.read・training.write。
睡眠（sleep_session）と心拍の日のまとめ（heart_rate_day）は、アプリが Health Connect から取り込んだものだけ
（手入力はない。origin は import）。心拍のサンプルそのものは受け取らない。
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import Field, model_validator

from sync.fields import Day, FieldsModel, Memo, Moment, Ref, SortOrder
from sync.registry import EntitySpec, Registry

AREA = "training"
Name = Annotated[str, Field(min_length=1, max_length=200)]
# フォームの動画のリンク。https:// で始まり、空白を含まないもの（アプリの lib/limits.ts の FORM_VIDEO_URL_MAX_LENGTH・formVideoUrlError と同じ）
FormVideoUrl = Annotated[str, Field(max_length=2000, pattern=r"^https://\S+$")]


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
    # 回数だけの種目の、体重に対する割合（0〜1。自重の負荷量 ＝ 体重 × 割合 × 回数）。null・なしは名前から決める
    bodyweight_ratio: Annotated[float, Field(ge=0, le=1)] | None = None
    # BIG3 の役。1つの役は1つの種目だけ（アプリが前の種目から外して送る。重なったら ID の小さいほう。training.domain.big3）
    big3: Literal["bench", "squat", "deadlift"] | None = None
    form_video_url: FormVideoUrl | None = None  # フォームの動画のリンク。記録の入力の画面から開く


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
    lean_mass_kg: Annotated[float, Field(ge=0, le=300)] | None = None
    memo: Memo = None
    source: Literal["manual", "health_connect"] = None
    external_id: Annotated[str, Field(max_length=200)] | None = None
    origin_package: Annotated[str, Field(max_length=200)] | None = None

    @model_validator(mode="before")
    @classmethod
    def _drop_removed(cls, data: object) -> object:
        """筋肉率（muscle_pct）とウエスト（waist_cm）は外した。前の版のアプリが送ってきても、断らずに捨てる。"""
        if isinstance(data, dict):
            return {k: v for k, v in data.items() if k not in ("muscle_pct", "waist_cm")}
        return data


Minutes = Annotated[int, Field(ge=0, le=1440)]  # 1件の睡眠は24時間まで（アプリの SLEEP_MAX_MIN）


class SleepSessionFields(FieldsModel):
    date: Day = None  # 起きた日（その土地の日付）
    start_at: Moment = None
    end_at: Moment = None
    asleep_min: Minutes = None  # 眠っていた分（全体から、起きていた・ベッドの外の段階を引いたもの）
    awake_min: Minutes = None
    source: Literal["health_connect"] = None
    external_id: Annotated[str, Field(max_length=200)] | None = None
    origin_package: Annotated[str, Field(max_length=200)] | None = None


Bpm = Annotated[float, Field(ge=1, le=300)]  # 拍/分（Health Connect の範囲。アプリの BPM_MIN・BPM_MAX）


class HeartRateDayFields(FieldsModel):
    date: Day = None  # 端末の暦の日付。ID は日付から決める（アプリの heartRateDayId）
    resting_bpm: Bpm | None = None
    avg_bpm: Bpm | None = None  # その日のサンプルの平均・最低・最高（サンプルがなければ null）
    min_bpm: Bpm | None = None
    max_bpm: Bpm | None = None
    samples: Annotated[int, Field(ge=0, le=1000000)] = None  # その日のサンプルの数


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
    registry.register("sleep_session", EntitySpec(
        SleepSessionFields, ("date", "start_at", "end_at", "asleep_min", "awake_min", "source"), AREA))
    registry.register("heart_rate_day", EntitySpec(HeartRateDayFields, ("date", "samples"), AREA))
