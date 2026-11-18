"""組み立て（DI）。ことばの種類を WordsTable 用の同期に登録し、ユースケースを作る。

依存の向き：presentation → application → domain ← infrastructure。KARADA のコンテキストは import しない。
MCP の Lambda（services/words/mcp_main.py）とアプリ用の同期の Lambda（services/words/app_api.py）が使う。
"""

from datetime import datetime
from typing import Callable

from sync.engine import SyncEngine
from sync.store import DynamoDBSyncStore, InMemorySyncStore
from words.application.service import WordsService
from words.infrastructure.sync_entities import create_registry
from words.infrastructure.sync_repository import SyncWordsRepository

__all__ = ["create_engine", "create_registry", "create_service"]


def create_engine(table_name: str | None) -> SyncEngine:
    """WordsTable の同期。テーブル名がなければメモリーに置く（PC 用。止めると消える）。

    キーと LSI の名前は MealsTable と同じ（pk EATER#<sub>、sk SYNC#…、LSI by_day・day_key）なので、同期の部品はそのまま使える。
    ことばでは、並びのキー（day_key）に表現の normalized_key を入れる。
    """
    registry = create_registry()
    store = DynamoDBSyncStore(table_name, registry.index_key) if table_name else InMemorySyncStore(registry.index_key)
    return SyncEngine(store, registry)


def create_service(engine: SyncEngine, now: Callable[[], datetime]) -> WordsService:
    return WordsService(SyncWordsRepository(engine), now)
