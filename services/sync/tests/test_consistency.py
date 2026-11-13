"""読み取りの整合性の切り分け（store.py の DynamoDB 版）。

commit の楽観的ロックの材料（head・seen・get_docs）は強い整合性、
集計・参照・表示の読み（read_log・scan_docs・docs_of_type・docs_by_index・last_app_received_at）は
結果整合で呼んでいることを、DynamoDB への呼び出しの引数で確かめる。
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


def test_集計と参照の読みは結果整合(dynamodb_table):
    store, table, _ = _recorded(dynamodb_table)
    store.read_log("u1", 0, 10)
    store.scan_docs("u1", None, 10)
    store.docs_of_type("u1", "meal")
    store.docs_by_index("u1", "meal", "2026-11-08#", "2026-11-08#z")
    assert [c[1]["ConsistentRead"] for c in table.calls] == [False] * 4

    assert store.last_app_received_at("u1") is None
    assert table.calls[-1][1]["ConsistentRead"] is False
