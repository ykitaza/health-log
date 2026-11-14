// フェーズの設定（app/phase/new.tsx）と進捗の詳細（app/phase/index.tsx）の計算。画面から切り離し、jest で確かめる。
// フェーズの決まり（何週目・ペース・止まった日・予定の線・成功の指標）は lib/phases.ts のまま使い、ここで数え方を作り直さない
import { addDays, DateKey, daysBetween } from './date';
import { average } from './health';
import { big3Gauge } from './homeHud';
import type { GrowthData } from './growthData';
import { growthScore } from './growth';
import { NutritionGoal, targetFor } from './meals';
import {
  cents, DIRECTION_LABELS, effectiveEnd, isPaused, MIN_WEIGH_INS, Pace, PACE_BAND_CENTS, PACE_WINDOW_DAYS, PaceStatus, pauses,
  Phase, PhaseDirection, phaseDay, PhaseMealTargets, phasePace, PhaseSnapshot, planPolylines, Span,
  SuccessMetric, SuccessNow, Weight,
} from './phases';
import { parseNumber } from './units';

// ---- 今の記録（開始時の記録と、成功の指標の「今」） ----

export type PhaseMeasures = SuccessNow & {
  /** 体重の出し方：直近 7 日の平均か、7 日に記録がないときの最新の値 */
  weightBasis: 'week' | 'latest' | null;
};

/** 直近 7 日（today を含む）の平均。なければ today までの最新の値 */
function weekOrLatest(list: { date: DateKey; v: number }[], today: DateKey): { v: number | null; basis: 'week' | 'latest' | null } {
  const from = addDays(today, -(PACE_WINDOW_DAYS - 1));
  const week = average(list.filter((x) => x.date >= from && x.date <= today).map((x) => x.v));
  if (week != null) return { v: Math.round(week * 10) / 10, basis: 'week' };
  const past = list.filter((x) => x.date <= today).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const last = past[past.length - 1];
  return last ? { v: last.v, basis: 'latest' } : { v: null, basis: null };
}

/**
 * 今の記録：体重（直近 7 日の平均、なければ最新）・体脂肪率（同じ）・BIG3 の推定1RM（ホームの BIG3 と同じ big3Gauge）・成長スコア。
 * フェーズの開始時の記録（snapshot）と、進捗の詳細の成功の指標の「今」の両方に使う（同じ出し方で比べるため）
 */
export function measuresFrom(g: GrowthData, today: DateKey): PhaseMeasures {
  const weight = weekOrLatest(g.weights.map((w) => ({ date: w.date, v: w.weightKg })), today);
  const fat = weekOrLatest(g.bodyFats.map((f) => ({ date: f.date, v: f.pct })), today);
  const gauge = big3Gauge(g.sets, g.big3, today);
  const big3 = gauge
    ? Object.fromEntries(gauge.lifts.map((l) => [l.role, l.kg])) as { bench: number | null; squat: number | null; deadlift: number | null }
    : null;
  const recorded = g.days.some((d) => d.date <= today);
  return {
    weightKg: weight.v, weightBasis: weight.basis, bodyFatPct: fat.v, big3,
    growthScore: recorded ? growthScore(g.days, today, g.weeklyTrainingGoal).total : null,
  };
}

/** 開始時の記録にする（範囲の確かめは db/repositories/phases.ts の cleanSnapshot） */
export function snapshotOf(m: PhaseMeasures): PhaseSnapshot {
  return { weight_kg: m.weightKg, body_fat_pct: m.bodyFatPct, big3: m.big3, growth_score: m.growthScore };
}

/** BIG3 の合計（記録のある役だけ）。どれもなければ null */
export function big3Sum(b: PhaseSnapshot['big3']): number | null {
  if (!b) return null;
  const v = [b.bench, b.squat, b.deadlift].filter((x): x is number => x != null);
  return v.length === 0 ? null : Math.round(v.reduce((s, x) => s + x, 0) * 10) / 10;
}

// ---- 設定のステップ ----

export const DIRECTIONS: PhaseDirection[] = ['bulk', 'cut', 'maintain'];
/** 向きの選択肢の題と説明（Figma の設定 1） */
export const DIRECTION_CHOICES: Record<PhaseDirection, { title: string; en: string; body: string }> = {
  bulk: { title: '増量', en: 'BULK', body: '体重を増やし、BIG3 を伸ばす。成功：体重↑ ＋ BIG3↑' },
  cut: { title: '減量', en: 'CUT', body: '体重を落とし、BIG3 を保つ。成功：体重↓ ＋ BIG3 を保つ' },
  maintain: { title: '維持・リコンプ', en: 'MAINTAIN', body: '体重はほぼそのまま、体を作り変える。成功：BIG3↑ ＋ 成長スコア↑' },
};
/** 成功の指標の見出しの右（向きごとの定義） */
export const SUCCESS_RULE: Record<PhaseDirection, string> = {
  bulk: '増量：体重↑ ＋ BIG3↑', cut: '減量：体重↓ ＋ BIG3 を保つ', maintain: 'リコンプ：体重→ ＋ BIG3↑ ＋ 成長↑',
};

