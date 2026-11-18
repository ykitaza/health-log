"""MCP の入口（ことばのツール）。ツールの説明文は Claude（ChatGPT）への指示を兼ねる。

ここはツールを登録するだけで、サーバー（MCPServer）と認証は作らない（組み立ては services/words/mcp_main.py）。
scope は words:read・words:write。接続のところで両方を必須にする（KARADA のような、後から足した scope の事情がないため）が、
ツールでももう一度確かめる。
"""

from __future__ import annotations

from contextlib import contextmanager
from datetime import date
import warnings
from typing import Literal

from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp_types import ToolAnnotations
from pydantic import BaseModel, Field

from words.application import service as svc
from words.application.service import WordsService
from words.domain import model as m
from words.domain.catalog import ICON_KEYS
from words.domain.errors import WordsError
from words.domain.grep import MAX_PATTERN_LENGTH, MAX_PATTERNS
from words.domain.search_doc import ALL_FIELDS

READ_SCOPE, WRITE_SCOPE = "words:read", "words:write"

# サーバーの説明（docs/words-design.md の「サーバーの説明（instructions）の案」のまま）
INSTRUCTIONS = """日本語の表現を集めて、話すときに使えるようにするサーバー（ことば）。
表現の置き場所は3つ：拾った（集めたもの全部）、手札（言えるようになりたいもの。10個まで）、自分の言葉（使えるようになったもの）。

# 拾う
利用者が表現を拾ってと言ったら、確認せずに capture_expression で記録する（いくつもあるときは capture_expressions）。
声・写真・Kindle のハイライトから、表現そのもの、出会った場所（source。list_facets の名前）と題・位置、場面、前後の文を読み取って入れる。
場所か場面が分からないときは、記録の前に1回だけまとめて聞く（「どこで出会いましたか？（Audible・Kindle・…）どんな場面でしたか？（一言で）」）。選択肢を出せるなら list_facets の名前を選択肢にする。
答えがない、または急いでいるようなら聞き直さず、空のまま記録する。言っていない場所や場面を推測で埋めない（あとで update_expression で足せる）。
source_not_found が返ったら、似た名前があればその名前で呼び直す。新しい場所なら、足してよいかを一度だけ聞いてから create_source を付けて呼び直す。写真から読み取った前後の文は surrounding_text に入れる。
「使いたい」「言えるようになりたい」と言われたら want_to_use を付ける。
結果に candidates があれば、同じ表現（活用や言い回しの違いだけ）なら same_as にその ID を入れて呼び直す。迷うときは利用者に聞く。
記録したら一言で伝える。また出会った表現で手札に入ったときは、そのことも伝える。

利用者が使う場面・気持ち・「こういう時に使えそう」を言ったら、situations・feelings（by=user）と use_note にそのまま入れる。
言っていなければ、場面から読み取った使う場面・気持ちのタグを2つまで by=claude で付け、返事で「タグの案：励ます・雑談で（違えば言ってください）」と見せる。
タグは list_facets の名前を使う。合うものがないときだけ、新しいタグを足してよいかを一度だけまとめて聞く。

# 補う
意味やニュアンスを聞かれたら、enrich_expressions で補う。利用者の書いた表現・場面・メモ・こういう時に使えそうは変えない。
読み・意味・ニュアンス・硬さ・例文・言い換えを入れ、使う場面・気持ちのタグの案（by=claude）も付ける。利用者が決めた硬さと、利用者が断ったタグは変えない。
意味とニュアンスは、あとで言いたいことから探すときに当たるよう、ふだんの言葉で書く。例文は話し言葉で、利用者の場面に近いものにする。
タグの案を「それでいい」と言われたら tag_expressions で confirm、「違う」と言われたら reject にする。

# 探す
表現の名前や言葉で探すときは grep_words を使う。結果は短いので、言葉を変えて何度呼んでもよい。
「〇〇な時に何て言おう」「落ち込んでる友達に」のように言いたいことから探すときは、次の順にする。
1. 言いたいことを、言葉の組（言い換え・似た言葉）をいくつかと、合いそうなタグ（list_facets の語彙）に広げる
2. grep_words を数回呼ぶ（言葉の組ごと、タグで絞って）。当たりが少なければ、タグの絞りを外す・言葉を広げる・拾ったも含める、の順に広げる
3. 候補の ID を集め、get_words でまとめて読む
4. 相手との関係・場の硬さ・気持ちに合う順に3〜5個選び、なぜ合うかと、その場での言い方の例を一言添える。手札にないものは、手札に入れるかを聞く
5. 利用者が確かめたタグ（confirmed）が合うものを、案（proposed）だけのものより先にする
見つからなければ、そう伝える。持っていない表現を、拾ったもののように見せない。

# 振り返り
「ことばの振り返りをして」と頼まれたら、先に reflection_material を読む。
手札の入れ替え（入れる・拾ったに戻す・自分の言葉にする）は提案だけをし、了承を得てから move_expression を呼ぶ。手札は10個まで。
今の役立ち度（usefulness 1〜3）は、利用者の近い予定や話題から決め、理由を一言付けて enrich_expressions で書く。
覚えられていないことや、振り返りをしていないことを責めない。続けた日数を数えない。

# 使えた
「〇〇が使えた」と言われたら、確認せずに record_use で記録し、新しい間隔を一言で伝える。
自分の言葉にする条件を満たしたと返ってきたら、移すかどうかを聞く。

# 消す
delete_expression は、消すものを見せて了承を得てから呼ぶ。手札から外したいだけなら、消さずに拾ったに戻す。

結果の last_app_sync_at は、スマホのアプリ（ことば）から最後に同期で受け付けた時刻（日本時間）。
アプリで書いた分は同期するまで見えない。見当たらないと言われたら、アプリを開いて同期してもらうよう伝える。"""

