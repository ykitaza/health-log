"""レポートのユースケース（保存・一覧・1件・消す）。本人は検証済みのアクセストークンの sub で受け取る。"""

from __future__ import annotations

import uuid
from dataclasses import replace
from typing import Callable

from reports.domain.errors import NotFound, ReportError
from reports.domain.ports import ReportRepository
from reports.domain.report import MAX_REPORTS, Kind, Report

IdFactory = Callable[[], str]


def new_id() -> str:
    return str(uuid.uuid4())


class ReportService:
    def __init__(self, reports: ReportRepository, ids: IdFactory = new_id):
        self.reports, self.ids = reports, ids

    async def save(self, owner: str, report: Report) -> Report:
        """新しいレポートとして保存する（report の id は使わず、ここで決める）。上限の数に達していたら断る。"""
        if len(await self.reports.list(owner)) >= MAX_REPORTS:
            raise ReportError(f"レポートは{MAX_REPORTS}件までです。古いものを delete_report で消してから保存してください")
        return await self.reports.add(owner, replace(report, id=self.ids()))

    async def list(self, owner: str, kind: Kind | None = None, limit: int | None = None) -> list[Report]:
        """新しい順（作った時刻、同じなら ID の順）。"""
        found = [r for r in await self.reports.list(owner) if kind is None or r.kind == kind]
        found.sort(key=lambda r: (r.created_at, r.id), reverse=True)
        return found[:limit] if limit is not None else found

    async def get(self, owner: str, report_id: str) -> Report:
        report = await self.reports.get(owner, report_id)
        if report is None:
            raise NotFound(f"レポート {report_id} は見つかりません")
        return report

    async def delete(self, owner: str, report_id: str) -> None:
        await self.get(owner, report_id)  # ほかの人のレポートや、ないレポートは消せない
        await self.reports.delete(owner, report_id)
