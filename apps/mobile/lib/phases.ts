// フェーズ（増量・減量・維持と療養の期間）の計算。どれも純粋な関数で、DB は読まない（読むのは db/repositories/phases.ts）。
// サーバー（services/training/training/domain/phase.py と application/queries.py の phase_progress）と同じ結果になるようにする
// （testdata/training/phases.json で確かめる）。決まりは phase.py の先頭の説明と同じ：
// - 止まっているか・時計のずれは療養の行から求める（通常のフェーズの状態は active のまま）。療養の [開始日, 終わった日) が止まった日。
//   実施中の療養は、今日まで（今日を含む）止まっているとする
// - 終了日（endDate）は止まった日を含まない予定の終わり。実際の終わりは止まった日数だけ後ろにずれる
// - 予定の線は直線で、目標や終了日を変えたら変えた日から引き直す（targetHistory の1件が1本の線）。線の時刻は止まった日を除いた日数
// - ペースは今日までの7日（開始より前と止まった日を除く）の体重の平均と、同じ日の予定の値の平均の差。±0.3kg 以内なら順調。
//   測った日が1日以下・療養で止まっている・療養から戻って14日は判定しない
import { addDays, DateKey, daysBetween } from './date';

export type PhaseKind = 'normal' | 'rehab';
export type PhaseDirection = 'bulk' | 'cut' | 'maintain';
export type PhaseStatus = 'active' | 'ended' | 'aborted';

export const PHASE_KINDS: readonly PhaseKind[] = ['normal', 'rehab'];
export const PHASE_DIRECTIONS: readonly PhaseDirection[] = ['bulk', 'cut', 'maintain'];
export const PHASE_STATUSES: readonly PhaseStatus[] = ['active', 'ended', 'aborted'];
export const DIRECTION_LABELS: Record<PhaseDirection, string> = { bulk: '増量', cut: '減量', maintain: '維持' };

/**
 * 上限。サーバーの services/training/training/domain/phase.py の MAX_…・PACE_… と同じ
 * （lib/__tests__/server-limits.test.ts で突き合わせる）。件数（phases）はサーバーが確かめないので、アプリが書くときに確かめる
 */
export const PHASE_LIMITS = { name: 40, weeks: 104, targetHistory: 100, phases: 200 } as const;
/** ペースの幅（0.01kg 単位。±0.3kg） */
export const PACE_BAND_CENTS = 30;
/** ペースを判定するのに要る、7日の中の体重を測った日の数 */
export const MIN_WEIGH_INS = 2;
export const PACE_WINDOW_DAYS = 7;
/** 療養から戻ったあと、ペースを判定しない日数 */
export const RECOVERY_DAYS = 14;

/** 筋トレの日・休みの日の食事の目標（食事の目標 nutrition_goal の targets と同じく2つを1つの項目にする） */
export type PhaseDayTarget = { kcal: number | null; protein_g: number | null };
export type PhaseMealTargets = { training_day: PhaseDayTarget; rest_day: PhaseDayTarget };
/** 開始時の記録（振り返りの before）。BIG3 は推定1RM（kg）。ないものは null */
export type PhaseSnapshot = {
  weight_kg: number | null;
  body_fat_pct: number | null;
  big3: { bench: number | null; squat: number | null; deadlift: number | null } | null;
  growth_score: number | null;
};
/** 目標と終了日の変更（最初の1件は開始日）。weight_kg は線の始まりの体重（なければ前の線のその日の値） */
export type TargetChange = { date: DateKey; target_weight_kg: number; end_date: DateKey; weight_kg: number | null };

export type Phase = {
  id: string;
  kind: PhaseKind;
  /** 通常のフェーズだけ */
  direction: PhaseDirection | null;
  name: string;
  startDate: DateKey;
  /** 予定の終わり（止まった日を含まない）。療養は null */
  endDate: DateKey | null;
  targetWeightKg: number | null;
  mealTargets: PhaseMealTargets | null;
  snapshot: PhaseSnapshot | null;
  status: PhaseStatus;
  /** 療養だけ：止めた通常のフェーズ */
  pausedPhaseId: string | null;
  targetHistory: TargetChange[];
  /** 終えた・中断した日（この日はフェーズに含まない） */
  endedOn: DateKey | null;
  createdAt: string;
};

export type Span = [DateKey, DateKey]; // [始め, 終わり)

/** 終了日（週数から。開始日＋7×週数−1） */
export function endDateFor(startDate: DateKey, weeks: number): DateKey {
  return addDays(startDate, weeks * 7 - 1);
}

export function weeksTotal(p: Phase): number | null {
  return p.endDate == null ? null : Math.ceil((daysBetween(p.startDate, p.endDate) + 1) / 7);
}

