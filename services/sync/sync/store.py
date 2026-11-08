"""変更の記録と今の状態の保存先。メモリー版（PC とテスト）と DynamoDB 版（Lambda）。

DynamoDB のキー（pk は利用者。今の MealsTable の項目と同じ EATER#<sub>）：
  SYNC#HEAD                    今の seq
  SYNC#LOG#<seq を12桁>        変更の記録と、当てはめたあとの対象の状態
  SYNC#CHANGE#<change_id>      受け付けた印（冪等のため）
  SYNC#APP                     アプリ（端末）からの変更を最後に受け付けた時刻（MCP が「最後の同期」として見せる）
  SYNC#STATE#<種類>#<ID>       今の状態（Doc）。並びのキー（Registry の index_key）があれば day_key に入れ、
                               LSI by_day で範囲を探せる（今は食事の日付と区分）

書き込みは commit の1回のトランザクションだけで、先頭の seq が読んだ値のままのときだけ通る（楽観的ロック）。
どれも同期の呼び出し（boto3 が同期のため）。async の側からはスレッドに逃がして呼ぶ。
"""

from __future__ import annotations

import json
import threading
from typing import Callable, Protocol

from sync.model import Doc, LogEntry

IndexKey = Callable[[Doc], str | None]

HEAD_SK = "SYNC#HEAD"
LOG_PREFIX = "SYNC#LOG#"
CHANGE_PREFIX = "SYNC#CHANGE#"
APP_SK = "SYNC#APP"
STATE_PREFIX = "SYNC#STATE#"
BY_DAY_INDEX = "by_day"
MAX_SEQ = 10**12 - 1


class Conflict(Exception):
    """ほかの書き込みと重なった。読み直してやり直す。"""


def pk(user: str) -> str:
    return f"EATER#{user}"


def log_sk(seq: int) -> str:
    return f"{LOG_PREFIX}{seq:012d}"


def state_sk(entity_type: str, entity_id: str) -> str:
    return f"{STATE_PREFIX}{entity_type}#{entity_id}"


class SyncStore(Protocol):
    def head(self, user: str) -> int: ...

    def seen(self, user: str, change_ids: list[str]) -> dict[str, int]:
        """受け付けた change_id → seq。"""
        ...

    def get_docs(self, user: str, keys: set[tuple[str, str]]) -> dict[tuple[str, str], Doc]: ...

    def commit(self, user: str, expected_head: int, new_head: int, logs: list[LogEntry],
               markers: dict[str, int], docs: list[Doc], app_received_at: str | None = None) -> None:
        """まとめて書く。先頭が expected_head でなければ Conflict。

        app_received_at は、アプリ（端末）からの変更を含むときの受け付けた時刻。同じトランザクションで残す。
        """
        ...

    def last_app_received_at(self, user: str) -> str | None:
        """アプリ（端末）からの変更を最後に受け付けた時刻。まだなければ None。"""
        ...

    def read_log(self, user: str, after: int, limit: int) -> tuple[list[LogEntry], bool]:
        """seq が after より大きいものを limit 件まで。2つめは続きがあるか。"""
        ...

    def scan_docs(self, user: str, start_after: str | None, limit: int) -> tuple[list[Doc], str | None]:
        """今の状態を sk の順に。2つめは続きの位置（なければ None）。"""
        ...

    def docs_of_type(self, user: str, entity_type: str) -> list[Doc]: ...

    def docs_by_index(self, user: str, entity_type: str, start: str, end: str) -> list[Doc]:
        """並びのキーが start から end まで（両端を含む）の対象。"""
        ...


