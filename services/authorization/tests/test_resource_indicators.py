"""RFC 8707（自分で書いた部分）。リソースサーバーが2つ以上あるときの動きは、ここで確かめる。"""

import pytest
from authlib.oauth2.rfc6749 import InvalidScopeError

from oauth.resource_indicators import InvalidTargetError, ResourceIndicators, ResourceServer, check_token_resource

MCP = ResourceServer("https://mcp.example/mcp", ("read",))
MEALS = ResourceServer("https://meals.example/mcp", ("meals:read", "meals:write"))
TWO = ResourceIndicators([MCP, MEALS])


def test_finds_the_requested_resource_server():
    assert TWO.find([MEALS.indicator]) == MEALS


@pytest.mark.parametrize("resources", [
    [],  # 2つ以上あると、どこ宛てか決められない
    ["https://other.example/mcp"],
    [MCP.indicator, MEALS.indicator],  # aud は1つだけ
])
def test_rejects_unclear_or_unknown_targets(resources):
    with pytest.raises(InvalidTargetError):
        TWO.find(resources)


def test_single_resource_server_is_the_default():
    assert ResourceIndicators([MEALS]).find([]) == MEALS


@pytest.mark.parametrize("server, requested, granted", [
    (MEALS, None, "meals:read meals:write"),  # 求めなければ、そのリソースサーバーの scope をすべて
    (MEALS, "meals:read", "meals:read"),
    (MEALS, "read meals:read meals:write", "meals:read meals:write"),  # 使えないものは外す
    (MCP, "read meals:write", "read"),
])
def test_grants_only_scopes_of_the_resource(server, requested, granted):
    assert server.grant(requested) == granted


def test_rejects_scopes_the_resource_does_not_serve():
    with pytest.raises(InvalidScopeError):
        MCP.grant("meals:write")


def test_token_request_must_target_the_granted_resource():
    check_token_resource(None, MEALS.indicator)
    check_token_resource(MEALS.indicator, MEALS.indicator)
    with pytest.raises(InvalidTargetError):
        check_token_resource(MCP.indicator, MEALS.indicator)