/** 表示の名前。名前がなければ「増量 16週」「療養」 */
export function phaseLabel(p: Phase): string {
  if (p.name.trim()) return p.name.trim();
  if (p.kind === 'rehab') return '療養';
  const dir = p.direction ? DIRECTION_LABELS[p.direction] : '';
  const weeks = weeksTotal(p);
  return weeks ? `${dir} ${weeks}週` : dir;
}

const rank = (p: Phase) => [p.startDate, p.createdAt, p.id] as const;
const newer = (a: Phase, b: Phase) => {
  const [x, y] = [rank(a), rank(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};
const best = (list: Phase[]) => list.reduce<Phase | null>((acc, p) => (acc == null || newer(p, acc) ? p : acc), null);

/** 予定の線を引ける通常のフェーズか（同期の途中で項目がそろっていないものは、今のフェーズに選ばない） */
const complete = (p: Phase) => p.endDate != null && p.targetWeightKg != null && p.direction != null;

/**
 * 今のフェーズと、療養で止まっている通常のフェーズ。asOf より後に始まるものは選ばない。
 * 実施中が2つ以上（端末どうしの同期）なら、開始日の新しいもの、同じなら記録の新しいもの、ID の大きいもの
 */
export function currentPhase(phases: Phase[], asOf: DateKey): { current: Phase | null; paused: Phase | null } {
  const active = phases.filter((p) => p.status === 'active' && p.startDate <= asOf);
  const rehab = best(active.filter((p) => p.kind === 'rehab'));
  if (rehab) {
    return { current: rehab, paused: active.find((p) => p.kind === 'normal' && p.id === rehab.pausedPhaseId) ?? null };
  }
  return { current: best(active.filter((p) => p.kind === 'normal' && complete(p))), paused: null };
}

/** 通常のフェーズが療養で止まった日（古い順、重なりはまとめる） */
export function pauses(p: Phase, phases: Phase[], asOf: DateKey): Span[] {
  const spans: Span[] = [];
  for (const r of phases) {
    if (r.kind !== 'rehab' || r.pausedPhaseId !== p.id) continue;
    const end = r.status === 'active' ? addDays(asOf, 1) : (r.endedOn ?? r.startDate);
    const start = r.startDate > p.startDate ? r.startDate : p.startDate;
    if (end > start) spans.push([start, end]);
  }
  spans.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const merged: Span[] = [];
  for (const [s, e] of spans) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = e > last[1] ? e : last[1];
    else merged.push([s, e]);
  }
  return merged;
}

/** 止まった日の数（until があれば、その日より前だけ） */
export function pausedDays(spans: Span[], until?: DateKey): number {
  let total = 0;
  for (const [s, e0] of spans) {
    const e = until != null && until < e0 ? until : e0;
    if (e > s) total += daysBetween(s, e);
  }
  return total;
}

/** フェーズの時計：開始日から day までの、止まった日を除いた日数（開始日は 0） */
export function phaseDay(p: Phase, spans: Span[], day: DateKey): number {
  return daysBetween(p.startDate, day) - pausedDays(spans, day);
}

export function isPaused(spans: Span[], day: DateKey): boolean {
  return spans.some(([s, e]) => s <= day && day < e);
}

/** 実際の終わり（終了日を止まった日数だけ後ろにずらす） */
export function effectiveEnd(p: Phase, spans: Span[]): DateKey | null {
  return p.endDate == null ? null : addDays(p.endDate, pausedDays(spans));
}

/** 実際の終わりから、保存する終了日（止まった日を含まない）を出す。延長の画面で、実際の終わりを選んだときに使う */
export function baseEndFor(p: Phase, spans: Span[], effectiveEndDate: DateKey): DateKey {
  return addDays(effectiveEndDate, -pausedDays(spans));
}

/** 何週目か（1から。止まった日は数えない）。全体の週数で止める */
export function phaseWeek(p: Phase, spans: Span[], asOf: DateKey): number {
  const n = Math.floor(Math.max(0, phaseDay(p, spans, asOf)) / 7) + 1;
  const total = weeksTotal(p);
  return total ? Math.min(n, total) : n;
}

export function remainingDays(p: Phase, spans: Span[], asOf: DateKey): number | null {
  const end = effectiveEnd(p, spans);
  return end == null ? null : Math.max(0, daysBetween(asOf, end));
}

/** 予定の線（古い順）。履歴がなければ今の目標と終了日で開始日から1本。最後の線は今の目標と終了日にそろえる */
export function planLines(p: Phase): TargetChange[] {
  if (p.endDate == null || p.targetWeightKg == null) return [];
  const startWeight = p.snapshot?.weight_kg ?? null;
  const found = p.targetHistory.filter((c) => c.date >= p.startDate).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (found.length === 0 || found[0].date !== p.startDate) {
    const first = found[0];
    found.unshift({
      date: p.startDate, target_weight_kg: first ? first.target_weight_kg : p.targetWeightKg, end_date: first ? first.end_date : p.endDate,
      weight_kg: startWeight,
    });
  }
  const last = found[found.length - 1];
  found[found.length - 1] = { ...last, target_weight_kg: p.targetWeightKg, end_date: p.endDate };
  return found;
}

function lineValue(p: Phase, spans: Span[], line: TargetChange, w0: number, day: DateKey): number {
  const t0 = phaseDay(p, spans, line.date);
  const tEnd = daysBetween(p.startDate, line.end_date); // 終了日は止まった日を含まないので、そのままフェーズの時計
  if (tEnd <= t0) return line.target_weight_kg;
  const ratio = Math.min(1, Math.max(0, (phaseDay(p, spans, day) - t0) / (tEnd - t0)));
  return w0 + (line.target_weight_kg - w0) * ratio;
}

/** 線ごとの始まりの体重（なければ前の線のその日の値）。最初の線に体重がなければ、そこから先は null */
function lineStarts(p: Phase, spans: Span[], lines: TargetChange[]): (number | null)[] {
  const out: (number | null)[] = [];
  lines.forEach((line, i) => {
    const prev = i > 0 ? out[i - 1] : null;
    out.push(line.weight_kg ?? (prev == null ? null : lineValue(p, spans, lines[i - 1], prev, line.date)));
  });
  return out;
}

/** その日の予定の体重（その日に有効な線の値）。開始時の体重がなければ null */
export function planValue(p: Phase, spans: Span[], day: DateKey): number | null {
  const lines = planLines(p);
  const starts = lineStarts(p, spans, lines);
  for (let i = 0; i < lines.length; i++) {
    const w0 = starts[i];
    if (w0 == null) return null;
    if (i + 1 === lines.length || day < lines[i + 1].date) return lineValue(p, spans, lines[i], w0, day);
  }
  return null;
}

/**
 * 予定の線を描くための点（線ごと。古い順）。各線は始まりの日から実際の終わりまでで、止まった日の始めと終わりにも点を置く
 * （止まっているあいだは平らになる）。current は今の線（前の線は薄く描く）
 */
export function planPolylines(p: Phase, spans: Span[]): { from: DateKey; current: boolean; points: { date: DateKey; kg: number }[] }[] {
  const lines = planLines(p);
  const starts = lineStarts(p, spans, lines);
  const out: { from: DateKey; current: boolean; points: { date: DateKey; kg: number }[] }[] = [];
  lines.forEach((line, i) => {
    const w0 = starts[i];
    if (w0 == null) return;
    // 線の終わり（実際の日付）：終了日に、止まった日のうちその日までに入るものを足す
    let end = line.end_date;
    for (const [s, e] of spans) if (s <= end) end = addDays(end, daysBetween(s, e));
    const days = new Set<DateKey>([line.date, end]);
    for (const [s, e] of spans) {
      if (s > line.date && s < end) days.add(s);
      if (e > line.date && e < end) days.add(e); // 戻った日の値は止まった日と同じ（平らな線の終わり）
    }
    const points = [...days].sort().map((date) => ({ date, kg: lineValue(p, spans, line, w0, date) }));
    out.push({ from: line.date, current: i === lines.length - 1, points });
  });
  return out;
}

/** 0.01kg 単位に丸める（.5 は上げる。サーバーの cents と同じ） */
export function cents(x: number): number {
  return Math.floor(x * 100 + 0.5);
}

/** on_track 順調、fast 早い、slow 遅い（増量・減量）。維持は over 上に外れた、under 下に外れた */
export type PaceStatus = 'on_track' | 'fast' | 'slow' | 'over' | 'under';
/** 判定しない理由（サーバーの NoPaceReason と同じ） */
export type NoPaceReason = 'not_active' | 'paused' | 'recovering' | 'few_weigh_ins' | 'no_plan';
export type Pace = {
  status: PaceStatus | null;
  reason: NoPaceReason | null;
  weighIns: number;
  weekAvgKg: number | null;
  planKg: number | null;
  diffKg: number | null;
};
export const PACE_LABELS: Record<PaceStatus, string> = { on_track: '順調', fast: '早い', slow: '遅い', over: '上に外れた', under: '下に外れた' };

function judge(direction: PhaseDirection | null, diff: number): PaceStatus {
  if (Math.abs(diff) <= PACE_BAND_CENTS) return 'on_track';
  if (direction === 'bulk') return diff > 0 ? 'fast' : 'slow';
  if (direction === 'cut') return diff < 0 ? 'fast' : 'slow';
  return diff > 0 ? 'over' : 'under';
}

export type Weight = { date: DateKey; kg: number };

/** asOf までの7日の体重の平均と予定の比べ（weights は日ごとの体重） */
export function phasePace(p: Phase, phases: Phase[], weights: Weight[], asOf: DateKey): Pace {
  const spans = pauses(p, phases, asOf);
  const none = (reason: NoPaceReason, n = 0): Pace => ({ status: null, reason, weighIns: n, weekAvgKg: null, planKg: null, diffKg: null });
  if (p.kind !== 'normal' || p.status !== 'active' || asOf < p.startDate) return none('not_active');
  if (isPaused(spans, asOf)) return none('paused');
  if (spans.some(([, e]) => e <= asOf && daysBetween(e, asOf) < RECOVERY_DAYS)) return none('recovering');
  const windowStart = addDays(asOf, -(PACE_WINDOW_DAYS - 1));
  const first = p.startDate > windowStart ? p.startDate : windowStart;
  const days = weights.filter((w) => first <= w.date && w.date <= asOf && !isPaused(spans, w.date));
  if (days.length < MIN_WEIGH_INS) return none('few_weigh_ins', days.length);
  const plans = days.map((w) => planValue(p, spans, w.date));
  if (plans.some((v) => v == null)) return none('no_plan', days.length);
  const avg = days.reduce((s, w) => s + w.kg, 0) / days.length;
  const plan = (plans as number[]).reduce((s, v) => s + v, 0) / plans.length;
  const diff = cents(avg - plan);
  return { status: judge(p.direction, diff), reason: null, weighIns: days.length, weekAvgKg: cents(avg) / 100, planKg: cents(plan) / 100, diffKg: diff / 100 };
}

export type PhaseProgress = {
  phase: Phase;
  asOf: DateKey;
  /** 療養で止まっている（通常のフェーズだけ） */
  paused: boolean;
  week: number;
  weeksTotal: number | null;
  effectiveEnd: DateKey | null;
  remainingDays: number | null;
  /** 通常：療養で止まった日数。療養：開始日から asOf まで（終わったものは終わった日まで）の日数 */
  rehabDays: number;
  pace: Pace | null;
  /** asOf の予定の体重（0.01kg） */
  planKg: number | null;
};

/** asOf の時点の進み具合（サーバーの phase_progress と同じ） */
export function phaseProgress(p: Phase, phases: Phase[], weights: Weight[], asOf: DateKey): PhaseProgress {
  if (p.kind === 'rehab') {
    const last = p.status === 'active' || !p.endedOn ? asOf : (addDays(p.endedOn, -1) < asOf ? addDays(p.endedOn, -1) : asOf);
    const days = Math.max(0, daysBetween(p.startDate, last) + 1);
    return {
      phase: p, asOf, paused: false, week: Math.floor(Math.max(0, days - 1) / 7) + 1, weeksTotal: null, effectiveEnd: null,
      remainingDays: null, rehabDays: days, pace: null, planKg: null,
    };
  }
  const spans = pauses(p, phases, asOf);
  const plan = planValue(p, spans, asOf);
  return {
    phase: p, asOf, paused: isPaused(spans, asOf), week: phaseWeek(p, spans, asOf), weeksTotal: weeksTotal(p),
    effectiveEnd: effectiveEnd(p, spans), remainingDays: remainingDays(p, spans, asOf), rehabDays: pausedDays(spans),
    pace: phasePace(p, phases, weights, asOf), planKg: plan == null ? null : cents(plan) / 100,
  };
}

/** 療養から戻ったあと、ペースを判定しない最後の日（なければ null）。画面で「〜まで判定しない」と出すため */
export function recoveryUntil(p: Phase, phases: Phase[], asOf: DateKey): DateKey | null {
  const ended = pauses(p, phases, asOf).filter(([, e]) => e <= asOf).map(([, e]) => e);
  if (ended.length === 0) return null;
  const until = addDays(ended[ended.length - 1], RECOVERY_DAYS - 1);
  return until >= asOf ? until : null;
}

/**
 * 目標体重：フェーズ実施中（療養で止まっているときも）はフェーズの目標、なければ設定の目標体重（サーバーの period_overview と同じ順）
 */
export function effectiveGoalWeight(phases: Phase[], settingGoalKg: number | null, asOf: DateKey): { kg: number | null; source: 'phase' | 'setting' | null } {
  const { current, paused } = currentPhase(phases, asOf);
  const normal = paused ?? (current?.kind === 'normal' ? current : null);
  if (normal?.targetWeightKg != null) return { kg: normal.targetWeightKg, source: 'phase' };
  return { kg: settingGoalKg, source: settingGoalKg == null ? null : 'setting' };
}

// --- 成功の指標（向きごと。ウエストは使わない。体脂肪率は参考に出すだけで判定に使わない） ---

/** 減量で「BIG3 を保つ」の幅（開始時からの減りが3%以内。仮） */
export const CUT_BIG3_KEEP_RATIO = 0.03;
/** 維持（リコンプ）で「体重がほぼ変わらない」の幅（±1kg。仮） */
export const MAINTAIN_WEIGHT_BAND_KG = 1;

export type SuccessMetricKey = 'weight' | 'big3' | 'growth_score' | 'body_fat';
export type SuccessMetric = {
  key: SuccessMetricKey;
  label: string;
  start: number | null;
  now: number | null;
  /** now − start（どちらかがなければ null） */
  delta: number | null;
  /** 目標の向きにかなっているか。比べられなければ null。参考（体脂肪率）はいつも null */
  ok: boolean | null;
  /** 判定に使わない参考 */
  reference: boolean;
};

export type SuccessNow = {
  /** 今の体重（週の平均など、呼ぶ側が決める） */
  weightKg: number | null;
  bodyFatPct: number | null;
  /** 今の BIG3 の推定1RM（開始時と同じ出し方で） */
  big3: { bench: number | null; squat: number | null; deadlift: number | null } | null;
  growthScore: number | null;
};

/** BIG3 の合計。開始時と今の両方に値がある役だけを足す（片方にしかない役で増減が出ないように） */
function big3Totals(start: PhaseSnapshot['big3'], now: SuccessNow['big3']): [number, number] | null {
  if (!start || !now) return null;
  const roles = (['bench', 'squat', 'deadlift'] as const).filter((r) => start[r] != null && now[r] != null);
  if (roles.length === 0) return null;
  return [roles.reduce((s, r) => s + start[r]!, 0), roles.reduce((s, r) => s + now[r]!, 0)];
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * 向きごとの成功の指標と、全体（判定に使う指標がすべて ok なら true、どれかが比べられなければ null）。
 * - 増量：体重↑＋BIG3↑
 * - 減量：体重↓＋BIG3 を保つ（−3% 以内）
 * - 維持（リコンプ）：体重がほぼ変わらない（±1kg）＋BIG3↑＋成長スコア↑
 * 体脂肪率は参考に出すだけ。療養は判定しない（空）
 */
export function successMetrics(p: Phase, now: SuccessNow): { metrics: SuccessMetric[]; achieved: boolean | null } {
  if (p.kind !== 'normal' || !p.direction) return { metrics: [], achieved: null };
  const s = p.snapshot;
  const metric = (key: SuccessMetricKey, label: string, start: number | null, current: number | null,
    ok: (delta: number, start: number) => boolean, reference = false): SuccessMetric => {
    const delta = start == null || current == null ? null : round1(current - start);
    return { key, label, start, now: current, delta, ok: reference || delta == null || start == null ? null : ok(current! - start, start), reference };
  };
  const totals = big3Totals(s?.big3 ?? null, now.big3);
  const [b0, b1] = totals ?? [null, null];
  const weight = (ok: (d: number) => boolean) => metric('weight', '体重', s?.weight_kg ?? null, now.weightKg, ok);
  const metrics: SuccessMetric[] = [];
  if (p.direction === 'bulk') {
    metrics.push(weight((d) => d > 0), metric('big3', 'BIG3', b0, b1, (d) => d > 0));
  } else if (p.direction === 'cut') {
    metrics.push(weight((d) => d < 0), metric('big3', 'BIG3', b0, b1, (d, st) => d >= -st * CUT_BIG3_KEEP_RATIO));
  } else {
    metrics.push(
      weight((d) => Math.abs(d) <= MAINTAIN_WEIGHT_BAND_KG),
      metric('big3', 'BIG3', b0, b1, (d) => d > 0),
      metric('growth_score', '成長スコア', s?.growth_score ?? null, now.growthScore, (d) => d > 0),
    );
  }
  metrics.push(metric('body_fat', '体脂肪率', s?.body_fat_pct ?? null, now.bodyFatPct, () => false, true));
  const judged = metrics.filter((m) => !m.reference);
  const achieved = judged.some((m) => m.ok == null) ? null : judged.every((m) => m.ok);
  return { metrics, achieved };
}
