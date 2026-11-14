import {
  growthCorners, heroPages, heroPhase, initialHeroPage, injuryCorners, keepHeroPage, nextHeroPage, phaseLine, phaseRing, recoveryCorners,
  REVIEW_DUE_DAYS, ringFooter, ringGap, ringSegment, weekAverageKg,
} from '../homeHero';
import { big3Gauge, logGrid, logWeekLabels, logWeekRange } from '../homeHud';
import type { Phase } from '../phases';
import type { PartRecovery } from '../recoveryMap';
import type { TrainingSetRow } from '../training';
import { addDays } from '../date';

const TODAY = '2026-11-08'; // 日曜

const phase = (o: Partial<Phase> = {}): Phase => ({
  id: 'p1', kind: 'normal', direction: 'bulk', name: '', startDate: '2026-09-28', endDate: '2027-01-17', targetWeightKg: 80, mealTargets: null,
  snapshot: { weight_kg: 74, body_fat_pct: null, big3: { bench: 100, squat: 120, deadlift: null }, growth_score: null },
  status: 'active', pausedPhaseId: null, targetHistory: [], endedOn: null, createdAt: '2026-09-28T00:00:00Z', ...o,
});
const rehab = (o: Partial<Phase> = {}): Phase => ({
  ...phase(), id: 'r1', kind: 'rehab', direction: null, endDate: null, targetWeightKg: null, snapshot: null, startDate: '2026-11-06',
  pausedPhaseId: 'p1', createdAt: '2026-11-06T00:00:00Z', ...o,
});
// 11/4 と 11/7 に測った（7 日に 2 日）
const WEIGHTS = [{ date: '2026-11-04', kg: 76.2 }, { date: '2026-11-07', kg: 76.3 }];

describe('フェーズの 1 行と輪の下', () => {
  test('実施中：BULK 06/16 · ON TRACK、残り 10週。押すと進み具合', () => {
    const h = heroPhase([phase()], WEIGHTS, TODAY);
    expect(phaseLine(h)).toEqual({
      text: 'BULK 06/16 · ON TRACK', route: '/phase',
      spoken: '増量 16週のうち6週目。ペース 順調。フェーズの進み具合を開く',
    });
    expect(ringFooter(h)).toBe('残り 10週');
  });
  test('ペースの英字：遅い BEHIND・早い AHEAD・測った日が足りない NO DATA・維持の外れ OVER', () => {
    expect(phaseLine(heroPhase([phase()], [{ date: '2026-11-04', kg: 75 }, { date: '2026-11-07', kg: 75 }], TODAY)).text).toBe('BULK 06/16 · BEHIND');
    expect(phaseLine(heroPhase([phase()], [{ date: '2026-11-04', kg: 78 }, { date: '2026-11-07', kg: 78 }], TODAY)).text).toBe('BULK 06/16 · AHEAD');
    expect(phaseLine(heroPhase([phase()], [WEIGHTS[0]], TODAY)).text).toBe('BULK 06/16 · NO DATA');
    const m = phase({ direction: 'maintain', targetWeightKg: 74 });
    expect(phaseLine(heroPhase([m], [{ date: '2026-11-04', kg: 76 }, { date: '2026-11-07', kg: 76 }], TODAY)).text).toBe('MAINTAIN 06/16 · OVER');
  });
  test('療養中：REHAB DAY 03 · BULK PAUSED、輪の下は止めたフェーズ。止めたフェーズがなければ REHAB DAY だけ', () => {
    const h = heroPhase([phase(), rehab()], WEIGHTS, TODAY);
    expect(phaseLine(h)).toEqual({ text: 'REHAB DAY 03 · BULK PAUSED', route: '/phase', spoken: '療養 3日目。増量は止めています。フェーズの進み具合を開く' });
    expect(ringFooter(h)).toBe('増量 06/16 · 停止中');
    const alone = heroPhase([rehab({ pausedPhaseId: null })], WEIGHTS, TODAY);
    expect(phaseLine(alone).text).toBe('REHAB DAY 03');
    expect(ringFooter(alone)).toBeNull();
    expect(phaseRing(alone, WEIGHTS, TODAY)).toBeNull();
  });
  test('未設定：NO PHASE · + START。押すとフェーズの設定。中断したフェーズ・これから始まるフェーズは未設定', () => {
    for (const list of [[], [phase({ status: 'aborted', endedOn: '2026-11-01' })], [phase({ startDate: '2026-11-09' })]]) {
      const h = heroPhase(list, WEIGHTS, TODAY);
      expect(phaseLine(h)).toEqual({ text: 'NO PHASE · + START', spoken: 'フェーズは未設定。フェーズを始める', route: '/phase/new' });
      expect(ringFooter(h)).toBeNull();
      expect(phaseRing(h, WEIGHTS, TODAY)).toBeNull();
    }
  });
  test('フェーズを終えて次が未設定：BULK DONE · REVIEW。押すとその振り返り', () => {
    const h = heroPhase([phase({ status: 'ended', endedOn: '2026-11-01' })], WEIGHTS, TODAY);
    expect(phaseLine(h)).toEqual({ text: 'BULK DONE · REVIEW', spoken: '増量 16週を終えました。次のフェーズは未設定。振り返りを開く', route: '/phase/review/p1' });
    expect(ringFooter(h)).toBeNull();
    expect(phaseRing(h, WEIGHTS, TODAY)).toBeNull();
  });
});

