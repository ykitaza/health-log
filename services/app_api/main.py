"""スマホアプリ用の API の組み立て（DI）。Lambda のハンドラーは handler（cdk/lib/infra-stack.ts の AppApiFunction）。

同期の入口（sync）は、どのコンテキストのドメインも知らない。ここで、食事・筋トレ・レポートの種類を登録し（composition の create_registry）、
食事のルート（目標の案。体組成と設定は筋トレの読み取りと同期から読む）を足す。すべてのコンテキストを知っているのはこのファイルだけ。
Lambda Web Adapter は通さず、API Gateway のイベントを直接受け取る（オーソライザーが確かめたクレームを読むため）。
"""

import logging
import os
from datetime import date, datetime, timedelta, timezone

from composition.body_data import SyncedBodyData
from composition.registry import create_registry
from meals.application.goals import GoalService
from meals.infrastructure.subject_as_eater_id import SubjectAsEaterId
from meals.infrastructure.sync_repositories import SyncDayTypeRepository, SyncGoalRepository
from meals.presentation.app_routes import meal_routes
from sync.engine import SyncEngine
from sync.presentation.http_api import SyncHttpApi
from sync.store import DynamoDBSyncStore
from training.main import create_queries

logging.getLogger().setLevel(logging.INFO)

JST = timezone(timedelta(hours=9))


def today() -> date:
    """「今日」は日本時間で決める（Lambda の時計は UTC のため。MCP の services/mcp/main.py と同じ）。"""
    return datetime.now(JST).date()


def create_api(engine: SyncEngine, app_client_id: str, today=today) -> SyncHttpApi:
    goals = GoalService(SubjectAsEaterId(), SyncGoalRepository(engine), SyncDayTypeRepository(engine),
                        SyncedBodyData(engine, create_queries(engine)))
    return SyncHttpApi(engine, engine.registry, app_client_id, routes=meal_routes(goals, today))


_api: SyncHttpApi | None = None


def handler(event: dict, context) -> dict:
    global _api
    if _api is None:  # 最初の呼び出しで作る（テストで環境変数なしに import できるように）
        registry = create_registry()
        engine = SyncEngine(DynamoDBSyncStore(os.environ["MEALS_TABLE"], registry.index_key), registry)
        _api = create_api(engine, os.environ["APP_CLIENT_ID"])
    return _api.handle(event)
