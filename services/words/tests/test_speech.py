"""「聞く」の読み上げ：台本の型（SSML）と、アプリ用の API の POST /v1/audio（Polly は偽物に差し替える）。"""

import base64
import json
import uuid
from pathlib import Path

import anyio

import app_api
from tests.conftest import Clock
from words.application.service import CaptureInput, EnrichInput, TagRequest
from words.domain import model as m
from words.domain.speech import PAUSES, build_script
from words.main import create_engine, create_service

APP_CLIENT = "torelog-app-client-id"


def expression(**kw) -> m.Expression:
    base = dict(id="x", text="腑に落ちる", normalized_key="腑に落ちる", place=m.Place.HAND, reading="ふにおちる",
                meaning="心の底から納得できる", nuance="頭で分かるだけでなく、気持ちでも納得したとき",
                use_note="説明を聞いてやっと分かったとき")
    return m.Expression(**{**base, **kw})


def test_台本は表現_読み_説明_使い方_例文の順で_間を入れる():
    e = expression(examples=(m.Example("それなら腑に落ちるね", m.By.CLAUDE, False),
                             m.Example("やっと腑に落ちた", m.By.USER, True),
                             m.Example("説明で腑に落ちた", m.By.CLAUDE, True)))
    script = build_script(e, [])
    assert [name for name, _ in script.sections] == ["text", "reading", "explanation", "usage", "example", "example"]
    assert script.text.splitlines() == [
        "腑に落ちる", "読みは、ふにおちる。", "心の底から納得できる。 頭で分かるだけでなく、気持ちでも納得したとき。",
        "こういう時に。説明を聞いてやっと分かったとき。", "例えば。やっと腑に落ちた。", "説明で腑に落ちた。"]  # 本人 → 確かめた順に2つ
    assert script.ssml == (
        '<speak>腑に落ちる<break time="800ms"/>読みは、ふにおちる。<break time="800ms"/>'
        '心の底から納得できる。 頭で分かるだけでなく、気持ちでも納得したとき。<break time="800ms"/>'
        'こういう時に。説明を聞いてやっと分かったとき。<break time="800ms"/>'
        '例えば<break time="300ms"/>やっと腑に落ちた。<break time="500ms"/>説明で腑に落ちた。</speak>')


def test_空の項目は飛ばし_使い方がなければ使う場面のタグ():
    e = expression(reading="", nuance="", use_note="", meaning="")
    tags = [(m.Tag("t1", m.TagKind.SITUATION, "会議で", 0), m.TagStatus.CONFIRMED),
            (m.Tag("t2", m.TagKind.SITUATION, "謝る", 1), m.TagStatus.REJECTED),
            (m.Tag("t3", m.TagKind.FEELING, "安堵", 0), m.TagStatus.PROPOSED)]
    script = build_script(e, tags)
    assert script.text.splitlines() == ["腑に落ちる", "使う場面は、会議で。"]


def test_記号は_SSML_のために逃がし_長い項目は切り詰める():
    e = expression(text="A & B <c>", meaning="あ" * 1000, use_note="", reading="")
    script = build_script(e, [])
    assert "A &amp; B &lt;c&gt;" in script.ssml and "<c>" not in script.ssml
    assert len(dict(script.sections)["explanation"]) == 400


def test_アプリと同じ台本になる():
    """既定はアプリが端末の読み上げで同じ型の台本を読むので、testdata/words/speech.json で同じになることを確かめる。"""
    data = json.loads((Path(__file__).parents[3] / "testdata" / "words" / "speech.json").read_text())
    assert PAUSES == data["pause_ms"]
    for case in data["cases"]:
        e = expression(**{k: v for k, v in case["expression"].items() if k != "examples"},
                       examples=tuple(m.Example(x["text"], m.By(x["origin"]), x["confirmed"])
                                      for x in case["expression"].get("examples", [])))
        tags = [(m.Tag(f"t{n}", m.TagKind(t["kind"]), t["name"], n), m.TagStatus(t["status"]))
                for n, t in enumerate(case["tags"])]
        script = build_script(e, tags, case.get("pause", "normal"))
        assert [[name, text] for name, text in script.sections] == case["sections"], case["name"]
        assert script.ssml == case["ssml"], case["name"]


# --- POST /v1/audio ---


class FakePolly:
    def __init__(self):
        self.calls = []

    def __call__(self, ssml, voice, engine):
        self.calls.append((ssml, voice, engine))
        return b"ID3-fake-mp3"


def setup():
    engine = create_engine(None)
    polly = FakePolly()
    api = app_api.create_api(engine, APP_CLIENT, synthesize=polly)
    service = create_service(engine, Clock())
    (r,) = anyio.run(service.capture, "alice", [CaptureInput(
        "腑に落ちる", examples=("やっと腑に落ちた",), tags=(TagRequest("会議で", m.TagKind.SITUATION, m.By.USER),))])
    return api, polly, service, r["expression"]["id"]


