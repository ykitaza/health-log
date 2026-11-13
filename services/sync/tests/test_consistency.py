"""読み取りの整合性の切り分け（store.py の DynamoDB 版）。

表示用の last_app_received_at だけが結果整合で、ほか（commit の材料の head・seen・get_docs、
pull の read_log、snapshot の scan_docs、MCP が書く前後に読む docs_of_type・docs_by_index）は
強い整合性で呼んでいることを、DynamoDB への呼び出しの引数で確かめる。理由は store.py の注記。
"""

from sync.store import DynamoDBSyncStore
from tests.conftest import REGISTRY


class _RecordingTable:
    """table の get_item・query を記録して、本物へそのまま渡す。"""

    def __init__(self, real):
        self._real = real
        self.calls: list[tuple[str, dict]] = []

    def get_item(self, **kwargs):
        self.calls.append(("get_item", kwargs))
        return self._real.get_item(**kwargs)

    def query(self, **kwargs):
        self.calls.append(("query", kwargs))
        return self._real.query(**kwargs)


class _RecordingClient:
    """client の batch_get_item を記録して、本物へそのまま渡す。"""

    def __init__(self, real):
        self._real = real
        self.requests: list[dict] = []

    def batch_get_item(self, **kwargs):
        self.requests.append(kwargs["RequestItems"])
        return self._real.batch_get_item(**kwargs)


def _recorded(dynamodb_table):
    store = DynamoDBSyncStore(dynamodb_table, REGISTRY.index_key)
    table = _RecordingTable(store.table)
    client = _RecordingClient(store.client)
    store.table, store.client = table, client
    return store, table, client


def test_commitの材料は強い整合性(dynamodb_table):
    store, table, client = _recorded(dynamodb_table)
    assert store.head("u1") == 0
    assert table.calls[-1][1]["ConsistentRead"] is True

    store.seen("u1", ["c1"])
    store.get_docs("u1", {("meal", "m1")})
    assert len(client.requests) == 2
    for request in client.requests:
        assert request[dynamodb_table]["ConsistentRead"] is True


def test_同期とMCPの読みは強い整合性(dynamodb_table):
    # pull・snapshot が古いと、カーソルの手前の変更が端末に二度と届かない。
    # MCP の読みが古いと、書いた直後の応答や、読んで決める並び順・件数の上限が崩れる
    store, table, _ = _recorded(dynamodb_table)
    store.read_log("u1", 0, 10)
    store.scan_docs("u1", None, 10)
    store.docs_of_type("u1", "meal")
    store.docs_by_index("u1", "meal", "2026-11-08#", "2026-11-08#z")
    assert [c[1]["ConsistentRead"] for c in table.calls] == [True] * 4


def test_最後の同期の時刻だけ結果整合(dynamodb_table):
    store, table, _ = _recorded(dynamodb_table)
    assert store.last_app_received_at("u1") is None
    assert table.calls[-1][1]["ConsistentRead"] is False
