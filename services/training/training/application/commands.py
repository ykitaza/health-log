"""筋トレの書き込みのユースケース（MCP のツールから呼ぶ）。本人は検証済みのトークンの sub で受け取る。

書き込みはリポジトリが変更の記録を通すので、アプリにも同期で降りる。
1回の呼び出しの変更は、まとめて1回で書く（30件を超えると、同期の仕組みが分けて書く）。
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, replace
from datetime import date, datetime, time, timezone
from typing import Callable

from training.domain import bodyweight, rules
from training.domain.catalog import Catalog, normalize
from training.domain.errors import NotFound, TrainingError
from training.domain.injury import (
    MAX_INJURIES,
    MAX_REVIEWS_PER_INJURY,
    SITES,
    Injury,
    InjuryReview,
    check_injury,
    check_review,
)
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


@dataclass(frozen=True)
class NewInjury:
    occurred_on: str
    site: str
    side: str | None = None
    exercise: str | None = None  # 種目の名前か ID
    phase: str = ""
    symptom: str = ""
    cause: str = ""
    fix: str = ""


@dataclass(frozen=True)
class InjuryChanges:
    """None は変えない。文字は空にすると消す。exercise は空の文字で種目を外す。"""

    occurred_on: str | None = None
    site: str | None = None
    side: str | None = None
    exercise: str | None = None
    phase: str | None = None
    symptom: str | None = None
    cause: str | None = None
    fix: str | None = None
    reopen: bool = False  # 直している途中に戻す（直せた日を消す）

    def empty(self) -> bool:
        return not self.reopen and all(getattr(self, k) is None for k in (
            "occurred_on", "site", "side", "exercise", "phase", "symptom", "cause", "fix"))


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

    async def add_exercise(self, subject: str, name: str, body_part: str, record_type: RecordType,
                           bodyweight_ratio: float | None = None) -> Exercise:
        """種目を足す（アプリと同じく、同じ部位に同じ名前は作らない。並びはその部位の最後）。
        回数だけの種目の割合は、省くと名前から決める（アプリの種目の追加と同じ初期値）。重量×回数の種目は持たない。"""
        trainee = TraineeId(subject)
        catalog = await self.repository.catalog(trainee)
        part = catalog.find_body_part(body_part)
        name = rules.check_name("種目", name)
        same_part = [e for e in catalog.exercises if e.body_part_id == part.id]
        _check_duplicate(part.name, name, same_part)
        ratio = rules.check_ratio(record_type, bodyweight_ratio)
        if record_type == RecordType.REPS_ONLY and ratio is None:
            ratio = bodyweight.default_ratio(name)
        exercise = Exercise(self.new_id(), part.id, name, record_type,
                            max((e.sort_order for e in same_part), default=-1) + 1, False, ratio)
        await self.repository.save_exercise(trainee, exercise)
        return exercise

    async def update_exercise(self, subject: str, exercise: str, name: str | None = None,
                              body_part: str | None = None, hidden: bool | None = None,
                              bodyweight_ratio: float | None = None) -> Exercise:
        """種目の名前・部位・非表示を変える（None は変えない）。記録は種目の ID でつながっているので、
        過去の記録もそのまま新しい名前と部位で出る。同じ部位に同じ名前は作らない（add_exercise と同じ）。
        部位を変えたときの並びは、新しい部位の最後。消すことはしない（過去の記録を残すため、代わりに隠す）。"""
        if name is None and body_part is None and hidden is None and bodyweight_ratio is None:
            raise TrainingError("変える内容（name・body_part・hidden・bodyweight_ratio）を1つ以上入れてください")
        trainee = TraineeId(subject)
        catalog = await self.repository.catalog(trainee)
        current = catalog.find_exercise(exercise)
        ratio = rules.check_ratio(current.record_type, bodyweight_ratio)
        part = catalog.find_body_part(body_part) if body_part is not None else catalog.body_part(current.body_part_id)
        if part is None:
            raise NotFound(f"{current.name}の部位が見つかりません。body_part で部位を指定してください")
        new_name = rules.check_name("種目", name) if name is not None else current.name
        same_part = [e for e in catalog.exercises if e.body_part_id == part.id and e.id != current.id]
        _check_duplicate(part.name, new_name, same_part)
        sort_order = current.sort_order if part.id == current.body_part_id else \
            max((e.sort_order for e in same_part), default=-1) + 1
        updated = replace(current, name=new_name, body_part_id=part.id, sort_order=sort_order,
                          hidden=current.hidden if hidden is None else hidden,
                          bodyweight_ratio=current.bodyweight_ratio if ratio is None else ratio)
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
                                given.get("body_fat_pct"), (memo or "").strip(), "manual", "")
        await self.repository.save_body_record(trainee, record)

    # --- ケガの記録 ---

    async def _injury(self, trainee: TraineeId, injury_id: str) -> Injury:
        found = next((i for i in await self.repository.injuries(trainee) if i.id == injury_id), None)
        if found is None:
            raise NotFound(f"ケガの記録 {injury_id} はありません。list_injuries で injury_id を確かめてください")
        return found

    async def _exercise_id(self, trainee: TraineeId, exercise: str | None) -> str | None:
        """種目の名前か ID から ID を決める（名前は完全一致だけ。見つからなければ候補を添えて断る）。"""
        if exercise is None or not exercise.strip():
            return None
        return (await self.repository.catalog(trainee)).find_exercise(exercise).id

    async def record_injury(self, subject: str, new: NewInjury) -> Injury:
        """ケガを記録する（直している途中として）。原因と直し方は、渡された言葉をそのまま持つ。"""
        trainee = TraineeId(subject)
        if len(await self.repository.injuries(trainee)) >= MAX_INJURIES:
            raise TrainingError(f"ケガの記録は{MAX_INJURIES}件までです。直せた古い記録を delete_injury で消してから記録してください")
        injury = check_injury(Injury(
            self.new_id(), new.occurred_on, new.site, new.side, await self._exercise_id(trainee, new.exercise),
            new.phase, new.symptom, new.cause, new.fix, "fixing", None))
        await self.repository.save_injury(trainee, injury)
        return await self._injury(trainee, injury.id)

    async def update_injury(self, subject: str, injury_id: str, changes: InjuryChanges) -> Injury:
        """ケガの記録を書き直す（渡した項目だけ）。部位を左右のない部位に変えると、左右は外す。"""
        if changes.empty():
            raise TrainingError("直す内容を1つ以上入れてください")
        trainee = TraineeId(subject)
        current = await self._injury(trainee, injury_id)
        site = changes.site if changes.site is not None else current.site
        if changes.side is not None:
            side = changes.side
        else:
            side = current.side if site in SITES and SITES[site].sided else None
        exercise_id = current.exercise_id if changes.exercise is None else \
            await self._exercise_id(trainee, changes.exercise)

        def text(new: str | None, old: str) -> str:
            return old if new is None else new

        status, fixed_on = ("fixing", None) if changes.reopen else (current.status, current.fixed_on)
        updated = check_injury(replace(
            current, occurred_on=changes.occurred_on or current.occurred_on, site=site, side=side,
            exercise_id=exercise_id, phase=text(changes.phase, current.phase),
            symptom=text(changes.symptom, current.symptom), cause=text(changes.cause, current.cause),
            fix=text(changes.fix, current.fix), status=status, fixed_on=fixed_on))
        await self.repository.save_injury(trainee, updated)
        return await self._injury(trainee, injury_id)

    async def mark_injury_fixed(self, subject: str, injury_id: str, fixed_on: str) -> Injury:
        """直せたにする（直せた日を入れる）。もう直せたにしてあれば、直せた日を書き換える。"""
        trainee = TraineeId(subject)
        current = await self._injury(trainee, injury_id)
        updated = check_injury(replace(current, status="fixed", fixed_on=fixed_on))
        await self.repository.save_injury(trainee, updated)
        return await self._injury(trainee, injury_id)

    async def add_injury_review(self, subject: str, injury_id: str, day: str, result: str, note: str = "",
                                exercise: str | None = None) -> InjuryReview:
        """振り返りを足す。結果が「直せた」でも、ケガの状態は変えない（直せたにするのは mark_injury_fixed）。"""
        trainee = TraineeId(subject)
        await self._injury(trainee, injury_id)
        reviews = [r for r in await self.repository.injury_reviews(trainee) if r.injury_id == injury_id]
        if len(reviews) >= MAX_REVIEWS_PER_INJURY:
            raise TrainingError(f"振り返りはケガ1件に{MAX_REVIEWS_PER_INJURY}件までです")
        review = check_review(InjuryReview(self.new_id(), injury_id, day, result, note,
                                           await self._exercise_id(trainee, exercise)))
        await self.repository.save_injury_review(trainee, review)
        return review

    async def delete_injury(self, subject: str, injury_id: str) -> int:
        """ケガを消す。振り返りも一緒に消す。消した振り返りの数を返す。"""
        trainee = TraineeId(subject)
        await self._injury(trainee, injury_id)
        review_ids = [r.id for r in await self.repository.injury_reviews(trainee) if r.injury_id == injury_id]
        await self.repository.delete_injury(trainee, injury_id, review_ids)
        return len(review_ids)
