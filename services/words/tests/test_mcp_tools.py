"""ことばの MCP のツールを、通信を通さずに呼んで確かめる（ツールごとの動き、上限、確認の決まり）。"""

import json

import pytest
from mcp.server.mcpserver.exceptions import ToolError

from words.domain.catalog import SEED_SOURCES, SEED_TAGS

ALL_TOOLS = {"capture_expression", "capture_expressions", "enrich_expressions", "tag_expressions", "move_expression",
             "record_use", "update_expression", "delete_expression", "add_source", "list_facets",
             "grep_words", "get_words", "reflection_material", "stats", "logout"}


def capture(call, text, **kw):
    return call("capture_expression", text=text, **kw)


def ids_in_place(call, place):
    return {h["id"] for h in call("grep_words", patterns=["."], place=[place], limit=50)["hits"]}


def test_ツールの一覧(call):
    import asyncio

    from mcp_connector.tools import register_connector_tools

    register_connector_tools(call.mcp, session=None)
    assert {t.name for t in asyncio.run(call.mcp.list_tools())} == ALL_TOOLS


# --- 拾う ---


def test_拾うと拾ったに入り_出会いが1つでき_最後の同期の時刻を返す(call):
    r = capture(call, "腑に落ちる", source="Audible", title="〇〇の本", locator="3章", scene="上司の説明で納得したとき")
    assert r["status"] == "recorded" and r["outcome"] == "created"
    assert r["expression"]["place"] == "collected" and r["expression"]["stage"] is None
    assert r["hand"] == {"count": 0, "limit": 10} and "last_app_sync_at" in r
    word = call("get_words", ids=[r["expression"]["id"]])["words"][0]
    assert word["source"] == "Audible" and word["scene"] == "上司の説明で納得したとき"
    assert [(e["title"], e["locator"], e["captured_via"]) for e in word["encounters"]] == [("〇〇の本", "3章", "mcp")]


def test_使いたいなら手札に入る(call):
    r = capture(call, "に尽きる", want_to_use=True)
    assert r["outcome"] == "promoted" and r["expression"]["place"] == "hand"
    assert r["expression"]["stage"] == "understood" and r["hand"]["count"] == 1
    word = call("get_words", ids=[r["expression"]["id"]])["words"][0]
    assert word["schedule"]["interval_days"] == 1 and word["schedule"]["due_on"] == "2026-11-19"


def test_同じ表現にまた出会うと_出会いを足し_空きがあれば手札に入れる(call):
    first = capture(call, "腑に落ちる")
    again = capture(call, "フニに落ちる".replace("フニ", "腑"), scene="二度目")  # 同じ形
    assert again["outcome"] == "promoted" and again["expression"]["id"] == first["expression"]["id"]
    assert "手札に入れました" in again["message"]
    third = capture(call, "腑に落ちる。")  # 句読点の違いは同じ表現
    assert third["outcome"] == "reencountered"
    word = call("get_words", ids=[first["expression"]["id"]])["words"][0]
    assert word["encounter_count"] == 3 and word["scene"] == "二度目"  # 最初は場面がなかったので写す


def test_似た表現は記録せずに候補を返し_選び直せる(call):
    first = capture(call, "腑に落ちる")
    r = capture(call, "腑に落ちた")
    assert r["status"] == "candidates" and [c["id"] for c in r["candidates"]] == [first["expression"]["id"]]
    assert call("list_facets")["total"] == 1  # 記録していない
    same = capture(call, "腑に落ちた", same_as=first["expression"]["id"], wording="腑に落ちた")
    assert same["outcome"] in ("reencountered", "promoted") and same["expression"]["id"] == first["expression"]["id"]
    new = capture(call, "腑に落ちた", same_as="new")
    assert new["outcome"] == "created" and new["expression"]["id"] != first["expression"]["id"]
    with pytest.raises(ToolError):
        capture(call, "x", same_as="no-such-id")


