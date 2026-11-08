import httpx

from oauth.models import Client, is_client_id_url

CIMD_MAX_BYTES = 5 * 1024


class ClientRejected(Exception):
    """クライアントを確かめられない。redirect_uri が攻撃者の URL かもしれないので、そこへは返さずにエラー画面を出す。"""


class CimdClientDirectory:
    """CIMD：client_id の URL から、クライアントの情報を書いた文書を取りに行く。

    SSRF の対策として、https の URL だけを、リダイレクトをたどらず、5秒・5KB までで取りに行く。
    allow_loopback_http は PC で動かすときだけ True にする（localhost の http も取りに行く）。
    """

    def __init__(self, http_get=None, *, allow_loopback_http: bool = False):
        self.http_get = http_get or self._get
        self.allow_loopback_http = allow_loopback_http

    def find(self, client_id: str) -> Client:
        if not is_client_id_url(client_id, allow_loopback_http=self.allow_loopback_http):
            raise ClientRejected("client_id は https の URL である必要があります")
        try:
            res = self.http_get(client_id)
        except httpx.HTTPError:
            raise ClientRejected("クライアントのメタデータを取得できません")
        if res.status_code != 200 or len(res.content) > CIMD_MAX_BYTES:
            raise ClientRejected("クライアントのメタデータを取得できません")
        try:
            doc = res.json()
        except ValueError:
            raise ClientRejected("クライアントのメタデータが JSON ではありません")

        # 文書の中の client_id が、取りに行った URL と同じか（他人の文書を使い回していないか）
        if doc.get("client_id") != client_id:
            raise ClientRejected("メタデータの client_id が URL と一致しません")
        # シークレットを持たないクライアント（PKCE で確かめる）だけを受け付ける。
        # ChatGPT は token_endpoint_auth_method に private_key_jwt を書き、対応できる方式の一覧
        # （token_endpoint_auth_methods_supported、CIMD の標準の項目ではない）に none も書いている。
        # 認可APIのメタデータは none だけを公開しているので、そちらで来る
        method = doc.get("token_endpoint_auth_method", "none")
        if "none" not in [method, *doc.get("token_endpoint_auth_methods_supported", [])]:
            raise ClientRejected("token_endpoint_auth_method は none だけに対応しています")
        if not isinstance(doc.get("redirect_uris"), list):
            raise ClientRejected("メタデータに redirect_uris がありません")
        return Client(
            client_id=client_id,
            client_name=doc.get("client_name") or client_id,
            redirect_uris=tuple(str(uri) for uri in doc["redirect_uris"]),
        )

    @staticmethod
    def _get(url: str) -> httpx.Response:
        # 少しずつ受け取り、5KB を超えたところでやめる（大きな応答を全部メモリーに読み込まない）。
        # iter_bytes は圧縮を解いたあとの中身なので、解くと大きくなる応答も 5KB で止まる
        with httpx.Client(timeout=5, follow_redirects=False) as client, client.stream("GET", url) as res:
            body = b""
            for chunk in res.iter_bytes():
                body += chunk
                if len(body) > CIMD_MAX_BYTES:
                    break
            return httpx.Response(res.status_code, content=body)
