"""認可の途中の状態とリフレッシュトークンの系列の置き場所（oauth/store.py の Store の実装）。

PC ではメモリー、Lambda では DynamoDB に置く（Lambda は呼ばれるたびに別の実行環境になることがあるため）。
"""

import json
import threading
import time

from oauth.store import ConditionFailed

# 条件つきの put（expected）で比べてよい項目。DynamoDB では data（JSON）とは別に、項目としても書く
GUARDED_FIELDS = ("current_hash",)


def _check_guarded(expected: tuple[str, str] | None) -> None:
    if expected is not None and expected[0] not in GUARDED_FIELDS:
        raise ValueError(f"expected に使えない項目：{expected[0]}")


class MemoryStore:
    """PC 用。再起動すると消える。"""

    def __init__(self):
        self.items: dict[str, tuple[dict, float]] = {}
        self.lock = threading.Lock()  # 条件つきの put で、読んでから書くまでを1つにする

    def put(self, kind, key, data, ttl_seconds, *, expected=None):
        _check_guarded(expected)
        with self.lock:
            if expected is not None:
                field, value = expected
                stored = self._alive(self.items.get(f"{kind}#{key}"))
                if stored is None or stored.get(field) != value:
                    raise ConditionFailed(f"{kind}#{key}")
            self.items[f"{kind}#{key}"] = (data, time.time() + ttl_seconds)

    def get(self, kind, key):
        with self.lock:
            return self._alive(self.items.get(f"{kind}#{key}"))

    def pop(self, kind, key):
        with self.lock:
            return self._alive(self.items.pop(f"{kind}#{key}", None))

    @staticmethod
    def _alive(entry: tuple[dict, float] | None) -> dict | None:
        if entry is None or entry[1] <= time.time():
            return None
        return entry[0]


class DynamoDBStore:
    """Lambda 用。1つのテーブルに、種類とキーをつないだ pk で保存する。

    expires_at を過ぎた項目は DynamoDB の TTL が消す（消えるまで遅れることがあるので、期限は自分でも確かめる）。
    """

    def __init__(self, table_name: str):
        import boto3  # Lambda の実行環境に入っている

        self.table = boto3.resource("dynamodb").Table(table_name)

    def put(self, kind, key, data, ttl_seconds, *, expected=None):
        _check_guarded(expected)
        item = {
            "pk": f"{kind}#{key}",
            "data": json.dumps(data),
            "expires_at": int(time.time()) + ttl_seconds,
        }
        # 条件に使う項目は、data とは別の項目にも書く（ConditionExpression で比べるため）
        item.update({field: data[field] for field in GUARDED_FIELDS if isinstance(data.get(field), str)})
        condition = {}
        if expected is not None:
            field, value = expected
            condition = {
                # この項目を書く前に保存したもの（data の JSON だけ）は、JSON の中の "current_hash": "..." で比べる。
                # ハッシュは64桁の16進数なので、ほかの値と取り違えない。ないもの（消された系列）は、どちらにも当たらない
                "ConditionExpression": "#f = :v OR (attribute_not_exists(#f) AND contains(#d, :legacy))",
                "ExpressionAttributeNames": {"#f": field, "#d": "data"},
                "ExpressionAttributeValues": {":v": value, ":legacy": json.dumps({field: value})[1:-1]},
            }
        try:
            self.table.put_item(Item=item, **condition)
        except self.table.meta.client.exceptions.ConditionalCheckFailedException as error:
            raise ConditionFailed(item["pk"]) from error

    def get(self, kind, key):
        return self._alive(self.table.get_item(Key={"pk": f"{kind}#{key}"}).get("Item"))

    def pop(self, kind, key):
        deleted = self.table.delete_item(Key={"pk": f"{kind}#{key}"}, ReturnValues="ALL_OLD")
        return self._alive(deleted.get("Attributes"))

    @staticmethod
    def _alive(item: dict | None) -> dict | None:
        if item is None or item["expires_at"] <= time.time():
            return None
        return json.loads(item["data"])
