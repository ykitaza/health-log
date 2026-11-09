"""MCP の入口（レポートのツール）。ツールの説明文は Claude（ChatGPT）への指示を兼ねる。

ここはツールを登録するだけで、サーバー（MCPServer）と認証は作らない。まとめるのは組み立ての場所（services/mcp/main.py）。
レポートは筋トレと食事の両方をまとめるので、接続のところで必須の食事の scope に加えて、筋トレの scope をツールごとに確かめる
（筋トレのツールと同じ。同期の種類も筋トレの scope で扱う）。
"""

from __future__ import annotations

from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from typing import Annotated, Literal

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
    MAX_METRIC_VALUE,
    MAX_NEXT_STEP_TEXT,
    MAX_NEXT_STEPS,
    MAX_REPORTS,
    MAX_TITLE,
    MAX_UNIT,
    Area,
    Highlight,
    Kind,
    Metric,
    Report,
    Tone,
)

READ_SCOPE, WRITE_SCOPE = "training:read", "training:write"
JST = timezone(timedelta(hours=9))

INSTRUCTIONS = f"""レポート（hlog）：記録を読んで書いたまとめ（週のまとめ・月のまとめ・分析）を save_report で残すと、スマホのアプリ（hlog）のホームと一覧で読める。
「今週のまとめを作って」「レポートにして」「ふり返りを残して」と頼まれたら、先に記録のツール（weekly_review、weekly_training_review、body_progress、sleep_summary など）で数字を読んでから書き、save_report で保存する。
数字は記録のツールが返した値だけを使い、推測で作らない。tone（良い・いつもどおり・気をつけたい）は数字にもとづいて決め、利用者を責めない。
保存したら、アプリのホームの「最新のレポート」に出ることを一言伝える。1人{MAX_REPORTS}件まで。"""

READ = ToolAnnotations(read_only_hint=True)
WRITE = ToolAnnotations(read_only_hint=False, destructive_hint=False)
DESTRUCTIVE = ToolAnnotations(read_only_hint=False, destructive_hint=True)

ToneName = Literal["good", "steady", "caution"]
KindName = Literal["weekly", "monthly", "other"]
Number = Annotated[float, Field(ge=-MAX_METRIC_VALUE, le=MAX_METRIC_VALUE)]


# --- 入力の型。SDK がここから JSON Schema を作り、AI に見せる ---


class MetricInput(BaseModel):
    label: str = Field(min_length=1, max_length=MAX_LABEL, description="指標の名前。例：合計負荷量、平均 kcal、体重、平均睡眠")
    value: Number = Field(description="期間の値（記録のツールが返した数字）")
    unit: str = Field("", max_length=MAX_UNIT, description="単位。例：t、kcal、g、kg、時間、回")
    delta: Number | None = Field(None, description="前の期間からの変化（value と同じ単位。増えたら正、減ったら負）。比べられなければ省く")
    delta_good: bool | None = Field(
        None, description="その変化の向きが利用者の目標にとって良いか（減量中の体重の減りは true）。delta を省いたら省く")


class HighlightInput(BaseModel):
    area: Literal["training", "meals", "body", "sleep"] = Field(
        description="分野：training（筋トレ）、meals（食事）、body（体組成）、sleep（睡眠・心拍）")
    tone: ToneName = Field(description="その分野の調子。good（良い）、steady（変わらない）、caution（気をつけたい）")
    text: str = Field(min_length=1, max_length=MAX_HIGHLIGHT_TEXT, description="一文で。例：脚の日が2回に増えた")
    metric: MetricInput | None = Field(None, description="その分野の主な数字（あれば1つ）")


def register_report_tools(mcp: MCPServer, service: ReportService) -> None:
    """レポートのツールを mcp に登録する。"""

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
            description="全体の調子：good（良い調子）、steady（いつもどおり）、caution（気をつけたい）。記録の数字にもとづいて決める")],
        headline: Annotated[str, Field(max_length=MAX_HEADLINE, description="ひと言の要約（40字ほど）。例：脚の日が増え、たんぱく質も目標どおり")],
        highlights: Annotated[list[HighlightInput], Field(
            max_length=MAX_HIGHLIGHTS, description=f"分野ごとの要点（{MAX_HIGHLIGHTS}件まで）。数字があれば metric に入れる")] = [],
        next_steps: Annotated[list[Annotated[str, Field(min_length=1, max_length=MAX_NEXT_STEP_TEXT)]], Field(
            max_length=MAX_NEXT_STEPS, description=f"次の期間にやること（{MAX_NEXT_STEPS}件まで、短い文）")] = [],
        body: Annotated[str, Field(max_length=MAX_BODY, description=(
            "くわしい本文（Markdown。見出し #、箇条書き - と 1.、太字 ** だけを使う。"
            "表・リンク・画像・HTML はアプリでは文字のまま出る）"))] = "",
        kind: Annotated[KindName, Field(description="weekly（週のまとめ）、monthly（月のまとめ）、other（種目の分析など）")] = "other",
        period_start: Annotated[date | None, Field(description="対象の期間の初日（YYYY-MM-DD）。期間がなければ省く")] = None,
        period_end: Annotated[date | None, Field(description="対象の期間の最後の日（YYYY-MM-DD。両端を含む）")] = None,
    ) -> dict:
        """まとめ・分析（レポート）を保存し、スマホのアプリ（hlog）で読めるようにする。

        「今週のまとめを作って」「月のふり返りをレポートにして」「この分析を残して」と頼まれたときに呼ぶ。
        先に記録のツール（weekly_review、weekly_training_review、body_progress、sleep_summary、heart_rate_summary など）で
        期間の数字を読み、それにもとづいて書く。数字（metric の value・delta）は記録のツールが返したものだけを使い、推測で作らない。
        tone は数字で決める（目標に近づいた・増えたなら good、変わらないなら steady、離れた・少ないなら caution）。責める言い方はしない。
        保存は1回の依頼につき1回。同じ内容を2回保存しない。保存したら、アプリのホームに出ることを一言伝える。
        """
        sub = subject(WRITE_SCOPE)
        with report_errors():
            report = Report(
                "", title, body, Kind(kind), period_start, period_end, Tone(overall_tone), headline,
                tuple(Highlight(Area(h.area), Tone(h.tone), h.text,
                                Metric(h.metric.label, h.metric.value, h.metric.unit, h.metric.delta, h.metric.delta_good)
                                if h.metric else None) for h in highlights),
                tuple(next_steps))
            saved = await service.save(sub, report)
        return {"report": _summary(saved), "message": "保存しました。アプリ（hlog）のホームの「最新のレポート」に出ます（同期のあと）。"}

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
        "body": r.body,
    }


@contextmanager
def report_errors():
    """決まりに反したときは、理由を AI に見せる（AI が言い直せるように）。"""
    try:
        yield
    except ReportError as e:
        raise ToolError(str(e)) from e