def test_知らない場所は記録せず_確かめてから足す(call):
    r = capture(call, "やぶさかでない", source="ポッドキャスト")
    assert r["status"] == "source_not_found" and "Audible" in r["sources"]
    assert call("list_facets")["total"] == 0
    r = capture(call, "やぶさかでない", source="Audibl")
    assert r["status"] == "source_not_found" and r["source_candidates"] == ["Audible"]
    created = capture(call, "やぶさかでない", source="Podcast", create_source=True, source_icon="podcast")
    assert created["status"] == "recorded"
    again = capture(call, "一石二鳥", source="ｐｏｄｃａｓｔ")  # 比べる形（全角半角・大文字小文字）で同じ
    assert again["status"] == "recorded"
    sources = call("list_facets")["sources"]
    podcast = [s for s in sources if s["name"] == "Podcast"]
    assert len(podcast) == 1 and podcast[0]["icon_key"] == "podcast" and podcast[0]["count"] == 2


def test_場所を言われなければ_null_で記録する(call):
    r = capture(call, "気が置けない")
    assert call("get_words", ids=[r["expression"]["id"]])["words"][0]["source"] is None


def test_タグ_本人が言ったものは確かめた扱い_Claude_の案は案(call):
    r = capture(call, "元気出して", situations=["励ます"], feelings=["共感"], by="user")
    assert r["confirmed_tags"] == ["励ます", "共感"] and r["proposed_tags"] == []
    r2 = capture(call, "気にしないで", situations=["慰める", "雑談で"], by="claude")
    assert r2["proposed_tags"] == ["慰める", "雑談で"]
    tags = call("get_words", ids=[r2["expression"]["id"]])["words"][0]["tags"]
    assert {(t["name"], t["added_by"], t["status"]) for t in tags} == {("慰める", "claude", "proposed"),
                                                                      ("雑談で", "claude", "proposed")}


def test_一覧にないタグは付けずに知らせ_確かめてから足す(call):
    r = capture(call, "ご愁傷さまです", situations=["お悔やみ"], by="user")
    assert r["status"] == "recorded" and r["tag_not_found"][0]["name"] == "お悔やみ"
    r = capture(call, "ご愁傷さまです", situations=["お悔やみ"], by="user", create_tags=True)
    assert r["confirmed_tags"] == ["お悔やみ"]
    assert any(t["name"] == "お悔やみ" for t in call("list_facets")["situations"])


def test_手札がいっぱいなら入れずに今の手札を返す(call):
    for n in range(10):
        capture(call, f"表現{n}番目のことば{'x' * n}", want_to_use=True, same_as="new")
    r = capture(call, "あふれた表現", want_to_use=True)
    assert r["expression"]["place"] == "collected" and r["hand_full"] is True and len(r["current_hand"]) == 10
    assert r["hand"]["count"] == 10


def test_まとめて拾う_30件まで(call):
    items = [{"text": f"まとめ{n}の言葉{'あ' * n}", "same_as": "new"} for n in range(30)]
    r = call("capture_expressions", items=items)
    assert len(r["results"]) == 30 and all(x["status"] == "recorded" for x in r["results"])
    with pytest.raises(ToolError):
        call("capture_expressions", items=items + [{"text": "31件目"}])


def test_まとめて拾うとき同じ表現は2件目から出会い(call):
    r = call("capture_expressions", items=[{"text": "腑に落ちる"}, {"text": "腑に落ちる", "locator": "p.2"}])
    first, second = r["results"]
    assert first["outcome"] == "created" and second["outcome"] == "promoted"
    assert first["expression"]["id"] == second["expression"]["id"]


# --- 補う ---


