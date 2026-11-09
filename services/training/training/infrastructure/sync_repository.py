"""リポジトリの実装（同期の仕組みの上）。読むのはアプリと MCP が書いた今の状態、書くのは変更の記録（origin は mcp）。

消したもの（deleted）と、項目がまだそろっていないもの（子が親より先に届いたときなど）は読まない。
集計の行は、アプリ（db/repositories/workouts.ts の allSetRows）と同じく、消したセットと消した日の種目を除き、
種目が消えていても含める（過去の負荷量が変わらないように）。並びは日付・その日の順・セットの順。
初期の部位と種目（training.domain.catalog）は、同期にまだ届いていなくても、あるものとして読む（アプリと同じ ID）。
書くときは今の状態と比べ、違う項目だけを update にする（新しいものは create）。アプリが同時に別の項目を変えていても、
項目ごとに当てはめるので、両方が残る。
"""

from __future__ import annotations

import uuid
from dataclasses import asdict
from functools import partial

import anyio

from sync.engine import SyncEngine
from sync.model import Change, EntityState
from training.domain import bodyweight
from training.domain.catalog import SEED_BODY_PARTS, SEED_EXERCISES, Catalog
from training.domain.model import (
    BodyPart,
    BodyRecord,
    Exercise,
    HeartRateDay,
    RecordType,
    SetRow,
    SleepSession,
    TraineeId,
    Workout,
    WorkoutEntry,
    WorkoutSet,
)

REQUIRED = {
    "body_part": {"name", "sort_order", "hidden"},
    "exercise": {"body_part_id", "name", "record_type", "sort_order", "hidden"},
    "workout_entry": {"date", "exercise_id", "sort_order"},
    "workout_set": {"entry_id", "set_index", "reps"},
    "body_record": {"date", "measured_at", "source"},
    "sleep_session": {"date", "start_at", "end_at", "asleep_min", "awake_min", "source"},
    "heart_rate_day": {"date", "samples"},
}
_MISSING = object()


def _seed_values(item: BodyPart | Exercise) -> dict:
    values = asdict(item)
    values.pop("id")
    if isinstance(item, Exercise):
        values["record_type"] = item.record_type.value
        values.pop("bodyweight_ratio")  # 初期の種目は割合を持たない（名前から決める）。同期の値があればそれを使う
    return values


def _exercise(entity_id: str, v: dict) -> Exercise:
    return Exercise(entity_id, v["body_part_id"], v["name"], RecordType(v["record_type"]), v["sort_order"], v["hidden"],
                    v.get("bodyweight_ratio"))


