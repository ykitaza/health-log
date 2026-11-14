"""MCP の入口（レポートのツール）。ツールの説明文は Claude（ChatGPT）への指示を兼ねる。

ここはツールを登録するだけで、サーバー（MCPServer）と認証は作らない。まとめるのは組み立ての場所（services/mcp/main.py）。
レポートは筋トレと食事の両方をまとめるので、接続のところで必須の食事の scope に加えて、筋トレの scope をツールごとに確かめる
（筋トレのツールと同じ。同期の種類も筋トレの scope で扱う）。
"""

from __future__ import annotations

from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from typing import Annotated, Protocol

from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp_types import ToolAnnotations
from pydantic import BaseModel, Field

from reports.application.service import ReportService
from reports.domain.errors import ReportError
from reports.domain.report import (
    MAX_BODY,
    MAX_HEADLINE,
    MAX_HIGHLIGHT_TEXT,
    MAX_HIGHLIGHTS,
    MAX_LABEL,
    MAX_LINK_BASIS,
    MAX_LINK_TEXT,
    MAX_LINKS,
    MAX_METRIC_VALUE,
    MAX_NEXT_STEP_TEXT,
    MAX_NEXT_STEPS,
    MAX_PHASE_ID,
    MAX_REPORTS,
    MAX_REVIEW_TEXT,
    MAX_TITLE,
    MAX_UNIT,
    Area,
    AreaName,
    Highlight,
    Kind,
    KindName,
    Link,
    Metric,
    Report,
    Review,
    ReviewTarget,
    ReviewTargetName,
    SavableKindName,
    Tone,
    ToneName,
)

READ_SCOPE, WRITE_SCOPE = "training:read", "training:write"
JST = timezone(timedelta(hours=9))

INSTRUCTIONS = f"""レポート（KARADA）：記録を読んで書いたまとめ（日のまとめ・週のまとめ・月のまとめ・フェーズの振り返り）を save_report で残すと、スマホのアプリ（KARADA）のホームとレポートの詳細（フェーズの振り返りはフェーズの画面）で読める。
「今日のまとめを作って」「今週のまとめを作って」「レポートにして」と頼まれたら、先に period_overview でその期間（日はその日、週は月曜〜日曜、月は月の初日〜最後の日）の材料を1回で読んでから書き、save_report で保存する。くわしく見たいときだけ、記録のツール（get_workout、weekly_training_review、body_progress、sleep_summary、heart_rate_summary、step_summary など）を足して読む。
週のまとめは、前の週のまとめの次の一歩の結果（period_overview と weekly_review の previous_next_steps。利用者がアプリでチェックした、済んだ・まだ）を先に振り返ってから、次の一歩を書く。
次の一歩はレポートの締めに置く：日は明日の一歩を1つ、週は来週の焦点に相当する一歩、月は今月の課題に相当する一歩（週・月は3つまで）。
週のまとめでは、period_overview の injuries（reviewed は期間に振り返りを書いたケガ、fixing は直している途中のケガ）を見て、直し方（fix）を守れたかを振り返りに書く。ケガは、本人の分析（原因 cause・直し方 fix）をそのまま使って振り返り、原因を推測しない。診断や治療の助言はしない。
数字は記録のツールが返した値だけを使い、推測で作らない。tone（良い・いつもどおり・気をつけたい）は数字にもとづいて決め、利用者を責めない。
tone の良し悪しは、本人がアプリで宣言したフェーズ（period_overview の phase）の向きで決める。増量（bulk）なら体重が増えたのが good、減量（cut）なら減ったのが good（たんぱく質を保ち BIG3 が落ちていなければなおよい）、維持（maintain）なら体重がほぼ変わらず BIG3 や記録が伸びたのが good。ペース（pace.status）が on_track なら順調、fast・slow・over・under は予定からずれている（判定しないとき status は null で、遅れと書かない）。フェーズがなければ今までどおり目標体重（goals.goal_weight_kg）に近づいたかで決める。
療養中（phase.current.kind が rehab、または rehab_in_period）は、体重や体の目標で tone を決めず、筋トレができていない・総負荷量が減ったことを caution にしない。見るのは睡眠・たんぱく質（食事が足りているか）・ケガの振り返りで、療養中に kcal を大きく減らすことを good にしない。診断や治療の助言はしない。
フェーズの振り返り（「フェーズの振り返りを作って」）は、period_overview ではなく list_phases を読む（フェーズは31日より長いため）。対象のフェーズの review_material（開始時 start と終わりの時点 end の体重の週平均・体脂肪率・BIG3、療養で止まった期間 rehab_spans）と target_history（目標の変更の履歴）を材料にし、save_report の kind を phase、phase_id をそのフェーズの phase_id、期間を review_material の period_start〜period_end にして保存する。
振り返りに書くこと：達成の度合い（届いた・ほぼ届いた・届かなかった。成功の指標は向きごと：増量は体重↑＋BIG3↑、減量は体重↓＋BIG3 を保つ（−3% 以内）、維持は体重がほぼ不変（±1kg）＋BIG3↑＋成長スコア↑。ウエストは使わない。体脂肪率は参考で判定に使わない）、うまくいったこと・課題、申し送り（次のフェーズへ。next_steps）、次のフェーズの提案。before／after の数字はアプリが出すので、文章で並べ直さない。療養の期間（rehab_spans）は振り返りの対象から除き、その間に筋トレできなかったことを課題にしない。数字は list_phases などのツールが返した値だけを使い、診断や治療の助言はしない。
次のフェーズの提案：増量・減量のあとは維持 4 週をすすめる。減量の直後に増量を考えているなら、間に維持を挟む案を出す（強制しない。決めるのは本人で、始めるのはアプリ）。
保存したら、アプリのホームの「最新のレポート」に出ることを一言伝える（フェーズの振り返りは「最新のレポート」には出ず、アプリのフェーズの画面で読める）。1人{MAX_REPORTS}件まで。"""

