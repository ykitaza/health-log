"""同期の API の入口。API Gateway（HTTP API、形式 2.0）のイベントを作って呼ぶ。種類はテスト用のもの（conftest）。"""

import base64
import json
import uuid

import pytest

from sync.engine import SyncEngine
from sync.presentation.http_api import SyncHttpApi
from sync.store import InMemorySyncStore
from tests.conftest import REGISTRY

APP_CLIENT = "app-client-id"
ALL_SCOPES = "openid torelog-api/meals.read torelog-api/meals.write torelog-api/training.read torelog-api/training.write"
SET = {"entry_id": "e1", "set_index": 0, "weight_kg": 60, "reps": 10, "memo": "", "done": False}
MEAL = {"date": "2026-11-08", "slot": "lunch", "time": "12:30", "description": "定食", "source": "text"}
ITEM = {"name": "白米", "amount": 200, "kcal": 312}


@pytest.fixture
def engine():
    return SyncEngine(InMemorySyncStore(REGISTRY.index_key), REGISTRY, clock=lambda: "2026-11-08T10:00:00.000Z")


@pytest.fixture
def api(engine):
    app = SyncHttpApi(engine, REGISTRY, APP_CLIENT, routes={("GET", "/v1/extra"): lambda caller, event: {"user": caller.user}})

    def call(method, path, body=None, query=None, sub="alice", scope=ALL_SCOPES, claims=None, raw_body=None,
             base64=False):
        if claims is None:
            claims = {"sub": sub, "scope": scope, "client_id": APP_CLIENT, "token_use": "access"}
        event = {
            "rawPath": path,
            "requestContext": {"http": {"method": method}, "authorizer": {"jwt": {"claims": claims}}},
            "queryStringParameters": query,
            "body": raw_body if raw_body is not None else (json.dumps(body) if body is not None else None),
            "isBase64Encoded": base64,
        }
        res = app.handle(event)
        return res["statusCode"], json.loads(res["body"]), res["headers"]["content-type"]

    return call


def change(entity_type="workout_set", entity_id="s1", op="create", fields=SET, **extra):
    c = {"change_id": str(uuid.uuid4()), "entity_type": entity_type, "entity_id": entity_id, "op": op,
         "changed_at": "2026-11-08T09:00:00.000Z", **extra}
    if fields is not None and op in ("create", "update"):
        c["fields"] = fields
    return c


def push(api, *changes, **kwargs):
    return api("POST", "/v1/sync/changes", {"device_id": "pixel", "changes": list(changes)}, **kwargs)


# --- 正常 ---

def test_送った変更を受け取れる(api):
    status, body, _ = push(api, change(), change("meal", "m1", fields=MEAL))
    assert status == 200 and [r["status"] for r in body["results"]] == ["accepted", "accepted"]
    assert body["cursor"] == 2
    status, page, _ = api("GET", "/v1/sync/changes", query={"after": "0"})
    assert status == 200 and not page["has_more"] and page["next_cursor"] == 2
    first = page["entries"][0]
    assert first["change"]["origin"] == "app" and first["change"]["device_id"] == "pixel"
    assert first["state"]["fields"]["reps"] == 10 and first["state"]["deleted"] is False


def test_同じ本文を送り直しても1回分(api):
    body = [change()]
    push(api, *body)
    status, again, _ = push(api, *body)
    assert again["results"][0]["status"] == "duplicate" and again["results"][0]["seq"] == 1
    assert len(api("GET", "/v1/sync/changes")[1]["entries"]) == 1


def test_カーソルのページ送り(api):
    push(api, *[change(entity_id=f"s{n}") for n in range(5)])
    _, page, _ = api("GET", "/v1/sync/changes", query={"after": "0", "limit": "2"})
    assert [e["change"]["seq"] for e in page["entries"]] == [1, 2] and page["has_more"]
    _, page, _ = api("GET", "/v1/sync/changes", query={"after": str(page["next_cursor"]), "limit": "2"})
    assert [e["change"]["seq"] for e in page["entries"]] == [3, 4]


def test_スナップショットのページ送り(api):
    push(api, *[change(entity_id=f"s{n}") for n in range(3)])
    push(api, change(entity_id="s1", op="delete"))
    _, first, _ = api("GET", "/v1/sync/snapshot", query={"limit": "2"})
    assert first["cursor"] == 4 and first["next_page_token"]
    _, second, _ = api("GET", "/v1/sync/snapshot", query={"limit": "2", "page_token": first["next_page_token"]})
    states = first["states"] + second["states"]
    assert second["next_page_token"] is None
    assert {s["entity_id"]: s["deleted"] for s in states} == {"s0": False, "s1": True, "s2": False}


