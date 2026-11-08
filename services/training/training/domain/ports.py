"""ポート：筋トレのドメインが外に求める働き。実装は infrastructure/ に置く。どれも本人（TraineeId）の分だけを読む。"""

from __future__ import annotations

from typing import Protocol

from training.domain.model import BodyPart, BodyRecord, Exercise, SetRow, TraineeId, Workout


class TrainingRepository(Protocol):
    async def body_parts(self, trainee: TraineeId) -> list[BodyPart]: ...

    async def exercises(self, trainee: TraineeId) -> list[Exercise]: ...

    async def workout(self, trainee: TraineeId, day: str) -> Workout:
        """その日のトレーニング（消した種目とセットは含めない）。"""
        ...

    async def set_rows(self, trainee: TraineeId) -> list[SetRow]:
        """集計に使うすべてのセット（消したセットと、消した日の種目のセットは含めない。日付・並び順の順）。"""
        ...

    async def body_records(self, trainee: TraineeId) -> list[BodyRecord]: ...
