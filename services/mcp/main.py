"""MCP サーバーの組み立て（DI）。食事・筋トレ・レポートのツールを、1つの MCP サーバー（1つのコネクタ）に登録する。

ツールの中身は、それぞれのコンテキストが持つ（食事は services/meals/meals/presentation/mcp_server.py、
筋トレは services/training/training/presentation/mcp_tools.py、
レポートは services/reports/reports/presentation/mcp_tools.py）。ここでは次のことだけをする。
- サーバー（MCPServer）と認証（アクセストークンの検証、scope）を作る。MCP のプロトコルは公式の SDK に任せる
- 食事と筋トレのリポジトリを、同じ同期の仕組み（変更の記録と今の状態）の上に作る
- コンテキストをまたぐもの（食事の目標の「筋トレの日」、食事の目標体重までの進み具合に使う体重、目標の自動計算に使う体組成と設定、
  アプリの最後の同期の時刻）を、
  各コンテキストのポートにつなぐ（実装は services/composition/composition/adapters.py と body_data.py）
- 期間の材料を1回で読むツール（period_overview。connector/period_overview.py）に、筋トレ・食事の読み取りと設定をつなぐ
食事と筋トレは互いを import しない。すべてを知っているのはこのファイルだけ（アプリ用の API の services/app_api/main.py と同じ）。
"""

import logging
from datetime import datetime

from mcp.server.auth.provider import TokenVerifier
from mcp.server.auth.routes import create_protected_resource_routes
from mcp.server.auth.settings import AuthSettings
from mcp.server.mcpserver import MCPServer

from composition.adapters import BodyRecordWeights, EngineAppSyncStatus, TrainingPhasePeriods, WorkoutTrainingDays
from composition.body_data import SyncedBodyData
from composition.clock import JST, today
from composition.registry import create_registry
from connector.access_token_verifier import AuthzApiTokenVerifier
from connector.authz_session import AuthzApiSession
from connector.icons import IconMiddleware, server_icons
from connector.period_overview import register_overview_tools
from connector.request_log import JsonRpcLogMiddleware
from connector.settings import load_settings
from connector.tools import Session, register_connector_tools
from meals.application.goals import GoalService
from meals.application.meals import MealService
from meals.application.summaries import SummaryService
from meals.application.templates import TemplateService
from meals.application.weights import WeightService
from meals.infrastructure import sync_repositories as synced
from meals.infrastructure.subject_as_eater_id import SubjectAsEaterId
from meals.presentation import mcp_server as meal_tools
from reports.main import create_service as create_report_service
from reports.presentation import mcp_tools as report_tools
from sync.engine import SyncEngine
from sync.store import DynamoDBSyncStore, InMemorySyncStore
from training.main import create_commands, create_queries
from training.presentation import mcp_tools as training_tools

# 接続（HTTP）のところで必須にする scope は、食事の2つだけ（今のコネクタのトークンのまま使えるように）。
# 筋トレの scope は、筋トレのツールが1つずつ確かめる。
# RFC 9728 の scopes_supported には4つとも並べる。クライアントはこれを見て scope を求めるので、
# つなぎ直すと筋トレの scope も同意画面に出る
REQUIRED_SCOPES = [meal_tools.READ_SCOPE, meal_tools.WRITE_SCOPE]
SUPPORTED_SCOPES = REQUIRED_SCOPES + [training_tools.READ_SCOPE, training_tools.WRITE_SCOPE]

INSTRUCTIONS = f"""食事と筋トレを記録するサーバー。食事のツールと筋トレのツールがある。
結果の last_app_sync_at は、スマホのアプリ（KARADA）から最後に同期で受け付けた時刻（日本時間）。null ならまだアプリから同期していない。
アプリで記録した分は、同期するまでここに見えない。記録が足りないように見えるとき（とくに last_app_sync_at より後にアプリで記録したと言われたとき）は、
アプリを開いて同期してもらうよう伝える。

# 食事
{meal_tools.INSTRUCTIONS}

# 筋トレ
{training_tools.INSTRUCTIONS}

# レポート
{report_tools.INSTRUCTIONS}"""


def now() -> datetime:
    return datetime.now(JST)


