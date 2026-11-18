"""リポジトリ：先頭の seq が変わっていなければ読んだものを使い回す。初期の行に同期の変更を重ねる。読めない状態は飛ばす。"""

import uuid

import anyio

from sync.model import Change
from words.domain.catalog import SEED_SOURCES, SEED_TAGS
from words.infrastructure.sync_repository import SyncWordsRepository
from words.main import create_engine


def app_change(engine, entity_type, entity_id, op, fields=None):
    engine.append("alice", [Change(str(uuid.uuid4()), entity_type, entity_id, None, op, fields,
                                   "2026-11-18T12:00:00.000Z", "app")])


def test_先頭が変わらなければ読み直さない(monkeypatch):
    engine = create_engine(None)
    repo = SyncWordsRepository(engine)
    reads = []
    original = engine.docs_of_type
    monkeypatch.setattr(engine, "docs_of_type", lambda user, t: reads.append(t) or original(user, t))
    first = anyio.run(repo.state, "alice")
    n = len(reads)
    assert anyio.run(repo.state, "alice") is first and len(reads) == n
    app_change(engine, "expression", str(uuid.uuid4()), "create",
               {"text": "腑に落ちる", "normalized_key": "腑に落ちる", "place": "collected"})
    second = anyio.run(repo.state, "alice")
    assert second is not first and len(second.expressions) == 1 and len(reads) == 2 * n


def test_初期の行に変えた項目を重ね_消した表現の子は読まない():
    engine = create_engine(None)
    app_change(engine, "source", SEED_SOURCES[0].id, "update", {"name": "オーディブル"})
    app_change(engine, "tag", SEED_TAGS[0].id, "update", {"hidden": True})
    expression_id = str(uuid.uuid4())
    app_change(engine, "expression", expression_id, "create",
               {"text": "腑に落ちる", "normalized_key": "腑に落ちる", "place": "hand"})  # 段階なしの手札は「意味がわかる」で読む
    app_change(engine, "encounter", str(uuid.uuid4()), "create", {"expression_id": expression_id})
    app_change(engine, "expression", str(uuid.uuid4()), "create", {"text": "項目が足りない"})
    state = anyio.run(SyncWordsRepository(engine).state, "alice")
    audible = state.source(SEED_SOURCES[0].id)
    assert (audible.name, audible.icon_key) == ("オーディブル", "headphones")
    assert state.tag(SEED_TAGS[0].id).hidden
    assert list(state.expressions) == [expression_id]
    assert state.expressions[expression_id].schedule.stage.value == "understood"
    assert len(state.encounters[expression_id]) == 1

    app_change(engine, "expression", expression_id, "delete")
    state = anyio.run(SyncWordsRepository(engine).state, "alice")
    assert state.expressions == {} and state.encounters == {}