def test_補うのは補う項目だけで_本人の項目と本人が決めた硬さは変えない(call, clock):
    e = capture(call, "腑に落ちる", scene="本人の場面", note="本人のメモ")["expression"]
    call("update_expression", id=e["id"], register="formal")
    r = call("enrich_expressions", items=[{
        "id": e["id"], "reading": "ふにおちる", "meaning": "納得がいく", "nuance": "腹の底から", "register": "spoken",
        "examples": ["やっと腑に落ちたよ", "それで腑に落ちた"], "similar": ["納得する"], "situations": ["会議で"],
        "usefulness": 3}])
    result = r["results"][0]
    assert result["status"] == "enriched" and result["proposed_tags"] == ["会議で"] and "note" in result
    word = call("get_words", ids=[e["id"]])["words"][0]
    assert (word["scene"], word["note"], word["register"], word["register_by"]) == ("本人の場面", "本人のメモ", "formal", "user")
    assert (word["meaning"], word["usefulness"]) == ("納得がいく", 3)
    assert word["examples"] == [{"text": "やっと腑に落ちたよ", "origin": "claude", "confirmed": False},
                                {"text": "それで腑に落ちた", "origin": "claude", "confirmed": False}]
    assert word["usefulness_until"] == "2026-12-02"  # 既定は決めた日から14日
    assert word["enriched_at"] is not None


def test_本人が断ったタグは補うときに付けない(call):
    e = capture(call, "腑に落ちる")["expression"]
    call("enrich_expressions", items=[{"id": e["id"], "situations": ["会議で"]}])
    call("tag_expressions", items=[{"id": e["id"], "reject": ["会議で"]}])
    r = call("enrich_expressions", items=[{"id": e["id"], "situations": ["会議で", "雑談で"]}])
    assert r["results"][0]["proposed_tags"] == ["雑談で"]
    tags = {t["name"]: t["status"] for t in call("get_words", ids=[e["id"]])["words"][0]["tags"]}
    assert tags == {"会議で": "rejected", "雑談で": "proposed"}


def test_補うのは20件まで_ない表現は_not_found(call):
    r = call("enrich_expressions", items=[{"id": "nope", "meaning": "x"}])
    assert r["results"][0]["status"] == "not_found"
    with pytest.raises(ToolError):
        call("enrich_expressions", items=[{"id": "nope"}] * 21)


# --- タグ ---


def test_案を確かめる_断る_本人が付けたものは外す(call):
    e = capture(call, "元気出して", situations=["励ます"], by="user")["expression"]
    call("enrich_expressions", items=[{"id": e["id"], "situations": ["雑談で"], "feelings": ["共感"]}])
    r = call("tag_expressions", items=[{"id": e["id"], "confirm": ["雑談で"], "reject": ["共感", "励ます"]}])
    result = r["results"][0]
    assert (result["confirmed"], result["rejected"], result["removed"]) == (["雑談で"], ["共感"], ["励ます"])
    assert {(t["name"], t["status"]) for t in result["tags"]} == {("雑談で", "confirmed"), ("共感", "rejected")}


def test_タグを足す_ないタグは似た名前を返す(call):
    e = capture(call, "元気出して")["expression"]
    r = call("tag_expressions", items=[{"id": e["id"], "add": [{"name": "はげます", "kind": "situation", "by": "user"}]}])
    assert r["results"][0]["tag_not_found"][0]["name"] == "はげます"
    r = call("tag_expressions", items=[{"id": e["id"], "add": [{"name": "励ます", "kind": "situation", "by": "claude"}]}])
    assert r["results"][0]["added_proposed"] == ["励ます"]


# --- 置き場所 ---


def test_手札に入れる_戻す_いっぱいなら_hand_full(call):
    ids = [capture(call, f"言葉{n}{'ー' * n}", same_as="new")["expression"]["id"] for n in range(11)]
    for i in ids[:10]:
        assert call("move_expression", id=i, to="hand")["status"] == "moved"
    full = call("move_expression", id=ids[10], to="hand")
    assert full["status"] == "hand_full" and len(full["current_hand"]) == 10
    back = call("move_expression", id=ids[0], to="collected")
    assert back["expression"]["stage"] is None and back["hand"]["count"] == 9
    assert call("move_expression", id=ids[10], to="hand")["status"] == "moved"
    assert call("move_expression", id=ids[10], to="hand")["status"] == "unchanged"
    own = call("move_expression", id=ids[10], to="own")
    assert own["expression"]["place"] == "own"