export const WEEK_OPTIONS = [4, 8, 12, 16, 20] as const;
/** 期間の初期値（増量 16 週・減量 12 週・維持 8 週） */
export const DEFAULT_WEEKS: Record<PhaseDirection, number> = { bulk: 16, cut: 12, maintain: 8 };

/** 名前が空のときの名前（lib/phases.ts の phaseLabel と同じ形） */
export function autoName(direction: PhaseDirection, weeks: number): string {
  return `${DIRECTION_LABELS[direction]} ${weeks}週`;
}

/**
 * 目標体重の初期値（kg）。増量・減量は、アカウントの目標体重が向きに合っていれば取り込む（今の体重がなければそのまま取り込む）。
 * 維持は今の体重（0.1kg に丸める）。どれもなければ null
 */
export function initialTarget(direction: PhaseDirection, goalKg: number | null, nowKg: number | null): { kg: number | null; imported: boolean } {
  if (direction === 'maintain') return { kg: nowKg == null ? goalKg : Math.round(nowKg * 10) / 10, imported: nowKg == null && goalKg != null };
  if (goalKg == null) return { kg: null, imported: false };
  const fits = nowKg == null || (direction === 'bulk' ? goalKg > nowKg : goalKg < nowKg);
  return fits ? { kg: goalKg, imported: true } : { kg: null, imported: false };
}

/** 予定のペース（kg／週。直線）。今の体重か目標がなければ null */
export function plannedWeeklyKg(nowKg: number | null, targetKg: number | null, weeks: number): number | null {
  if (nowKg == null || targetKg == null || weeks <= 0) return null;
  return (targetKg - nowKg) / weeks;
}

/** 目標が向きと逆か（増量なのに今より軽いなど）。維持は ±1kg を超えたら */
export function targetAgainstDirection(direction: PhaseDirection, nowKg: number | null, targetKg: number | null): boolean {
  if (nowKg == null || targetKg == null) return false;
  if (direction === 'bulk') return targetKg <= nowKg;
  if (direction === 'cut') return targetKg >= nowKg;
  return Math.abs(targetKg - nowKg) > 1;
}

/** 食事の目標の入力（筋トレの日・休みの日の kcal、たんぱく質は 1 日あたり。両方の日で同じ） */
export type MealDraft = { training: string; rest: string; protein: string };

const str = (n: number | null | undefined, digits = 0) => (n == null ? '' : String(Math.round(n * 10 ** digits) / 10 ** digits));

/** 今の食事の目標（nutrition_goal）を取り込む。たんぱく質は 体重 × 体重1kgあたりの量 */
export function mealDraftFromGoal(goal: NutritionGoal | null): MealDraft {
  if (!goal) return { training: '', rest: '', protein: '' };
  const t = targetFor(goal, 'training');
  const r = targetFor(goal, 'rest');
  return { training: str(t.kcal), rest: str(r.kcal), protein: str(t.protein_g) };
}

/** フェーズの食事の目標を入力に戻す（たんぱく質は筋トレの日の値） */
export function mealDraftFromPhase(t: PhaseMealTargets | null): MealDraft {
  if (!t) return { training: '', rest: '', protein: '' };
  return { training: str(t.training_day.kcal), rest: str(t.rest_day.kcal), protein: str(t.training_day.protein_g ?? t.rest_day.protein_g, 1) };
}

/** 入力を確かめる。全部空なら null（目標なし）。範囲はサーバーと同じ（db/repositories/phases.ts が確かめ直す） */
export function parseMealDraft(d: MealDraft): { value: PhaseMealTargets | null } | { error: string } {
  const read = (text: string, label: string): number | null | string => {
    if (text.trim() === '') return null;
    const n = parseNumber(text.replace(/,/g, ''));
    return n == null ? `${label}を数字で入れてください` : n;
  };
  const training = read(d.training, '筋トレの日の kcal');
  const rest = read(d.rest, '休みの日の kcal');
  const protein = read(d.protein, 'たんぱく質');
  for (const v of [training, rest, protein]) if (typeof v === 'string') return { error: v };
  if (training == null && rest == null && protein == null) return { value: null };
  const p = protein as number | null;
  return {
    value: {
      training_day: { kcal: training as number | null, protein_g: p },
      rest_day: { kcal: rest as number | null, protein_g: p },
    },
  };
}