def test_親と一緒に保存する種類は_parent_id_つきで受け取れる(api):
    push(api, change("meal", "m1", fields=MEAL), change("meal_item", "rice", fields=ITEM, parent_id="m1"))
    _, snap, _ = api("GET", "/v1/sync/snapshot")
    assert [(s["entity_type"], s["parent_id"]) for s in snap["states"]] == [("meal", None), ("meal_item", "m1")]


# --- 不正な入力 ---

@pytest.mark.parametrize("bad,code", [
    ({"fields": {**SET, "reps": "10"}}, "invalid_fields"),  # 型
    ({"fields": {**SET, "reps": -1}}, "invalid_fields"),  # 範囲
    ({"fields": {**SET, "weight": 60}}, "invalid_fields"),  # 知らない項目
    ({"fields": {**SET, "done": 1}}, "invalid_fields"),  # 真偽値に数
    ({"fields": {"set_index": 0}}, "missing_fields"),  # create に要る項目がない
    ({"entity_type": "workout"}, "invalid_fields"),  # 知らない種類
    ({"op": "upsert"}, "invalid_fields"),
    ({"changed_at": "2026-11-08T09:00:00"}, "invalid_fields"),  # 時差がない
    ({"origin": "mcp"}, "invalid_fields"),  # アプリは mcp を名乗れない
    ({"parent_id": "m1"}, "parent_id_not_allowed"),
    ({"entity_id": "../x"}, "invalid_fields"),
    ({"extra": 1}, "invalid_fields"),
])
def test_不正な変更はその変更だけ断る(api, bad, code):
    status, body, _ = push(api, {**change(entity_id="bad"), **bad}, change(entity_id="good"))
    assert status == 200
    assert body["results"][0]["status"] == "rejected" and body["results"][0]["error"]["code"] == code
    assert body["results"][1]["status"] == "accepted"
    _, snap, _ = api("GET", "/v1/sync/snapshot")
    assert [s["entity_id"] for s in snap["states"]] == ["good"]


def test_項目の誤りは場所つきで返す(api):
    _, body, _ = push(api, change(fields={**SET, "reps": -1}))
    assert body["results"][0]["error"]["errors"][0]["field"] == "changes[0].fields.reps"


def test_親の要る種類に_parent_id_がないと断る_null_にできない項目に_null_も断る(api):
    item = {"name": "白米"}
    _, body, _ = push(api, change("meal_item", "rice", op="update", fields=item),
                      change("meal", "m1", op="update", fields={"slot": None}))
    assert [r["error"]["code"] for r in body["results"]] == ["missing_parent_id", "invalid_fields"]


def test_種類ごとの_ID_の決まりと_項目の組み合わせの決まり(api):
    _, body, _ = push(api, change("nutrition_goal", "other", fields={"policy": "bulk"}),
                      change("nutrition_goal", "current", fields={"policy": "bulk"}),
                      change("named", "named-x", fields={"name": "y"}),
                      change("named", "named-y", fields={"name": "y"}))
    assert [r["status"] for r in body["results"]] == ["rejected", "accepted", "rejected", "accepted"]


def test_削除に_fields_は入れない(api):
    _, body, _ = push(api, {**change(op="delete", fields=None), "fields": SET})
    assert body["results"][0]["error"]["code"] == "fields_not_allowed"


@pytest.mark.parametrize("body", [
    {"device_id": "pixel"},
    {"device_id": "", "changes": [change()]},
    {"device_id": "pixel", "changes": []},
    {"device_id": "pixel", "changes": [change(entity_id=f"s{n}") for n in range(26)]},
    {"device_id": "pixel", "changes": [{**change(), "change_id": "not-a-uuid"}]},
    {"device_id": "pixel", "changes": ["x"]},
    {"device_id": "pixel", "changes": [change()], "user": "bob"},  # 利用者は本文で決めない
])
def test_本文の形が違えば_400_で1件も受け付けない(api, body):
    status, problem, content_type = api("POST", "/v1/sync/changes", body)
    assert status == 400 and content_type == "application/problem+json" and problem["status"] == 400
    assert api("GET", "/v1/sync/changes")[1]["entries"] == []


def test_同じ_change_id_が2回あれば_400(api):
    c = change()
    assert push(api, c, c)[0] == 400


@pytest.mark.parametrize("raw", ["not json", '{"device_id": "p", "changes": [NaN]}'])
def test_JSON_でなければ_400(api, raw):
    assert api("POST", "/v1/sync/changes", raw_body=raw)[0] == 400