class InMemorySyncStore:
    def __init__(self, index_key: IndexKey = lambda doc: None):
        self.index_key = index_key
        self._users: dict[str, dict] = {}
        self._lock = threading.Lock()

    def _user(self, user: str) -> dict:
        return self._users.setdefault(user, {"head": 0, "log": {}, "markers": {}, "docs": {}, "app": None})

    def head(self, user: str) -> int:
        with self._lock:
            return self._user(user)["head"]

    def seen(self, user: str, change_ids: list[str]) -> dict[str, int]:
        with self._lock:
            markers = self._user(user)["markers"]
            return {c: markers[c] for c in change_ids if c in markers}

    def get_docs(self, user: str, keys: set[tuple[str, str]]) -> dict[tuple[str, str], Doc]:
        with self._lock:
            docs = self._user(user)["docs"]
            return {k: Doc.from_json(json.loads(docs[state_sk(*k)])) for k in keys if state_sk(*k) in docs}

    def commit(self, user, expected_head, new_head, logs, markers, docs, app_received_at=None) -> None:
        with self._lock:
            u = self._user(user)
            if u["head"] != expected_head or any(c in u["markers"] for c in markers):
                raise Conflict()
            u["head"] = new_head
            if app_received_at is not None:
                u["app"] = app_received_at
            for entry in logs:
                u["log"][entry.change.seq] = json.dumps(entry.to_json())
            u["markers"].update(markers)
            for doc in docs:
                u["docs"][state_sk(*doc.key)] = json.dumps(doc.to_json())

    def last_app_received_at(self, user):
        with self._lock:
            return self._user(user)["app"]

    def read_log(self, user, after, limit):
        with self._lock:
            log = self._user(user)["log"]
            seqs = sorted(s for s in log if s > after)
            return [LogEntry.from_json(json.loads(log[s])) for s in seqs[:limit]], len(seqs) > limit

    def scan_docs(self, user, start_after, limit):
        with self._lock:
            docs = self._user(user)["docs"]
            sks = sorted(sk for sk in docs if start_after is None or sk > start_after)
            page = sks[:limit]
            more = len(sks) > limit
            return [Doc.from_json(json.loads(docs[sk])) for sk in page], (page[-1] if more else None)

    def docs_of_type(self, user, entity_type):
        with self._lock:
            docs = self._user(user)["docs"]
            prefix = state_sk(entity_type, "")
            return [Doc.from_json(json.loads(v)) for sk, v in sorted(docs.items()) if sk.startswith(prefix)]

    def docs_by_index(self, user, entity_type, start, end):
        found = []
        for doc in self.docs_of_type(user, entity_type):
            key = self.index_key(doc)
            if key is not None and start <= key <= end:
                found.append(doc)
        return found