// ---- 進捗の詳細：体重のグラフ ----

/** 週の点。x はフェーズの時計（開始日からの止まった日を除いた日数）。judged が false なら白抜き（判定しない週） */
export type WeekPoint = { week: number; x: number; kg: number; judged: boolean };
export type ChartLine = { current: boolean; points: { x: number; kg: number }[] };
export type WeightChart = {
  points: WeekPoint[];
  lines: ChartLine[];
  /** 目標を変えた所（2 本目からの線の始まり）。label は「目標 79→80」 */
  changes: { x: number; from: number; to: number }[];
  /** 横軸の終わり（週数 × 7） */
  xMax: number;
  weeks: number;
  targetKg: number | null;
};

/** フェーズの週（1 から）ごとの、その週の最後の日（止まった日を除く）。asOf より先は含めない */
function weekEnds(p: Phase, spans: Span[], asOf: DateKey): Map<number, DateKey> {
  const out = new Map<number, DateKey>();
  const last = (() => {
    const end = effectiveEnd(p, spans);
    return end != null && end < asOf ? end : asOf;
  })();
  for (let d = p.startDate; d <= last; d = addDays(d, 1)) {
    if (isPaused(spans, d)) continue;
    out.set(Math.floor(phaseDay(p, spans, d) / 7) + 1, d);
  }
  return out;
}

/**
 * 体重のグラフ：週ごとの点（その週の最後の日までの 7 日の平均。ペースと同じ phasePace で判定し、判定しない週は白抜き）、
 * 予定の線（前の線は current が false）、目標を変えた所
 */
export function weightChart(p: Phase, phases: Phase[], weights: Weight[], asOf: DateKey): WeightChart {
  const spans = pauses(p, phases, asOf);
  const points: WeekPoint[] = [];
  for (const [week, end] of weekEnds(p, spans, asOf)) {
    const pace = phasePace(p, phases, weights, end);
    const from = addDays(end, -(PACE_WINDOW_DAYS - 1));
    const first = p.startDate > from ? p.startDate : from;
    const days = weights.filter((w) => first <= w.date && w.date <= end && !isPaused(spans, w.date));
    const avg = average(days.map((w) => w.kg));
    if (avg == null) continue;
    const judged = pace.status != null;
    points.push({ week, x: phaseDay(p, spans, end), kg: judged ? pace.weekAvgKg! : cents(avg) / 100, judged });
  }
  const polys = planPolylines(p, spans);
  const lines = polys.map((l) => ({ current: l.current, points: l.points.map((pt) => ({ x: phaseDay(p, spans, pt.date), kg: pt.kg })) }));
  const changes = polys.slice(1).map((l, i) => {
    const prev = polys[i];
    return { x: phaseDay(p, spans, l.from), from: prev.points[prev.points.length - 1].kg, to: l.points[l.points.length - 1].kg };
  });
  const weeks = p.endDate ? Math.ceil((daysBetween(p.startDate, p.endDate) + 1) / 7) : 1;
  return { points, lines, changes, xMax: weeks * 7, weeks, targetKg: p.targetWeightKg };
}

/** 今の予定の線の傾き（kg／週）。線がなければ null */
export function planSlopePerWeek(chart: WeightChart): number | null {
  const line = chart.lines.find((l) => l.current);
  if (!line || line.points.length < 2) return null;
  const a = line.points[0];
  const b = line.points[line.points.length - 1];
  return b.x === a.x ? null : ((b.kg - a.kg) / (b.x - a.x)) * 7;
}

/** ここ 3 週の傾き（kg／週）：最後の点と、その 3 週前の点（なければそれより前のいちばん近い点）から。2 点なければ null */
export function recentSlopePerWeek(chart: WeightChart): number | null {
  const pts = chart.points;
  if (pts.length < 2) return null;
  const last = pts[pts.length - 1];
  const base = [...pts].reverse().find((x) => x.week <= last.week - 3) ?? null;
  if (!base) return null;
  return ((last.kg - base.kg) / (last.x - base.x)) * 7;
}

/** このままの見込み（最後の週の点から、ここ 3 週の傾きで終わりまで伸ばす）。出せなければ null */
export function projectedKg(chart: WeightChart): number | null {
  const slope = recentSlopePerWeek(chart);
  const last = chart.points[chart.points.length - 1];
  if (slope == null || !last) return null;
  return Math.round((last.kg + (slope * Math.max(0, chart.xMax - 1 - last.x)) / 7) * 10) / 10;
}

