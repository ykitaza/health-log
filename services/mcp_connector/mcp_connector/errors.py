"""認証（SDK のミドルウェア）の中で起きた例外の応答。"""

from starlette.responses import JSONResponse, PlainTextResponse

from mcp_connector.access_token_verifier import JwksUnavailableError


def unhandled_error(request, exc: Exception):
    """JWKS が取れないときだけ、401 ではなく 503 で再試行を促す。"""
    if isinstance(exc, JwksUnavailableError):
        return JSONResponse(
            {"error": "temporarily_unavailable", "error_description": "Token verification is temporarily unavailable"},
            status_code=503, headers={"Retry-After": "1"})
    return PlainTextResponse("Internal Server Error", status_code=500)
