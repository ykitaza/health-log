"""組み立て（DI）。設定を読み、アダプターを差し込んで、MCP サーバーのアプリを作る。

依存の向き：presentation → application → domain ← infrastructure。すべての層を知っているのはこのファイルだけ。
"""

import logging
from datetime import date, datetime, timedelta, timezone

from application.goals import GoalService
from application.meals import MealService
from application.summaries import SummaryService
from application.templates import TemplateService
from application.weights import WeightService
from infrastructure import dynamodb_repositories as dynamo
from infrastructure import memory_repositories as memory
from infrastructure import sync_repositories as synced
from infrastructure.access_token_verifier import AuthzApiTokenVerifier
from infrastructure.authz_session import AuthzApiSession
from infrastructure.settings import load_settings
from infrastructure.subject_as_eater_id import SubjectAsEaterId
from presentation.mcp_server import Services, create_mcp_server
from presentation.icons import IconMiddleware
from presentation.request_log import JsonRpcLogMiddleware
from sync.engine import SyncEngine
from sync.store import DynamoDBSyncStore, InMemorySyncStore

JST = timezone(timedelta(hours=9))


def today() -> date:
    """「今日」は日本時間で決める（Lambda の時計は UTC のため）。"""
    return datetime.now(JST).date()


settings = load_settings()
# 食事・いつもの・目標・日の種類は、同期の仕組み（変更の記録と今の状態）で読み書きする。アプリと同じものが見える。
# 体重は、体組成に一本化するまで今のまま
if settings.table_name:
    engine = SyncEngine(DynamoDBSyncStore(settings.table_name))
    weights = dynamo.DynamoDBWeightRepository(settings.table_name)
else:
    engine = SyncEngine(InMemorySyncStore())
    weights = memory.InMemoryWeightRepository()
meals = synced.SyncMealRepository(engine)
templates = synced.SyncMealTemplateRepository(engine)
goals = synced.SyncGoalRepository(engine)
day_types = synced.SyncDayTypeRepository(engine)

eaters = SubjectAsEaterId()
mcp = create_mcp_server(
    services=Services(
        meals=MealService(eaters, meals),
        templates=TemplateService(eaters, meals, templates),
        goals=GoalService(eaters, goals, day_types),
        summaries=SummaryService(eaters, meals, goals, day_types),
        weights=WeightService(eaters, weights, goals),
    ),
    token_verifier=AuthzApiTokenVerifier(settings.trusted_issuer, settings.resource_url),
    trusted_issuer=settings.trusted_issuer,
    resource_url=settings.resource_url,
    today=today,
    session=AuthzApiSession(settings.trusted_issuer),
)

# PC では 127.0.0.1 で待ち受ける（SDK が DNS リバインディング対策を自動で入れる）。
# Lambda では、外から届くように 0.0.0.0 で待ち受ける
HOST = "0.0.0.0" if settings.on_lambda else "127.0.0.1"
# ステートレスで、応答は SSE ではなく JSON にする（Lambda は応答をまとめて返すため）
app = mcp.streamable_http_app(streamable_http_path="/mcp", stateless_http=True, json_response=True, host=HOST)
app = JsonRpcLogMiddleware(app)  # 診断用：どのツール・リソースが呼ばれたかをログに出す
app = IconMiddleware(app)  # コネクタのアイコン（/favicon.ico など）
logging.getLogger("meals.requests").setLevel(logging.INFO)

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=HOST, port=8001)
