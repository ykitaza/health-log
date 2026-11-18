// フェーズの振り返り（app/phase/review/[id].tsx）と療養（ケガから療養に入る・療養を終える）の計算。画面から切り離し、jest で確かめる。
// 成功の指標は lib/phases.ts の successMetrics、終わりの時点の記録は lib/phaseView.ts の endMeasuresFrom のまま使う
import { addDays, DateKey } from './date';
import { DIRECTION_LABELS, Phase, PhaseDirection, SuccessMetric } from './phases';

// ---- 達成の度合い ----

export type ReviewTier = 'reached' | 'almost' | 'missed';
export const TIER_LABELS: Record<ReviewTier, string> = { reached: '届いた', almost: 'ほぼ届いた', missed: '届かなかった' };
/** 「ほぼ届いた」にする、目標体重までの進みの下限（8 割。仮） */
export const ALMOST_RATIO = 0.8;

export type Achievement = {
  tier: ReviewTier | null;
  /** 棒の長さ（0〜1）。増量・減量は目標体重までの進み、維持はかなった指標の割合。出せなければ null */
  ratio: number | null;
  /** 増量・減量の目標体重までの進み（1 で目標に届いた。上限なし）。出せなければ null */
  weightRatio: number | null;
};

/** 増量・減量の、目標体重までの進み：(終わり − 開始) ÷ (目標 − 開始)。開始と目標が同じ・どれかがなければ null */
export function weightProgress(startKg: number | null, nowKg: number | null, targetKg: number | null): number | null {
  if (startKg == null || nowKg == null || targetKg == null || targetKg === startKg) return null;
  return (nowKg - startKg) / (targetKg - startKg);
}

/**
 * 達成の度合い（仮の決まり。判定に使う指標＝体脂肪率を除いたものが、どれか比べられなければ null）。
 * - 増量・減量：体重が目標に届き（進み 1 以上）、ほかの指標（BIG3）もかなえば「届いた」。
 *   目標の 8 割まで進んでほかもかなう、または目標に届いてほかがかなわないなら「ほぼ届いた」。ほかは「届かなかった」
 * - 維持：全部かなえば「届いた」、かなわないのが 1 つなら「ほぼ届いた」、2 つ以上なら「届かなかった」
 */
export function achievement(direction: PhaseDirection, metrics: SuccessMetric[], targetKg: number | null): Achievement {
  const judged = metrics.filter((m) => !m.reference);
  const okCount = judged.filter((m) => m.ok).length;
  if (direction === 'maintain') {
    if (judged.length === 0 || judged.some((m) => m.ok == null)) return { tier: null, ratio: null, weightRatio: null };
    const misses = judged.length - okCount;
    return { tier: misses === 0 ? 'reached' : misses === 1 ? 'almost' : 'missed', ratio: okCount / judged.length, weightRatio: null };
  }
  const weight = judged.find((m) => m.key === 'weight');
  const others = judged.filter((m) => m.key !== 'weight');
  const p = weight ? weightProgress(weight.start, weight.now, targetKg) : null;
  const ratio = p == null ? null : Math.min(1, Math.max(0, p));
  if (p == null || others.some((m) => m.ok == null)) return { tier: null, ratio, weightRatio: p };
  const othersOk = others.every((m) => m.ok);
  const tier: ReviewTier = p >= 1 && othersOk ? 'reached' : (p >= ALMOST_RATIO && othersOk) || p >= 1 ? 'almost' : 'missed';
  return { tier, ratio, weightRatio: p };
}

/**
 * 度合いの横の 1 文（数字は記録から出したものだけ）。
 * 「体重は目標の 90%（+3.6 / +4.0 kg）・BIG3 は伸びた」「体重は目標に届いた（−4.1 kg）・BIG3 は保てた」
 */
