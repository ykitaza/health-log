"""ポート：筋トレのドメインが外に求める働き。実装は infrastructure/ に置く。どれも本人（TraineeId）の分だけを読み書きする。"""

from __future__ import annotations

from typing import Protocol

from training.domain.catalog import Catalog
from training.domain.injury import Injury, InjuryReview
from training.domain.phase import Phase
from training.domain.model import (
    BodyPart,
    BodyRecord,
    Exercise,
    HeartRateDay,
    SetRow,
    SleepSession,
    StepDay,
    TraineeId,
    Workout,
    WorkoutEntry,
)


class TrainingRepository(Protocol):
    async def body_parts(self, trainee: TraineeId) -> list[BodyPart]: ...

    async def exercises(self, trainee: TraineeId) -> list[Exercise]: ...

    async def catalog(self, trainee: TraineeId) -> Catalog:
        """初期の部位と種目に、同期された記録を重ねたもの（消したものは含めない。隠したものは含める）。"""
        ...

    async def workout(self, trainee: TraineeId, day: str) -> Workout:
        """その日のトレーニング（消した種目とセットは含めない）。"""
        ...

    async def workouts(self, trainee: TraineeId, start: str, end: str) -> list[Workout]:
        """start から end まで（両端を含む）の、記録がある日のトレーニング（日付の順）。"""
        ...

    async def set_rows(self, trainee: TraineeId) -> list[SetRow]:
        """集計に使うすべてのセット（消したセットと、消した日の種目のセットは含めない。日付・並び順の順）。"""
        ...

    async def body_records(self, trainee: TraineeId) -> list[BodyRecord]: ...

    async def sleep_sessions(self, trainee: TraineeId) -> list[SleepSession]:
        """消していない睡眠（Health Connect の取り込み）。"""
        ...

    async def heart_rate_days(self, trainee: TraineeId) -> list[HeartRateDay]:
        """消していない心拍の日のまとめ（Health Connect の取り込み）。"""
        ...

    async def step_days(self, trainee: TraineeId) -> list[StepDay]:
        """消していない歩数の日の合計（Health Connect の取り込み）。"""
        ...

    async def phases(self, trainee: TraineeId) -> list[Phase]:
        """消していないフェーズ（並びは決めない）。アプリだけが書くので、書き込みはない。"""
        ...

    # --- 書き込み（変更の記録を通す。アプリに同期で降りる） ---

    async def save_entries(self, trainee: TraineeId, entries: list[WorkoutEntry], deleted_set_ids: list[str],
                           deleted_entries: list[WorkoutEntry]) -> None:
        """まとめて書く。entries はその種目と entry.sets のセットを保存する（今の状態と違う項目だけ）。
        entry.sets にないセットは変えない。消すセットは deleted_set_ids、種目ごと消すもの（セットも消す）は deleted_entries。
        """
        ...

    async def save_exercise(self, trainee: TraineeId, exercise: Exercise) -> None: ...

    async def save_body_record(self, trainee: TraineeId, record: BodyRecord) -> None: ...

    async def injuries(self, trainee: TraineeId) -> list[Injury]:
        """消していないケガ（並びは決めない）。"""
        ...

    async def injury_reviews(self, trainee: TraineeId) -> list[InjuryReview]:
        """消していない振り返りのうち、消していないケガのもの（並びは決めない）。"""
        ...

    async def save_injury(self, trainee: TraineeId, injury: Injury) -> None:
        """ケガを書く（新しければ作る。あれば今の状態と違う項目だけ）。"""
        ...

    async def save_injury_review(self, trainee: TraineeId, review: InjuryReview) -> None: ...

    async def delete_injury(self, trainee: TraineeId, injury_id: str, review_ids: list[str]) -> None:
        """ケガを消し、その振り返り（review_ids）も消す。"""
        ...
