"""手札の振り返りと間隔（v1）。docs/words-design.md の「振り返りと間隔（v1）」と「一度に見せるもの」。

数字はメモのとおり。アプリと同じ計算にし、testdata/words/schedule.json・priority.json で両方を確かめる。
日付の区切りは日本時間の午前4時（夜中の振り返りは前の日に数える）。
同じ日に2回振り返っても、間隔の項目を変えるのはその日の最初の1回だけ（記録は残す）。
"""

from __future__ import annotations

import math
from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta, timezone

from words.domain.model import Expression, RecallResult, Schedule, Stage

JST = timezone(timedelta(hours=9))
DAY_BOUNDARY_HOURS = 4

HAND_LIMIT = 10
RECALL_FACTOR, RECALL_CAP = 1.5, 14  # 思い出すだけの間隔は14日で止める
USE_FACTOR, USE_MIN, USE_CAP = 3, 7, 60  # 延びるのは「使えた」だけ
SAYABLE_STREAK = 2  # 言えたが2回続いたら、意味がわかる → 言えそう
DEMOTE_LAPSES = 3  # 出てこなかったが3回続いたら、拾ったに戻すかを聞く
STALE_UNDERSTOOD_DAYS = 45  # 手札に45日以上いて意味がわかるのまま → 戻すのを勧める
OWN_USES = 2  # 使えたが違う日に2回 → 自分の言葉にするかを聞く

RISK_CAP = 3.0
STAR_WEIGHT = 1.5
DEFAULT_USEFULNESS = 2
USEFULNESS_DAYS = 14  # 役立ち度の期限の既定（決めた日から）
QUEUE_MAX, QUEUE_MIN, QUEUE_RISK = 5, 3, 0.5


def business_day(moment: datetime) -> date:
    """その時刻の「日」（日本時間の午前4時で区切る）。"""
    return (moment.astimezone(JST) - timedelta(hours=DAY_BOUNDARY_HOURS)).date()


def enter_hand(schedule: Schedule, day: date) -> Schedule:
    """手札に入れたとき：間隔1日、明日が期限、意味がわかる、連続の回数は0。回数（振り返った・使えた）は残す。"""
    return replace(schedule, stage=Stage.UNDERSTOOD, interval_days=1, due_on=day + timedelta(days=1),
                   success_streak=0, lapse_streak=0)


def leave_hand(schedule: Schedule) -> Schedule:
    """手札から出したとき：段階と期限を外す（間隔の項目はそのまま残す）。"""
    return replace(schedule, stage=None, due_on=None)


def apply_recall(schedule: Schedule, result: RecallResult, day: date) -> Schedule:
    """振り返りの結果を当てはめる。その日の2回目からは何も変えない。"""
    if schedule.last_reviewed_on == day:
        return schedule
    s, interval, stage = schedule, schedule.interval_days, schedule.stage
    success, lapse, lapses = s.success_streak, s.lapse_streak, s.lapse_count
    if result is RecallResult.SAID:
        # 14日で止めるのは「延ばす」ほうだけ。使えたで14日より長くなっていた間隔は、言えたで縮めない
        interval = max(interval, min(math.ceil(interval * RECALL_FACTOR), RECALL_CAP))
        success, lapse = success + 1, 0
        if stage is Stage.UNDERSTOOD and success >= SAYABLE_STREAK:
            stage = Stage.SAYABLE
    elif result is RecallResult.BLANK:
        interval = max(interval // 2, 1)
        stage = {Stage.SAYABLE: Stage.UNDERSTOOD, Stage.USED: Stage.SAYABLE}.get(stage, stage)
        success, lapse, lapses = 0, lapse + 1, lapses + 1
    # 惜しい（close）は、間隔・段階・連続の回数を変えない
    return replace(s, stage=stage, interval_days=interval, due_on=day + timedelta(days=interval), last_reviewed_on=day,
                   success_streak=success, lapse_streak=lapse, review_count=s.review_count + 1, lapse_count=lapses)


def apply_use(schedule: Schedule, day: date, in_hand: bool = True) -> Schedule:
    """実際に使えた。段階は使えた、間隔は大きく延ばす（その日の2回目からは間隔を変えない）。

    手札でないとき（拾った・自分の言葉）は、使えた回数と日だけを残し、段階と間隔は変えない。
    """
    s = replace(schedule, use_count=schedule.use_count + 1, last_used_on=day, lapse_streak=0)
    if not in_hand:
        return s
    if schedule.last_reviewed_on == day:
        return replace(s, stage=Stage.USED)
    interval = min(max(schedule.interval_days * USE_FACTOR, USE_MIN), USE_CAP)
    return replace(s, stage=Stage.USED, interval_days=interval, due_on=day + timedelta(days=interval), last_reviewed_on=day)


# --- 並べる順 ---


def usefulness(expression: Expression, today: date) -> int:
    """今の役立ち度（1〜3）。null と期限切れは2。"""
    u = expression.usefulness
    if u is None or (expression.usefulness_until is not None and expression.usefulness_until < today):
        return DEFAULT_USEFULNESS
    return u


def risk(expression: Expression, today: date) -> float:
    """忘れそうな度合い：最後に振り返ってからの日数 ÷ 間隔（まだなら手札に入れてからの日数）。3で止める。"""
    s = expression.schedule
    since = s.last_reviewed_on or expression.hand_since
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
    priority: float
    due: bool


def review_queue(hand: list[Expression], today: date) -> list[QueueItem]:
    """一度に見せるもの。期限のものを優先度の順に5つまで。3つに満たなければ、今日まだ振り返っていない、
    risk が 0.5 以上のものを優先度の順に足して3つにする。手札が3つより少なければ全部。"""
    def order(e: Expression):
        return (-priority(e, today), e.id)

    def item(e: Expression) -> QueueItem:
        return QueueItem(e, round(priority(e, today), 3), is_due(e, today))

    if len(hand) < QUEUE_MIN:
        return [item(e) for e in sorted(hand, key=order)]
    due = sorted((e for e in hand if is_due(e, today)), key=order)[:QUEUE_MAX]
    if len(due) < QUEUE_MIN:
        chosen = {e.id for e in due}
        extra = sorted((e for e in hand if e.id not in chosen and e.schedule.last_reviewed_on != today
                        and risk(e, today) >= QUEUE_RISK), key=order)
        due += extra[:QUEUE_MIN - len(due)]
    return [item(e) for e in due]


def own_ready(use_days: set[date]) -> bool:
    """自分の言葉に移す条件：使えたが、違う日に2回。満たしたら勧める（自動では移さない）。"""
    return len(use_days) >= OWN_USES


def should_suggest_demote(expression: Expression, today: date) -> bool:
    """拾ったに戻すのを勧める：出てこないが3回続いた、または手札に45日以上いて意味がわかるのまま。"""
    s = expression.schedule
    if s.lapse_streak >= DEMOTE_LAPSES:
        return True
    return (s.stage is Stage.UNDERSTOOD and expression.hand_since is not None
            and (today - expression.hand_since).days >= STALE_UNDERSTOOD_DAYS)