# --- 例文 ---


def test_拾うときの本人の例文と_補う_Claude_の例文(call):
    e = capture(call, "腑に落ちる", examples=["やっと腑に落ちた"])["expression"]
    capture(call, "腑に落ちる。", examples=["やっと腑に落ちた", "話を聞いて腑に落ちた"])  # また出会ったときは足す（同じ文は足さない）
    word = call("get_words", ids=[e["id"]])["words"][0]
    assert [(x["text"], x["origin"], x["confirmed"]) for x in word["examples"]] == [
        ("やっと腑に落ちた", "user", True), ("話を聞いて腑に落ちた", "user", True)]
    call("enrich_expressions", items=[{"id": e["id"], "examples": ["それなら腑に落ちるね", "説明で腑に落ちたよ"]}])
    call("update_expression", id=e["id"], confirm_examples=["それなら腑に落ちるね"])
    call("enrich_expressions", items=[{"id": e["id"], "examples": ["なるほど、腑に落ちた", "うん、腑に落ちる", "腑に落ちない？"]}])
    texts = [(x["text"], x["origin"], x["confirmed"]) for x in call("get_words", ids=[e["id"]])["words"][0]["examples"]]
    # 本人の例文と、本人が確かめた Claude の例文は残り、確かめていない Claude の例文は入れ替わる
    assert texts == [("やっと腑に落ちた", "user", True), ("話を聞いて腑に落ちた", "user", True),
                     ("それなら腑に落ちるね", "claude", True), ("なるほど、腑に落ちた", "claude", False),
                     ("うん、腑に落ちる", "claude", False), ("腑に落ちない？", "claude", False)]
    call("update_expression", id=e["id"], remove_examples=["腑に落ちない？"], add_examples=["今日の会議で腑に落ちた"])
    texts = [x["text"] for x in call("get_words", ids=[e["id"]])["words"][0]["examples"]]
    assert "腑に落ちない？" not in texts and texts[-1] == "今日の会議で腑に落ちた"
    with pytest.raises(ToolError):
        call("update_expression", id=e["id"], confirm_examples=["ない例文"])


def test_補う例文は2から3個(call):
    e = capture(call, "腑に落ちる")["expression"]
    with pytest.raises(ToolError):
        call("enrich_expressions", items=[{"id": e["id"], "examples": ["一つだけ"]}])
    with pytest.raises(ToolError):
        call("enrich_expressions", items=[{"id": e["id"], "examples": ["1", "2", "3", "4"]}])


def test_例文でも探せる(call):
    e = capture(call, "腑に落ちる", examples=["部長の説明でやっと納得"])["expression"]
    r = call("grep_words", patterns=["部長の説明"])
    assert [(h["id"], h["field"]) for h in r["hits"]] == [(e["id"], "examples")]


# --- 使えた ---


def test_使えたで間隔が延び_違う日に2回で自分の言葉を勧める(call, clock):
    e = capture(call, "腑に落ちる", want_to_use=True)["expression"]
    r = call("record_use", id=e["id"], scene="会議で", note="うまく言えた")
    assert (r["interval_days"], r["expression"]["stage"], r["own_ready"]) == (7, "used", False)
    word = call("get_words", ids=[e["id"]])["words"][0]
    assert word["note"] == "" and word["recent_uses"] == [{"used_on": "2026-11-18", "scene": "会議で", "note": "うまく言えた"}]
    again = call("record_use", id=e["id"])  # 同じ日の2回目は間隔を変えない
    assert again["interval_days"] == 7 and again["own_ready"] is False and again["use_count"] == 2
    clock.advance(days=3)
    r = call("record_use", id=e["id"])
    assert r["interval_days"] == 21 and r["own_ready"] is True and "自分の言葉" in r["message"]
    assert call("get_words", ids=[e["id"]])["words"][0]["place"] == "hand"  # 自動では移さない


