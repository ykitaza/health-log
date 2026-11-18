"""ことばのアプリ用の API（同期）の組み立て。Lambda のハンドラーは handler（cdk/lib/words-stack.ts の WordsAppApiFunction）。

同期の入口（sync の SyncHttpApi）をそのまま使い、ことばの種類だけを登録した Registry と WordsTable で動かす。
ルートは KARADA と同じ形（POST・GET /v1/sync/changes、GET /v1/sync/snapshot）。仕様は docs/api/words-app-api.yaml。
ログインは KARADA と共通：クライアントは torelog-app、scope は torelog-api/training.read・training.write。
Lambda Web Adapter は通さず、API Gateway のイベントを直接受け取る（オーソライザーが確かめたクレームを読むため）。
"""

import logging
import os

from sync.engine import SyncEngine
from sync.presentation.http_api import SyncHttpApi
from words.main import create_engine

logging.getLogger().setLevel(logging.INFO)


def create_api(engine: SyncEngine, app_client_id: str) -> SyncHttpApi:
    return SyncHttpApi(engine, engine.registry, app_client_id)


_api: SyncHttpApi | None = None


def handler(event: dict, context) -> dict:
    global _api
    if _api is None:  # 最初の呼び出しで作る（テストで環境変数なしに import できるように）
        _api = create_api(create_engine(os.environ["WORDS_TABLE"]), os.environ["APP_CLIENT_ID"])
    return _api.handle(event)