READ = ToolAnnotations(read_only_hint=True)
WRITE = ToolAnnotations(read_only_hint=False, destructive_hint=False)
DESTRUCTIVE = ToolAnnotations(read_only_hint=False, destructive_hint=True)

Number = Annotated[float, Field(ge=-MAX_METRIC_VALUE, le=MAX_METRIC_VALUE)]


# --- 入力の型。SDK がここから JSON Schema を作り、AI に見せる ---


class MetricInput(BaseModel):
    label: str = Field(min_length=1, max_length=MAX_LABEL, description="指標の名前。例：合計負荷量、平均 kcal、体重、平均睡眠")
    value: Number = Field(description="期間の値（記録のツールが返した数字）")
    unit: str = Field("", max_length=MAX_UNIT, description="単位。例：t、kcal、g、kg、時間、回")
    delta: Number | None = Field(None, description="前の期間からの変化（value と同じ単位。増えたら正、減ったら負）。比べられなければ省く")
    delta_good: bool | None = Field(
        None, description=(
            "その変化の向きが利用者の目標にとって良いか。向きはフェーズ（period_overview の phase）で決める"
            "（減量 cut の体重の減りは true、増量 bulk の増えは true。療養中の体重は判定しないので省く）。delta を省いたら省く"))


class HighlightInput(BaseModel):
    area: AreaName = Field(
        description="分野：training（筋トレ）、meals（食事）、body（体組成・歩数）、sleep（睡眠・心拍）")
    tone: ToneName = Field(description=(
        "その分野の調子。good（良い）、steady（変わらない）、caution（気をつけたい）。体重の良し悪しはフェーズの向き"
        "（減量なら減ったのが good）で決め、療養中は筋トレの少なさを caution にしない"))
    text: str = Field(min_length=1, max_length=MAX_HIGHLIGHT_TEXT, description="一文で。例：脚の日が2回に増えた")
    metric: MetricInput | None = Field(None, description="その分野の主な数字（あれば1つ）")