export function achievementText(
  direction: PhaseDirection, metrics: SuccessMetric[], targetKg: number | null, signedKg: (kg: number) => string,
): string {
  const parts: string[] = [];
  const weight = metrics.find((m) => m.key === 'weight');
  if (weight && weight.delta != null) {
    if (direction === 'maintain') {
      parts.push(weight.ok ? `体重はほぼ同じ（${signedKg(weight.delta)}）` : `体重は ±1 kg の外（${signedKg(weight.delta)}）`);
    } else {
      const p = weightProgress(weight.start, weight.now, targetKg);
      if (p == null) parts.push(`体重は ${signedKg(weight.delta)}`);
      else if (p >= 1) parts.push(`体重は目標に届いた（${signedKg(weight.delta)}）`);
      else parts.push(`体重は目標の ${Math.max(0, Math.round(p * 100))}%（${signedKg(weight.delta)} / ${signedKg(targetKg! - weight.start!)}）`);
    }
  } else {
    parts.push('体重は比べる記録がない');
  }
  const big3 = metrics.find((m) => m.key === 'big3');
  if (big3) {
    if (big3.ok == null) parts.push('BIG3 は比べる記録がない');
    else if (direction === 'cut') parts.push(big3.ok ? 'BIG3 は保てた' : 'BIG3 は −3% より減った');
    else parts.push(big3.ok ? 'BIG3 は伸びた' : 'BIG3 は伸びなかった');
  }
  const score = metrics.find((m) => m.key === 'growth_score');
  if (score) parts.push(score.ok == null ? '成長スコアは比べる記録がない' : score.ok ? '成長スコアは上がった' : '成長スコアは上がらなかった');
  return parts.join('・');
}

// ---- 終えたフェーズ ----

const byStartDesc = (a: Phase, b: Phase) =>
  a.startDate !== b.startDate ? (a.startDate < b.startDate ? 1 : -1) : a.createdAt !== b.createdAt ? (a.createdAt < b.createdAt ? 1 : -1) : a.id < b.id ? 1 : -1;

/** 振り返れるフェーズ（終えた通常のフェーズ。中断したもの・療養は入れない）。開始日の新しい順 */
export function endedPhases(phases: Phase[]): Phase[] {
  return phases.filter((p) => p.kind === 'normal' && p.status === 'ended' && p.direction != null).sort(byStartDesc);
}

/**
 * ホームの 1 行から開く振り返り：いちばん新しい通常のフェーズが「終えた」もの（中断したものなら出さない）。
 * 呼ぶ側は、今のフェーズがない（次が未設定）ときだけ使う
 */
export function lastEnded(phases: Phase[]): Phase | null {
  const latest = phases.filter((p) => p.kind === 'normal').sort(byStartDesc)[0];
  return latest && latest.status === 'ended' && latest.direction != null ? latest : null;
}

/** 減量の「直後」とみなす日数（終えてから 28 日。仮） */
export const AFTER_CUT_DAYS = 28;

/**
 * 増量を選んだとき、維持を挟む案を出すか：いちばん新しい通常のフェーズが減量で、終えてから 28 日以内（強制はしない）。
 * 返すのはその減量（出さないなら null）
 */
export function cutJustBefore(phases: Phase[], today: DateKey): Phase | null {
  const latest = phases.filter((p) => p.kind === 'normal' && p.status !== 'active').sort(byStartDesc)[0];
  if (!latest || latest.direction !== 'cut' || latest.status !== 'ended' || latest.endedOn == null) return null;
  return latest.endedOn >= addDays(today, -AFTER_CUT_DAYS) ? latest : null;
}