class DynamoDBSyncStore:
    def __init__(self, table_name: str, index_key: IndexKey = lambda doc: None):
        import boto3  # Lambda の実行環境に入っている

        self.index_key = index_key
        self.table = boto3.resource("dynamodb").Table(table_name)
        self.client = self.table.meta.client  # 高水準の型（dict・str・int）のまま渡せる
        self.table_name = table_name

    def head(self, user: str) -> int:
        item = self.table.get_item(Key={"pk": pk(user), "sk": HEAD_SK}, ConsistentRead=True).get("Item")
        return int(item["seq"]) if item else 0

    def seen(self, user: str, change_ids: list[str]) -> dict[str, int]:
        if not change_ids:
            return {}
        keys = [{"pk": pk(user), "sk": CHANGE_PREFIX + c} for c in change_ids]
        found = self._batch_get(keys)
        return {item["sk"].removeprefix(CHANGE_PREFIX): int(item["seq"]) for item in found}

    def get_docs(self, user: str, keys: set[tuple[str, str]]) -> dict[tuple[str, str], Doc]:
        if not keys:
            return {}
        found = self._batch_get([{"pk": pk(user), "sk": state_sk(*k)} for k in keys])
        docs = [Doc.from_json(json.loads(item["data"])) for item in found]
        return {d.key: d for d in docs}

    def _batch_get(self, keys: list[dict]) -> list[dict]:
        items = []
        for i in range(0, len(keys), 100):
            request = {self.table_name: {"Keys": keys[i:i + 100], "ConsistentRead": True}}
            while request:
                res = self.client.batch_get_item(RequestItems=request)
                items += res["Responses"].get(self.table_name, [])
                request = res.get("UnprocessedKeys") or None
        return items

    def commit(self, user, expected_head, new_head, logs, markers, docs, app_received_at=None) -> None:
        from botocore.exceptions import ClientError

        p = pk(user)
        head = {"Put": {
            "TableName": self.table_name, "Item": {"pk": p, "sk": HEAD_SK, "seq": new_head},
            "ConditionExpression": "attribute_not_exists(pk) OR seq = :expected",
            "ExpressionAttributeValues": {":expected": expected_head},
        }}
        new_only = {"ConditionExpression": "attribute_not_exists(pk)"}
        items = [head]
        items += [{"Put": {"TableName": self.table_name, **new_only, "Item": {
            "pk": p, "sk": log_sk(e.change.seq), "data": json.dumps(e.to_json())}}} for e in logs]
        items += [{"Put": {"TableName": self.table_name, **new_only, "Item": {
            "pk": p, "sk": CHANGE_PREFIX + c, "seq": s}}} for c, s in markers.items()]
        for doc in docs:
            item = {"pk": p, "sk": state_sk(*doc.key), "data": json.dumps(doc.to_json())}
            if (day_key := self.index_key(doc)) is not None:
                item["day_key"] = day_key
            items.append({"Put": {"TableName": self.table_name, "Item": item}})
        if app_received_at is not None:
            items.append({"Put": {"TableName": self.table_name, "Item": {
                "pk": p, "sk": APP_SK, "received_at": app_received_at}}})
        try:
            self.client.transact_write_items(TransactItems=items)
        except ClientError as e:
            if e.response["Error"]["Code"] == "TransactionCanceledException":
                raise Conflict() from e
            raise

    def last_app_received_at(self, user):
        item = self.table.get_item(Key={"pk": pk(user), "sk": APP_SK}, ConsistentRead=True).get("Item")
        return item["received_at"] if item else None

    def read_log(self, user, after, limit):
        from boto3.dynamodb.conditions import Key

        if after >= MAX_SEQ:
            return [], False
        res = self.table.query(
            KeyConditionExpression=Key("pk").eq(pk(user)) & Key("sk").between(log_sk(after + 1), log_sk(MAX_SEQ)),
            Limit=limit, ConsistentRead=True)
        entries = [LogEntry.from_json(json.loads(item["data"])) for item in res["Items"]]
        return entries, "LastEvaluatedKey" in res

    def scan_docs(self, user, start_after, limit):
        from boto3.dynamodb.conditions import Key

        kwargs = {"ExclusiveStartKey": {"pk": pk(user), "sk": start_after}} if start_after else {}
        res = self.table.query(
            KeyConditionExpression=Key("pk").eq(pk(user)) & Key("sk").begins_with(STATE_PREFIX),
            Limit=limit, ConsistentRead=True, **kwargs)
        docs = [Doc.from_json(json.loads(item["data"])) for item in res["Items"]]
        last = res.get("LastEvaluatedKey")
        return docs, (last["sk"] if last else None)

    def docs_of_type(self, user, entity_type):
        from boto3.dynamodb.conditions import Key

        condition = Key("pk").eq(pk(user)) & Key("sk").begins_with(state_sk(entity_type, ""))
        items = self._query_all(KeyConditionExpression=condition, ConsistentRead=True)
        return [Doc.from_json(json.loads(i["data"])) for i in items]

    def docs_by_index(self, user, entity_type, start, end):
        from boto3.dynamodb.conditions import Attr, Key

        # LSI には、移行の前の MEAL# の項目も入っているので、同期のその種類の状態だけに絞る
        items = self._query_all(
            IndexName=BY_DAY_INDEX,
            KeyConditionExpression=Key("pk").eq(pk(user)) & Key("day_key").between(start, end),
            FilterExpression=Attr("sk").begins_with(state_sk(entity_type, "")), ConsistentRead=True)
        return [Doc.from_json(json.loads(i["data"])) for i in items]

    def _query_all(self, **kwargs) -> list[dict]:
        items, start_key = [], None
        while True:  # 1回の応答は 1MB までなので、続きがあれば読み続ける
            continuation = {"ExclusiveStartKey": start_key} if start_key else {}
            page = self.table.query(**kwargs, **continuation)
            items += page["Items"]
            start_key = page.get("LastEvaluatedKey")
            if not start_key:
                return items
