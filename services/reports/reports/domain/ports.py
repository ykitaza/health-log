"""リポジトリのポート。持ち主はアクセストークンの sub（ほかの人のレポートは読めない・消せない）。"""

from __future__ import annotations

from typing import Protocol

from reports.domain.report import Report


class ReportRepository(Protocol):
    async def add(self, owner: str, report: Report) -> Report:
        """保存し、作った時刻の入ったレポートを返す。"""
        ...

    async def list(self, owner: str) -> list[Report]:
        """消していないレポート（並びは決めない）。"""
        ...

    async def get(self, owner: str, report_id: str) -> Report | None: ...

    async def delete(self, owner: str, report_id: str) -> None: ...
