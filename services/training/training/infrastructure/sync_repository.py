"""リポジトリの実装（同期の仕組みの上）。アプリから同期された今の状態を読む。

消したもの（deleted）と、項目がまだそろっていないもの（子が親より先に届いたときなど）は読まない。
集計の行は、アプリ（db/repositories/workouts.ts の allSetRows）と同じく、消したセットと消した日の種目を除き、
種目が消えていても含める（過去の負荷量が変わらないように）。並びは日付・その日の順・セットの順。
"""

from __future__ import annotations

from functools import partial

import anyio

from sync.engine import SyncEngine
from sync.model import EntityState
from training.domain.model import (
    BodyPart,
    BodyRecord,
    Exercise,
    RecordType,
    SetRow,
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
}


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
        found = [Exercise(s.entity_id, s.values["body_part_id"], s.values["name"], RecordType(s.values["record_type"]),
                          s.values["sort_order"], s.values["hidden"]) for s in states]
        return sorted(found, key=lambda e: (e.sort_order, e.id))

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

    def _set_rows(self, user: str) -> list[SetRow]:
        # 種目が消えていても、部位は種目の記録から引く（アプリの JOIN と同じ）
        exercises = {d.own.entity_id: d.own.values for d in self.engine.docs_of_type(user, "exercise") if d.own}
        rows = []
        for entry in self._entries(user):
            exercise = exercises.get(entry.exercise_id)
            if exercise is None or "body_part_id" not in exercise:
                continue  # 種目がまだ届いていない（アプリの JOIN でも出ない）
            rows += [SetRow(entry.date, entry.exercise_id, exercise["body_part_id"], s.weight_kg, s.reps)
                     for s in entry.sets]
        return rows

    async def set_rows(self, trainee: TraineeId) -> list[SetRow]:
        return await self._run(self._set_rows, trainee.value)

    async def body_records(self, trainee: TraineeId) -> list[BodyRecord]:
        states = await self._run(self._alive, trainee.value, "body_record")
        return [BodyRecord(s.entity_id, s.values["date"], s.values["measured_at"], s.values.get("weight_kg"),
                           s.values.get("body_fat_pct"), s.values.get("muscle_pct"), s.values.get("waist_cm"),
                           s.values.get("memo", ""), s.values["source"], s.updated_at) for s in states]
