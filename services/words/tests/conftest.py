"""ことばのテストの共通の部品。MCP のツールは通信を通さずに呼び、アクセストークンは検証済みのものに差し替える。"""

import asyncio
import json
from datetime import datetime, timedelta

import pytest
from mcp.server.auth.provider import AccessToken
from mcp.server.mcpserver import MCPServer

from words.domain.schedule import JST
from words.main import create_engine, create_service
from words.presentation import mcp_tools

ALL_SCOPES = ["words:read", "words:write"]


class Clock:
    """テストの時計（日本時間）。advance で日を進める。"""

    def __init__(self, at: datetime = datetime(2026, 11, 18, 21, 0, tzinfo=JST)):
        self.at = at

    def __call__(self) -> datetime:
        return self.at

    def advance(self, days: float = 0, hours: float = 0) -> None:
        self.at += timedelta(days=days, hours=hours)


@pytest.fixture
def clock():
    return Clock()


@pytest.fixture
def engine():
    return create_engine(None)


@pytest.fixture
def service(engine, clock):
    return create_service(engine, clock)


@pytest.fixture
def call(monkeypatch, service):
    """call(ツール, **引数) で呼び、JSON を返す。call.login(sub, scopes) で呼ぶ人と scope を変えられる。"""
    current = {"token": AccessToken(token="t", client_id="c", scopes=ALL_SCOPES, subject="alice")}
    monkeypatch.setattr(mcp_tools, "get_access_token", lambda: current["token"])
    mcp = MCPServer(name="test")
    mcp_tools.register_words_tools(mcp, service)

    def _call(tool: str, **arguments):
        result = asyncio.run(mcp.call_tool(tool, arguments))
        return json.loads(result.content[0].text)

    def raw(tool: str, **arguments):
        return asyncio.run(mcp.call_tool(tool, arguments)).content[0].text

    def login(subject, scopes=ALL_SCOPES):
        current["token"] = AccessToken(token="t", client_id="c", scopes=scopes, subject=subject)

    _call.login, _call.mcp, _call.raw = login, mcp, raw
    return _call