class LinkInput(BaseModel):
    from_area: AreaName = Field(description="気づきのもとの分野（training・meals・body・sleep）")
    to_area: AreaName = Field(description="影響が出た分野。from_area と違う分野にする")
    text: str = Field(min_length=1, max_length=MAX_LINK_TEXT,
                      description="一文で。例：7時間以上寝た日の次の日は、総負荷量が多い")
    basis: str | None = Field(None, min_length=1, max_length=MAX_LINK_BASIS,
                              description="根拠の短い言葉（例：2日、3週）。なければ省く")


class ReviewInput(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_REVIEW_TEXT,
                      description="目標の見直しの提案（一、二文）。例：体重が目標のペースより速く減っているので、kcal を少し上げる")
    target: ReviewTargetName | None = Field(
        None, description="見直す目標。食事の目標（kcal・PFC・目標体重）なら meals_goal（アプリが食事の目標を開くボタンを出す）。ほかは省く")


class PhasePeriods(Protocol):
    """フェーズの振り返りの期間。実装は services/mcp/main.py（筋トレのフェーズを読む。レポートは筋トレを import しない）。"""

    async def phase_period(self, subject: str, phase_id: str) -> dict | None:
        """{"kind": normal・rehab, "start_date", "end_date"（続いた最後の日。実施中なら今日）}。ないフェーズは None。"""
        ...


async def _phase_period(phases: PhasePeriods | None, sub: str, phase_id: str | None,
                        start: date | None, end: date | None) -> tuple[date | None, date | None]:
    """フェーズの振り返りの期間を、フェーズの開始日〜続いた最後の日に決める。省いたら入れ、違えば断る（どの値にすればよいかを返す）。"""
    if phases is None or not phase_id:
        return start, end  # 決まりの確かめ（phase_id がない）は Report に任せる
    found = await phases.phase_period(sub, phase_id)
    if found is None:
        raise ToolError(f"フェーズ {phase_id} は見つかりません。list_phases の phase_id を使ってください（アプリで作ったフェーズは同期のあとに見える）")
    if found["kind"] != "normal":
        raise ToolError("療養（rehab）は振り返りの対象にしません。増量・減量・維持のフェーズの phase_id を使ってください")
    want = (date.fromisoformat(found["start_date"]), date.fromisoformat(found["end_date"]))
    if (start, end) == (None, None):
        return want
    if (start, end) != want:
        raise ToolError(f"フェーズの振り返りの期間は、フェーズの開始日〜続いた最後の日（period_start={want[0]}、period_end={want[1]}）にしてください。省けばこの期間で保存します")
    return start, end


