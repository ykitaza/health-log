"""ことばの種類の同期の決まり（アプリから届く変更の確かめ）。WordsTable 用の Registry には、ことばの種類だけが入る。"""

import uuid

import pytest

from sync.model import Doc, EntityState
from sync.registry import Rejection
from words.domain.catalog import SEED_TAGS, expression_tag_id
from words.infrastructure.sync_entities import ENTITY_TYPES, create_registry, expression_index_key

REGISTRY = create_registry()
AT = "2026-11-18T12:00:00Z"
EXPRESSION = {"text": "腑に落ちる", "normalized_key": "腑に落ちる", "place": "collected"}


def change(entity_type, op="create", fields=None, entity_id=None):
    raw = {"change_id": str(uuid.uuid4()), "entity_type": entity_type, "entity_id": entity_id or str(uuid.uuid4()),
           "parent_id": None, "op": op, "changed_at": AT}
    if fields is not None:
        raw["fields"] = fields
    return REGISTRY.parse_change(raw, REGISTRY.types_in({"training"}), "device")


def test_ことばの種類だけを_training_の_scope_で登録する():
    assert set(REGISTRY.specs) == set(ENTITY_TYPES)
    assert REGISTRY.types_in({"training"}) == set(ENTITY_TYPES)
    assert REGISTRY.types_in({"meals"}) == set()


def test_表現を作れる():
    assert not isinstance(change("expression", fields=EXPRESSION), Rejection)


def test_補う項目はアプリから書けない():
    r = change("expression", "update", {"meaning": "納得できる"})
    assert isinstance(r, Rejection) and r.code == "op_not_allowed"
    assert not isinstance(change("expression", "update", {"reading": "ふにおちる", "register": "spoken",
                                                          "register_by": "user"}), Rejection)


def test_段階は手札のときだけ():
    r = change("expression", fields={**EXPRESSION, "stage": "understood"})
    assert isinstance(r, Rejection)
    assert not isinstance(change("expression", fields={**EXPRESSION, "place": "hand", "stage": "understood"}), Rejection)


@pytest.mark.parametrize("entity_type", ["source", "tag"])
def test_場所とタグは消せない_隠す(entity_type):
    r = change(entity_type, "delete")
    assert isinstance(r, Rejection) and r.code == "op_not_allowed"
    assert not isinstance(change(entity_type, "update", {"hidden": True}), Rejection)


def test_振り返りの記録は追記だけ():
    fields = {"expression_id": str(uuid.uuid4()), "kind": "recall", "result": "said", "reviewed_at": AT}
    assert not isinstance(change("review", fields=fields), Rejection)
    assert isinstance(change("review", "update", {"result": "blank"}), Rejection)
    assert not isinstance(change("review", "delete"), Rejection)
    r = change("review", fields={**fields, "kind": "use"})
    assert isinstance(r, Rejection) and r.errors[0]["field"] == "fields.result"


def test_つながりの_ID_は表現とタグから決める():
    expression_id, tag_id = str(uuid.uuid4()), SEED_TAGS[0].id
    fields = {"expression_id": expression_id, "tag_id": tag_id, "added_by": "user", "status": "confirmed"}
    assert isinstance(change("expression_tag", fields=fields), Rejection)
    ok = change("expression_tag", fields=fields, entity_id=expression_tag_id(expression_id, tag_id))
    assert not isinstance(ok, Rejection)


def test_子は表現と一緒に消える():
    for entity_type in ("expression_tag", "encounter", "review"):
        assert REGISTRY.owner(entity_type) == ("expression", "expression_id")


def test_並びのキーは表現の_normalized_key():
    doc = Doc("expression", "x", EntityState("expression", "x", None, {"normalized_key": "ふにおちる"}))
    assert expression_index_key(doc) == "ふにおちる"
    empty = Doc("expression", "x", EntityState("expression", "x", None, {"normalized_key": ""}))
    assert expression_index_key(empty) is None  # 空の形は LSI のキーにできない
    assert REGISTRY.index_key(Doc("encounter", "y", EntityState("encounter", "y", None, {}))) is None


def test_ID_は_UUID():
    raw = {"change_id": str(uuid.uuid4()), "entity_type": "expression", "entity_id": "not-a-uuid", "parent_id": None,
           "op": "create", "changed_at": AT, "fields": EXPRESSION}
    assert isinstance(REGISTRY.parse_change(raw, REGISTRY.types_in({"training"}), "d"), Rejection)