// ---- 進捗の詳細：ペース ----

/** ペースの理由の 1 文（Pace の値だけから作る。数字は kg） */
export function paceSentence(pace: Pace, recovery: DateKey | null, fmt: (kg: number) => string, dateText: (d: DateKey) => string): string {
  if (pace.status != null) {
    const band = `予定の ${fmt(pace.planKg!)} の幅（±${fmt(PACE_BAND_CENTS / 100)}）`;
    const where = Math.abs(pace.diffKg!) * 100 <= PACE_BAND_CENTS ? 'の中です' : pace.diffKg! > 0 ? 'より上です' : 'より下です';
    return `この7日の平均は ${fmt(pace.weekAvgKg!)}。${band}${where}。`;
  }
  switch (pace.reason) {
    case 'paused': return '療養で止めているので、判定していません。';
    case 'recovering': return `療養から戻って2週間${recovery ? `（${dateText(recovery)}まで）` : ''}は、判定しません。`;
    case 'few_weigh_ins': return `この7日に体重を測ったのが${pace.weighIns}日なので、判定していません（${MIN_WEIGH_INS}日以上で判定します）。`;
    case 'no_plan': return '開始時の体重がないので、予定の線を引けません。目標を変えると、そのときの体重から線を引きます。';
    default: return '判定していません。';
  }
}

/**
 * 2 週続けてペースが崩れているか：今日と 7 日前の両方で判定でき、どちらも幅の外で、同じ向きに外れている。
 * 崩れていればその状態（遅い・早い・上に外れた・下に外れた）、ほかは null
 */
export function offPaceStreak(p: Phase, phases: Phase[], weights: Weight[], asOf: DateKey): PaceStatus | null {
  const now = phasePace(p, phases, weights, asOf).status;
  const before = phasePace(p, phases, weights, addDays(asOf, -7)).status;
  if (now == null || now === 'on_track' || now !== before) return null;
  return now;
}

/** 崩れの見出し（「ペースが2週続けて遅れています」） */
export const STREAK_TITLES: Record<Exclude<PaceStatus, 'on_track'>, string> = {
  slow: 'ペースが2週続けて遅れています', fast: 'ペースが2週続けて早すぎます',
  over: '体重が2週続けて予定の幅より上です', under: '体重が2週続けて予定の幅より下です',
};

// ---- 進捗の詳細：中間の見直し ----

/** 中間の週（全体の半分。4 週より短いフェーズにはない） */
export function midWeek(weeks: number | null): number | null {
  if (weeks == null || weeks < 4) return null;
  return Math.ceil(weeks / 2);
}

/** 中間の週が始まる日（今までに止まった日数だけ後ろにずらす） */
export function midDate(p: Phase, phases: Phase[], asOf: DateKey, mid: number): DateKey {
  const spans = pauses(p, phases, asOf);
  const paused = spans.reduce((s, [a, b]) => s + daysBetween(a, b), 0);
  return addDays(p.startDate, (mid - 1) * 7 + paused);
}

// ---- 進捗の詳細：成功の指標 ----

/** 主な指標を先に（増量・減量は体重、維持は BIG3） */
export function orderMetrics(direction: PhaseDirection, metrics: SuccessMetric[]): SuccessMetric[] {
  const main = direction === 'maintain' ? 'big3' : 'weight';
  return [...metrics.filter((m) => m.key === main), ...metrics.filter((m) => m.key !== main)];
}

/** 指標の右下の 1 言（「目標まで あと 2.6 kg」「伸びている」「保てている（−3% 以内）」） */
export function metricNote(m: SuccessMetric, direction: PhaseDirection, targetKg: number | null, fmt: (kg: number) => string): string {
  if (m.reference) return '参考';
  if (m.ok == null) return '比べる記録がありません';
  if (m.key === 'weight') {
    if (direction === 'maintain') return m.ok ? 'ほぼ同じ（±1 kg の中）' : '±1 kg の外';
    if (targetKg != null && m.now != null) {
      const left = direction === 'bulk' ? targetKg - m.now : m.now - targetKg;
      return left > 0 ? `目標まで あと ${fmt(left)}` : '目標に届いた';
    }
    return m.ok ? '向きどおり' : '向きと逆';
  }
  if (m.key === 'big3' && direction === 'cut') return m.ok ? '保てている（−3% 以内）' : '−3% より減っている';
  return m.ok ? '伸びている' : '伸びていない';
}
