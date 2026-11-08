"""認可の途中の状態とリフレッシュトークンの系列の置き場所（oauth/store.py の Store の実装）。

PC ではメモリー、Lambda では DynamoDB に置く（Lambda は呼ばれるたびに別の実行環境になることがあるため）。
"""

import json
import time


class MemoryStore:
    """PC 用。再起動すると消える。"""

    def __init__(self):
        self.items: dict[str, tuple[dict, float]] = {}

    def put(self, kind, key, data, ttl_seconds):
        self.items[f"{kind}#{key}"] = (data, time.time() + ttl_seconds)

    def get(self, kind, key):
        data, expires_at = self.items.get(f"{kind}#{key}", (None, 0))
        return data if expires_at > time.time() else None

    def pop(self, kind, key):
        data, expires_at = self.items.pop(f"{kind}#{key}", (None, 0))
        return data if expires_at > time.time() else None


class DynamoDBStore:
    """Lambda 用。1つのテーブルに、種類とキーをつないだ pk で保存する。

    expires_at を過ぎた項目は DynamoDB の TTL が消す（消えるまで遅れることがあるので、期限は自分でも確かめる）。
    """

    def __init__(self, table_name: str):
        import boto3  # Lambda の実行環境に入っている

        self.table = boto3.resource("dynamodb").Table(table_name)

    def put(self, kind, key, data, ttl_seconds):
        self.table.put_item(Item={
            "pk": f"{kind}#{key}",
            "data": json.dumps(data),
            "expires_at": int(time.time()) + ttl_seconds,
        })

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