def test_使えた日は今日か前の日_夜中は前の日(call, clock):
    e = capture(call, "腑に落ちる", want_to_use=True)["expression"]
    with pytest.raises(ToolError):
        call("record_use", id=e["id"], used_on="2026-11-19")
    r = call("record_use", id=e["id"], used_on="2026-11-17")
    assert r["due_on"] == "2026-11-24"
    clock.advance(hours=6)  # 11-19 03:00 はまだ 11-18
    r = call("record_use", id=e["id"])
    assert call("get_words", ids=[e["id"]])["words"][0]["recent_uses"][0]["used_on"] == "2026-11-18"


def test_振り返りのツールはない(call):
    import asyncio

    names = {t.name for t in asyncio.run(call.mcp.list_tools())}
    assert "record_review" not in names


# --- 直す・消す ---


def test_本人が言ったとおりに直す_出会いも直せる(call):
    e = capture(call, "腑に落ちる", source="Audible", title="本")["expression"]
    word = call("get_words", ids=[e["id"]])["words"][0]
    r = call("update_expression", id=e["id"], text="腑に落ちた", star=True, encounter_id=word["encounters"][0]["id"],
             encounter={"source": "Kindle", "locator": "No.2310"})
    updated = r["expression"]
    assert (updated["text"], updated["star"]) == ("腑に落ちた", True)
    assert (updated["encounters"][0]["source"], updated["encounters"][0]["locator"]) == ("Kindle", "No.2310")
    with pytest.raises(ToolError):
        call("update_expression", id=e["id"])  # 直す項目がない
    with pytest.raises(ToolError):
        call("update_expression", id=e["id"], encounter={"title": "x"})  # encounter_id がない


def test_消すのは確かめてから_出会いと使えたも一緒に消える(call, engine):
    e = capture(call, "腑に落ちる", want_to_use=True, situations=["励ます"], by="user")["expression"]
    call("record_use", id=e["id"])
    preview = call("delete_expression", id=e["id"])
    assert preview["status"] == "needs_confirmation" and preview["encounter_count"] == 1
    assert preview["usage_count"] == 1
    assert call("get_words", ids=[e["id"]])["words"]  # まだ消えていない
    done = call("delete_expression", id=e["id"], confirmed=True)
    assert done["status"] == "deleted"
    assert call("get_words", ids=[e["id"]])["not_found"] == [e["id"]]
    deleted = {d.entity_type for t in ("expression", "encounter", "usage", "expression_tag")
               for d in engine.docs_of_type("alice", t) if d.own and d.own.deleted}
    assert deleted == {"expression", "encounter", "usage", "expression_tag"}


# --- 出会った場所 ---


def test_場所を足す_同じ名前は足さない(call):
    assert call("add_source", name="Podcast", icon="podcast")["status"] == "created"
    assert call("add_source", name=" podcast ")["status"] == "exists"
    assert call("add_source", name="Audible")["source"]["id"] == SEED_SOURCES[0].id


# --- 読む ---


def test_語彙と件数(call):
    a = capture(call, "元気出して", source="会話", situations=["励ます"], by="user")["expression"]
    capture(call, "気にしないで", source="会話", situations=["励ます"], by="claude")
    call("move_expression", id=a["id"], to="hand")
    f = call("list_facets")
    encourage = next(t for t in f["situations"] if t["name"] == "励ます")
    assert (encourage["confirmed"], encourage["proposed"]) == (1, 1)
    assert len(f["situations"]) == 13 and len(f["feelings"]) == 7
    assert next(s for s in f["sources"] if s["name"] == "会話")["count"] == 2
    assert f["places"] == {"collected": 1, "hand": 1, "own": 0} and f["stages"]["understood"] == 1
    assert f["total"] == 2 and f["hand"] == {"count": 1, "limit": 10}


