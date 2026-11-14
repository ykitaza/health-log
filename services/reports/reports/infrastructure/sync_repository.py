"""リポジトリの実装（同期の仕組みの上）。読むのは今の状態、書くのは変更の記録（origin は mcp）。

書く前に、アプリから届く変更と同じ決まり（sync_entities.py）で確かめる。
読めない状態（項目がそろっていない、ドメインの決まりに合わない）は飛ばし、ログに残す（一覧の残りは返す）。
"""

from __future__ import annotations

import logging
import uuid
from datetime import date
from functools import partial

import anyio

from reports.domain.errors import ReportError
from reports.domain.report import Area, Highlight, Kind, Link, Metric, Report, Review, ReviewTarget, Tone
from reports.infrastructure.sync_entities import ENTITY
from sync.engine import SyncEngine
from sync.model import Change, EntityState
from sync.registry import Rejection

logger = logging.getLogger(__name__)
REQUIRED = {"title", "body", "kind"}


def report_fields(r: Report) -> dict:
    """保存する項目。構造のある項目は、入っているものだけ（前の形のレポートと同じく、なければ持たない）。
    次の一歩の済んだ番号（next_steps_done）はアプリだけが書くものだが、置き換えのときだけ例外にする：
    サービス（application/service.py の _carried_done）が前のレポートから引き継いだ分が入っていたら、一緒に書く
    （新しいレポートにチェックが付いた状態で届き、利用者のチェックが置き換えで消えないようにするため）。"""
    fields: dict = {
        "title": r.title, "body": r.body, "kind": r.kind.value,
        "period_start": r.period_start.isoformat() if r.period_start else None,
        "period_end": r.period_end.isoformat() if r.period_end else None,
    }
    if r.overall_tone is not None:
        fields["overall_tone"] = r.overall_tone.value
    if r.headline:
        fields["headline"] = r.headline
    if r.highlights:
        fields["highlights"] = [_highlight_fields(h) for h in r.highlights]
    if r.next_steps:
        fields["next_steps"] = list(r.next_steps)
    if r.next_steps_done:
        fields["next_steps_done"] = list(r.next_steps_done)
    if r.links:
        fields["links"] = [{"from_area": link.from_area.value, "to_area": link.to_area.value, "text": link.text,
                            "basis": link.basis} for link in r.links]
    if r.review is not None:
        fields["review"] = {"text": r.review.text, "target": r.review.target.value if r.review.target else None}
    if r.phase_id is not None:
        fields["phase_id"] = r.phase_id
    return fields


def _highlight_fields(h: Highlight) -> dict:
    out: dict = {"area": h.area.value, "tone": h.tone.value, "text": h.text}
    if h.metric is not None:
        m = h.metric
        out["metric"] = {"label": m.label, "value": m.value, "unit": m.unit, "delta": m.delta, "delta_good": m.delta_good}
    return out


def report_from_state(state: EntityState) -> Report | None:
    v = state.values
    if state.deleted or not REQUIRED <= v.keys():
        return None
    try:
        highlights = tuple(
            Highlight(Area(h["area"]), Tone(h["tone"]), h["text"],
                      Metric(**h["metric"]) if h.get("metric") else None)
            for h in v.get("highlights") or [])
        links = tuple(Link(Area(link["from_area"]), Area(link["to_area"]), link["text"], link.get("basis"))
                      for link in v.get("links") or [])
        review = v.get("review")
        next_steps = tuple(v.get("next_steps") or ())
        # アプリが送った番号のうち、次の一歩にあるものだけ（項目ごとに当てはめるので、次の一歩より先に届くこともある）
        done = tuple(i for i in v.get("next_steps_done") or () if isinstance(i, int) and 0 <= i < len(next_steps))
        return Report(
            state.entity_id, v["title"], v["body"], Kind(v["kind"]),
            date.fromisoformat(v["period_start"]) if v.get("period_start") else None,
            date.fromisoformat(v["period_end"]) if v.get("period_end") else None,
            Tone(v["overall_tone"]) if v.get("overall_tone") else None,
            v.get("headline") or "", highlights, next_steps, state.created_at, links,
            Review(review["text"], ReviewTarget(review["target"]) if review.get("target") else None) if review else None,
            done, v.get("phase_id"))
    except (ReportError, ValueError, KeyError, TypeError) as e:
        logger.warning("読めない report を飛ばしました（id=%s）: %s", state.entity_id, e)
        return None


class SyncReportRepository:
    def __init__(self, engine: SyncEngine):
        self.engine = engine

    async def _run(self, fn, *args):
        return await anyio.to_thread.run_sync(partial(fn, *args))

    def _change(self, entity_id: str, op: str, fields: dict | None = None) -> Change:
        # MCP の変更の時刻は、サーバーが受け付けた時刻（エンジンが received_at で切る）
        return Change(str(uuid.uuid4()), ENTITY, entity_id, None, op, fields, self.engine.clock(), "mcp")

    def _add(self, owner: str, report: Report) -> Report:
        fields = report_fields(report)
        result = self.engine.registry.check_change(ENTITY, report.id, "create", fields)
        if isinstance(result, Rejection):
            details = "、".join(f"{e['field']}：{e['message']}" for e in result.errors)
            raise ReportError(f"保存できない値です（{result.message}{'：' + details if details else ''}）")
        self.engine.append(owner, [self._change(report.id, "create", fields)])
        return self._get(owner, report.id)

    def _get(self, owner: str, report_id: str) -> Report | None:
        doc = self.engine.doc(owner, ENTITY, report_id)
        return report_from_state(doc.own) if doc and doc.own else None

    def _list(self, owner: str) -> list[Report]:
        found = [report_from_state(d.own) for d in self.engine.docs_of_type(owner, ENTITY) if d.own is not None]
        return [r for r in found if r is not None]

    async def add(self, owner: str, report: Report) -> Report:
        return await self._run(self._add, owner, report)

    async def list(self, owner: str) -> list[Report]:
        return await self._run(self._list, owner)

    async def get(self, owner: str, report_id: str) -> Report | None:
        return await self._run(self._get, owner, report_id)

    async def delete(self, owner: str, report_id: str) -> None:
        await self._run(self.engine.append, owner, [self._change(report_id, "delete")])
