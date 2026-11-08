"""今のテスト（リポジトリ・サービス・MCP のツール）を、そのまま同期の実装で動かす。

テストの関数は元のモジュールから読み込み、fixture（repos・app・call）だけを同期の実装に差し替える。
MCP のツールの外から見たふるまいが変わっていないことを確かめるため。
"""

import asyncio
import json
from itertools import count

import pytest
from mcp.server.auth.provider import AccessToken

from application.goals import GoalService
from application.meals import MealService
from application.summaries import SummaryService
from application.templates import TemplateService
from application.weights import WeightService
from infrastructure import memory_repositories as memory
from infrastructure import sync_repositories as synced
from infrastructure.subject_as_eater_id import SubjectAsEaterId
from presentation import mcp_server
from presentation.mcp_server import Services, create_mcp_server
from sync.engine import SyncEngine
from sync.store import InMemorySyncStore
from tests.application import test_services
from tests.infrastructure import test_repositories
from tests.presentation import test_mcp_server

for _module, _prefix in ((test_repositories, "repositories"), (test_services, "services"), (test_mcp_server, "mcp")):
    for _name in dir(_module):
        if _name.startswith("test_"):
            globals()[f"test_{_prefix}__{_name.removeprefix('test_')}"] = getattr(_module, _name)


def _repos(engine: SyncEngine):
    return (synced.SyncMealRepository(engine), synced.SyncMealTemplateRepository(engine),
            synced.SyncGoalRepository(engine), synced.SyncDayTypeRepository(engine))


@pytest.fixture
def repos(sync_store):
    """test_repositories 用。体重は同期しないので、今のメモリー版のまま。"""
    return (*_repos(SyncEngine(sync_store)), memory.InMemoryWeightRepository())


@pytest.fixture
def app():
    """test_services 用。"""
    meals, templates, goals, day_types = _repos(SyncEngine(InMemorySyncStore()))
    eaters, numbers = SubjectAsEaterId(), count(1)
    ids = lambda: f"id{next(numbers)}"  # noqa: E731
    return {
        "meals": MealService(eaters, meals, ids),
        "templates": TemplateService(eaters, meals, templates, ids),
        "goals": GoalService(eaters, goals, day_types),
        "summaries": SummaryService(eaters, meals, goals, day_types),
    }


@pytest.fixture
def call(monkeypatch):
    """test_mcp_server 用。"""
    token = AccessToken(token="t", client_id="c", scopes=["meals:read", "meals:write"], subject="alice")
    monkeypatch.setattr(mcp_server, "get_access_token", lambda: token)
    meals, templates, goals, day_types = _repos(SyncEngine(InMemorySyncStore()))
    eaters = SubjectAsEaterId()
    services = Services(
        MealService(eaters, meals),
        TemplateService(eaters, meals, templates),
        GoalService(eaters, goals, day_types),
        SummaryService(eaters, meals, goals, day_types),
        WeightService(eaters, memory.InMemoryWeightRepository(), goals),
    )
    session = test_mcp_server.FakeSession()
    mcp = create_mcp_server(services, token_verifier=object(), trusted_issuer="https://authz.example",
                            resource_url="https://meals.example/mcp", today=lambda: test_mcp_server.TODAY,
                            session=session)
    return _caller(mcp, session)


def _caller(mcp, session):
    """元の call と同じ呼び方。"""
    def _call(tool: str, **arguments):
        result = asyncio.run(mcp.call_tool(tool, arguments))
        return json.loads(result.content[0].text)

    _call.mcp, _call.session = mcp, session
    return _call
