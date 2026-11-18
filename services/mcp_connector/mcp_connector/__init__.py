"""MCP の入口（コネクタ）の共有の部品。KARADA の MCP（services/mcp）と、ことばの MCP（services/words）が使う。

どの製品のドメインも知らない。Claude・ChatGPT とつなぐところの話だけを置く：
アクセストークンの検証（認可API との約束。JWKS のやり直し・覚えておく鍵・取れないときの 503）、
連携の取り消し（logout）、診断用のログ、認証の中の例外の応答。
"""