def register_report_tools(mcp: MCPServer, service: ReportService, phases: PhasePeriods | None = None) -> None:
    """レポートのツールを mcp に登録する。phases を渡すと、フェーズの振り返りの phase_id と期間を確かめる。"""

    def subject(scope: str) -> str:
        """検証済みのアクセストークンに scope があれば本人（sub）を返す。なければ断る。"""
        token = get_access_token()
        if token is None or scope not in token.scopes:
            what = "読む" if scope == READ_SCOPE else "書く"
            raise ToolError(
                f"レポートを{what}許可（{scope}）がありません。筋トレのツールを足す前につないだコネクタです。"
                "利用者に、コネクタの連携をいったん解除してつなぎ直し、同意画面で許可するよう伝えてください。")
        return token.subject

    @mcp.tool(annotations=WRITE)
    async def save_report(
        title: Annotated[str, Field(min_length=1, max_length=MAX_TITLE, description="題。例：今週のまとめ（11/2〜11/8）")],
        overall_tone: Annotated[ToneName, Field(
            description=("全体の調子：good（良い調子）、steady（いつもどおり）、caution（気をつけたい）。記録の数字にもとづき、"
                         "フェーズの向きで決める（減量期は体重が減ったのが good。療養中は体の目標で判定せず、"
                         "筋トレできていないことを caution にしない）"))],
        headline: Annotated[str, Field(max_length=MAX_HEADLINE, description="ひと言の要約（40字ほど）。例：脚の日が増え、たんぱく質も目標どおり")],
        kind: Annotated[SavableKindName, Field(description=(
            "種類（必須）：daily（日のまとめ。period_start と period_end を同じ日に）、weekly（週のまとめ）、monthly（月のまとめ）、"
            "phase（フェーズの振り返り。phase_id が要る）。この4つ以外は保存できない"))],
        highlights: Annotated[list[HighlightInput], Field(
            max_length=MAX_HIGHLIGHTS, description=f"分野ごとの要点（{MAX_HIGHLIGHTS}件まで）。数字があれば metric に入れる")] = [],
        next_steps: Annotated[list[Annotated[str, Field(min_length=1, max_length=MAX_NEXT_STEP_TEXT)]], Field(
            max_length=MAX_NEXT_STEPS,
            description="次の一歩（短い文）。日は明日の一歩を1つ、週は来週の焦点に相当する一歩を3つまで、月は今月の課題に相当する一歩を3つまで")] = [],
        links: Annotated[list[LinkInput], Field(max_length=MAX_LINKS, description=(
            f"つながり：分野をまたぐ気づき（{MAX_LINKS}件まで）。週・月のまとめで、記録の数字から言えるものだけ。なければ省く"))] = [],
        review: Annotated[ReviewInput | None, Field(description=(
            "目標の見直しの提案。月のまとめで、体重の推移や目標までのペースから見直したほうがよいときだけ。なければ省く"))] = None,
        body: Annotated[str, Field(max_length=MAX_BODY, description=(
            "くわしい本文（Markdown。見出し #、箇条書き - と 1.、太字 ** だけを使う。"
            "表・リンク・画像・HTML はアプリでは文字のまま出る）"))] = "",
        period_start: Annotated[date | None, Field(description="対象の期間の初日（YYYY-MM-DD）。期間がなければ省く")] = None,
        period_end: Annotated[date | None, Field(description="対象の期間の最後の日（YYYY-MM-DD。両端を含む）")] = None,
        phase_id: Annotated[str | None, Field(
            min_length=1, max_length=MAX_PHASE_ID, pattern=r"^[A-Za-z0-9_-]+$",
            description=("kind が phase のときだけ：振り返るフェーズの phase_id（list_phases の値）。期間は省けば、"
                         "サーバーがフェーズの開始日〜続いた最後の日にする。ほかの種類では省く"))] = None,
    ) -> dict:
        """まとめ（レポート）を保存し、スマホのアプリ（KARADA）で読めるようにする。

        「今日のまとめを作って」「今週のまとめを作って」「月のふり返りをレポートにして」と頼まれたときに呼ぶ。
        先に period_overview で期間の材料を読み、それにもとづいて書く（くわしくは get_workout、today_status、weekly_training_review、
        body_progress、sleep_summary、heart_rate_summary、step_summary など）。数字（metric の value・delta）は記録のツールが返したものだけを使い、推測で作らない。
        達成の数字（今日の達成、今週の目標の達成、体の変化のグラフ）はアプリが記録から計算して見せるので、書くのは見出し・分野ごとの一言・
        つながり・次の一歩・目標の見直しにする。
        種類ごとに書くこと：
        - 日（kind は daily。period_start と period_end をその日にする）：その日の目標に対する一言（highlights は3件ほど）と、明日の一歩を1つ
        - 週（weekly。月曜〜日曜）：今週の目標の達成についての一言、分野をまたぐ気づき（links）、来週の焦点に相当する一歩を3つまで。
          前の週の次の一歩の結果（period_overview の previous_next_steps。done が true なら済んだ、false ならまだ）を振り返ってから、
          次の一歩を書く（済んだものは一言ほめて次へ進め、まだのものは続けるか、やりやすい形に小さくする。責めない）。
          ケガは period_overview の injuries（reviewed・fixing）を見て、直し方を守れたかを振り返りに書く（highlights の分野には入れない）
        - 月（monthly。月の初日〜最後の日）：体の変化（体重の推移と目標までのペース）、BIG3、つながり（links）、目標の見直しの提案（review）、
          今月の課題に相当する一歩を3つまで
        - フェーズの振り返り（phase。phase_id は list_phases の値、期間は省いてよい）：材料は period_overview ではなく list_phases の
          そのフェーズの review_material（開始時 start と終わり end の体重の週平均・体脂肪率・BIG3、療養の期間 rehab_spans）と target_history。
          headline に達成の度合い（届いた・ほぼ届いた・届かなかった）、highlights にうまくいったこと・課題、next_steps に申し送り
          （次のフェーズへ。3つまで）、body に次のフェーズの提案を書く。成功の指標は向きごと（増量：体重↑＋BIG3↑、減量：体重↓＋
          BIG3 を保つ（−3% 以内）、維持：体重がほぼ不変（±1kg）＋BIG3↑＋成長スコア↑）。ウエストは使わず、体脂肪率は参考で判定に使わない。
          before／after の数字はアプリが出すので、文章で並べ直さない。療養の期間は振り返りの対象から除く。
          次のフェーズは、増量・減量のあとは維持 4 週をすすめ、減量の直後に増量なら間に維持を挟む案を出す（強制しない）
        tone は数字で決める（目標に近づいた・増えたなら good、変わらないなら steady、離れた・少ないなら caution）。責める言い方はしない。
        目標の向きはフェーズ（period_overview の phase）で決める：減量（cut）なら体重が減ったのが good、増量（bulk）なら増えたのが good、
        維持（maintain）なら体重がほぼ変わらないのが good。療養中（phase.current.kind が rehab）は体の目標で判定せず、
        筋トレができていないことを caution にしない（見るのは睡眠・たんぱく質・ケガの振り返り。診断や治療の助言はしない）。
        保存は1回の依頼につき1回。同じ種類・期間（フェーズの振り返りは同じ phase_id）でもう一度保存すると、前のレポートは置き換わる（重複にはならない）。保存したら、アプリのホームに出ることを一言伝える（フェーズの振り返りはホームの「最新のレポート」には出ず、アプリのフェーズの画面で読める）。
        """
        sub = subject(WRITE_SCOPE)
        if kind == "phase":
            period_start, period_end = await _phase_period(phases, sub, phase_id, period_start, period_end)
        with report_errors():
            report = Report(
                "", title, body, Kind(kind), period_start, period_end, Tone(overall_tone), headline,
                tuple(Highlight(Area(h.area), Tone(h.tone), h.text,
                                Metric(h.metric.label, h.metric.value, h.metric.unit, h.metric.delta, h.metric.delta_good)
                                if h.metric else None) for h in highlights),
                tuple(next_steps),
                links=tuple(Link(Area(link.from_area), Area(link.to_area), link.text, link.basis) for link in links),
                review=Review(review.text, ReviewTarget(review.target) if review.target else None) if review else None,
                phase_id=phase_id)
            saved = await service.save(sub, report)
        where = "フェーズの画面" if kind == "phase" else "ホームの「最新のレポート」"
        return {"report": _summary(saved), "message": f"保存しました。アプリ（KARADA）の{where}に出ます（同期のあと）。"}

    @mcp.tool(annotations=READ)
    async def list_reports(
        kind: KindName | None = None,
        limit: Annotated[int, Field(ge=1, le=MAX_REPORTS, description="新しい順に何件まで")] = 20,
    ) -> dict:
        """保存したレポートの一覧（新しい順。本文は含まない）。前のまとめと比べるときや、消すレポートを探すときに呼ぶ。"""
        sub = subject(READ_SCOPE)
        return {"reports": [_summary(r) for r in await service.list(sub, Kind(kind) if kind else None, limit)]}

    @mcp.tool(annotations=READ)
    async def get_report(report_id: str) -> dict:
        """レポートを1件、本文と highlights まで返す。前のまとめの続きを書くときに読む。"""
        sub = subject(READ_SCOPE)
        with report_errors():
            return _full(await service.get(sub, report_id))

    @mcp.tool(annotations=DESTRUCTIVE)
    async def delete_report(report_id: str) -> dict:
        """レポートを消す（アプリからも消える）。元に戻せないので、どれを消すかを利用者に確かめてから呼ぶ。

        書き直したいと言われたときは、消してから save_report で保存し直す。
        """
        sub = subject(WRITE_SCOPE)
        with report_errors():
            await service.delete(sub, report_id)
        return {"deleted": report_id}