READ = ToolAnnotations(read_only_hint=True)
WRITE = ToolAnnotations(read_only_hint=False, destructive_hint=False)
DESTRUCTIVE = ToolAnnotations(read_only_hint=False, destructive_hint=True)

OWN_WORDS = "利用者の言葉のまま。言っていなければ省く（推測で埋めない）"
TAG_BY = "user（利用者が言った。確かめた扱い confirmed）か claude（Claude の案。proposed で付き、返事で見せる）"


# --- 入力の型。SDK がここから JSON Schema を作り、AI に見せる ---


class CaptureItem(BaseModel):
    text: str = Field(min_length=1, max_length=m.MAX_TEXT, description="表現そのもの（「腑に落ちる」）")
    source: str | None = Field(None, max_length=m.MAX_SOURCE_NAME,
                               description="出会った場所の名前（list_facets の sources の名前）。言われていなければ省く")
    create_source: bool = Field(False, description="一覧にない場所を足すとき true。利用者に一度だけ確かめてから付ける")
    source_icon: Literal[ICON_KEYS] | None = Field(None, description="場所を足すときのアイコン")  # type: ignore[valid-type]
    situations: list[str] = Field([], max_length=10, description="使う場面のタグの名前（list_facets の situations）")
    feelings: list[str] = Field([], max_length=10, description="気持ちのタグの名前（list_facets の feelings）")
    by: Literal["user", "claude"] = Field("claude", description="situations・feelings をだれが言ったか。" + TAG_BY)
    use_note: str = Field("", max_length=m.MAX_USE_NOTE, description="こういう時に使えそう。" + OWN_WORDS)
    create_tags: bool = Field(False, description="一覧にないタグを足すとき true。利用者に一度だけまとめて確かめてから付ける")
    title: str = Field("", max_length=m.MAX_TITLE, description="本・番組・映画の題、会話の相手や場")
    locator: str = Field("", max_length=m.MAX_LOCATOR, description="位置の手がかり（3章、p.142、No.2310、1:02:30）")
    met_on: date | None = Field(None, description="出会った日（分かれば。YYYY-MM-DD）")
    time_hint: str = Field("", max_length=m.MAX_TIME_HINT, description="日付が曖昧なときの言葉（先週、通勤中）")
    scene: str = Field("", max_length=m.MAX_SCENE, description="その出会いの場面（振り返りで見せる）。" + OWN_WORDS)
    surrounding_text: str = Field("", max_length=m.MAX_SURROUNDING, description="写真やハイライトから読み取った前後の文")
    wording: str = Field("", max_length=m.MAX_WORDING, description="その出会いでの言い回し（表現と少し違うとき。腑に落ちた）")
    note: str = Field("", max_length=m.MAX_ENCOUNTER_NOTE, description="メモ。" + OWN_WORDS)
    star: bool = Field(False, description="利用者が優先したい（★）と言ったとき true")
    want_to_use: bool = Field(False, description="「使いたい」「言えるようになりたい」と言われたとき true（手札に入れる）")
    same_as: str | None = Field(None, description="candidates のうち同じ表現の ID。別の表現として作るなら \"new\"")


