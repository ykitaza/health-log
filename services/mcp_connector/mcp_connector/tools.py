"""コネクタそのもののツール（食事にも筋トレにも属さない）。"""

from typing import Protocol

from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.mcpserver import MCPServer
from mcp_types import ToolAnnotations


class Session(Protocol):
    """連携（ログイン）の終わらせ方。認可コンテキストに頼む。"""

    async def revoke(self, access_token: str, client_id: str) -> None: ...

    def logout_url(self) -> str: ...


def register_connector_tools(mcp: MCPServer, session: Session) -> None:
    @mcp.tool(annotations=ToolAnnotations(read_only_hint=False, destructive_hint=True))
    async def logout() -> dict:
        """ログアウトする。別のアカウントで入り直したいときや、連携をやめたいときに呼ぶ。

        この連携を終わらせ、ログイン画面のセッションを消すためのリンク（logout_url）を返す。
        リンクを利用者に見せ、開くように伝える。そのあと、このコネクタを使うとログインし直しになる。
        """
        token = get_access_token()
        await session.revoke(token.token, token.client_id)
        return {
            "message": "この連携を終わらせました。ログイン画面のセッションも消すため、logout_url を開いてください。",
            "logout_url": session.logout_url(),
        }
