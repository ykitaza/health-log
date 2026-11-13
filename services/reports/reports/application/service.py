"""レポートのユースケース（保存・一覧・1件・消す）。本人は検証済みのアクセストークンの sub で受け取る。"""

from __future__ import annotations

import uuid
from dataclasses import replace
from datetime import date, timedelta
from typing import Callable

from reports.domain.errors import NotFound, ReportError
from reports.domain.ports import ReportRepository
from reports.domain.report import MAX_REPORTS, Kind, Report

IdFactory = Callable[[], str]


def new_id() -> str:
    return str(uuid.uuid4())


def _carried_done(old_reports: list[Report], new_report: Report) -> tuple[int, ...]:
    """置き換えで引き継ぐ、次の一歩のチェック（済んだ番号）。

    チェックは番号で指すので、置き換えた方の一歩にそのまま移すと、別の一歩を済んだことにしてしまう。
    前のレポートでチェックされた一歩のうち、文面が同じものが新しい方にもあれば、その番号に移す。
    文面が変わった・なくなった一歩のチェックは引き継がない（残った一歩のチェックは消さない）。
    """
    carried = {i for i in new_report.next_steps_done if 0 <= i < len(new_report.next_steps)}
    for old in old_reports:
        for i in old.next_steps_done:
            if 0 <= i < len(old.next_steps) and old.next_steps[i] in new_report.next_steps:
                carried.add(new_report.next_steps.index(old.next_steps[i]))
    return tuple(sorted(carried))


class ReportService:
    def __init__(self, reports: ReportRepository, ids: IdFactory = new_id):
        self.reports, self.ids = reports, ids

    async def save(self, owner: str, report: Report) -> Report:
        """レポートとして保存する（report の id は使わず、ここで決める）。上限の数に達していたら断る。

        同じ種類・期間（kind と period_start〜period_end）のレポートがすでにあれば、新しい方で置き換える（重複を作らない。
        期間のないレポートは「同じ期間」と言えないので、置き換えの対象にしない）。
        置き換えは、レポートの決まり（保存したら変えない。書き換えは消して作り直す）どおり、古い方を消して新しい ID で作る。
        同期は項目ごとの後勝ちで項目を消す仕組みがないため、同じ ID の update では、前のレポートにだけあった
        highlights・links などが残ってしまう。先に新しい方を保存してから古い方を消す（保存に失敗したら古い方が残る）。
        件数の上限は、置き換える分を除いて数える（上限でも置き換えはできる）。
        次の一歩のチェック（next_steps_done）は、置き換えでも消さない：チェックは次の一歩の番号で指すので、
        文面が同じ一歩だけを、新しい方の番号に移して引き継ぐ（_carried_done）。
        種類は daily・weekly・monthly だけを受け付ける。other は前に保存したものが残っているだけで、
        新しくは保存しない（読む・消すは今までどおりできる）。
        """
        if report.kind not in (Kind.DAILY, Kind.WEEKLY, Kind.MONTHLY):
            raise ReportError("レポートの種類（kind）は daily（日のまとめ）・weekly（週のまとめ）・monthly（月のまとめ）のどれかにしてください。other は保存できません")
        existing = await self.reports.list(owner)
        same = [r for r in existing if report.period_start is not None
                and r.kind == report.kind and r.period_start == report.period_start and r.period_end == report.period_end]
        if len(existing) - len(same) >= MAX_REPORTS:
            raise ReportError(f"レポートは{MAX_REPORTS}件までです。古いものを delete_report で消してから保存してください")
        saved = await self.reports.add(owner, replace(
            report, id=self.ids(), next_steps_done=_carried_done(same, report)))
        for old in same:  # すでに重複していた分も含め、古い方は全部消す
            await self.reports.delete(owner, old.id)
        return saved

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

    async def previous_weekly(self, owner: str, start: date) -> Report | None:
        """start（ふり返る期間の初日）の前の週のまとめ：kind が weekly で、期間の終わりが start の7日前〜前の日のもの。
        いくつかあれば、いちばん新しく作ったもの（アプリのホームの「今週やること」と同じ選び方）。なければ None。"""
        found = [r for r in await self.list(owner, Kind.WEEKLY)
                 if r.period_end is not None and start - timedelta(days=7) <= r.period_end < start]
        return found[0] if found else None

    async def delete(self, owner: str, report_id: str) -> None:
        await self.get(owner, report_id)  # ほかの人のレポートや、ないレポートは消せない
        await self.reports.delete(owner, report_id)