class SyncTrainingRepository:
    def __init__(self, engine: SyncEngine):
        self.engine = engine

    def _alive(self, user: str, entity_type: str) -> list[EntityState]:
        states = [d.own for d in self.engine.docs_of_type(user, entity_type) if d.own is not None]
        return [s for s in states if not s.deleted and REQUIRED[entity_type] <= s.values.keys()]

    async def _run(self, fn, *args):
        return await anyio.to_thread.run_sync(partial(fn, *args))

    async def body_parts(self, trainee: TraineeId) -> list[BodyPart]:
        states = await self._run(self._alive, trainee.value, "body_part")
        parts = [BodyPart(s.entity_id, s.values["name"], s.values["sort_order"], s.values["hidden"]) for s in states]
        return sorted(parts, key=lambda p: (p.sort_order, p.id))

    async def exercises(self, trainee: TraineeId) -> list[Exercise]:
        states = await self._run(self._alive, trainee.value, "exercise")
        found = [_exercise(s.entity_id, s.values) for s in states]
        return sorted(found, key=lambda e: (e.sort_order, e.id))

    def _with_seeds(self, user: str, entity_type: str, seeds) -> list[tuple[str, dict]]:
        """初期のものに、同期の記録を重ねる。同期で消したものは除く。"""
        states = {d.own.entity_id: d.own for d in self.engine.docs_of_type(user, entity_type) if d.own is not None}
        merged = {s.id: _seed_values(s) for s in seeds}
        for entity_id, state in states.items():
            merged[entity_id] = {**merged.get(entity_id, {}), **state.values}
            if state.deleted:
                merged.pop(entity_id)
        return [(i, v) for i, v in merged.items() if REQUIRED[entity_type] <= v.keys()]

    def _catalog(self, user: str) -> Catalog:
        parts = [BodyPart(i, v["name"], v["sort_order"], v["hidden"])
                 for i, v in self._with_seeds(user, "body_part", SEED_BODY_PARTS)]
        exercises = [_exercise(i, v) for i, v in self._with_seeds(user, "exercise", SEED_EXERCISES)]
        return Catalog(tuple(sorted(parts, key=lambda p: (p.sort_order, p.name, p.id))),
                       tuple(sorted(exercises, key=lambda e: (e.sort_order, e.name, e.id))))

    async def catalog(self, trainee: TraineeId) -> Catalog:
        return await self._run(self._catalog, trainee.value)

    def _entries(self, user: str) -> list[WorkoutEntry]:
        sets_by_entry: dict[str, list[WorkoutSet]] = {}
        for s in self._alive(user, "workout_set"):
            v = s.values
            sets_by_entry.setdefault(v["entry_id"], []).append(
                WorkoutSet(s.entity_id, v["set_index"], v.get("weight_kg"), v["reps"], v.get("memo", ""),
                           v.get("done", False)))
        entries = []
        for e in self._alive(user, "workout_entry"):
            v = e.values
            sets = tuple(sorted(sets_by_entry.get(e.entity_id, []), key=lambda s: (s.set_index, s.id)))
            entries.append(WorkoutEntry(e.entity_id, v["date"], v["exercise_id"], v["sort_order"], sets))
        return sorted(entries, key=lambda e: (e.date, e.sort_order, e.id))

    async def workout(self, trainee: TraineeId, day: str) -> Workout:
        entries = await self._run(self._entries, trainee.value)
        return Workout(day, tuple(e for e in entries if e.date == day))

    async def workouts(self, trainee: TraineeId, start: str, end: str) -> list[Workout]:
        entries = await self._run(self._entries, trainee.value)
        days: dict[str, list[WorkoutEntry]] = {}
        for e in entries:
            if start <= e.date <= end:
                days.setdefault(e.date, []).append(e)
        return [Workout(d, tuple(days[d])) for d in sorted(days)]

    def _set_rows(self, user: str) -> list[SetRow]:
        # 種目が消えていても、部位は種目の記録から引く（アプリの JOIN と同じ）。同期にまだない初期の種目は、初期の値から引く
        exercises = {e.id: _seed_values(e) for e in SEED_EXERCISES}
        for d in self.engine.docs_of_type(user, "exercise"):
            if d.own:
                exercises[d.own.entity_id] = {**exercises.get(d.own.entity_id, {}), **d.own.values}
        rows = []
        for entry in self._entries(user):
            exercise = exercises.get(entry.exercise_id)
            if exercise is None or "body_part_id" not in exercise:
                continue  # 種目がまだ届いていない（アプリの JOIN でも出ない）
            ratio = bodyweight.ratio_of(_exercise(entry.exercise_id, exercise)) \
                if REQUIRED["exercise"] <= exercise.keys() else None
            rows += [SetRow(entry.date, entry.exercise_id, exercise["body_part_id"], s.weight_kg, s.reps, ratio)
                     for s in entry.sets]
        return rows

    async def set_rows(self, trainee: TraineeId) -> list[SetRow]:
        return await self._run(self._set_rows, trainee.value)

    async def body_records(self, trainee: TraineeId) -> list[BodyRecord]:
        states = await self._run(self._alive, trainee.value, "body_record")
        return [BodyRecord(s.entity_id, s.values["date"], s.values["measured_at"], s.values.get("weight_kg"),
                           s.values.get("body_fat_pct"), s.values.get("muscle_pct"), s.values.get("waist_cm"),
                           s.values.get("memo", ""), s.values["source"], s.updated_at) for s in states]

    async def sleep_sessions(self, trainee: TraineeId) -> list[SleepSession]:
        states = await self._run(self._alive, trainee.value, "sleep_session")
        return [SleepSession(s.entity_id, s.values["date"], s.values["start_at"], s.values["end_at"],
                             s.values["asleep_min"], s.values["awake_min"]) for s in states]

    async def heart_rate_days(self, trainee: TraineeId) -> list[HeartRateDay]:
        states = await self._run(self._alive, trainee.value, "heart_rate_day")
        return [HeartRateDay(s.values["date"], s.values.get("resting_bpm"), s.values.get("avg_bpm"),
                             s.values.get("min_bpm"), s.values.get("max_bpm"), s.values["samples"]) for s in states]

    # --- 書き込み ---

    def _change(self, entity_type: str, entity_id: str, op: str, fields: dict | None = None) -> Change:
        # MCP の変更の時刻は、サーバーが受け付けた時刻（エンジンが received_at で切る）
        return Change(str(uuid.uuid4()), entity_type, entity_id, None, op, fields, self.engine.clock(), "mcp")

    def _upsert(self, entity_type: str, entity_id: str, state: EntityState | None, desired: dict) -> list[Change]:
        if state is None:
            return [self._change(entity_type, entity_id, "create", desired)]
        changes = [self._change(entity_type, entity_id, "restore")] if state.deleted else []
        diff = {k: v for k, v in desired.items() if state.values.get(k, _MISSING) != v}
        if diff:
            changes.append(self._change(entity_type, entity_id, "update", diff))
        return changes

    def _states(self, user: str, keys: set[tuple[str, str]]) -> dict[tuple[str, str], EntityState]:
        return {k: d.own for k, d in self.engine.docs(user, keys).items() if d.own is not None}

    def _write(self, user: str, changes: list[Change]) -> None:
        if changes:
            self.engine.append(user, changes)

    def _save_entries(self, user: str, entries: list[WorkoutEntry], deleted_set_ids: list[str],
                      deleted_entries: list[WorkoutEntry]) -> None:
        keys = {("workout_entry", e.id) for e in entries} | {("workout_set", s.id) for e in entries for s in e.sets}
        states = self._states(user, keys)
        changes: list[Change] = []
        for e in entries:
            changes += self._upsert("workout_entry", e.id, states.get(("workout_entry", e.id)),
                                    {"date": e.date, "exercise_id": e.exercise_id, "sort_order": e.sort_order})
            for s in e.sets:
                changes += self._upsert("workout_set", s.id, states.get(("workout_set", s.id)), {
                    "entry_id": e.id, "set_index": s.set_index, "weight_kg": s.weight_kg, "reps": s.reps,
                    "memo": s.memo, "done": s.done})
        changes += [self._change("workout_set", set_id, "delete") for set_id in deleted_set_ids]
        for e in deleted_entries:  # アプリの deleteEntry と同じく、種目とそのセットを消す
            changes.append(self._change("workout_entry", e.id, "delete"))
            changes += [self._change("workout_set", s.id, "delete") for s in e.sets]
        self._write(user, changes)

    async def save_entries(self, trainee: TraineeId, entries: list[WorkoutEntry], deleted_set_ids: list[str],
                           deleted_entries: list[WorkoutEntry]) -> None:
        await self._run(self._save_entries, trainee.value, entries, deleted_set_ids, deleted_entries)

    def _save_exercise(self, user: str, exercise: Exercise) -> None:
        state = self._states(user, {("exercise", exercise.id)}).get(("exercise", exercise.id))
        desired = {"body_part_id": exercise.body_part_id, "name": exercise.name,
                   "record_type": exercise.record_type.value, "sort_order": exercise.sort_order,
                   "hidden": exercise.hidden}
        if exercise.bodyweight_ratio is not None:  # 持っていない割合を null で書くと、アプリがまだ送っていない値に勝ってしまう
            desired["bodyweight_ratio"] = exercise.bodyweight_ratio
        seed = next((s for s in SEED_EXERCISES if s.id == exercise.id), None)
        if seed is None:
            self._write(user, self._upsert("exercise", exercise.id, state, desired))
            return
        # 初期の種目は、同期にまだ全部の項目がなくても、初期の値に同期の値を重ねたものと比べ、違う項目だけを送る。
        # 変えていない項目に今の時刻の値を書くと、アプリがまだ送っていない変更（例：隠した）より新しくなり、
        # 項目ごとの当てはめで負かしてしまうため
        current = {**_seed_values(seed), **(state.values if state else {})}
        diff = {k: v for k, v in desired.items() if current.get(k, _MISSING) != v}
        self._write(user, [self._change("exercise", exercise.id, "update", diff)] if diff else [])

    async def save_exercise(self, trainee: TraineeId, exercise: Exercise) -> None:
        await self._run(self._save_exercise, trainee.value, exercise)

    def _save_body_record(self, user: str, record: BodyRecord) -> None:
        state = self._states(user, {("body_record", record.id)}).get(("body_record", record.id))
        self._write(user, self._upsert("body_record", record.id, state, {
            "date": record.date, "measured_at": record.measured_at, "weight_kg": record.weight_kg,
            "body_fat_pct": record.body_fat_pct, "muscle_pct": record.muscle_pct, "waist_cm": record.waist_cm,
            "memo": record.memo, "source": record.source}))

    async def save_body_record(self, trainee: TraineeId, record: BodyRecord) -> None:
        await self._run(self._save_body_record, trainee.value, record)
