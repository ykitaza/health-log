"""スマホアプリ用の API の組み立て（DI）。Lambda のハンドラーは handler（cdk/lib/infra-stack.ts の AppApiFunction）。

同期の入口（sync）は、どのコンテキストのドメインも知らない。ここで、食事・筋トレ・レポートの種類を登録し（composition の create_registry）、
食事のルート（目標の案）を足す。すべてのコンテキストを知っているのはこのファイルだけ。
Lambda Web Adapter は通さず、API Gateway のイベントを直接受け取る（オーソライザーが確かめたクレームを読むため）。
"""

import logging
import os

from composition.registry import create_registry
from meals.application.goals import GoalService
from meals.infrastructure.subject_as_eater_id import SubjectAsEaterId
from meals.infrastructure.sync_repositories import SyncDayTypeRepository, SyncGoalRepository
from meals.presentation.app_routes import meal_routes
from sync.engine import SyncEngine
from sync.presentation.http_api import SyncHttpApi
from sync.store import DynamoDBSyncStore

logging.getLogger().setLevel(logging.INFO)


def create_api(engine: SyncEngine, app_client_id: str) -> SyncHttpApi:
    goals = GoalService(SubjectAsEaterId(), SyncGoalRepository(engine), SyncDayTypeRepository(engine))
    return SyncHttpApi(engine, engine.registry, app_client_id, routes=meal_routes(goals))


_api: SyncHttpApi | None = None


def handler(event: dict, context) -> dict:
    global _api
    if _api is None:  # 最初の呼び出しで作る（テストで環境変数なしに import できるように）
        registry = create_registry()
        engine = SyncEngine(DynamoDBSyncStore(os.environ["MEALS_TABLE"], registry.index_key), registry)
        _api = create_api(engine, os.environ["APP_CLIENT_ID"])
    return _api.handle(event)