@pytest.mark.parametrize("query", [{"after": "-1"}, {"after": "x"}, {"limit": "0"}, {"limit": "501"},
                                   {"after": "²"}, {"limit": "１０"}, {"after": "٣"}, {"after": "9" * 5000}])
def test_カーソルと件数が範囲の外なら_400(api, query):
    status, problem, content_type = api("GET", "/v1/sync/changes", query=query)
    assert status == 400 and content_type == "application/problem+json"


@pytest.mark.parametrize("query", [{"limit": "²"}, {"limit": "１０"}, {"limit": "9" * 5000}])
def test_スナップショットの件数が数字でなければ_400(api, query):
    assert api("GET", "/v1/sync/snapshot", query=query)[0] == 400


def test_本文が_64KB_を超えると_413_で1件も受け付けない(api):
    big = {"device_id": "pixel", "changes": [change()], "pad": "x" * (64 * 1024)}
    status, problem, content_type = api("POST", "/v1/sync/changes", raw_body=json.dumps(big))
    assert status == 413 and content_type == "application/problem+json" and problem["status"] == 413
    assert api("GET", "/v1/sync/changes")[1]["entries"] == []


def test_本文の大きさは_base64_を戻してから数える(api):
    body = json.dumps({"device_id": "pixel", "changes": [change()]}).encode()
    event_body = base64.b64encode(body).decode()
    assert api("POST", "/v1/sync/changes", raw_body=event_body, base64=True)[0] == 200
    big = base64.b64encode(b" " * (64 * 1024) + body).decode()
    assert api("POST", "/v1/sync/changes", raw_body=big, base64=True)[0] == 413


def test_64KB_ちょうどの本文は受け付ける(api):
    body = json.dumps({"device_id": "pixel", "changes": [change()]})
    raw = body + " " * (64 * 1024 - len(body.encode()))
    assert api("POST", "/v1/sync/changes", raw_body=raw)[0] == 200


def bulk_logs(caplog):
    return [r.getMessage() for r in caplog.records if "bulk_delete" in r.getMessage()]


def set_of(n, entry):
    return change(entity_id=f"s{n}", fields={**SET, "entry_id": entry})


def test_delete_が多い送信はログに数を出す(api, caplog):
    # セットの親（種目）がみな違う：親の数で10
    push(api, *[set_of(n, f"e{n}") for n in range(12)])
    with caplog.at_level("WARNING", logger="sync.http_api"):
        push(api, *[change(entity_id=f"s{n}", op="delete") for n in range(9)])
        assert not bulk_logs(caplog)
        push(api, *[change(entity_id=f"s{n}", op="delete") for n in range(9, 12)],
             *[change(entity_id=f"s{n}", op="restore") for n in range(9)])
        assert not bulk_logs(caplog)
        push(api, *[change(entity_id=f"s{n}", op="delete") for n in range(10)])
    assert bulk_logs(caplog) == ["bulk_delete deletes=10 delete_changes=10 changes=10"]
    assert "alice" not in bulk_logs(caplog)[0]


def test_種目を外すだけなら_セットが多くても鳴らない(api, caplog):
    # 種目1件とそのセット15件。セットは保存してある entry_id で親にまとめ、種目と同じ1つに数える
    push(api, *[set_of(n, "e1") for n in range(15)])
    with caplog.at_level("WARNING", logger="sync.http_api"):
        push(api, change("workout_entry", "e1", op="delete"),
             *[change(entity_id=f"s{n}", op="delete") for n in range(15)])
        # 種目を残してセットだけ15件消しても（記録を直したとき）1つ
        push(api, *[set_of(n, "e2") for n in range(15, 30)])
        push(api, *[change(entity_id=f"s{n}", op="delete") for n in range(15, 30)])
    assert not bulk_logs(caplog)


def test_食事を消すときの品目は数えない(api, caplog):
    push(api, change("meal", "m1", fields=MEAL), *[change("meal_item", f"i{n}", fields=ITEM, parent_id="m1")
                                                   for n in range(20)])
    with caplog.at_level("WARNING", logger="sync.http_api"):
        push(api, change("meal", "m1", op="delete"),
             *[change("meal_item", f"i{n}", op="delete", parent_id="m1") for n in range(20)])
    assert not bulk_logs(caplog)


