"""今のテスト（リポジトリ・サービス・MCP のツール）を、そのまま同期の実装で動かす。

テストの関数は元のモジュールから読み込み、fixture（repos・app・call）だけを同期の実装に差し替える。
MCP のツールの外から見たふるまいが変わっていないことを確かめるため。
"""

import asyncio
import json
from itertools import count

import pytest
from mcp.server.auth.provider import AccessToken

from meals.application.goals import GoalService
from meals.application.meals import MealService
from meals.application.summaries import SummaryService
from meals.application.templates import TemplateService
from meals.application.weights import WeightService
from meals.infrastructure import memory_repositories as memory
from meals.infrastructure import sync_repositories as synced
from meals.infrastructure.subject_as_eater_id import SubjectAsEaterId
from meals.presentation import mcp_server
from mcp.server.mcpserver import MCPServer

from meals.presentation.mcp_server import Services, register_meal_tools
from sync.engine import SyncEngine
from tests.sync.conftest import memory_engine
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
def repos(sync_engine):
    """test_repositories 用。"""
    return _repos(sync_engine)


@pytest.fixture
def app():
    """test_services 用。"""
    meals, templates, goals, day_types = _repos(memory_engine())
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
    meals, templates, goals, day_types = _repos(memory_engine())
    eaters = SubjectAsEaterId()
    services = Services(
        MealService(eaters, meals),
        TemplateService(eaters, meals, templates),
        GoalService(eaters, goals, day_types),
        SummaryService(eaters, meals, goals, day_types),
        WeightService(eaters, memory.InMemoryWeightRepository(), goals),
    )
    session = test_mcp_server.FakeSession()
    mcp = MCPServer(name="test")
    register_meal_tools(mcp, services, today=lambda: test_mcp_server.TODAY)
    return _caller(mcp, session)


def _caller(mcp, session):
    """元の call と同じ呼び方。"""
    def _call(tool: str, **arguments):
        result = asyncio.run(mcp.call_tool(tool, arguments))
        return json.loads(result.content[0].text)

    _call.mcp, _call.session = mcp, session
    return _call
