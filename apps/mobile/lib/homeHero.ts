// ホームのヒーロー（刷新 A のその 2）の計算：フェーズの 1 行・外の輪（16 の目盛り）と内の輪（主な指標の進み）・白い線（予定の位置）、
// 横スライドのページの並びと最初のページ、RECOVERY・INJURY・GROWTH の四隅。画面（components/HomeHero.tsx）から切り離し、jest で確かめる。
// フェーズの決まり（何週目・ペース・止まった日）は lib/phases.ts のまま使い、ここで数え方を作り直さない
import { addDays, DateKey, daysBetween } from './date';
import { average } from './health';
import { RESULTS, siteLabel } from './injuries';
import {
  currentPhase, DIRECTION_LABELS, PACE_LABELS, PaceStatus, pauses, Phase, PhaseDirection, phaseDay, phaseLabel, phaseProgress, PhaseProgress, PhaseTicks,
  planLines, tickState, Weight,
} from './phases';
import { lastEnded } from './phaseReview';
import type { PartRecovery } from './recoveryMap';

// ---- フェーズの状態 ----

export type HeroPhase =
  /** フェーズがない。last は、いちばん新しい通常のフェーズを終えたまま次が未設定のときの、そのフェーズ（振り返りへの入口） */
  | { kind: 'none'; last?: Phase }
  /** 通常のフェーズを実施中 */
  | { kind: 'active'; phase: Phase; progress: PhaseProgress; elapsed: number }
  /** 療養中。paused は療養で止めた通常のフェーズ（なければ null） */
  | { kind: 'rehab'; rehab: Phase; rehabDays: number; paused: { phase: Phase; progress: PhaseProgress; elapsed: number } | null };

