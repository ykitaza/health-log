"""変更を受け付けて当てはめ、受け取り（カーソル）とスナップショットを返す。アプリも MCP もここを通して書く。"""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Callable

from sync.model import APP_ORIGINS, Change, Doc, LogEntry, stamped, utc_now
from sync.read_cache import cached
from sync.registry import Registry
from sync.store import Conflict, SyncStore

# 1つのトランザクションは100件まで：先頭1＋（変更の記録＋印＋状態）×30以下＋アプリの受け付けの時刻1
MAX_CHANGES_PER_COMMIT = 30
RETRIES = 3


@dataclass(frozen=True)
class Accepted:
    change_id: str
    seq: int
    duplicate: bool  # 前に受け付けていた（状態は変わっていない）


class SyncEngine:
    def __init__(self, store: SyncStore, registry: Registry, clock: Callable[[], str] = utc_now):
        self.store, self.registry, self.clock = store, registry, clock

    def append(self, user: str, changes: list[Change]) -> list[Accepted]:
        """変更を送られた順に当てはめて保存する。同じ change_id は2回目から duplicate（冪等）。"""
        # 親と一緒に保存する種類は、登録から親の種類を決める（呼ぶ側が書かなくてよいように）
        changes = [replace(c, parent_type=self.registry.parent_type(c.entity_type)) for c in changes]
        results: dict[str, Accepted] = {}
        for i in range(0, len(changes), MAX_CHANGES_PER_COMMIT):
            for accepted in self._append_chunk(user, changes[i:i + MAX_CHANGES_PER_COMMIT]):
                results[accepted.change_id] = accepted
        return [results[c.change_id] for c in changes]

    def _append_chunk(self, user: str, changes: list[Change]) -> list[Accepted]:
        for _ in range(RETRIES):
            seen = self.store.seen(user, [c.change_id for c in changes])
            fresh, ids = [], set(seen)
            for c in changes:  # 同じ呼び出しの中で重なったものも、最初の1つだけ
                if c.change_id not in ids:
                    fresh.append(c)
                    ids.add(c.change_id)
            if not fresh:
                return [Accepted(c, s, True) for c, s in seen.items()]
            head = self.store.head(user)
            docs = self.store.get_docs(user, {c.doc_key for c in fresh})
            received_at, seq, logs = self.clock(), head, []
            for change in fresh:
                seq += 1
                change = stamped(change, received_at, seq)
                doc = docs.setdefault(change.doc_key, Doc(*change.doc_key))
                logs.append(LogEntry(change, doc.apply(change).view()))
            # アプリ（端末）からの変更を含むなら、その受け付けの時刻を残す（MCP が「最後の同期」として見せる）
            from_app = received_at if any(c.origin in APP_ORIGINS for c in fresh) else None
            try:
                self.store.commit(user, head, seq, logs, {e.change.change_id: e.change.seq for e in logs},
                                  list(docs.values()), app_received_at=from_app)
            except Conflict:
                continue  # ほかの書き込みと重なった。読み直してやり直す
            return [Accepted(c, s, True) for c, s in seen.items()] + [
                Accepted(e.change.change_id, e.change.seq, False) for e in logs]
        raise Conflict("書き込みが重なり続けました")

    def pull(self, user: str, after: int, limit: int, readable: set[str]) -> tuple[list[LogEntry], int, bool]:
        """after より後の変更。読めない種類は飛ばすが、カーソルは進める。"""
        entries, more = self.store.read_log(user, after, limit)
        next_cursor = entries[-1].change.seq if entries else after
        return [e for e in entries if e.change.entity_type in readable], next_cursor, more

    def snapshot(self, user: str, start_after: str | None, limit: int, readable: set[str]) -> tuple[list[dict], str | None]:
        docs, last = self.store.scan_docs(user, start_after, limit)
        states = [s.view() for d in docs for s in d.states() if s.entity_type in readable]
        return states, last

    def head(self, user: str) -> int:
        return self.store.head(user)

    def last_app_received_at(self, user: str) -> str | None:
        """アプリ（端末）からの変更を最後に受け付けた時刻（UTC、ミリ秒まで）。まだなければ None。"""
        return self.store.last_app_received_at(user)

    def docs(self, user: str, keys: set[tuple[str, str]]) -> dict[tuple[str, str], Doc]:
        """(種類, ID) の組でまとめて読む。ないものは入らない。"""
        return self.store.get_docs(user, keys)

    def doc(self, user: str, entity_type: str, entity_id: str) -> Doc | None:
        return self.store.get_docs(user, {(entity_type, entity_id)}).get((entity_type, entity_id))

    def docs_of_type(self, user: str, entity_type: str) -> list[Doc]:
        # 読み取りの範囲（sync.read_cache）が開いている間は、同じ種類の全件読みを使い回す。
        # 返す一覧はコピー（使い回した中身を呼ぶ側が書き換えないように）
        return list(cached(("docs_of_type", user, entity_type),
                           lambda: self.store.docs_of_type(user, entity_type)))

    def docs_by_index(self, user: str, entity_type: str, start: str, end: str) -> list[Doc]:
        return self.store.docs_by_index(user, entity_type, start, end)
