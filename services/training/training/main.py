"""組み立て（DI）。筋トレの対象を同期に登録し、ユースケースを作る。

依存の向き：presentation → application → domain ← infrastructure。すべての層を知っているのはこのファイルだけ。
今はアプリ用の API の組み立て（services/app_api/main.py）から使う。MCP のツールを足すときは、ここで presentation も組み立てる。
"""

from training.application.queries import TrainingQueries
from training.infrastructure.sync_entities import register as register_sync_entities
from training.infrastructure.sync_repository import SyncTrainingRepository
from sync.engine import SyncEngine

__all__ = ["create_queries", "register_sync_entities"]


def create_queries(engine: SyncEngine) -> TrainingQueries:
    return TrainingQueries(SyncTrainingRepository(engine))
