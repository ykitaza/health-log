"""フェーズ（phase）：増量・減量・維持（リコンプ）と療養の期間。本人がアプリで宣言する（自動では始まらない。MCP は読むだけ）。

  通常（normal）  向き（bulk 増量・cut 減量・maintain 維持）、開始日、終了日（週数から。開始日＋7×週数−1）、目標体重、
                  食事の目標（筋トレの日・休みの日の kcal・たんぱく質）、開始時の記録（体重・体脂肪率・BIG3・成長スコア）
  療養（rehab）   ケガや体調不良で、回復そのものが目的の期間。向きと目標体重は持たない。終わりは本人が決める。
                  始めたときに実施中の通常のフェーズがあれば、その ID（paused_phase_id）を持つ

決まり（アプリの apps/mobile/lib/phases.ts と同じ。testdata/training/phases.json で確かめる）
- 止まっているか・時計のずれは、療養の行から求める（通常のフェーズの状態は active のまま。同期は項目ごとの後勝ちなので、
  2つの行にまたがる状態を両方に持つと食い違うため）。療養の [開始日, 終わった日) が、通常のフェーズの止まった日。
  実施中の療養は、今日まで（今日を含む）止まっているとする
- 終了日（end_date）は止まった日を含まない予定の終わり。実際の終わり（effective_end）は、止まった日数だけ後ろにずれる
- 同時に実施中（active）は1つ（療養が実施中なら、それが今のフェーズで、止めている通常のフェーズは「止まっている」）。
  端末どうしの同期で2つになったら、開始日の新しいもの、同じなら記録の新しいもの、ID の大きいものを選ぶ
- 予定の線は直線。目標や終了日を変えたら、変えた日から引き直す（target_history の1件が1本の線。最初の1件は開始日）。
  線の時刻は止まった日を除いた日数（フェーズの時計）で測る
- ペースは、今日までの7日（フェーズの開始より前と止まった日を除く）の体重の平均を、同じ日の予定の値の平均と比べる。
  差が ±0.3kg 以内なら順調。測った日が1日以下なら判定しない。療養から戻って14日は判定しない
上限は、アプリ（apps/mobile/lib/__tests__/server-limits.test.ts）がこのファイルを正規表現で読んで突き合わせるので、
「名前 = 整数」の1行で書く。
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

MAX_NAME = 40  # 名前（任意。空なら「増量 16週」のように付ける）
MAX_WEEKS = 104  # 通常のフェーズの長さ（週）
MAX_TARGET_HISTORY = 100  # 目標・終了日の変更の履歴（最初の1件を含む）
MAX_PHASES = 200  # 1人が持てるフェーズの数（消したものは数えない。アプリが書くときに確かめる）
PACE_BAND_CENTS = 30  # ペースの幅（±0.3kg を 0.01kg 単位で）
MIN_WEIGH_INS = 2  # ペースを判定するのに要る、7日の中の体重を測った日の数
PACE_WINDOW_DAYS = 7
RECOVERY_DAYS = 14  # 療養から戻ったあと、ペースを判定しない日数

Kind = Literal["normal", "rehab"]
Direction = Literal["bulk", "cut", "maintain"]
Status = Literal["active", "ended", "aborted"]
DIRECTION_NAMES = {"bulk": "増量", "cut": "減量", "maintain": "維持"}
STATUS_NAMES = {"active": "実施中", "ended": "終了", "aborted": "中断"}
# ペース：on_track 順調、fast 早い、slow 遅い（増量・減量）。維持は over 上に外れた、under 下に外れた
PaceStatus = Literal["on_track", "fast", "slow", "over", "under"]
# 判定しない理由：not_active 実施中の通常のフェーズでない、paused 療養で止まっている、recovering 療養から戻って14日、
# few_weigh_ins 7日に測った日が1日以下、no_plan 予定の線がない（開始時の体重がない）
NoPaceReason = Literal["not_active", "paused", "recovering", "few_weigh_ins", "no_plan"]


@dataclass(frozen=True)
class TargetChange:
    date: str  # 変えた日（最初の1件は開始日）。この日から線を引き直す
    target_weight_kg: float
    end_date: str  # その時点の終了日（止まった日を含まない）
    weight_kg: float | None  # 線の始まりの体重（変えたときの週の平均。最初の1件は開始時の体重）。なければ前の線の値


@dataclass(frozen=True)
class Phase:
    id: str
    kind: Kind
    direction: Direction | None  # 通常のフェーズだけ
    name: str
    start_date: str
    end_date: str | None  # 通常のフェーズだけ
    target_weight_kg: float | None  # 通常のフェーズだけ
    meal_targets: dict | None  # {"training_day": {"kcal", "protein_g"}, "rest_day": {...}}
    snapshot: dict | None  # {"weight_kg", "body_fat_pct", "big3": {"bench", "squat", "deadlift"}, "growth_score"}
    status: Status
    paused_phase_id: str | None  # 療養だけ：止めた通常のフェーズ
    target_history: tuple[TargetChange, ...]
    ended_on: str | None
    created_at: str = ""


def _d(text: str) -> date:
    return date.fromisoformat(text)


def _days(a: str, b: str) -> int:
    return (_d(b) - _d(a)).days


def _add(day: str, n: int) -> str:
    return (_d(day) + timedelta(days=n)).isoformat()


def label(p: Phase) -> str:
    """表示の名前。名前がなければ「増量 16週」「療養」。"""
    if p.name.strip():
        return p.name.strip()
    if p.kind == "rehab":
        return "療養"
    weeks = weeks_total(p)
    return f"{DIRECTION_NAMES.get(p.direction or '', '')} {weeks}週" if weeks else DIRECTION_NAMES.get(p.direction or "", "")


def _rank(p: Phase) -> tuple:
    return (p.start_date, p.created_at, p.id)


def current(phases: list[Phase], as_of: str) -> tuple[Phase | None, Phase | None]:
    """(今のフェーズ, 療養で止まっている通常のフェーズ)。as_of より後に始まるものは選ばない。"""
    active = [p for p in phases if p.status == "active" and p.start_date <= as_of]
    rehab = max((p for p in active if p.kind == "rehab"), key=_rank, default=None)
    normal = max((p for p in active if p.kind == "normal" and p.end_date and p.target_weight_kg is not None
                  and p.direction), key=_rank, default=None)
    if rehab is not None:
        paused = next((p for p in active if p.id == rehab.paused_phase_id and p.kind == "normal"), None)
        return rehab, paused
    return normal, None


def pauses(p: Phase, phases: list[Phase], as_of: str) -> list[tuple[str, str]]:
    """通常のフェーズが療養で止まった日（[始め, 終わり) の組。古い順、重なりはまとめる）。
    終わった療養は終わった日まで（終わった日がなければ止まっていない）、実施中の療養は as_of まで（as_of を含む）。"""
    spans = []
    for r in phases:
        if r.kind != "rehab" or r.paused_phase_id != p.id:
            continue
        end = _add(as_of, 1) if r.status == "active" else (r.ended_on or r.start_date)
        start = max(r.start_date, p.start_date)
        if end > start:
            spans.append((start, end))
    merged: list[tuple[str, str]] = []
    for s, e in sorted(spans):
        if merged and s <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], e))
        else:
            merged.append((s, e))
    return merged


def paused_days(spans: list[tuple[str, str]], until: str | None = None) -> int:
    """止まった日の数（until があれば、その日より前だけ）。"""
    total = 0
    for s, e in spans:
        if until is not None:
            e = min(e, until)
        if e > s:
            total += _days(s, e)
    return total


def phase_day(p: Phase, spans: list[tuple[str, str]], day: str) -> int:
    """フェーズの時計：開始日から day までの、止まった日を除いた日数（開始日は 0）。"""
    return _days(p.start_date, day) - paused_days(spans, day)


def is_paused(spans: list[tuple[str, str]], day: str) -> bool:
    return any(s <= day < e for s, e in spans)


def weeks_total(p: Phase) -> int | None:
    if p.end_date is None:
        return None
    return math.ceil((_days(p.start_date, p.end_date) + 1) / 7)


def effective_end(p: Phase, spans: list[tuple[str, str]]) -> str | None:
    """実際の終わり（終了日を止まった日数だけ後ろにずらす）。"""
    return None if p.end_date is None else _add(p.end_date, paused_days(spans))


def week(p: Phase, spans: list[tuple[str, str]], as_of: str) -> int:
    """何週目か（1から。止まった日は数えない）。通常のフェーズは全体の週数で止める。"""
    n = max(0, phase_day(p, spans, as_of)) // 7 + 1
    total = weeks_total(p)
    return min(n, total) if total else n


def remaining_days(p: Phase, spans: list[tuple[str, str]], as_of: str) -> int | None:
    end = effective_end(p, spans)
    return None if end is None else max(0, _days(as_of, end))


def history(p: Phase) -> list[TargetChange]:
    """予定の線（古い順）。履歴がなければ、今の目標と終了日で開始日から1本。最後の線は今の目標と終了日にそろえる。"""
    if p.end_date is None or p.target_weight_kg is None:
        return []
    start_weight = (p.snapshot or {}).get("weight_kg")
    found = sorted((c for c in p.target_history if c.date >= p.start_date), key=lambda c: c.date)
    if not found or found[0].date != p.start_date:
        first = found[0] if found else None
        found.insert(0, TargetChange(p.start_date, first.target_weight_kg if first else p.target_weight_kg,
                                     first.end_date if first else p.end_date, start_weight))
    last = found[-1]
    found[-1] = TargetChange(last.date, p.target_weight_kg, p.end_date, last.weight_kg)
    return found


def _line_value(p: Phase, spans, line: TargetChange, w0: float, day: str) -> float:
    t0 = phase_day(p, spans, line.date)
    t_end = _days(p.start_date, line.end_date)  # 終了日は止まった日を含まないので、そのままフェーズの時計
    if t_end <= t0:
        return line.target_weight_kg
    t = phase_day(p, spans, day)
    ratio = min(1.0, max(0.0, (t - t0) / (t_end - t0)))
    return w0 + (line.target_weight_kg - w0) * ratio


def plan_value(p: Phase, spans: list[tuple[str, str]], day: str) -> float | None:
    """その日の予定の体重（今の線。day が線の始まりより前なら、その時点の線）。開始時の体重がなければ None。"""
    lines = history(p)
    w = None
    for i, line in enumerate(lines):
        w0 = line.weight_kg if line.weight_kg is not None else (
            None if i == 0 or w is None else _line_value(p, spans, lines[i - 1], w, line.date))
        if w0 is None:
            return None
        if i + 1 == len(lines) or day < lines[i + 1].date:
            return _line_value(p, spans, line, w0, day)
        w = w0
    return None


def cents(x: float) -> int:
    """0.01kg 単位に丸める（.5 は上げる。アプリの Math.round と同じ）。"""
    return math.floor(x * 100 + 0.5)


@dataclass(frozen=True)
class Pace:
    status: PaceStatus | None
    reason: NoPaceReason | None
    weigh_ins: int
    week_avg_kg: float | None  # 7日の体重の平均（0.01kg）
    plan_kg: float | None  # 同じ日の予定の平均（0.01kg）
    diff_kg: float | None  # 平均 − 予定（0.01kg）


def _judge(direction: str | None, diff: int) -> PaceStatus:
    if abs(diff) <= PACE_BAND_CENTS:
        return "on_track"
    if direction == "bulk":
        return "fast" if diff > 0 else "slow"
    if direction == "cut":
        return "fast" if diff < 0 else "slow"
    return "over" if diff > 0 else "under"


def pace(p: Phase, phases: list[Phase], weights: list[tuple[str, float]], as_of: str) -> Pace:
    """as_of までの7日の体重の平均と予定の比べ（weights は日ごとの体重）。"""
    spans = pauses(p, phases, as_of)
    none = lambda reason, n=0: Pace(None, reason, n, None, None, None)  # noqa: E731
    if p.kind != "normal" or p.status != "active" or as_of < p.start_date:
        return none("not_active")
    if is_paused(spans, as_of):
        return none("paused")
    if any(e <= as_of and _days(e, as_of) < RECOVERY_DAYS for _, e in spans):
        return none("recovering")
    first = max(p.start_date, _add(as_of, -(PACE_WINDOW_DAYS - 1)))
    days = [(d, kg) for d, kg in weights if first <= d <= as_of and not is_paused(spans, d)]
    if len(days) < MIN_WEIGH_INS:
        return none("few_weigh_ins", len(days))
    plans = [plan_value(p, spans, d) for d, _ in days]
    if any(v is None for v in plans):
        return none("no_plan", len(days))
    avg = sum(kg for _, kg in days) / len(days)
    plan = sum(plans) / len(plans)
    diff = cents(avg - plan)
    return Pace(_judge(p.direction, diff), None, len(days), cents(avg) / 100, cents(plan) / 100, diff / 100)


def end_of(p: Phase, phases: list[Phase], as_of: str) -> str:
    """そのフェーズが続いた（続く）最後の日。終わったものは終わった日の前の日まで、実施中の通常は実際の終わり、
    実施中の療養は as_of。"""
    if p.status != "active":
        return _add(p.ended_on, -1) if p.ended_on else p.start_date
    if p.kind == "rehab":
        return as_of
    return effective_end(p, pauses(p, phases, as_of)) or as_of