class PreviousNextSteps:
    """前の週のまとめの次の一歩と、それぞれ済んだか（アプリのチェック）。週のまとめの材料（period_overview・weekly_review）に足す。
    食事のツール（weekly_review）と期間の材料（period_overview）に、組み立ての場所（services/mcp/main.py）でつなぐ。"""

    def __init__(self, service: ReportService):
        self.service = service

    async def previous_next_steps(self, subject: str, start: date) -> dict | None:
        report = await self.service.previous_weekly(subject, start)
        return previous_steps_view(report) if report is not None and report.next_steps else None


def previous_steps_view(r: Report) -> dict:
    done = set(r.next_steps_done)
    return {
        "report_id": r.id, "title": r.title,
        "period_start": r.period_start.isoformat() if r.period_start else None,
        "period_end": r.period_end.isoformat() if r.period_end else None,
        "steps": [{"text": text, "done": i in done} for i, text in enumerate(r.next_steps)],
        "done_count": len(done),
        "note": "利用者がアプリでチェックした結果（done が false でも、チェックしていないだけのこともある）。責めずに振り返る",
    }


def _created_at(r: Report) -> str:
    at = datetime.fromisoformat(r.created_at.replace("Z", "+00:00"))
    return at.astimezone(JST).isoformat(timespec="seconds")