# 項目の名前 register（硬さ）は設計どおり。pydantic の ABC の register と名前が重なる警告は出さない
warnings.filterwarnings("ignore", message='Field name "register"', category=UserWarning)


class EnrichItem(BaseModel):
    id: str = Field(description="表現の ID")
    reading: str | None = Field(None, max_length=m.MAX_READING, description="読み（ひらがな）")
    meaning: str | None = Field(None, max_length=m.MAX_MEANING, description="意味（ふだんの言葉で）")
    nuance: str | None = Field(None, max_length=m.MAX_NUANCE, description="ニュアンス・使いどころ・似た言葉との違い")
    register: Literal["spoken", "written", "formal"] | None = Field(
        None, description="硬さ（話し言葉・書き言葉・改まった）。利用者が決めた硬さは変わらない")
    situations: list[str] = Field([], max_length=10, description="使う場面のタグの案（proposed で付く。断られたタグは付かない）")
    feelings: list[str] = Field([], max_length=10, description="気持ちのタグの案（同上）")
    examples: list[str] | None = Field(None, max_length=m.MAX_EXAMPLES, description="話し言葉の例文（3件まで、各200文字）")
    similar: list[str] | None = Field(None, max_length=m.MAX_SIMILAR, description="言い換え・似た表現（5件まで、各100文字）")
    usefulness: int | None = Field(None, ge=1, le=3, description="今の役立ち度（1 低い・2 ふつう・3 高い）。振り返りで決める")
    usefulness_reason: str | None = Field(None, max_length=m.MAX_USEFULNESS_REASON, description="役立ち度の理由を一言")
    usefulness_until: date | None = Field(None, description="役立ち度の期限。省くと今日から14日")


class TagAdd(BaseModel):
    name: str = Field(min_length=1, max_length=m.MAX_TAG_NAME, description="タグの名前（list_facets の名前）")
    kind: Literal["situation", "feeling"] = Field(description="situation（使う場面）か feeling（気持ち）")
    by: Literal["user", "claude"] = Field(description=TAG_BY)


class TagEditItem(BaseModel):
    id: str = Field(description="表現の ID")
    add: list[TagAdd] = Field([], max_length=10, description="付けるタグ")
    confirm: list[str] = Field([], max_length=10, description="利用者が「それでいい」と言ったタグの名前（confirmed にする）")
    reject: list[str] = Field([], max_length=10, description="利用者が「違う」と言ったタグの名前（Claude の案は rejected、利用者が付けたものは外す）")
    create_tags: bool = Field(False, description="一覧にないタグを足すとき true。利用者に一度だけ確かめてから付ける")


class EncounterEdit(BaseModel):
    source: str | None = Field(None, description="出会った場所の名前（list_facets）。空の文字で外す")
    title: str | None = Field(None, max_length=m.MAX_TITLE)
    locator: str | None = Field(None, max_length=m.MAX_LOCATOR)
    met_on: date | None = None
    time_hint: str | None = Field(None, max_length=m.MAX_TIME_HINT)
    scene: str | None = Field(None, max_length=m.MAX_SCENE)
    surrounding_text: str | None = Field(None, max_length=m.MAX_SURROUNDING)
    wording: str | None = Field(None, max_length=m.MAX_WORDING)
    note: str | None = Field(None, max_length=m.MAX_ENCOUNTER_NOTE)


_F = CaptureItem.model_fields  # capture_expression の引数（capture_expressions の1件と同じ形）


def _tags(situations: list[str], feelings: list[str], by: str) -> tuple[svc.TagRequest, ...]:
    who = m.By(by)
    return tuple([svc.TagRequest(n, m.TagKind.SITUATION, who) for n in situations]
                 + [svc.TagRequest(n, m.TagKind.FEELING, who) for n in feelings])


def _capture_input(item: CaptureItem) -> svc.CaptureInput:
    return svc.CaptureInput(
        text=item.text, source=item.source, create_source=item.create_source, source_icon=item.source_icon,
        tags=_tags(item.situations, item.feelings, item.by), create_tags=item.create_tags, use_note=item.use_note,
        title=item.title, locator=item.locator, met_on=item.met_on, time_hint=item.time_hint, scene=item.scene,
        surrounding_text=item.surrounding_text, wording=item.wording, note=item.note, star=item.star,
        want_to_use=item.want_to_use, same_as=item.same_as)


