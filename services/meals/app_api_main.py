"""アプリ用の API の組み立て（DI）。Lambda のハンドラーは handler。

MCP の Lambda（main.py）とは別の関数にする。Lambda Web Adapter は通さず、API Gateway のイベントを直接受け取る
（オーソライザーが確かめたクレームを、イベントの requestContext から読むため）。
"""

import logging
import os

from application.goals import GoalService
from infrastructure.subject_as_eater_id import SubjectAsEaterId
from infrastructure.sync_repositories import SyncDayTypeRepository, SyncGoalRepository
from presentation.app_api import AppApi
from sync.engine import SyncEngine
from sync.store import DynamoDBSyncStore

logging.getLogger().setLevel(logging.INFO)

engine = SyncEngine(DynamoDBSyncStore(os.environ["MEALS_TABLE"]))
api = AppApi(
    engine,
    GoalService(SubjectAsEaterId(), SyncGoalRepository(engine), SyncDayTypeRepository(engine)),
    app_client_id=os.environ["APP_CLIENT_ID"],
)


def handler(event: dict, context) -> dict:
    return api.handle(event)
