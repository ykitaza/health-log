"""組み立て（DI）。レポートの種類を同期に登録し、ユースケースを作る。

アプリ用の API の組み立て（services/app_api、composition の create_registry）は登録だけを、
MCP の組み立て（services/mcp/main.py）はユースケースとツールの登録（reports.presentation.mcp_tools）を使う。
"""

from reports.application.service import ReportService
from reports.infrastructure.sync_entities import register as register_sync_entities
from reports.infrastructure.sync_repository import SyncReportRepository
from sync.engine import SyncEngine

__all__ = ["create_service", "register_sync_entities"]


def create_service(engine: SyncEngine) -> ReportService:
    return ReportService(SyncReportRepository(engine))
