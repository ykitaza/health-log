"""コンテキストをまたぐポートの実装。MCP の組み立ての場所（services/mcp/main.py）が使う。

- アプリの最後の同期の時刻：食事と筋トレの AppSyncStatus（同期の仕組みから読む）
- 筋トレの日：食事の TrainingDayProvider（筋トレの読み取りから求める）
- 体重：食事の WeightRepository（筋トレの体組成を読み書きする）
- フェーズの期間：レポートの PhasePeriods（筋トレのフェーズから求める）
"""

from datetime import date, datetime

import anyio

from composition.clock import JST
from meals.domain.body_weight import WeightRecord
from meals.domain.values import EaterId
from sync.engine import SyncEngine
from training.application.commands import TrainingCommands
from training.application.queries import TrainingQueries
from training.domain import phase as phase_rules


class EngineAppSyncStatus:
    """アプリの最後の同期の時刻（食事と筋トレの AppSyncStatus の実装）。同期の仕組みから読み、日本時間で返す。"""

    def __init__(self, engine: SyncEngine):
        self.engine = engine

    async def last_app_sync_at(self, subject: str) -> str | None:
        at = await anyio.to_thread.run_sync(self.engine.last_app_received_at, subject)
        if at is None:
            return None
        return datetime.fromisoformat(at.replace("Z", "+00:00")).astimezone(JST).isoformat(timespec="seconds")


class WorkoutTrainingDays:
    """食事の TrainingDayProvider の実装。筋トレのセットの記録がある日を、筋トレの読み取りから求める。

    食べた人（EaterId）も筋トレをする人（TraineeId）も、Cognito の sub そのもの（SubjectAsEaterId）。
    """

    def __init__(self, queries: TrainingQueries):
        self.queries = queries

    async def training_days(self, eater_id: EaterId, start: date, end: date) -> set[date]:
        days = await self.queries.training_dates(eater_id.value, start.isoformat(), end.isoformat())
        return {date.fromisoformat(d) for d in days}


class TrainingPhasePeriods:
    """レポートの PhasePeriods の実装。フェーズの振り返りの期間（開始日〜続いた最後の日。実施中なら今日まで）を、筋トレのフェーズから求める。"""

    def __init__(self, queries: TrainingQueries, today):
        self.queries, self.today = queries, today

    async def phase_period(self, subject: str, phase_id: str) -> dict | None:
        phases = await self.queries.phases(subject)
        p = next((x for x in phases if x.id == phase_id), None)
        if p is None:
            return None
        as_of = self.today().isoformat()
        return {"kind": p.kind, "start_date": p.start_date,
                "end_date": max(p.start_date, min(phase_rules.end_of(p, phases, as_of), as_of))}


class BodyRecordWeights:
    """食事の WeightRepository の実装。体重は筋トレの体組成（body_record）に一本化していて、そこを読み書きする。

    書くとき（record_weight）は、体組成の手入力（record_body）と同じく、その日の手入力の記録の体重だけを書き換える
    （なければ作る）。読むときは、体組成の日ごとの値（その日の手入力のいちばん新しい記録。手入力がなければ Health Connect の取り込み）の体重。
    """

    def __init__(self, commands: TrainingCommands, queries: TrainingQueries):
        self.commands, self.queries = commands, queries

    async def save(self, record: WeightRecord) -> None:
        await self.commands.record_body(record.eater_id.value, record.day.isoformat(), {"weight_kg": record.kg}, None)

    async def find(self, eater_id: EaterId, start: date, end: date) -> list[WeightRecord]:
        days = await self.queries.daily_body(eater_id.value)
        return [WeightRecord(eater_id, date.fromisoformat(d.date), d.weight_kg) for d in days
                if start.isoformat() <= d.date <= end.isoformat() and d.weight_kg is not None]