describe('輪', () => {
  test('増量：外の輪は 16 週で今は 6 週目。内の輪は体重の進み、白い線は今日の予定', () => {
    const r = phaseRing(heroPhase([phase()], WEIGHTS, TODAY), WEIGHTS, TODAY)!;
    expect(r).toMatchObject({ weeks: 16, current: 6, paused: false, metric: 'weight' });
    // (76.25 - 74) / (80 - 74)
    expect(r.inner).toBeCloseTo(0.375, 3);
    // 予定は 74 → 80 を 111 日で。今日は 41 日目
    expect(r.plan).toBeCloseTo((6 * 41) / 111 / 6, 2);
    expect([0, 4, 5, 6].map((i) => ringSegment(r, i))).toEqual(['done', 'done', 'current', 'todo']);
    expect(ringSegment(null, 0)).toBe('todo');
  });
  test('減量は下がるほど進む。範囲の外は 0〜1 に収める', () => {
    const cut = phase({ direction: 'cut', targetWeightKg: 70 });
    const r = phaseRing(heroPhase([cut], [{ date: '2026-11-04', kg: 72 }, { date: '2026-11-07', kg: 72 }], TODAY), [], TODAY)!;
    expect(r.inner).toBeCloseTo(0.5, 3);
    const over = phaseRing(heroPhase([cut], [{ date: '2026-11-04', kg: 76 }, { date: '2026-11-07', kg: 76 }], TODAY), [], TODAY)!;
    expect(over.inner).toBe(0);
  });
  test('ペースが出せなくても、7 日の中に体重があれば内の輪を出す。なければ null', () => {
    const one = [{ date: '2026-11-07', kg: 77 }];
    expect(phaseRing(heroPhase([phase()], one, TODAY), one, TODAY)!.inner).toBeCloseTo(0.5, 3);
    expect(phaseRing(heroPhase([phase()], [], TODAY), [], TODAY)!.inner).toBeNull();
  });
  test('維持（リコンプ）：内の輪と白い線は期間の進み', () => {
    const r = phaseRing(heroPhase([phase({ direction: 'maintain', targetWeightKg: 74 })], WEIGHTS, TODAY), WEIGHTS, TODAY)!;
    expect(r.metric).toBe('time');
    expect(r.inner).toBeCloseTo(42 / 112, 3);
    expect(r.plan).toBe(r.inner);
  });
  test('療養中は止めたフェーズの週を出す（止まった色）', () => {
    const r = phaseRing(heroPhase([phase(), rehab()], WEIGHTS, TODAY), WEIGHTS, TODAY)!;
    expect(r).toMatchObject({ weeks: 16, current: 6, paused: true });
  });
  test('区切りの間は週が多いほど狭く、弧が裏返らない', () => {
    expect(ringGap(16)).toBe(0.05);
    const step = (2 * Math.PI) / 104;
    expect(ringGap(104)).toBeLessThan(step / 2);
  });
  test('7 日の体重の平均', () => {
    expect(weekAverageKg([{ date: '2026-11-01', kg: 70 }, ...WEIGHTS], TODAY)).toBeCloseTo(76.25, 5);
    expect(weekAverageKg([{ date: '2026-11-01', kg: 70 }], TODAY)).toBeNull();
  });
});