def create_server(
    engine: SyncEngine,
    token_verifier: TokenVerifier,
    trusted_issuer: str,
    resource_url: str,
    session: Session,
    today=today,
    now=now,
) -> MCPServer:
    mcp = MCPServer(
        name="study-meals",  # 今のコネクタと同じ名前のまま
        title="KARADA",
        instructions=INSTRUCTIONS,
        icons=server_icons(resource_url.removesuffix("/mcp")),
        token_verifier=token_verifier,
        auth=AuthSettings(
            issuer_url=trusted_issuer,
            resource_server_url=resource_url,
            required_scopes=REQUIRED_SCOPES,  # 足りなければ SDK が 403 を返す
            validate_token_resource=False,  # aud はトークンの検証で確かめている
        ),
    )
    sync_status = EngineAppSyncStatus(engine)
    report_service = create_report_service(engine)
    # 前の週のまとめの次の一歩（アプリのチェックつき）を、週のまとめの材料（weekly_review・period_overview）に足す
    previous_steps = report_tools.PreviousNextSteps(report_service)
    training_queries, training_commands = create_queries(engine), create_commands(engine, now)

    # 食事：食事・いつもの・目標・日の種類は同期の仕組みで読み書きする。体重は筋トレの体組成を、ポートを通して読み書きする
    eaters = SubjectAsEaterId()
    meals, templates = synced.SyncMealRepository(engine), synced.SyncMealTemplateRepository(engine)
    goals, day_types = synced.SyncGoalRepository(engine), synced.SyncDayTypeRepository(engine)
    body_data = SyncedBodyData(engine, training_queries)
    summaries = SummaryService(eaters, meals, goals, day_types, WorkoutTrainingDays(training_queries))
    meal_tools.register_meal_tools(mcp, meal_tools.Services(
        meals=MealService(eaters, meals),
        templates=TemplateService(eaters, meals, templates),
        goals=GoalService(eaters, goals, day_types, body_data),
        summaries=summaries,
        weights=WeightService(eaters, BodyRecordWeights(training_commands, training_queries), goals),
    ), today=today, sync_status=sync_status, previous_steps=previous_steps)

    training_tools.register_training_tools(
        mcp, training_commands, training_queries, today=today, sync_status=sync_status)
    # 期間の材料（レポートを書くため）。筋トレ・食事・からだ・目標をまたぐので、ここでつなぐ
    register_overview_tools(mcp, training_queries, summaries, body_data, sync_status, today, previous_steps)
    report_tools.register_report_tools(mcp, report_service, TrainingPhasePeriods(training_queries, today))
    register_connector_tools(mcp, session)
    return mcp


def create_app(mcp: MCPServer, host: str):
    # ステートレスで、応答は SSE ではなく JSON にする（Lambda は応答をまとめて返すため）
    app = mcp.streamable_http_app(streamable_http_path="/mcp", stateless_http=True, json_response=True, host=host)
    # RFC 9728 の文書（/.well-known/oauth-protected-resource/mcp）だけ、SDK の同じ関数で scopes_supported を4つにして先に置く。
    # SDK は required_scopes をそのまま scopes_supported にするが、必須は食事の2つにしておきたいため
    auth = mcp.settings.auth
    app.router.routes[:0] = create_protected_resource_routes(
        auth.resource_server_url, [auth.issuer_url], scopes_supported=SUPPORTED_SCOPES)
    app = JsonRpcLogMiddleware(app)  # 診断用：どのツール・リソースが呼ばれたかをログに出す
    return IconMiddleware(app)  # コネクタのアイコン（/favicon.ico など）


settings = load_settings()
registry = create_registry()
if settings.table_name:
    _engine = SyncEngine(DynamoDBSyncStore(settings.table_name, registry.index_key), registry)
else:  # PC：メモリーに置く（止めると消える）
    _engine = SyncEngine(InMemorySyncStore(registry.index_key), registry)

mcp = create_server(
    _engine,
    token_verifier=AuthzApiTokenVerifier(settings.trusted_issuer, settings.resource_url),
    trusted_issuer=settings.trusted_issuer,
    resource_url=settings.resource_url,
    session=AuthzApiSession(settings.trusted_issuer),
)

# PC では 127.0.0.1 で待ち受ける（SDK が DNS リバインディング対策を自動で入れる）。
# Lambda では、外から届くように 0.0.0.0 で待ち受ける
HOST = "0.0.0.0" if settings.on_lambda else "127.0.0.1"
app = create_app(mcp, HOST)
logging.getLogger("mcp.requests").setLevel(logging.INFO)

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=HOST, port=8001)