def register_words_tools(mcp: MCPServer, service: WordsService) -> None:
    """ことばのツールを mcp に登録する。"""

    def subject(scope: str) -> str:
        token = get_access_token()
        if token is None or scope not in token.scopes:
            what = "読む" if scope == READ_SCOPE else "書く"
            raise ToolError(f"ことばの記録を{what}許可（{scope}）がありません。コネクタの連携をいったん解除してつなぎ直し、"
                            "同意画面で許可するよう利用者に伝えてください。")
        return token.subject

    async def synced(sub: str, view: dict) -> dict:
        return {**view, "last_app_sync_at": await service.last_app_sync_at(sub)}

    # --- 拾う ---

    @mcp.tool(annotations=WRITE)
    async def capture_expression(
        text: str = _F["text"],
        source: str | None = _F["source"],
        create_source: bool = _F["create_source"],
        source_icon: Literal[ICON_KEYS] | None = _F["source_icon"],  # type: ignore[valid-type]
        situations: list[str] = _F["situations"],
        feelings: list[str] = _F["feelings"],
        by: Literal["user", "claude"] = _F["by"],
        use_note: str = _F["use_note"],
        create_tags: bool = _F["create_tags"],
        title: str = _F["title"],
        locator: str = _F["locator"],
        met_on: date | None = _F["met_on"],
        time_hint: str = _F["time_hint"],
        scene: str = _F["scene"],
        surrounding_text: str = _F["surrounding_text"],
        wording: str = _F["wording"],
        note: str = _F["note"],
        star: bool = _F["star"],
        want_to_use: bool = _F["want_to_use"],
        same_as: str | None = _F["same_as"],
    ) -> dict:
        """表現を拾う（確認なしで呼んでよい）。拾ったに入り、使いたい（want_to_use）なら手札に入れる。

        同じ表現（正規化した形が同じ）がもうあれば、新しく作らずに出会いを1つ足す（outcome=reencountered）。
        拾ったにあって手札に空きがあれば、手札に入れる（outcome=promoted。そのことを一言伝える）。
        似た表現があれば記録せずに candidates を返す。同じ表現（活用や言い回しの違いだけ）なら same_as にその ID、
        別の表現なら same_as="new" で呼び直す。迷うときは利用者に聞く。
        場所（source）が一覧になければ記録せずに source_not_found と似た名前（source_candidates）・今の一覧を返す。
        似た名前が利用者の意図ならその名前で、本当に新しい場所なら一度だけ確かめてから create_source=true で呼び直す
        （同じ会話で同じ名前をもう一度足すときは聞かない）。場所を言われていなければ source を省く。
        タグ（situations・feelings）は list_facets の名前。一覧にない名前は付けずに tag_not_found で返す（create_tags で足せる）。
        結果の hand は今の手札の数と上限（10）。
        """
        arguments = {name: value for name, value in locals().items() if name in _F}
        sub = subject(WRITE_SCOPE)
        item = CaptureItem.model_validate(arguments)
        with words_errors():
            (result,) = await service.capture(sub, [_capture_input(item)])
        if result["status"] == "error":
            raise ToolError(result["error"])
        return await synced(sub, result)

    @mcp.tool(annotations=WRITE)
    async def capture_expressions(items: list[CaptureItem]) -> dict:
        """表現をまとめて拾う（30件まで。Kindle のハイライト、写真のページ）。確認なしで呼び、拾ったあとに一覧で見せる。

        1件ごとの決まりと結果は capture_expression と同じ（results に入力の順で並ぶ）。
        candidates・source_not_found の件は記録されていないので、選び直してその件だけ呼び直す。
        """
        sub = subject(WRITE_SCOPE)
        with words_errors():
            results = await service.capture(sub, [_capture_input(i) for i in items])
        return await synced(sub, {"results": results})

    # --- 補う ---

    @mcp.tool(annotations=WRITE)
    async def enrich_expressions(items: list[EnrichItem]) -> dict:
        """表現を補う（20件まで。確認なし）。読み・意味・ニュアンス・硬さ・例文・言い換え・タグの案・今の役立ち度を書く。

        補う項目だけを変え、利用者の項目（表現・場面・メモ・こういう時に使えそう・★）は変えない。
        利用者が決めた硬さは変えず、利用者が断ったタグは付けない。タグは Claude の案（proposed）として付く。
        意味とニュアンスは、あとで言いたいことから探すときに当たるよう、ふだんの言葉で書く。
        """
        sub = subject(WRITE_SCOPE)
        inputs = [svc.EnrichInput(
            id=i.id, reading=i.reading, meaning=i.meaning, nuance=i.nuance,
            register=m.Register(i.register) if i.register else None, tags=_tags(i.situations, i.feelings, "claude"),
            examples=tuple(i.examples) if i.examples is not None else None,
            similar=tuple(i.similar) if i.similar is not None else None, usefulness=i.usefulness,
            usefulness_reason=i.usefulness_reason, usefulness_until=i.usefulness_until) for i in items]
        with words_errors():
            results = await service.enrich(sub, inputs)
        return await synced(sub, {"results": results})

    @mcp.tool(annotations=WRITE)
    async def tag_expressions(items: list[TagEditItem]) -> dict:
        """タグを付ける・確かめる・断る（20件まで）。

        利用者が言ったタグ（by=user）は確認なしで confirmed。Claude の案（by=claude）は proposed で付け、返事で見せて
        「違えば言ってください」と添える。案を「それでいい」と言われたら confirm、「違う」と言われたら reject
        （Claude の案は rejected で残し、同じ案をくり返さない。利用者が付けたものは外す）。
        一覧にないタグは tag_not_found と似た名前で返す。新しいタグを足すときだけ一度確かめてから create_tags=true。
        """
        sub = subject(WRITE_SCOPE)
        edits = [svc.TagEdit(i.id, tuple(svc.TagRequest(a.name, m.TagKind(a.kind), m.By(a.by)) for a in i.add),
                             tuple(i.confirm), tuple(i.reject), i.create_tags) for i in items]
        with words_errors():
            results = await service.tag_expressions(sub, edits)
        return await synced(sub, {"results": results})

    # --- 手札 ---

    @mcp.tool(annotations=WRITE)
    async def move_expression(id: str, to: Literal["collected", "hand", "own"], reason: str = "") -> dict:
        """表現の置き場所を変える（collected 拾った・hand 手札・own 自分の言葉）。

        利用者が頼んだときは確認なしで呼ぶ。Claude から勧める（振り返りの入れ替えなど）ときは、提案して了承を得てから呼ぶ。
        手札は10個まで。いっぱいなら移さずに hand_full と今の手札（current_hand）を返すので、どれと入れ替えるかを聞く。
        手札に入れると、意味がわかる・間隔1日から始まる。reason は記録しない（返事の参考）。
        """
        sub = subject(WRITE_SCOPE)
        with words_errors():
            result = await service.move(sub, id, m.Place(to))
        return await synced(sub, {**result, "reason": reason} if reason else result)

    @mcp.tool(annotations=WRITE)
    async def record_review(id: str, result: Literal["said", "close", "blank"], session_id: str | None = None) -> dict:
        """チャットの中で手札を振り返った結果を記録する（said 言えた・close 惜しい・blank 出てこなかった）。

        場面だけを見せて「この場面で、あなたなら何て言う？」と聞き、答えを見せてから利用者が選んだ結果を渡す（結果を推測しない）。
        言えたで間隔が延び（14日まで）、出てこなかったで縮む。同じ日の2回目は記録だけを残し、間隔は変えない。
        出てこなかったが3回続くと suggest_demote が返るので、拾ったに戻すかを聞く（自動では戻さない）。
        """
        sub = subject(WRITE_SCOPE)
        with words_errors():
            out = await service.record_review(sub, id, m.RecallResult(result), session_id)
        return await synced(sub, out)

    @mcp.tool(annotations=WRITE)
    async def record_use(id: str, used_on: date | None = None, scene: str = "", note: str = "") -> dict:
        """実際の会話で使えた（確認なしで呼ぶ）。段階が「使えた」になり、間隔が大きく延びる（7〜60日）。新しい間隔を一言で伝える。

        used_on は使えた日（省くと今日）。scene・note は利用者の言葉のまま（表現のメモに日付つきで足す）。
        違う日に2回使えると own_ready が true になるので、自分の言葉にするかを聞く（自動では移さない）。
        """
        sub = subject(WRITE_SCOPE)
        with words_errors():
            out = await service.record_use(sub, id, used_on, scene, note)
        return await synced(sub, out)

    @mcp.tool(annotations=WRITE)
    async def update_expression(
        id: str,
        text: str | None = Field(None, max_length=m.MAX_TEXT, description="表現そのもの"),
        scene: str | None = Field(None, max_length=m.MAX_SCENE, description="振り返りで見せる場面"),
        note: str | None = Field(None, max_length=m.MAX_NOTE, description="メモ"),
        star: bool | None = None,
        use_note: str | None = Field(None, max_length=m.MAX_USE_NOTE, description="こういう時に使えそう"),
        reading: str | None = Field(None, max_length=m.MAX_READING),
        register: Literal["spoken", "written", "formal"] | None = Field(
            None, description="利用者が決めた硬さ（このあと enrich では変わらない）"),
        encounter_id: str | None = Field(None, description="直す出会いの ID（get_words の encounters）"),
        encounter: EncounterEdit | None = Field(None, description="直す出会いの項目（変えるものだけ）"),
    ) -> dict:
        """利用者が言ったとおりに、表現（表現・場面・メモ・★・こういう時に使えそう・読み・硬さ）と出会いの項目を直す（確認なし）。

        変えない項目は省く。言っていないことを推測で埋めない。
        """
        sub = subject(WRITE_SCOPE)
        edit = svc.ExpressionEdit(
            id=id, text=text, scene=scene, note=note, star=star, use_note=use_note, reading=reading,
            register=m.Register(register) if register else None, encounter_id=encounter_id,
            encounter={k: (v.isoformat() if isinstance(v, date) else v)
                       for k, v in encounter.model_dump(exclude_unset=True).items()} if encounter else None)
        with words_errors():
            out = await service.update_expression(sub, edit)
        return await synced(sub, out)

    @mcp.tool(annotations=DESTRUCTIVE)
    async def delete_expression(id: str, confirmed: bool = False) -> dict:
        """表現を消す。出会いと振り返りの記録も一緒に消える（アプリからも消える）。必ず確認する。

        confirmed を省くと消さずに、消えるもの（表現・出会いの数・振り返りの数）を返す。それを利用者に見せて了承を得てから
        confirmed=true で呼び直す。手札から外したいだけなら、消さずに move_expression で拾ったに戻す。
        """
        sub = subject(WRITE_SCOPE)
        with words_errors():
            out = await service.delete_expression(sub, id, confirmed)
        return await synced(sub, out)

    @mcp.tool(annotations=WRITE)
    async def add_source(name: str = Field(min_length=1, max_length=m.MAX_SOURCE_NAME),
                         icon: Literal[ICON_KEYS] = "other") -> dict:  # type: ignore[valid-type]
        """出会った場所（Podcast など）を一覧に足す。足した場所は一覧に残り、アプリの絞り込みにも出るので、
        利用者に一度だけ確かめてから呼ぶ。同じ名前（大文字小文字・全角半角・空白の違いを除く）があれば、足さずにそれを返す。
        名前の変更・隠す・並べ替えはアプリの設定でする（ここではできない）。
        """
        sub = subject(WRITE_SCOPE)
        with words_errors():
            out = await service.add_source(sub, name, icon)
        return await synced(sub, out)

    # --- 読む ---

    @mcp.tool(annotations=READ)
    async def list_facets(include_hidden: bool = False) -> dict:
        """語彙と件数：使う場面（situations）・気持ち（feelings）のタグ（ID・名前・確かめた数 confirmed・案の数 proposed）、
        出会った場所（sources。ID・名前・アイコン・件数）、硬さ・置き場所・段階ごとの件数。

        拾うときの場所とタグの名前の確かめ、grep_words の絞り込みの語彙に使う。隠したものは include_hidden=true のときだけ。
        """
        sub = subject(READ_SCOPE)
        with words_errors():
            out = await service.facets(sub, include_hidden)
        return await synced(sub, out)

    @mcp.tool(annotations=READ)
    async def grep_words(
        patterns: list[str] = Field(min_length=1, max_length=MAX_PATTERNS, description=(
            f"探す言葉（1〜{MAX_PATTERNS}個。どれかに当たれば当たり）。部分一致か簡単な正規表現（. * + ? | [] ^ $ だけ、"
            f"1つ{MAX_PATTERN_LENGTH}文字まで。かっこは使えない）。カタカナとひらがな、全角と半角は同じに扱い、読みにも当たる")),
        fields: list[str] | None = Field(None, description=(
            "探す項目（省くと探すための文の全部）：" + "・".join(ALL_FIELDS)
            + "。surrounding_text（前後の文）と title（本・人の名前）は名指ししたときだけ探す")),
        place: list[Literal["collected", "hand", "own"]] | None = None,
        stage: list[Literal["understood", "sayable", "used"]] | None = None,
        source: str | None = Field(None, description="出会った場所の名前（list_facets）"),
        situations: list[str] | None = Field(None, description="使う場面のタグの名前（どれか）"),
        feelings: list[str] | None = Field(None, description="気持ちのタグの名前（どれか）"),
        confirmed_only: bool = Field(False, description="タグの絞り込みに、利用者が確かめたタグ（confirmed）だけを使う"),
        register: Literal["spoken", "written", "formal"] | None = None,
        starred: bool | None = None,
        captured_from: date | None = Field(None, description="拾った日の範囲の初め"),
        captured_to: date | None = Field(None, description="拾った日の範囲の終わり"),
        limit: int = Field(svc.GREP_DEFAULT_LIMIT, ge=1, le=svc.GREP_MAX_LIMIT),
    ) -> dict:
        """表現を探す。当たりの短い形（id・表現・当たった項目・当たった所の前後の抜き出し。40文字まで）と、当たりの全部の数を返す。

        同じ軸の中は「どれか」、軸どうしは「かつ」で絞る。並び：当たったパターンの数 → 当たった項目（表現・読み → 意味・ニュアンス
        → 使う場面・気持ち・こういう時に使えそう → それ以外）→ 利用者が確かめたタグ → ★ → 新しい順。
        結果は軽いので、言葉を変えて何度呼んでもよい。中身は get_words でまとめて読む。
        """
        sub = subject(READ_SCOPE)
        query = svc.GrepQuery(
            patterns=tuple(patterns), fields=tuple(fields) if fields else None,
            places=tuple(m.Place(p) for p in place or ()), stages=tuple(m.Stage(s) for s in stage or ()),
            source=source, situations=tuple(situations or ()), feelings=tuple(feelings or ()),
            confirmed_only=confirmed_only, register=m.Register(register) if register else None, starred=starred,
            captured_from=captured_from, captured_to=captured_to, limit=limit)
        with words_errors():
            out = await service.grep(sub, query)
        return await synced(sub, out)

    @mcp.tool(annotations=READ)
    async def get_words(ids: list[str] = Field(min_length=1, max_length=svc.MAX_GET)) -> dict:
        """表現の全部（10個まで）：読み・意味・ニュアンス・硬さ・例文・言い換え・こういう時に使えそう・場面・メモ・★・置き場所・段階・間隔、
        タグ（だれが付けたか added_by・確かめたか status）、出会い（新しい10件。encounter_id はここで調べる）、最近の振り返り5件。"""
        sub = subject(READ_SCOPE)
        with words_errors():
            out = await service.get_words(sub, ids)
        return await synced(sub, out)

    @mcp.tool(annotations=READ)
    async def reflection_material(days: int = Field(14, ge=7, le=90)) -> dict:
        """振り返りの材料（「ことばの振り返りをして」と頼まれたら先に読む）。期間は今日までの days 日（7〜90。既定14）。

        - hand：手札（段階・間隔・期限・連続の回数・役立ち度）と review_queue（今日見せる順。期限のものを優先度の順に5つまで）
        - captured：期間に拾ったもの、reencountered：期間にまた出会ったもの、review_results：振り返りの結果の数（said・close・blank・use）
        - suggest_to_hand：手札に勧められるもの（出会いが2回以上か★のある拾ったもの）
        - suggest_demote：戻すのを勧めるもの（出てこないが3回続いた、手札に45日以上いて意味がわかるのまま）
        - suggest_own：自分の言葉に勧められるもの（違う日に2回使えた）
        入れ替えは提案だけをし、了承を得てから move_expression を呼ぶ。覚えられていないことを責めない。続けた日数を数えない。
        """
        sub = subject(READ_SCOPE)
        with words_errors():
            out = await service.reflection_material(sub, days)
        return await synced(sub, out)


@contextmanager
def words_errors():
    """ことばの決まりに反したときは、理由を AI に見せる（AI が言い直せるように）。"""
    try:
        yield
    except WordsError as e:
        raise ToolError(str(e)) from e