describe('ページ', () => {
  test('並び：LATEST → RECOVERY → INJURY（ケガがあるときだけ）→ GROWTH', () => {
    expect(heroPages(true)).toEqual(['latest', 'recovery', 'injury', 'growth']);
    expect(heroPages(false)).toEqual(['latest', 'recovery', 'growth']);
  });
  test('最初のページ：ふだんは LATEST、療養中は INJURY（ケガがなければ LATEST）', () => {
    expect(initialHeroPage(heroPages(true), false)).toBe('latest');
    expect(initialHeroPage(heroPages(true), true)).toBe('injury');
    expect(initialHeroPage(heroPages(false), true)).toBe('latest');
  });
  test('INJURY を見ている間にケガがなくなったら LATEST に戻す', () => {
    expect(keepHeroPage('injury', heroPages(false))).toBe('latest');
    expect(keepHeroPage('growth', heroPages(false))).toBe('growth');
  });
  test('スワイプで隣へ。端では動かない', () => {
    const pages = heroPages(true);
    expect(nextHeroPage('latest', pages, 'next')).toBe('recovery');
    expect(nextHeroPage('growth', pages, 'prev')).toBe('injury');
    expect(nextHeroPage('latest', pages, 'prev')).toBeNull();
    expect(nextHeroPage('growth', pages, 'next')).toBeNull();
  });
});

const part = (name: string, remaining: number | null, level = remaining ? 0.5 : 0): PartRecovery =>
  ({ name, last: '2026-11-07', days: 1, sets: 3, recoveryDays: 2, remaining, level, meshes: [] });

describe('RECOVERY の四隅', () => {
  test('回復済みの数／全体、次の部位、回復中は残りがいちばん長い部位、ケガの数', () => {
    const c = recoveryCorners([part('胸', 1, 0.5), part('脚', 2, 0.9), part('背中', null), part('肩', null)], '背中', 2);
    expect(c).toEqual({ ready: 2, total: 4, next: '背中', recovering: { name: '脚', remaining: 2, level: 0.9, more: 1 }, injuries: 2 });
  });
  test('回復中がなければ null', () => {
    expect(recoveryCorners([part('胸', null)], null, 0).recovering).toBeNull();
  });
});

describe('INJURY の四隅', () => {
  const inj = (id: string, occurredOn: string, lastReview: { date: string; result: 'fixed' | 'not_yet' | 'pain' } | null = null) =>
    ({ id, occurredOn, site: id === 'a' ? 'shoulder_joint' : 'waist', side: id === 'a' ? 'right' : null, lastReview });
  test('件数、直している部位（新しいもの）と最後の振り返り、いつから（古いもの）、振り返りの促し', () => {
    const list = [inj('a', '2026-11-06', { date: '2026-11-07', result: 'not_yet' }), inj('b', '2026-10-20')];
    const c = injuryCorners(list, null, TODAY);
    expect(c.count).toBe(2);
    expect(c.fix).toEqual({ id: 'a', label: '右肩の関節', review: { date: '2026-11-07', mark: '△' } });
    expect(c.since).toEqual({ date: '2026-10-20', day: 20, injuryId: 'b' });
    // b は痛めてから REVIEW_DUE_DAYS 日以上振り返りがない
    expect(REVIEW_DUE_DAYS).toBe(7);
    expect(c.alert).toBe(1);
  });
  test('療養中は療養の開始日から', () => {
    expect(injuryCorners([inj('a', '2026-11-01')], rehab(), TODAY).since).toEqual({ date: '2026-11-06', day: 3, injuryId: null });
  });
  test('ケガがなければ空', () => {
    expect(injuryCorners([], null, TODAY)).toEqual({ count: 0, fix: null, since: null, alert: 0 });
  });
});