def _seed_for_grep(call):
    a = capture(call, "元気出して", situations=["励ます"], by="user", star=True)["expression"]
    b = capture(call, "気にしないで", situations=["励ます", "慰める"], by="claude",
                surrounding_text="落ち込んでいる友達に「気にしないで」と言った", title="〇〇さんとの会話")["expression"]
    c = capture(call, "腑に落ちる")["expression"]
    call("enrich_expressions", items=[{"id": c["id"], "reading": "ふにおちる", "meaning": "励ますより納得の言葉"},
                                      {"id": b["id"], "meaning": "相手を慰めるときの一言"}])
    return a, b, c


def test_探す_正規化して比べ_並べる(call):
    a, b, c = _seed_for_grep(call)
    r = call("grep_words", patterns=["フニオチ"])  # 読みにカタカナで当たる
    assert [(h["id"], h["field"]) for h in r["hits"]] == [(c["id"], "reading")]
    r = call("grep_words", patterns=["励ま"])
    # 使う場面のタグ（a・b）と意味（c）。意味の当たり（c）が先、次に確かめたタグのある a
    assert [h["id"] for h in r["hits"]] == [c["id"], a["id"], b["id"]] and r["total"] == 3
    assert set(r["hits"][0]) == {"id", "text", "field", "snippet"}


def test_探す_絞り込み(call):
    a, b, c = _seed_for_grep(call)
    assert [h["id"] for h in call("grep_words", patterns=["."], situations=["慰める"])["hits"]] == [b["id"]]
    assert [h["id"] for h in call("grep_words", patterns=["."], situations=["励ます"], confirmed_only=True)["hits"]] == [a["id"]]
    assert [h["id"] for h in call("grep_words", patterns=["."], starred=True)["hits"]] == [a["id"]]
    assert call("grep_words", patterns=["."], place=["hand"])["total"] == 0
    assert call("grep_words", patterns=["."], captured_from="2026-11-19")["total"] == 0
    with pytest.raises(ToolError):
        call("grep_words", patterns=["."], situations=["はげます"])  # ないタグ


def test_前後の文と本の名前は名指ししたときだけ探す(call):
    _, b, _ = _seed_for_grep(call)
    assert call("grep_words", patterns=["落ち込"])["total"] == 0
    r = call("grep_words", patterns=["落ち込"], fields=["surrounding_text"])
    assert [h["id"] for h in r["hits"]] == [b["id"]] and r["hits"][0]["field"] == "surrounding_text"
    assert call("grep_words", patterns=["さんとの"], fields=["title"])["total"] == 1
    with pytest.raises(ToolError):
        call("grep_words", patterns=["x"], fields=["unknown"])


def test_探す_上限_当たりは50件まで_抜き出しは40文字_応答は小さい(call):
    long_scene = "とても長い場面の説明。" * 20
    items = [{"text": f"長い表現の例その{n}の言い回し" + "ら" * (n % 7) + str(n), "scene": long_scene[:300], "same_as": "new"}
             for n in range(30)]
    call("capture_expressions", items=items)
    call("capture_expressions", items=[{**i, "text": i["text"] + "追加"} for i in items])
    r = call("grep_words", patterns=["場面"], limit=50)
    assert r["total"] == 60 and len(r["hits"]) == 50
    assert all(len(h["snippet"]) <= 40 for h in r["hits"])
    compact = json.dumps(call("grep_words", patterns=["場面"], limit=50), ensure_ascii=False, separators=(",", ":"))
    assert len(compact) < 8 * 1024  # 50件でも 8K 文字ほど（設計メモ）
    assert len(call("grep_words", patterns=["場面"])["hits"]) == 20  # 既定は20件
    with pytest.raises(ToolError):
        call("grep_words", patterns=["場面"], limit=51)
    with pytest.raises(ToolError):
        call("grep_words", patterns=["a"] * 9)
    with pytest.raises(ToolError):
        call("grep_words", patterns=["(a+)+"])