def _summary(r: Report) -> dict:
    return {
        "report_id": r.id, "title": r.title, "kind": r.kind.value,
        "period_start": r.period_start.isoformat() if r.period_start else None,
        "period_end": r.period_end.isoformat() if r.period_end else None,
        "overall_tone": r.overall_tone.value if r.overall_tone else None,
        "headline": r.headline, "created_at": _created_at(r),
        **({"phase_id": r.phase_id} if r.phase_id is not None else {}),
    }


def _full(r: Report) -> dict:
    return {
        **_summary(r),
        "highlights": [{
            "area": h.area.value, "tone": h.tone.value, "text": h.text,
            "metric": None if h.metric is None else {
                "label": h.metric.label, "value": h.metric.value, "unit": h.metric.unit,
                "delta": h.metric.delta, "delta_good": h.metric.delta_good},
        } for h in r.highlights],
        "next_steps": list(r.next_steps),
        "next_steps_done": list(r.next_steps_done),  # 済んだ次の一歩の番号（アプリのチェック）
        "links": [{"from_area": link.from_area.value, "to_area": link.to_area.value, "text": link.text,
                   "basis": link.basis} for link in r.links],
        "review": None if r.review is None else {
            "text": r.review.text, "target": r.review.target.value if r.review.target else None},
        "body": r.body,
    }


@contextmanager
def report_errors():
    """決まりに反したときは、理由を AI に見せる（AI が言い直せるように）。"""
    try:
        yield
    except ReportError as e:
        raise ToolError(str(e)) from e
