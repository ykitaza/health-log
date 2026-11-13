"""読み取りの範囲（sync.read_cache）の中では、種類ごとの全件読みを使い回すこと。"""

from sync.engine import SyncEngine
from sync.read_cache import read_cache_scope
from sync.store import InMemorySyncStore
from tests.conftest import REGISTRY


class _CountingStore(InMemorySyncStore):
    def __init__(self, index_key):
        super().__init__(index_key)
        self.type_reads: list[tuple[str, str]] = []

    def docs_of_type(self, user, entity_type):
        self.type_reads.append((user, entity_type))
        return super().docs_of_type(user, entity_type)


def _engine():
    store = _CountingStore(REGISTRY.index_key)
    return SyncEngine(store, REGISTRY), store


def test_範囲の中では同じ種類を1回だけ読む():
    engine, store = _engine()
    with read_cache_scope():
        engine.docs_of_type("u1", "meal")
        engine.docs_of_type("u1", "meal")
        engine.docs_of_type("u1", "workout_set")
        engine.docs_of_type("u2", "meal")
    assert store.type_reads == [("u1", "meal"), ("u1", "workout_set"), ("u2", "meal")]


def test_範囲の外と範囲が変われば読み直す():
    engine, store = _engine()
    engine.docs_of_type("u1", "meal")
    engine.docs_of_type("u1", "meal")
    with read_cache_scope():
        engine.docs_of_type("u1", "meal")
    with read_cache_scope():
        engine.docs_of_type("u1", "meal")
    assert store.type_reads == [("u1", "meal")] * 4


def test_返した一覧を書き換えても使い回しの中身は変わらない():
    engine, _ = _engine()
    with read_cache_scope():
        first = engine.docs_of_type("u1", "meal")
        first.append("書き換え")
        assert engine.docs_of_type("u1", "meal") == []
