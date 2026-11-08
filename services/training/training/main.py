"""組み立て（DI）。筋トレの対象を同期に登録し、ユースケースを作る。

依存の向き：presentation → application → domain ← infrastructure。
アプリ用の API の組み立て（services/app_api/main.py）は登録だけを、MCP の組み立て（services/mcp/main.py）は
ユースケースとツールの登録（training.presentation.mcp_tools）を使う。
"""

from datetime import datetime
from typing import Callable

from sync.engine import SyncEngine
from training.application.commands import TrainingCommands
from training.application.queries import TrainingQueries
from training.infrastructure.sync_entities import register as register_sync_entities
from training.infrastructure.sync_repository import SyncTrainingRepository

__all__ = ["create_commands", "create_queries", "register_sync_entities"]


def create_queries(engine: SyncEngine) -> TrainingQueries:
    return TrainingQueries(SyncTrainingRepository(engine))


def create_commands(engine: SyncEngine, now: Callable[[], datetime]) -> TrainingCommands:
    return TrainingCommands(SyncTrainingRepository(engine), now)
