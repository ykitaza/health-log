"""レポートの保存（ユースケース）：同じ種類・期間は置き換える（重複を作らない）。リポジトリはメモリの偽物で確かめる。"""

import asyncio
from dataclasses import replace
from datetime import date

from reports.application.service import ReportService
from reports.domain.errors import ReportError
from reports.domain.report import Kind, Report

OWNER = "alice"
WEEK = (date(2026, 11, 2), date(2026, 11, 8))


class MemoryReports:
    """ReportRepository の偽物（持ち主ごと）。add は作った時刻を入れて返す（本物と同じ約束）。"""

    def __init__(self):
        self.by_owner: dict[str, dict[str, Report]] = {}

    async def add(self, owner, report):
        saved = replace(report, created_at="2026-11-09T01:00:00.000Z")
        self.by_owner.setdefault(owner, {})[saved.id] = saved
        return saved

    async def list(self, owner):
        return list(self.by_owner.get(owner, {}).values())

    async def get(self, owner, report_id):
        return self.by_owner.get(owner, {}).get(report_id)

    async def delete(self, owner, report_id):
        self.by_owner.get(owner, {}).pop(report_id, None)


def report(report_id="", kind=Kind.WEEKLY, period=WEEK, title="今週のまとめ", **kw):
    start, end = period if period else (None, None)
    return Report(report_id, title, "本文", kind, start, end, **kw)


def service(repo):
    ids = iter(f"new-{n}" for n in range(1, 100))
    return ReportService(repo, ids=lambda: next(ids))


def test_すでにある重複も_保存し直しで1件になる():
    repo = MemoryReports()
    asyncio.run(repo.add(OWNER, report("old-1", title="古い1")))
    asyncio.run(repo.add(OWNER, report("old-2", title="古い2")))  # 置き換えの決まりより前にできた重複
    svc = service(repo)
    saved = asyncio.run(svc.save(OWNER, report(title="新しい")))
    found = asyncio.run(repo.list(OWNER))
    assert [r.id for r in found] == [saved.id] and found[0].title == "新しい"


def test_期間のないレポートは_置き換えの対象にしない():
    repo = MemoryReports()
    svc = service(repo)
    asyncio.run(svc.save(OWNER, report(period=None, title="期間のない週のまとめ1")))
    asyncio.run(svc.save(OWNER, report(period=None, title="期間のない週のまとめ2")))
    assert len(asyncio.run(repo.list(OWNER))) == 2  # 「同じ期間」と言えないので、どちらも残る
    asyncio.run(svc.save(OWNER, report(title="今週のまとめ")))  # 期間のある方も、期間のない方を消さない
    assert len(asyncio.run(repo.list(OWNER))) == 3


def test_other_は保存できない():
    repo = MemoryReports()
    svc = service(repo)
    try:
        asyncio.run(svc.save(OWNER, report(kind=Kind.OTHER, period=None, title="種目の分析")))
        raise AssertionError("other の保存が通ってしまった")
    except ReportError as e:
        assert "other は保存できません" in str(e)
    assert asyncio.run(repo.list(OWNER)) == []  # 断ったものは残らない


def test_前に保存した_other_は_一覧と1件で読める():
    repo = MemoryReports()
    asyncio.run(repo.add(OWNER, report("old-other", kind=Kind.OTHER, period=None, title="種目の分析")))
    svc = service(repo)
    assert [r.id for r in asyncio.run(svc.list(OWNER))] == ["old-other"]  # 絞らなくても出る
    assert [r.id for r in asyncio.run(svc.list(OWNER, Kind.OTHER))] == ["old-other"]  # other で絞っても探せる
    assert asyncio.run(svc.get(OWNER, "old-other")).title == "種目の分析"


def test_種類が違えば_同じ期間でも置き換えない():
    repo = MemoryReports()
    svc = service(repo)
    asyncio.run(svc.save(OWNER, report(kind=Kind.WEEKLY)))
    asyncio.run(svc.save(OWNER, report(kind=Kind.MONTHLY, title="今月のまとめ")))
    assert len(asyncio.run(repo.list(OWNER))) == 2
