"""手札の間隔と、聞く順（v1）。docs/words-design.md の「聞くと間隔（v1）」。

自己採点の振り返りはやめ、車などで「聞く」ことを触れた回数（exposure）として間隔に使う。数字はメモのとおり。
アプリと同じ計算にし、testdata/words/schedule.json・listen_queue.json で両方を確かめる。
日付の区切りは日本時間の午前4時（夜中に聞いたものは前の日に数える）。
同じ日に何度聞いても、間隔を延ばすのはその日の最初の1回だけ（回数は数える）。使えたも同じ。
"""

from __future__ import annotations

import math
from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta, timezone

from words.domain.model import Expression, Place, Schedule, Stage

JST = timezone(timedelta(hours=9))
DAY_BOUNDARY_HOURS = 4

HAND_LIMIT = 10
LISTEN_FACTOR, LISTEN_CAP = 1.5, 14  # 聞くだけの間隔は14日で止める
USE_FACTOR, USE_MIN, USE_CAP = 3, 7, 60  # 延びるのは「使えた」だけ
STALE_HAND_DAYS = 45  # 手札に45日以上いて、まだ使えていない → 拾ったに戻すのを勧める
OWN_USES = 2  # 使えたが違う日に2回 → 自分の言葉にするかを聞く

RISK_CAP = 3.0
STAR_WEIGHT = 1.5
DEFAULT_USEFULNESS = 2
USEFULNESS_DAYS = 14  # 役立ち度の期限の既定（決めた日から）
RECENT_DAYS = 14  # 聞く順の「最近拾ったもの」
LISTEN_QUEUE_MAX = 20  # 1回に流す数の既定


def business_day(moment: datetime) -> date:
    """その時刻の「日」（日本時間の午前4時で区切る）。"""
    return (moment.astimezone(JST) - timedelta(hours=DAY_BOUNDARY_HOURS)).date()


def moment_day(text: str | None) -> date | None:
    """RFC 3339 の時刻の「日」。"""
    if not text:
        return None
    return business_day(datetime.fromisoformat(text.replace("Z", "+00:00")))


def enter_hand(schedule: Schedule, day: date) -> Schedule:
    """手札に入れたとき：間隔1日、明日が期限、意味がわかる。回数（聞いた・使えた）は残す。"""
    return replace(schedule, stage=Stage.UNDERSTOOD, interval_days=1, due_on=day + timedelta(days=1))


def leave_hand(schedule: Schedule) -> Schedule:
    """手札から出したとき：段階と期限を外す（回数と間隔はそのまま残す）。"""
    return replace(schedule, stage=None, due_on=None)


def apply_listen(schedule: Schedule, at: str, in_hand: bool = True) -> Schedule:
    """聞いた（アプリが流し終えた）。回数と時刻を残し、手札ならその日の最初の1回だけ間隔を延ばす（14日まで、縮めない）。"""
    day, before = moment_day(at), moment_day(schedule.listened_at)
    s = replace(schedule, listened_at=at, listen_count=schedule.listen_count + 1)
    if not in_hand or before == day:
        return s
    interval = max(schedule.interval_days, min(math.ceil(schedule.interval_days * LISTEN_FACTOR), LISTEN_CAP))
    return replace(s, interval_days=interval, due_on=day + timedelta(days=interval))


def apply_use(schedule: Schedule, day: date, in_hand: bool = True) -> Schedule:
    """実際に使えた。段階は使えた、間隔は大きく延ばす（その日の2回目からは間隔を変えない）。

    手札でないとき（拾った・自分の言葉）は、使えた回数と日だけを残し、段階と間隔は変えない。
    """
    s = replace(schedule, use_count=schedule.use_count + 1, last_used_on=day)
    if not in_hand:
        return s
    if schedule.last_used_on == day:
        return replace(s, stage=Stage.USED)
    interval = min(max(schedule.interval_days * USE_FACTOR, USE_MIN), USE_CAP)
    return replace(s, stage=Stage.USED, interval_days=interval, due_on=day + timedelta(days=interval))


# --- 並べる順 ---


def usefulness(expression: Expression, today: date) -> int:
    """今の役立ち度（1〜3）。null と期限切れは2。"""
    u = expression.usefulness
    if u is None or (expression.usefulness_until is not None and expression.usefulness_until < today):
        return DEFAULT_USEFULNESS
    return u


def risk(expression: Expression, today: date) -> float:
    """忘れそうな度合い：最後に聞いた日からの日数 ÷ 間隔（まだなら手札に入れてからの日数）。3で止める。"""
    s = expression.schedule
    since = moment_day(s.listened_at) or expression.hand_since
    if since is None:
        return 0.0
    return min(max((today - since).days, 0) / max(s.interval_days, 1), RISK_CAP)


def priority(expression: Expression, today: date) -> float:
    return risk(expression, today) * usefulness(expression, today) * (STAR_WEIGHT if expression.star else 1.0)


def is_due(expression: Expression, today: date) -> bool:
    due = expression.schedule.due_on
    return due is not None and due <= today


@dataclass(frozen=True)
class QueueItem:
    expression: Expression
    group: str  # due（手札の期限のもの）・hand（手札のほか）・star（★の拾った・自分の言葉）・recent（最近拾ったもの）
    priority: float


def listen_queue(expressions: list[Expression], today: date, limit: int = LISTEN_QUEUE_MAX) -> list[QueueItem]:
    """聞く順：手札の期限のもの（優先度の順）→ 手札のほか（優先度の順）→ ★のもの（新しい順）→ 最近14日に拾ったもの（新しい順）。
    同じ表現は1回だけ。同じ優先度は ID の順。"""
    def by_priority(e: Expression):
        return (-priority(e, today), e.id)

    def newest(e: Expression):
        return ("".join(chr(0x10FFFF - ord(c)) for c in e.created_at), e.id)

    hand = [e for e in expressions if e.place is Place.HAND]
    rest = [e for e in expressions if e.place is not Place.HAND]
    recent_from = today - timedelta(days=RECENT_DAYS - 1)
    groups = [
        ("due", sorted((e for e in hand if is_due(e, today)), key=by_priority)),
        ("hand", sorted((e for e in hand if not is_due(e, today)), key=by_priority)),
        ("star", sorted((e for e in rest if e.star), key=newest)),
        ("recent", sorted((e for e in rest if (d := moment_day(e.created_at)) and d >= recent_from), key=newest)),
    ]
    out, seen = [], set()
    for group, items in groups:
        for e in items:
            if e.id not in seen and len(out) < limit:
                seen.add(e.id)
                out.append(QueueItem(e, group, round(priority(e, today), 3)))
    return out


def own_ready(use_days: set[date]) -> bool:
    """自分の言葉に移す条件：使えたが、違う日に2回。満たしたら勧める（自動では移さない）。"""
    return len(use_days) >= OWN_USES


def should_suggest_demote(expression: Expression, today: date) -> bool:
    """拾ったに戻すのを勧める：手札に45日以上いて、まだ一度も使えていない。"""
    return (expression.place is Place.HAND and expression.schedule.use_count == 0
            and expression.hand_since is not None and (today - expression.hand_since).days >= STALE_HAND_DAYS)
