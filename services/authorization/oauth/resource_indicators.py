"""RFC 8707（Resource Indicators）。Authlib にはないので自分で書く。

クライアントが resource で求めたリソースサーバーを確かめ、アクセストークンの aud にする。
scope もリソースサーバーごとに持つので、ここで狭める。
"""

from dataclasses import dataclass

from authlib.oauth2.rfc6749 import InvalidScopeError, OAuth2Error


class InvalidTargetError(OAuth2Error):
    """知らないリソースサーバー宛てのトークンを求められた。"""

    error = "invalid_target"


@dataclass(frozen=True)
class ResourceServer:
    """認可APIが知っているリソースサーバーと、そこで使える scope。"""

    indicator: str
    scopes: tuple[str, ...]

    def grant(self, requested: str | None) -> str:
        """求められた scope のうち、このリソースサーバーで使えるものだけを許す（RFC 6749 3.3 で狭めてよい）。

        何も求められなければ、使える scope をすべて許す。
        """
        values = (requested or "").split()
        if not values:
            return " ".join(self.scopes)
        granted = [s for s in values if s in self.scopes]
        if not granted:
            raise InvalidScopeError(f"Available scopes for this resource: {' '.join(self.scopes)}")
        return " ".join(granted)


class ResourceIndicators:
    """認可コードのグラントに付ける拡張。/authorize で resource を確かめ、scope を狭める。"""

    def __init__(self, servers: list[ResourceServer]):
        self.servers = servers

    def __call__(self, grant):
        # Authlib が scope を確かめたあとに呼ぶ。ここで出したエラーは、クライアントの redirect_uri へ返る
        grant.register_hook("after_validate_authorization_request_payload", self.validate_authorization_request)

    def validate_authorization_request(self, grant, redirect_uri):
        request = grant.request
        server = self.find([r for r in request.payload.datalist.get("resource", []) if r])
        request.resource = server.indicator
        request.scope = server.grant(request.payload.scope)

    def find(self, resources: list[str]) -> ResourceServer:
        if len(resources) > 1:
            raise InvalidTargetError("Only one 'resource' is supported.")
        if not resources:
            # resource を送ってこなければ、リソースサーバーが1つのときに限りそこ宛てにする（2つ以上だと決められない）
            if len(self.servers) == 1:
                return self.servers[0]
            raise InvalidTargetError("Missing 'resource'.")
        server = next((s for s in self.servers if s.indicator == resources[0]), None)
        if server is None:
            raise InvalidTargetError("Unknown resource server.")
        return server


def check_token_resource(requested: str | None, granted: str) -> None:
    """/token でも resource を送ってきたなら、許したときと同じか。"""
    if requested and requested != granted:
        raise InvalidTargetError("'resource' does not match the grant.")