def test_読むのは10個まで_ないものは_not_found(call):
    e = capture(call, "腑に落ちる")["expression"]
    r = call("get_words", ids=[e["id"], "nope"])
    assert [w["id"] for w in r["words"]] == [e["id"]] and r["not_found"] == ["nope"]
    with pytest.raises(ToolError):
        call("get_words", ids=["x"] * 11)


def test_手札の見直しの材料(call, clock):
    hand = [capture(call, f"手札{n}{'の' * n}", want_to_use=True, same_as="new")["expression"] for n in range(4)]
    call("record_use", id=hand[1]["id"])
    clock.advance(days=46)
    star = capture(call, "気が置けない", star=True)["expression"]
    capture(call, "やぶさかでない")
    call("record_use", id=hand[1]["id"])
    r = call("reflection_material")
    assert r["days"] == 14 and len(r["hand"]) == 4 and r["hand_count"]["count"] == 4
    assert {x["group"] for x in r["listen_queue"]} <= {"due", "hand", "star", "recent"}
    assert r["listen_queue"][0]["group"] == "due"
    assert r["activity"] == {"used": 1, "listened_items": 0, "listened_minutes": 0.0}
    assert {x["id"] for x in r["suggest_to_hand"]} == {star["id"]}
    assert {x["id"] for x in r["suggest_demote"]} == {hand[0]["id"], hand[2]["id"], hand[3]["id"]}  # 使えていない
    assert [x["id"] for x in r["suggest_own"]] == [hand[1]["id"]]
    assert r["captured_total"] == 2  # 期間（14日）に拾ったもの
    with pytest.raises(ToolError):
        call("reflection_material", days=6)


def test_活動の記録(call, engine, clock):
    import uuid

    from sync.model import Change

    a = capture(call, "腑に落ちる", source="Audible", want_to_use=True)["expression"]
    capture(call, "気が置けない", source="会話")
    capture(call, "やぶさかでない")
    call("record_use", id=a["id"])
    engine.append("alice", [Change(str(uuid.uuid4()), "listen_session", str(uuid.uuid4()), None, "create",
                                   {"started_at": "2026-11-18T08:00:00+09:00", "listened_on": "2026-11-18",
                                    "seconds": 900, "items": 15}, "2026-11-18T00:00:00.000Z", "app")])
    r = call("stats")
    assert r["unit"] == "week" and len(r["periods"]) == 8 and r["to"] == "2026-11-22"
    this_week = r["periods"][-1]
    assert (this_week["captured"], this_week["used"], this_week["hand_entered"], this_week["listened_items"],
            this_week["listened_minutes"]) == (3, 1, 1, 15, 15.0)
    assert {x["source"]: x["captured"] for x in r["captured_by_source"]} == {"Audible": 1, "会話": 1, "（場所なし）": 1}
    assert r["now"] == {"collected": 2, "hand": 1, "own": 0, "total": 3} and "last_app_sync_at" in r
    month = call("stats", unit="month", count=3)
    assert [p["from"] for p in month["periods"]] == ["2026-09-01", "2026-10-01", "2026-11-01"]
    with pytest.raises(ToolError):
        call("stats", unit="month", count=13)


# --- 許可と利用者 ---


def test_読むだけの許可では書けない(call):
    call.login("alice", ["words:read"])
    with pytest.raises(ToolError, match="words:write"):
        capture(call, "腑に落ちる")
    assert call("list_facets")["total"] == 0
    call.login("alice", [])
    with pytest.raises(ToolError, match="words:read"):
        call("list_facets")


def test_利用者ごとに分かれる(call):
    capture(call, "腑に落ちる")
    call.login("bob")
    assert call("list_facets")["total"] == 0


def test_初期のタグは固定の_ID(call):
    e = capture(call, "元気出して", situations=["励ます"], by="user")["expression"]
    assert any(t["id"] == SEED_TAGS[0].id for t in call("list_facets")["situations"])
    assert json.dumps(call("get_words", ids=[e["id"]]), ensure_ascii=False).count("励ます") == 1
