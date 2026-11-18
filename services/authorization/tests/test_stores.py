"""保存先（MemoryStore と DynamoDBStore）が、同じ約束（oauth/store.py の Store）を守るか。"""

import json
import time

import pytest

from infrastructure.stores import MemoryStore
from oauth.store import ConditionFailed

TTL = 3600


@pytest.fixture(params=["memory", "dynamodb"])
def store(request):
    return MemoryStore() if request.param == "memory" else request.getfixturevalue("dynamodb_store")


def family(current_hash: str, **extra) -> dict:
    return {"id": "fam", "current_hash": current_hash, **extra}


def test_put_get_pop(store):
    store.put("refresh", "fam", family("a"), TTL)
    assert store.get("refresh", "fam") == family("a")
    assert store.pop("refresh", "fam") == family("a")
    assert store.get("refresh", "fam") is None


def test_conditional_put_replaces_only_when_current_hash_matches(store):
    store.put("refresh", "fam", family("a"), TTL)
    store.put("refresh", "fam", family("b", previous_hash="a"), TTL, expected=("current_hash", "a"))
    assert store.get("refresh", "fam") == family("b", previous_hash="a")

    # 読んだあとに、ほかの更新が先に置き換えた（a はもう最新ではない）
    with pytest.raises(ConditionFailed):
        store.put("refresh", "fam", family("c", previous_hash="a"), TTL, expected=("current_hash", "a"))
    assert store.get("refresh", "fam") == family("b", previous_hash="a")  # 上書きしない


def test_conditional_put_does_not_bring_back_a_revoked_family(store):
    store.put("refresh", "fam", family("a"), TTL)
    store.pop("refresh", "fam")  # 再使用を見つけて系列ごと消した
    with pytest.raises(ConditionFailed):
        store.put("refresh", "fam", family("b"), TTL, expected=("current_hash", "a"))
    assert store.get("refresh", "fam") is None


def test_conditional_put_accepts_only_guarded_fields(store):
    store.put("refresh", "fam", family("a"), TTL)
    with pytest.raises(ValueError):
        store.put("refresh", "fam", family("b"), TTL, expected=("id", "fam"))


def legacy_item(current_hash: str) -> dict:
    # current_hash を項目として書く前に保存した形（data の JSON だけ）
    return {"pk": "refresh#fam", "data": json.dumps(family(current_hash, expires_at=time.time() + TTL)),
            "expires_at": int(time.time()) + TTL}


def test_dynamodb_writes_current_hash_as_an_attribute_for_the_condition(dynamodb_store):
    dynamodb_store.put("refresh", "fam", family("a"), TTL)
    item = dynamodb_store.table.get_item(Key={"pk": "refresh#fam"})["Item"]
    assert item["current_hash"] == "a"


def test_dynamodb_conditional_put_on_a_family_stored_before_the_attribute(dynamodb_store):
    hash_a, hash_b = "a" * 64, "b" * 64
    dynamodb_store.table.put_item(Item=legacy_item(hash_a))
    with pytest.raises(ConditionFailed):  # 違うハッシュでは置き換えない
        dynamodb_store.put("refresh", "fam", family(hash_b), TTL, expected=("current_hash", hash_b))
    # data の JSON の current_hash で比べて、置き換える
    dynamodb_store.put("refresh", "fam", family(hash_b, previous_hash=hash_a), TTL, expected=("current_hash", hash_a))
    assert dynamodb_store.get("refresh", "fam")["current_hash"] == hash_b
    # 置き換えたあとは項目があるので、古いハッシュの previous_hash には当たらない
    with pytest.raises(ConditionFailed):
        dynamodb_store.put("refresh", "fam", family("c" * 64), TTL, expected=("current_hash", hash_a))
