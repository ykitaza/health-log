"""レポートの種類（report）を、同期の仕組み（sync）に登録する。項目は docs/api/app-api.yaml の ReportFields と同じ。

書くのは MCP（save_report）だけ。アプリは読むのと消すのだけなので、アプリから届く変更は delete だけを受け付ける（app_ops）。
scope は筋トレと同じ torelog-api/training.read・training.write（レポートは筋トレと食事の両方をまとめるので、MCP では
接続のところで食事の scope、ツールで筋トレの scope を確かめる。新しい scope は作らない）。
上限は domain/report.py と同じ。
"""

from __future__ import annotations

from datetime import date
from typing import Annotated, Literal

from pydantic import AfterValidator, Field

from reports.domain.report import (
    MAX_BODY,
    MAX_ENCODED_BYTES,
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
    MAX_PERIOD_DAYS,
    MAX_REVIEW_TEXT,
    MAX_TITLE,
    MAX_UNIT,
    encoded_size,
)
from sync.fields import Day, FieldsModel
from sync.registry import UUID_PATTERN, EntitySpec, Registry, Rejection

AREA = "training"
ENTITY = "report"


def _not_blank(text: str) -> str:
    if not text.strip():
        raise ValueError("空白だけにはできません")
    return text


Tone = Literal["good", "steady", "caution"]
Number = Annotated[float, Field(ge=-MAX_METRIC_VALUE, le=MAX_METRIC_VALUE)]


class MetricFields(FieldsModel):
    label: Annotated[str, Field(min_length=1, max_length=MAX_LABEL), AfterValidator(_not_blank)]
    value: Number
    unit: Annotated[str, Field(max_length=MAX_UNIT)] = ""
    delta: Number | None = None
    delta_good: bool | None = None


class HighlightFields(FieldsModel):
    area: Literal["training", "meals", "body", "sleep"]
    tone: Tone
    text: Annotated[str, Field(min_length=1, max_length=MAX_HIGHLIGHT_TEXT), AfterValidator(_not_blank)]
    metric: MetricFields | None = None


AreaName = Literal["training", "meals", "body", "sleep"]


class LinkFields(FieldsModel):
    from_area: AreaName
    to_area: AreaName
    text: Annotated[str, Field(min_length=1, max_length=MAX_LINK_TEXT), AfterValidator(_not_blank)]
    basis: Annotated[str, Field(min_length=1, max_length=MAX_LINK_BASIS), AfterValidator(_not_blank)] | None = None


class ReviewFields(FieldsModel):
    text: Annotated[str, Field(min_length=1, max_length=MAX_REVIEW_TEXT), AfterValidator(_not_blank)]
    target: Literal["meals_goal"] | None = None


class ReportFields(FieldsModel):
    title: Annotated[str, Field(min_length=1, max_length=MAX_TITLE), AfterValidator(_not_blank)] = None
    body: Annotated[str, Field(max_length=MAX_BODY)] = None  # Markdown。アプリは文字として表示するだけ
    kind: Literal["daily", "weekly", "monthly", "other"] = None
    period_start: Day | None = None
    period_end: Day | None = None
    overall_tone: Tone | None = None
    headline: Annotated[str, Field(max_length=MAX_HEADLINE)] = None
    highlights: Annotated[list[HighlightFields], Field(max_length=MAX_HIGHLIGHTS)] = None
    next_steps: Annotated[list[Annotated[str, Field(min_length=1, max_length=MAX_NEXT_STEP_TEXT),
                                          AfterValidator(_not_blank)]], Field(max_length=MAX_NEXT_STEPS)] = None
    links: Annotated[list[LinkFields], Field(max_length=MAX_LINKS)] = None  # 分野をまたぐ気づき（つながり）
    review: ReviewFields | None = None  # 目標の見直し


def _check(entity_id: str, fields: dict) -> Rejection | None:
    if encoded_size(fields) > MAX_ENCODED_BYTES:
        return Rejection("invalid_fields", "レポートが大きすぎます。本文を短くしてください（絵文字が多いと字数より先に上限に届きます）",
                         ({"field": "fields.body", "message": f"JSON で {MAX_ENCODED_BYTES} バイトまで"},))
    start, end = fields.get("period_start"), fields.get("period_end")
    if start and end:
        days = (date.fromisoformat(end) - date.fromisoformat(start)).days
        if not 0 <= days < MAX_PERIOD_DAYS:
            return Rejection("invalid_fields", f"期間は period_start から period_end まで（{MAX_PERIOD_DAYS}日以内）にしてください",
                             ({"field": "fields.period_end", "message": "period_start と同じか後の日"},))
    if fields.get("kind") == "daily" and not (start and start == end):
        return Rejection("invalid_fields", "日のまとめ（daily）は、period_start と period_end を同じ日にしてください",
                         ({"field": "fields.period_end", "message": "period_start と同じ日"},))
    return None


def register(registry: Registry) -> None:
    registry.register(ENTITY, EntitySpec(
        ReportFields, ("title", "body", "kind"), AREA,
        valid_id=lambda entity_id: bool(UUID_PATTERN.match(entity_id)), check=_check, app_ops=("delete",)))