def test_親が10あれば子といっしょでも鳴る(api, caplog):
    # 1日の記録を全部消す（種目10件とそれぞれのセット）。1回の送信は25件までなので、種目10件＋セット15件
    push(api, *[set_of(n, f"e{n % 10}") for n in range(15)])
    with caplog.at_level("WARNING", logger="sync.http_api"):
        push(api, *[change("workout_entry", f"e{n}", op="delete") for n in range(10)],
             *[change(entity_id=f"s{n}", op="delete") for n in range(15)])
    assert bulk_logs(caplog) == ["bulk_delete deletes=10 delete_changes=25 changes=25"]


def test_親のわからない子は1件ずつ数える(api, caplog):
    # まだ保存していないセット（親を読めない）は、それぞれを1つに数える
    with caplog.at_level("WARNING", logger="sync.http_api"):
        push(api, *[change(entity_id=f"x{n}", op="delete") for n in range(10)])
    assert bulk_logs(caplog) == ["bulk_delete deletes=10 delete_changes=10 changes=10"]


@pytest.mark.parametrize("token", ["!!!", base64.urlsafe_b64encode(b'{"after": "SYNC#LOG#1"}').decode(),
                                   base64.urlsafe_b64encode(b"[]").decode()])
def test_壊れた_page_token_は_400(api, token):
    assert api("GET", "/v1/sync/snapshot", query={"page_token": token})[0] == 400


def test_ないパスは_404(api):
    assert api("GET", "/v1/sync/unknown")[0] == 404


# --- 利用者と scope ---

def test_ほかの人のデータは見えない_同じ_ID_を送っても別のもの(api):
    push(api, change(), sub="alice")
    assert api("GET", "/v1/sync/changes", sub="bob")[1]["entries"] == []
    assert api("GET", "/v1/sync/snapshot", sub="bob")[1]["states"] == []
    push(api, change(op="update", fields={"reps": 1}), sub="bob")  # bob の s1 は alice の s1 と別
    _, alice, _ = api("GET", "/v1/sync/snapshot", sub="alice")
    assert alice["states"][0]["fields"]["reps"] == 10


def test_ほかの人の_page_token_を使っても自分の分しか読めない(api):
    push(api, *[change(entity_id=f"s{n}") for n in range(3)], sub="alice")
    _, first, _ = api("GET", "/v1/sync/snapshot", query={"limit": "1"}, sub="alice")
    _, bob, _ = api("GET", "/v1/sync/snapshot", query={"page_token": first["next_page_token"]}, sub="bob")
    assert bob["states"] == []


@pytest.mark.parametrize("claims", [
    {},  # オーソライザーを通っていない（設定の誤り）
    {"scope": ALL_SCOPES, "client_id": APP_CLIENT, "token_use": "access"},  # sub がない
    {"sub": "alice", "client_id": APP_CLIENT, "token_use": "id"},  # ID トークン
    {"sub": "alice", "scope": ALL_SCOPES, "client_id": "authz-api-client", "token_use": "access"},  # 別のクライアント
])
def test_クレームがない_または別のトークンなら_401(api, claims):
    status, problem, _ = api("GET", "/v1/sync/changes", claims=claims)
    assert status == 401 and problem["status"] == 401


def test_書く_scope_がない種類は断る(api):
    status, body, _ = push(api, change(), change("meal", "m1", fields=MEAL),
                           scope="torelog-api/meals.write")
    assert [r["status"] for r in body["results"]] == ["rejected", "accepted"]
    assert body["results"][0]["error"]["code"] == "insufficient_scope"


def test_読む_scope_がない種類は受け取らない(api):
    push(api, change(), change("meal", "m1", fields=MEAL))
    _, page, _ = api("GET", "/v1/sync/changes", scope="torelog-api/meals.read")
    assert [e["change"]["entity_type"] for e in page["entries"]] == ["meal"] and page["next_cursor"] == 2
    _, snap, _ = api("GET", "/v1/sync/snapshot", scope="torelog-api/training.read")
    assert [s["entity_type"] for s in snap["states"]] == ["workout_set"]


def test_別のリソースサーバーの_scope_は数えない(api):
    _, body, _ = push(api, change(), scope="other-api/training.write training.write")
    assert body["results"][0]["error"]["code"] == "insufficient_scope"


def test_コンテキストが足したルートも_クレームで利用者を決める(api):
    assert api("GET", "/v1/extra", sub="alice")[1] == {"user": "alice"}
    assert api("GET", "/v1/extra", claims={})[0] == 401


def test_同じルートを2回足すと断る(engine):
    with pytest.raises(ValueError):
        SyncHttpApi(engine, REGISTRY, APP_CLIENT, routes={("GET", "/v1/sync/changes"): lambda c, e: {}})