/** 次のフェーズの選択肢（おすすめは維持 4 週）。週数は維持だけ決め、ほかは設定の初期値 */
export type NextOption = { direction: PhaseDirection; weeks: number | null; title: string; sub: string; recommended: boolean };
export function nextOptions(prev: PhaseDirection): NextOption[] {
  const other = (d: PhaseDirection): NextOption => ({
    direction: d, weeks: null, recommended: false,
    title: d === prev ? `${DIRECTION_LABELS[d]}をもう一度` : DIRECTION_LABELS[d],
    sub: d === 'bulk' ? '体重を増やし、BIG3 を伸ばす' : d === 'cut' ? '体重を落とし、BIG3 を保つ' : '体重をほぼそのまま、BIG3 と成長スコアを伸ばす',
  });
  return [
    { direction: 'maintain', weeks: 4, recommended: true, title: '維持 4週', sub: '今の体重の前後を保ち、体を慣らしてから次へ' },
    ...(['cut', 'bulk'] as const).map(other),
  ];
}

// ---- 療養 ----

/** ケガ（療養の判定に使う項目だけ） */
export type RehabInjury = { id: string; occurredOn: DateKey; status: 'fixing' | 'fixed'; fixedOn: DateKey | null };

/**
 * その療養の対象のケガ（フェーズはケガの ID を持たないので、記録から決める）：
 * 療養の終わり（実施中なら今日）までに痛めていて、療養の始まりの時点で直している途中だったもの、または療養中に痛めたもの。
 * いま直している途中か、療養の始まり以後に直せたにしたもの
 */
export function rehabInjuries<T extends RehabInjury>(injuries: T[], rehab: Phase, today: DateKey): T[] {
  const until = rehab.status === 'active' ? today : (rehab.endedOn ?? today);
  return injuries.filter((i) => i.occurredOn <= until
    && (i.status === 'fixing' || (i.fixedOn != null && i.fixedOn >= rehab.startDate)));
}

/** 「療養を終えますか」を出すか：療養中で、対象のケガが 1 つ以上あり、すべて直せた */
export function readyToEndRehab(injuries: RehabInjury[], rehab: Phase, today: DateKey): boolean {
  if (rehab.kind !== 'rehab' || rehab.status !== 'active') return false;
  const list = rehabInjuries(injuries, rehab, today);
  return list.length > 0 && list.every((i) => i.status === 'fixed');
}

/** 療養中に見るもの（Figma の療養 3）。数字は記録から出せるものだけ */
export type RehabWatch = {
  /** 療養に入ってからの睡眠の平均（分。記録のある日だけ）。なければ null */
  sleepAvgMin: number | null;
  sleepDays: number;
  /** 食事を記録した日と、そのうち食事の目標（カロリーとたんぱく質）に届いた日 */
  mealDays: number;
  mealReached: number;
  /** 療養に入ってからの、対象のケガの振り返りの数と、いちばん新しいもの */
  reviews: number;
  latestReview: { date: DateKey; result: 'fixed' | 'not_yet' | 'pain' } | null;
};

export function rehabWatch(
  days: { date: DateKey; sleepMin: number | null; mealRecorded: boolean; mealGoalReached: boolean }[],
  reviews: { date: DateKey; result: 'fixed' | 'not_yet' | 'pain'; createdAt?: string }[],
  rehab: Phase, today: DateKey,
): RehabWatch {
  const inRange = (d: DateKey) => rehab.startDate <= d && d <= today;
  const span = days.filter((d) => inRange(d.date));
  const sleeps = span.flatMap((d) => (d.sleepMin == null ? [] : [d.sleepMin]));
  const meals = span.filter((d) => d.mealRecorded);
  const rs = reviews.filter((r) => inRange(r.date))
    .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : (a.createdAt ?? '') < (b.createdAt ?? '') ? -1 : 1));
  const latest = rs[rs.length - 1];
  return {
    sleepAvgMin: sleeps.length ? Math.round(sleeps.reduce((s, x) => s + x, 0) / sleeps.length) : null, sleepDays: sleeps.length,
    mealDays: meals.length, mealReached: meals.filter((d) => d.mealGoalReached).length,
    reviews: rs.length, latestReview: latest ? { date: latest.date, result: latest.result } : null,
  };
}