def event(body, scope="torelog-api/training.read", headers=None, client_id=APP_CLIENT, raw=False):
    return {"rawPath": "/v1/audio", "headers": headers or {},
            "requestContext": {"http": {"method": "POST"}, "authorizer": {"jwt": {"claims": {
                "sub": "alice", "token_use": "access", "client_id": client_id, "scope": scope}}}},
            "body": body if raw else json.dumps(body)}


def test_音声を_MP3_で返し_置かない():
    api, polly, service, expression_id = setup()
    res = api.handle(event({"expression_id": expression_id}))
    assert res["statusCode"] == 200 and res["isBase64Encoded"] is True
    assert res["headers"] == {"content-type": "audio/mpeg", "cache-control": "no-store"}
    assert base64.b64decode(res["body"]) == b"ID3-fake-mp3"
    ssml, voice, engine = polly.calls[0]
    assert (voice, engine) == ("Kazuha", "neural") and ssml.startswith("<speak>腑に落ちる")
    assert "やっと腑に落ちた" in ssml and "使う場面は、会議で。" in ssml
    again = api.handle(event({"expression_id": expression_id}))
    assert again["statusCode"] == 200 and len(polly.calls) == 2  # 置かないので毎回作る
    # 補って台本が変わると、読む文も変わる
    anyio.run(service.enrich, "alice", [EnrichInput(expression_id, meaning="心から納得する")])
    api.handle(event({"expression_id": expression_id}))
    assert "心から納得する。" in polly.calls[-1][0]
    other = api.handle(event({"expression_id": expression_id, "voice": "Takumi"}))
    assert other["statusCode"] == 200 and polly.calls[-1][1] == "Takumi"


def test_間_pause_で区切りのあいだの_break_が変わり_省けば_800ms():
    api, polly, _, expression_id = setup()
    for pause, ms in (("short", 400), ("normal", 800), ("long", 1600)):
        assert api.handle(event({"expression_id": expression_id, "pause": pause}))["statusCode"] == 200
        ssml = polly.calls[-1][0]
        assert f'腑に落ちる<break time="{ms}ms"/>' in ssml and ssml.count(f'<break time="{ms}ms"/>') >= 2
        assert '<break time="300ms"/>' in ssml  # 「例えば」のあとは変わらない
    api.handle(event({"expression_id": expression_id}))
    assert polly.calls[-1][0] == polly.calls[1][0]  # 省くと normal と同じ（古いアプリ）
    n = len(polly.calls)
    for bad in ("fast", 1, None, ["short"]):
        assert api.handle(event({"expression_id": expression_id, "pause": bad}))["statusCode"] == 400
    assert len(polly.calls) == n


def test_音声の入口の確かめ():
    api, polly, _, expression_id = setup()
    assert api.handle(event({"expression_id": str(uuid.uuid4())}))["statusCode"] == 404
    assert api.handle(event({"expression_id": "not-uuid"}))["statusCode"] == 400
    assert api.handle(event({"expression_id": expression_id, "voice": "Joanna"}))["statusCode"] == 400
    assert api.handle(event({"expression_id": expression_id, "x": 1}))["statusCode"] == 400
    assert api.handle(event("x" * 2000, raw=True))["statusCode"] == 413
    assert api.handle(event({"expression_id": expression_id}, scope="torelog-api/meals.read"))["statusCode"] == 403
    assert api.handle(event({"expression_id": expression_id}, client_id="authz-api"))["statusCode"] == 401
    assert polly.calls == []


def test_ほかの利用者の表現は読めない():
    api, polly, _, expression_id = setup()
    e = event({"expression_id": expression_id})
    e["requestContext"]["authorizer"]["jwt"]["claims"]["sub"] = "bob"
    assert api.handle(e)["statusCode"] == 404 and polly.calls == []


def test_Polly_が失敗したら_500():
    engine = create_engine(None)

    def broken(ssml, voice, engine_name):
        raise RuntimeError("polly down")

    api = app_api.create_api(engine, APP_CLIENT, synthesize=broken)
    (r,) = anyio.run(create_service(engine, Clock()).capture, "alice", [CaptureInput("腑に落ちる")])
    res = api.handle(event({"expression_id": r["expression"]["id"]}))
    assert res["statusCode"] == 500 and "polly" not in res["body"]


def test_同期のルートはそのまま():
    api, _, _, _ = setup()
    e = event({})
    e["rawPath"], e["requestContext"]["http"]["method"] = "/v1/sync/snapshot", "GET"
    e["body"] = None
    assert api.handle(e)["statusCode"] == 200
