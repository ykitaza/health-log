"""活動の記録（docs/words-design.md の「活動の記録」）。続ける気持ちを支えるための数で、責めるためには使わない。

同期で届いた今の状態だけから計算する（アプリは端末の SQLite から同じ計算をし、MCP の stats は同じ数を返す）。
数え方は testdata/words/stats.json でアプリと確かめる。
- captured：その期間に拾った表現の数（表現を作った日）
- reencountered：その期間に足した出会いのうち、表現を作った日より後のもの（また出会った）
- used：その期間の使えたの記録（usage）の数
- hand_entered：その期間に手札に入れた数（今の手札の hand_since で数える。出し入れの履歴は持たないので、今も手札にあるものだけ）
- moved_to_own：その期間に自分の言葉に移した数（今の置き場所が own で、moved_at がその期間のもの）
- listened_items・listened_minutes：その期間に聞いた数と分（listen_session の合計）
期間は日本時間の午前4時で区切った日で、週は月曜〜日曜、月は暦の月。
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from datetime import date, timedelta

from words.domain.model import Encounter, Expression, ListenSession, Place, Source, Usage
from words.domain.schedule import moment_day

UNITS = ("week", "month")
MAX_PERIODS = {"week": 26, "month": 12}
UNKNOWN_SOURCE = "（場所なし）"


@dataclass(frozen=True)
class Period:
    start: date
    end: date  # 含む


def periods(today: date, unit: str, count: int) -> list[Period]:
    """今日を含む期間から count 個さかのぼる（古い順）。"""
    out = []
    if unit == "week":
        start = today - timedelta(days=today.weekday())
        for i in range(count):
            s = start - timedelta(weeks=i)
            out.append(Period(s, s + timedelta(days=6)))
    else:
        y, mo = today.year, today.month
        for _ in range(count):
            s = date(y, mo, 1)
            nxt = date(y + (mo == 12), mo % 12 + 1, 1)
            out.append(Period(s, nxt - timedelta(days=1)))
            y, mo = (y - 1, 12) if mo == 1 else (y, mo - 1)
    return out[::-1]


def activity_stats(expressions: list[Expression], encounters: list[Encounter], usages: list[Usage],
                   listens: list[ListenSession], sources: list[Source], today: date, unit: str = "week",
                   count: int = 8) -> dict:
    if unit not in UNITS:
        raise ValueError(f"unit は {' か '.join(UNITS)}")
    spans = periods(today, unit, count)
    created = {e.id: moment_day(e.created_at) for e in expressions}

    def bucket(day: date | None) -> int | None:
        if day is None:
            return None
        return next((i for i, p in enumerate(spans) if p.start <= day <= p.end), None)

    rows = [{"from": p.start.isoformat(), "to": p.end.isoformat(), "captured": 0, "reencountered": 0, "used": 0,
             "hand_entered": 0, "moved_to_own": 0, "listened_items": 0, "listened_seconds": 0} for p in spans]

    def add(day: date | None, key: str, n: int = 1) -> None:
        if (i := bucket(day)) is not None:
            rows[i][key] += n

    by_source: Counter = Counter()
    for e in expressions:
        add(created[e.id], "captured")
        if bucket(created[e.id]) is not None:
            by_source[e.source_id] += 1
        if e.place is Place.HAND:
            add(e.hand_since, "hand_entered")
        if e.place is Place.OWN:
            add(moment_day(e.moved_at), "moved_to_own")
    for x in encounters:
        day = moment_day(x.created_at)
        first = created.get(x.expression_id)
        if first is not None and day is not None and day > first:
            add(day, "reencountered")
    for u in usages:
        add(u.used_on, "used")
    for s in listens:
        add(s.listened_on, "listened_items", s.items)
        add(s.listened_on, "listened_seconds", s.seconds)
    for r in rows:
        r["listened_minutes"] = round(r.pop("listened_seconds") / 60, 1)

    names = {s.id: s.name for s in sources}
    totals = {k: (round(sum(r[k] for r in rows), 1) if k == "listened_minutes" else sum(r[k] for r in rows))
              for k in rows[0] if k not in ("from", "to")} if rows else {}
    return {
        "unit": unit,
        "from": spans[0].start.isoformat() if spans else None,
        "to": spans[-1].end.isoformat() if spans else None,
        "periods": rows,
        "totals": totals,
        "captured_by_source": [{"source": names.get(sid, UNKNOWN_SOURCE) if sid else UNKNOWN_SOURCE, "captured": n}
                               for sid, n in sorted(by_source.items(), key=lambda kv: (-kv[1], names.get(kv[0], "")))],
        "now": {p.value: sum(e.place is p for e in expressions) for p in Place} | {"total": len(expressions)},
    }
