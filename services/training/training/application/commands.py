"""筋トレの書き込みのユースケース（MCP のツールから呼ぶ）。本人は検証済みのトークンの sub で受け取る。

書き込みはリポジトリが変更の記録を通すので、アプリにも同期で降りる。
1回の呼び出しの変更は、まとめて1回で書く（30件を超えると、同期の仕組みが分けて書く）。
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, replace
from datetime import date, datetime, time, timezone
from typing import Callable

from training.domain import rules
from training.domain.catalog import Catalog, normalize
from training.domain.errors import NotFound, TrainingError
from training.domain.model import BodyRecord, Exercise, RecordType, TraineeId, Workout, WorkoutEntry, WorkoutSet
from training.domain.ports import TrainingRepository

MAX_EXERCISES = 30  # 1回で記録する種目の数
MAX_SETS = 50  # 1種目のセットの数


@dataclass(frozen=True)
class NewSet:
    weight_kg: float | None
    reps: int
    memo: str = ""


@dataclass(frozen=True)
class NewExerciseSets:
    exercise: str  # 種目の名前か ID
    sets: tuple[NewSet, ...]


@dataclass(frozen=True)
class SetChange:
    set_id: str
    weight_kg: float | None = None  # None は変えない
    reps: int | None = None
    memo: str | None = None


@dataclass(frozen=True)
class WorkoutChanges:
    sets: tuple[SetChange, ...] = ()
    remove_set_ids: tuple[str, ...] = ()
    remove_entry_ids: tuple[str, ...] = ()
    move_to: str | None = None  # その日の記録を、まるごと別の日に移す

    def empty(self) -> bool:
        return not (self.sets or self.remove_set_ids or self.remove_entry_ids or self.move_to)


def _timestamp(value: datetime) -> str:
    """アプリの toISOString() と同じ形（UTC、ミリ秒まで）。"""
    value = value.astimezone(timezone.utc)
    return value.strftime("%Y-%m-%dT%H:%M:%S.") + f"{value.microsecond // 1000:03d}Z"


def _exercise_of(catalog: Catalog, entry: WorkoutEntry) -> Exercise:
    found = catalog.exercise(entry.exercise_id)
    if found:
        return found
    # 種目を消したあとの記録：今の値から記録の仕方を決める
    kind = RecordType.WEIGHT_REPS if any(s.weight_kg is not None for s in entry.sets) else RecordType.REPS_ONLY
    return Exercise(entry.exercise_id, "", "この種目", kind, 0, True)


def _check_duplicate(part_name: str, name: str, same_part: list[Exercise]) -> None:
    """同じ部位に同じ名前（比べる形 normalize で同じ）の種目があれば断る。"""
    dup = next((e for e in same_part if normalize(e.name) == normalize(name)), None)
    if dup:
        hidden = "（隠している種目です。そのまま記録に使え、update_exercise で表示に戻せます）" if dup.hidden else ""
        raise TrainingError(f"{part_name}にはもう「{dup.name}」があります{hidden}")


class TrainingCommands:
    def __init__(self, repository: TrainingRepository, now: Callable[[], datetime],
                 new_id: Callable[[], str] = lambda: str(uuid.uuid4())):
        """now は利用者の暦の時刻（時差つき）。体組成を測った時刻に使う。"""
        self.repository, self.now, self.new_id = repository, now, new_id

    async def record_workout(self, subject: str, day: str, items: list[NewExerciseSets]) -> Workout:
        """その日に種目とセットを足す。同じ日に同じ種目があれば、そのセットの後ろに足す（アプリの1日1種目1行と同じ）。"""
        if not items:
            raise TrainingError("種目を1つ以上入れてください")
        if len(items) > MAX_EXERCISES:
            raise TrainingError(f"1回で記録できる種目は{MAX_EXERCISES}までです")
        trainee = TraineeId(subject)
        catalog = await self.repository.catalog(trainee)
        workout = await self.repository.workout(trainee, day)
        entries = {e.exercise_id: e for e in workout.entries}
        next_order = max((e.sort_order for e in workout.entries), default=-1) + 1
        touched: dict[str, WorkoutEntry] = {}
        for item in items:
            exercise = catalog.find_exercise(item.exercise)
            if not item.sets:
                raise TrainingError(f"{exercise.name}のセットを1つ以上入れてください")
            if len(item.sets) > MAX_SETS:
                raise TrainingError(f"1種目のセットは{MAX_SETS}までです")
            for s in item.sets:
                rules.check_set(exercise, s.weight_kg, s.reps, s.memo)
            entry = touched.get(exercise.id) or entries.get(exercise.id)
            if entry is None:
                entry = WorkoutEntry(self.new_id(), day, exercise.id, next_order)
                next_order += 1
            start = max((x.set_index for x in entry.sets), default=-1) + 1
            new_sets = tuple(WorkoutSet(self.new_id(), start + i, s.weight_kg, s.reps, s.memo.strip(), True)
                             for i, s in enumerate(item.sets))
            touched[exercise.id] = replace(entry, sets=entry.sets + new_sets)
        await self.repository.save_entries(trainee, list(touched.values()), [], [])
        return await self.repository.workout(trainee, day)

    async def update_workout(self, subject: str, day: str, changes: WorkoutChanges) -> Workout:
        """その日の記録を直す：セットの重量・回数・メモ、セットや種目を消す、日を移す。"""
        if changes.empty():
            raise TrainingError("直す内容を1つ以上入れてください")
        trainee = TraineeId(subject)
        workout = await self.repository.workout(trainee, day)
        if not workout.entries:
            raise NotFound(f"{day} の筋トレの記録はありません")
        catalog = await self.repository.catalog(trainee)
        entries = {e.id: e for e in workout.entries}
        set_owner = {s.id: e.id for e in workout.entries for s in e.sets}
        for set_id in [c.set_id for c in changes.sets] + list(changes.remove_set_ids):
            if set_id not in set_owner:
                raise NotFound(f"{day} の記録に、セット {set_id} はありません。get_workout で set_id を確かめてください")
        for entry_id in changes.remove_entry_ids:
            if entry_id not in entries:
                raise NotFound(f"{day} の記録に、種目 {entry_id} はありません。get_workout で entry_id を確かめてください")

        removed_entries = [entries[i] for i in dict.fromkeys(changes.remove_entry_ids)]
        removed_entry_ids = {e.id for e in removed_entries}
        removed_sets = [i for i in dict.fromkeys(changes.remove_set_ids) if set_owner[i] not in removed_entry_ids]
        by_set = {c.set_id: c for c in changes.sets}
        kept: list[WorkoutEntry] = []
        for entry in workout.entries:
            if entry.id in removed_entry_ids:
                continue
            exercise = _exercise_of(catalog, entry)
            sets = []
            for s in entry.sets:
                if s.id in removed_sets:
                    continue
                c = by_set.get(s.id)
                if c:
                    s = replace(s, weight_kg=s.weight_kg if c.weight_kg is None else c.weight_kg,
                                reps=s.reps if c.reps is None else c.reps,
                                memo=s.memo if c.memo is None else c.memo.strip())
                    rules.check_set(exercise, s.weight_kg, s.reps, s.memo)
                sets.append(s)
            if not sets:
                raise TrainingError(f"{exercise.name}の最後のセットは消せません。種目ごと消すときは remove_entry_ids に "
                                    f"entry_id（{entry.id}）を入れてください")
            # 消したあとは、アプリと同じく 0 から振り直す
            kept.append(replace(entry, sets=tuple(replace(s, set_index=i) for i, s in enumerate(sets))))

        to_day = changes.move_to or day
        if changes.move_to and changes.move_to != day:
            target = await self.repository.workout(trainee, changes.move_to)
            next_order = max((e.sort_order for e in target.entries), default=-1) + 1
            kept = [replace(e, date=changes.move_to, sort_order=next_order + i) for i, e in enumerate(kept)]
        await self.repository.save_entries(trainee, kept, removed_sets, removed_entries)
        return await self.repository.workout(trainee, to_day)

    async def delete_workout(self, subject: str, day: str, entry_ids: list[str] | None = None) -> list[str]:
        """その日の記録を消す（entry_ids を渡すと、その種目だけ）。消した entry_id を返す。"""
        trainee = TraineeId(subject)
        workout = await self.repository.workout(trainee, day)
        if not workout.entries:
            raise NotFound(f"{day} の筋トレの記録はありません")
        if entry_ids is None:
            targets = list(workout.entries)
        else:
            by_id = {e.id: e for e in workout.entries}
            missing = [i for i in entry_ids if i not in by_id]
            if missing or not entry_ids:
                raise NotFound(f"{day} の記録に、種目 {', '.join(missing) or '（空）'} はありません")
            targets = [by_id[i] for i in dict.fromkeys(entry_ids)]
        await self.repository.save_entries(trainee, [], [], targets)
        return [e.id for e in targets]

    async def add_exercise(self, subject: str, name: str, body_part: str, record_type: RecordType) -> Exercise:
        """種目を足す（アプリと同じく、同じ部位に同じ名前は作らない。並びはその部位の最後）。"""
        trainee = TraineeId(subject)
        catalog = await self.repository.catalog(trainee)
        part = catalog.find_body_part(body_part)
        name = rules.check_name("種目", name)
        same_part = [e for e in catalog.exercises if e.body_part_id == part.id]
        _check_duplicate(part.name, name, same_part)
        exercise = Exercise(self.new_id(), part.id, name, record_type,
                            max((e.sort_order for e in same_part), default=-1) + 1, False)
        await self.repository.save_exercise(trainee, exercise)
        return exercise

    async def update_exercise(self, subject: str, exercise: str, name: str | None = None,
                              body_part: str | None = None, hidden: bool | None = None) -> Exercise:
        """種目の名前・部位・非表示を変える（None は変えない）。記録は種目の ID でつながっているので、
        過去の記録もそのまま新しい名前と部位で出る。同じ部位に同じ名前は作らない（add_exercise と同じ）。
        部位を変えたときの並びは、新しい部位の最後。消すことはしない（過去の記録を残すため、代わりに隠す）。"""
        if name is None and body_part is None and hidden is None:
            raise TrainingError("変える内容（name・body_part・hidden）を1つ以上入れてください")
        trainee = TraineeId(subject)
        catalog = await self.repository.catalog(trainee)
        current = catalog.find_exercise(exercise)
        part = catalog.find_body_part(body_part) if body_part is not None else catalog.body_part(current.body_part_id)
        if part is None:
            raise NotFound(f"{current.name}の部位が見つかりません。body_part で部位を指定してください")
        new_name = rules.check_name("種目", name) if name is not None else current.name
        same_part = [e for e in catalog.exercises if e.body_part_id == part.id and e.id != current.id]
        _check_duplicate(part.name, new_name, same_part)
        sort_order = current.sort_order if part.id == current.body_part_id else \
            max((e.sort_order for e in same_part), default=-1) + 1
        updated = replace(current, name=new_name, body_part_id=part.id, sort_order=sort_order,
                          hidden=current.hidden if hidden is None else hidden)
        await self.repository.save_exercise(trainee, updated)
        return updated

    async def record_body(self, subject: str, day: str, values: dict[str, float | None], memo: str | None) -> None:
        """体組成を手入力で記録する。アプリ（db/repositories/body.ts の saveManual）と同じく、その日の手入力の記録が
        あれば渡した項目だけを書き換え、なければ作る（測った時刻は、今日なら今、ほかの日はその日の正午）。"""
        rules.check_body(values, memo)
        trainee = TraineeId(subject)
        given = {k: v for k, v in values.items() if v is not None}
        manual = [r for r in await self.repository.body_records(trainee) if r.source == "manual" and r.date == day]
        if manual:
            latest = max(manual, key=lambda r: r.measured_at)
            record = replace(latest, **given, **({"memo": memo.strip()} if memo is not None else {}))
        else:
            now = self.now()
            d = date.fromisoformat(day)
            measured = now if now.date() == d else datetime.combine(d, time(12), tzinfo=now.tzinfo)
            record = BodyRecord(self.new_id(), day, _timestamp(measured), given.get("weight_kg"),
                                given.get("body_fat_pct"), given.get("muscle_pct"), given.get("waist_cm"),
                                (memo or "").strip(), "manual", "")
        await self.repository.save_body_record(trainee, record)