/** 期間の進み（0〜1）：止まった日を除いた、開始日から asOf までの日数 ÷ 全体の日数。今日の分を含める */
function elapsedOf(p: Phase, phases: Phase[], asOf: DateKey): number {
  if (p.endDate == null) return 0;
  const total = daysBetween(p.startDate, p.endDate) + 1;
  const done = phaseDay(p, pauses(p, phases, asOf), asOf) + 1;
  return clamp01(done / total);
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** 今日の時点のフェーズ（lib/phases.ts の currentPhase と phaseProgress） */
export function heroPhase(phases: Phase[], weights: Weight[], today: DateKey): HeroPhase {
  const { current, paused } = currentPhase(phases, today);
  if (!current) {
    const last = lastEnded(phases.filter((p) => p.startDate <= today));
    return last ? { kind: 'none', last } : { kind: 'none' };
  }
  if (current.kind === 'rehab') {
    return {
      kind: 'rehab', rehab: current, rehabDays: phaseProgress(current, phases, weights, today).rehabDays,
      paused: paused ? { phase: paused, progress: phaseProgress(paused, phases, weights, today), elapsed: elapsedOf(paused, phases, today) } : null,
    };
  }
  return { kind: 'active', phase: current, progress: phaseProgress(current, phases, weights, today), elapsed: elapsedOf(current, phases, today) };
}

/** 輪・BIG3・LOG に使う通常のフェーズ（実施中か、療養で止めているもの）。なければ null */
export function normalPhaseOf(h: HeroPhase): { phase: Phase; progress: PhaseProgress; elapsed: number } | null {
  if (h.kind === 'active') return h;
  if (h.kind === 'rehab') return h.paused;
  return null;
}

// ---- フェーズの 1 行 ----

export const DIRECTION_EN: Record<PhaseDirection, string> = { bulk: 'BULK', cut: 'CUT', maintain: 'MAINTAIN' };
/**
 * ペースの英字。増量・減量は ON TRACK・AHEAD（早い）・BEHIND（遅い）。維持（リコンプ）で幅の外に出たときは OVER・UNDER
 * （維持には早い・遅いがないため）。判定しないとき（測った日が足りない・療養から戻って 2 週など）は NO DATA
 */
export const PACE_EN: Record<PaceStatus, string> = { on_track: 'ON TRACK', fast: 'AHEAD', slow: 'BEHIND', over: 'OVER', under: 'UNDER' };
export const NO_PACE = 'NO DATA';

const two = (n: number) => String(n).padStart(2, '0');

/** フェーズの 1 行を押したときに開く画面 */
export type PhaseRoute = '/phase' | '/phase/new' | `/phase/review/${string}`;

/**
 * 輪の上の 1 行（等幅）と読み上げと、押したときに開く画面。
 * 実施中「BULK 06/16 · ON TRACK」、療養中「REHAB DAY 03 · BULK PAUSED」（止めたフェーズがなければ「REHAB DAY 03」）、未設定「NO PHASE · + START」。
 * フェーズを終えて次が未設定なら「CUT DONE · REVIEW」（その振り返りへ。振り返りの画面から次のフェーズを始められる）
 */
export function phaseLine(h: HeroPhase): { text: string; spoken: string; route: PhaseRoute } {
  if (h.kind === 'none' && h.last) {
    return {
      text: `${DIRECTION_EN[h.last.direction!]} DONE · REVIEW`,
      spoken: `${phaseLabel(h.last)}を終えました。次のフェーズは未設定。振り返りを開く`,
      route: `/phase/review/${h.last.id}`,
    };
  }
  if (h.kind === 'none') return { text: 'NO PHASE · + START', spoken: 'フェーズは未設定。フェーズを始める', route: '/phase/new' };
  if (h.kind === 'rehab') {
    const p = h.paused?.phase;
    const dir = p?.direction ?? null;
    return {
      text: `REHAB DAY ${two(h.rehabDays)}${dir ? ` · ${DIRECTION_EN[dir]} PAUSED` : ''}`,
      spoken: `療養 ${h.rehabDays}日目${dir ? `。${DIRECTION_LABELS[dir]}は止めています` : ''}。フェーズの進み具合を開く`,
      route: '/phase',
    };
  }
  const { phase, progress } = h;
  const status = progress.pace?.status ?? null;
  const total = progress.weeksTotal ?? progress.week;
  return {
    text: `${DIRECTION_EN[phase.direction!]} ${two(progress.week)}/${two(total)} · ${status ? PACE_EN[status] : NO_PACE}`,
    spoken: `${DIRECTION_LABELS[phase.direction!]} ${total}週のうち${progress.week}週目。ペース ${status ? PACE_LABELS[status] : '判定なし'}。フェーズの進み具合を開く`,
    route: '/phase',
  };
}

/** 輪の下の 1 行：実施中「残り 10週」、療養で止めているとき「増量 06/16 · 停止中」。ほかは null */
export function ringFooter(h: HeroPhase): string | null {
  if (h.kind === 'active') {
    const days = h.progress.remainingDays;
    return days == null ? null : `残り ${Math.ceil(days / 7)}週`;
  }
  if (h.kind === 'rehab' && h.paused) {
    const { phase, progress } = h.paused;
    return `${DIRECTION_LABELS[phase.direction!]} ${two(progress.week)}/${two(progress.weeksTotal ?? progress.week)} · 停止中`;
  }
  return null;
}

// ---- 輪 ----

export type PhaseRing = {
  /** 外の輪の目盛り（16 個。期間に比例して進む。lib/phases.ts の phaseTicks） */
  ticks: PhaseTicks;
  /** 療養で止めている（過ぎた目盛りを止まった色で塗る） */
  paused: boolean;
  /** 内の輪：主な指標の進み（0〜1）。増量・減量は体重、維持は期間。出せなければ null */
  inner: number | null;
  /** 白い線：予定の位置（0〜1）。出せなければ null */
  plan: number | null;
  /** 主な指標（読み上げ） */
  metric: 'weight' | 'time';
};

/** 直近 7 日（今日を含む）の体重の平均（kg）。測った日がなければ null */
export function weekAverageKg(weights: Weight[], today: DateKey): number | null {
  const from = addDays(today, -6);
  return average(weights.filter((w) => w.date >= from && w.date <= today).map((w) => w.kg));
}

/** 開始時の体重（予定の最初の線の始まり。なければ開始時の記録） */
function startWeight(p: Phase): number | null {
  return planLines(p)[0]?.weight_kg ?? p.snapshot?.weight_kg ?? null;
}

/**
 * 外の輪（16 の目盛り）と内の輪（主な指標）。フェーズがない・止めたフェーズのない療養なら null（灰色の枠だけ）。
 * 体重の進み＝（今の週平均 − 開始時）÷（目標 − 開始時）、予定の位置＝（今日の予定の値 − 開始時）÷（目標 − 開始時）。
 * 週平均は 7 日の平均（ペースと同じ。ペースが出せなければ直近 7 日の平均）。目標と開始時が同じなら出さない
 */
export function phaseRing(h: HeroPhase, weights: Weight[], today: DateKey): PhaseRing | null {
  const n = normalPhaseOf(h);
  if (!n) return null;
  const { phase, progress, elapsed } = n;
  const base = { ticks: progress.ticks ?? { done: 0, current: 0 }, paused: h.kind === 'rehab' };
  if (phase.direction === 'maintain') return { ...base, inner: elapsed, plan: elapsed, metric: 'time' };
  const start = startWeight(phase);
  const target = phase.targetWeightKg;
  if (start == null || target == null || Math.abs(target - start) < 0.05) return { ...base, inner: null, plan: null, metric: 'weight' };
  const now = progress.pace?.weekAvgKg ?? weekAverageKg(weights, today);
  const frac = (kg: number | null) => (kg == null ? null : clamp01((kg - start) / (target - start)));
  return { ...base, inner: frac(now), plan: frac(progress.planKg), metric: 'weight' };
}

/** 外の輪の目盛り i（0 から）の状態：過ぎた・今・これから（フェーズの画面の目盛りと同じ tickState） */
export function ringSegment(ring: PhaseRing | null, i: number): 'done' | 'current' | 'todo' {
  return tickState(ring?.ticks ?? null, i);
}

// ---- ページ ----

export type HeroPage = 'latest' | 'recovery' | 'injury' | 'growth';
export const HERO_PAGE_EN: Record<HeroPage, string> = { latest: 'LATEST', recovery: 'RECOVERY', injury: 'INJURY', growth: 'GROWTH' };
export const HERO_PAGE_JA: Record<HeroPage, string> = { latest: '直近のトレーニング', recovery: '回復', injury: 'ケガ', growth: '成長の形' };

/** ページの並び：LATEST → RECOVERY → INJURY（直している途中のケガがあるときだけ）→ GROWTH */
export function heroPages(hasInjury: boolean): HeroPage[] {
  return hasInjury ? ['latest', 'recovery', 'injury', 'growth'] : ['latest', 'recovery', 'growth'];
}

/** 最初のページ：療養中で INJURY があれば INJURY、ほかは LATEST（前に見たページは覚えない） */
export function initialHeroPage(pages: HeroPage[], rehab: boolean): HeroPage {
  return rehab && pages.includes('injury') ? 'injury' : 'latest';
}

/** 今のページが並びから消えた（ケガを直せた）ときは LATEST に戻す */
export function keepHeroPage(page: HeroPage, pages: HeroPage[]): HeroPage {
  return pages.includes(page) ? page : 'latest';
}

/** 横スワイプで隣のページへ（端では動かない＝null） */
export function nextHeroPage(page: HeroPage, pages: HeroPage[], direction: 'prev' | 'next'): HeroPage | null {
  const i = pages.indexOf(page);
  const j = i + (direction === 'next' ? 1 : -1);
  return i < 0 || j < 0 || j >= pages.length ? null : pages[j];
}

// ---- RECOVERY の四隅 ----

export type RecoveryCorners = {
  /** 鍛えられる（回復中でない：回復済み・空いている・まだ）部位の数と全体 */
  ready: number;
  total: number;
  /** 次の部位（今日のおすすめ）。なければ null */
  next: string | null;
  /** 次の部位が空いているとき、最後に鍛えてからの日数（ほかは null） */
  nextIdle: number | null;
  /** 回復中の部位（残りがいちばん長いもの）と、ほかに回復中の数 */
  recovering: { name: string; remaining: number; level: number; more: number } | null;
  /** 直している途中のケガの数 */
  injuries: number;
};

export function recoveryCorners(list: PartRecovery[], next: string | null, injuries: number): RecoveryCorners {
  const rec = list.filter((p) => p.level > 0 && p.remaining != null);
  const n = list.find((p) => p.name === next);
  const top = rec.reduce<PartRecovery | null>((a, b) => (a == null || b.remaining! > a.remaining! || (b.remaining === a.remaining && b.level > a.level) ? b : a), null);
  return {
    ready: list.length - rec.length, total: list.length, next, nextIdle: n?.idle ? n.days : null,
    recovering: top ? { name: top.name, remaining: top.remaining!, level: top.level, more: rec.length - 1 } : null,
    injuries,
  };
}

// ---- INJURY の四隅 ----

/** 振り返りを促す日数：最後の振り返り（なければ痛めた日）からこの日数が過ぎた、直している途中のケガを ALERT に数える */
export const REVIEW_DUE_DAYS = 7;

type HeroInjury = { id: string; occurredOn: string; site: string; side: string | null; lastReview: { date: string; result: keyof typeof RESULTS } | null };

export type InjuryCorners = {
  count: number;
  /** 直している部位（いちばん新しく痛めたもの。id は押すと開くケガ）と、最後の振り返り（日付と記号） */
  fix: { id: string; label: string; review: { date: DateKey; mark: string } | null } | null;
  /**
   * いつから：療養中は療養の開始日、ほかは直している途中でいちばん古く痛めた日。day は 1 日目から。
   * injuryId は押すと開くケガ（いちばん古いもの）。療養中は null（フェーズの画面を開く）
   */
  since: { date: DateKey; day: number; injuryId: string | null } | null;
  /** 振り返りが REVIEW_DUE_DAYS 日以上ないケガの数 */
  alert: number;
};

/** fixing はその日に直している途中のケガ（lib/recoveryMap.ts の fixingOn） */
export function injuryCorners(fixing: HeroInjury[], rehab: Phase | null, today: DateKey): InjuryCorners {
  const newest = fixing.reduce<HeroInjury | null>((a, b) => (a == null || b.occurredOn > a.occurredOn ? b : a), null);
  const oldest = fixing.reduce<HeroInjury | null>((a, b) => (a == null || b.occurredOn < a.occurredOn ? b : a), null);
  const sinceDate = rehab ? rehab.startDate : oldest?.occurredOn ?? null;
  return {
    count: fixing.length,
    fix: newest ? {
      id: newest.id,
      label: siteLabel(newest.site, newest.side),
      review: newest.lastReview ? { date: newest.lastReview.date, mark: RESULTS[newest.lastReview.result].mark } : null,
    } : null,
    since: sinceDate ? { date: sinceDate, day: Math.max(1, daysBetween(sinceDate, today) + 1), injuryId: rehab ? null : oldest?.id ?? null } : null,
    alert: fixing.filter((i) => daysBetween(i.lastReview?.date ?? i.occurredOn, today) >= REVIEW_DUE_DAYS).length,
  };
}

// ---- GROWTH の四隅 ----

export type GrowthCorners = {
  /** PHASE：向き（増量・減量・維持・療養）と週（「06/16W」）か療養の日（「DAY 03」）。なければ null */
  phase: { value: string; sub: string } | null;
  /** PACE：日本語と英字。判定しないときは value が null（英字は NO DATA） */
  pace: { value: string | null; sub: string } | null;
  /** WEIGHT：週平均と目標（kg） */
  weekAvgKg: number | null;
  goalKg: number | null;
};

export function growthCorners(h: HeroPhase, weekAvgKg: number | null, goalKg: number | null): GrowthCorners {
  const base = { weekAvgKg, goalKg };
  if (h.kind === 'none') return { ...base, phase: null, pace: null };
  if (h.kind === 'rehab') return { ...base, phase: { value: '療養', sub: `DAY ${two(h.rehabDays)}` }, pace: { value: null, sub: 'PAUSED' } };
  const { phase, progress } = h;
  const status = progress.pace?.status ?? null;
  return {
    ...base,
    phase: { value: DIRECTION_LABELS[phase.direction!], sub: `${two(progress.week)}/${two(progress.weeksTotal ?? progress.week)}W` },
    pace: { value: status ? PACE_LABELS[status] : null, sub: status ? PACE_EN[status] : NO_PACE },
  };
}