describe('GROWTH の四隅', () => {
  test('実施中：増量 06/16W、順調 ON TRACK、週平均 → 目標', () => {
    expect(growthCorners(heroPhase([phase()], WEIGHTS, TODAY), 76.25, 80)).toEqual({
      phase: { value: '増量', sub: '06/16W' }, pace: { value: '順調', sub: 'ON TRACK' }, weekAvgKg: 76.25, goalKg: 80,
    });
  });
  test('判定しないときは NO DATA、療養中は療養と日、未設定は null', () => {
    expect(growthCorners(heroPhase([phase()], [], TODAY), null, 80).pace).toEqual({ value: null, sub: 'NO DATA' });
    expect(growthCorners(heroPhase([phase(), rehab()], WEIGHTS, TODAY), 76, 80)).toMatchObject({
      phase: { value: '療養', sub: 'DAY 03' }, pace: { value: null, sub: 'PAUSED' },
    });
    expect(growthCorners(heroPhase([], WEIGHTS, TODAY), 76, 72)).toEqual({ phase: null, pace: null, weekAvgKg: 76, goalKg: 72 });
  });
});

describe('BIG3 の Δ PHASE と LOG の週', () => {
  const row = (date: string, exerciseId: string, weightKg: number, reps: number): TrainingSetRow => ({ date, exerciseId, bodyPartId: 'chest', weightKg, reps });
  const assigned = { bench: 'bench', squat: 'squat', deadlift: 'dl' };
  const rows = [row('2026-09-01', 'bench', 100, 1), row('2026-11-01', 'bench', 110, 1), row('2026-11-01', 'squat', 130, 1), row('2026-11-01', 'dl', 150, 1)];
  test('開始時の BIG3 があれば、開始時と今の両方に値がある役だけで差を出す', () => {
    const g = big3Gauge(rows, assigned, TODAY, { bench: 100, squat: 120, deadlift: null })!;
    expect(g.deltaBase).toBe('PHASE');
    // (110 + 130) - (100 + 120)。デッドリフトは開始時にないので足さない
    expect(g.deltaKg).toBeCloseTo(20, 5);
  });
  test('開始時の BIG3 がなければ今のまま（28 日前から）', () => {
    expect(big3Gauge(rows, assigned, TODAY, null)!.deltaBase).toBe('28D');
    expect(big3Gauge(rows, assigned, TODAY)!.deltaBase).toBe('28D');
  });
  test('週の名前：フェーズの週（今週の行に合わせる）。フェーズの前の行は「—」。フェーズがなければ W1〜W4', () => {
    expect(logWeekLabels(6)).toEqual(['W3', 'W4', 'W5', 'W6']);
    expect(logWeekLabels(2)).toEqual(['—', '—', 'W1', 'W2']);
    expect(logWeekLabels(null)).toEqual(['W1', 'W2', 'W3', 'W4']);
    expect(logWeekRange(logWeekLabels(6))).toBe('W3-W6');
    expect(logWeekRange(logWeekLabels(1))).toBe('W1');
    const grid = logGrid({ rows: [], partName: () => '', meals: [], weighed: new Set(), injured: new Set(), suggest: null, phaseWeek: 6 }, TODAY);
    expect(grid.map((w) => w.label)).toEqual(['W3', 'W4', 'W5', 'W6']);
    expect(grid[3].cells[0].date).toBe(addDays(TODAY, -6));
  });
});
