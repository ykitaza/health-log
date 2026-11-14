import { addDays } from '../date';
import type { GrowthData } from '../growthData';
import type { NutritionGoal } from '../meals';
import { Phase, successMetrics } from '../phases';
import {
  autoName, big3Sum, initialTarget, mealDraftFromGoal, mealDraftFromPhase, measuresFrom, metricNote, midDate, midWeek, offPaceStreak,
  orderMetrics, paceSentence, parseMealDraft, planSlopePerWeek, plannedWeeklyKg, projectedKg, recentSlopePerWeek, snapshotOf,
  targetAgainstDirection, weightChart,
} from '../phaseView';

const TODAY = '2026-11-08'; // 日曜。9/28 開始の 6 週目

const phase = (o: Partial<Phase> = {}): Phase => ({
  id: 'p1', kind: 'normal', direction: 'bulk', name: '', startDate: '2026-09-28', endDate: '2027-01-17', targetWeightKg: 80, mealTargets: null,
  snapshot: { weight_kg: 74, body_fat_pct: 18, big3: { bench: 100, squat: 120, deadlift: null }, growth_score: 60 },
  status: 'active', pausedPhaseId: null, targetHistory: [], endedOn: null, createdAt: '2026-09-28T00:00:00Z', ...o,
});
const rehab = (o: Partial<Phase> = {}): Phase => ({
  ...phase(), id: 'r1', kind: 'rehab', direction: null, endDate: null, targetWeightKg: null, snapshot: null, startDate: '2026-10-12',
  pausedPhaseId: 'p1', createdAt: '2026-10-12T00:00:00Z', status: 'ended', endedOn: '2026-10-19', ...o,
});
/** 予定（74→80kg を 111 日で）どおりの体重を、週に 2 日（水・土）測る。off は予定からのずれ */
function onPlan(from: string, to: string, off = 0): { date: string; kg: number }[] {
  const out: { date: string; kg: number }[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (wd !== 3 && wd !== 6) continue;
    const t = (new Date(`${d}T00:00:00Z`).getTime() - new Date('2026-09-28T00:00:00Z').getTime()) / 86400000;
    out.push({ date: d, kg: Math.round((74 + (6 * t) / 111 + off) * 100) / 100 });
  }
  return out;
}

describe('今の記録（開始時の記録と成功の指標の「今」）', () => {
  const growth = (o: Partial<GrowthData> = {}): GrowthData => ({
    today: TODAY, days: [], sets: [], exerciseNames: new Map(), big3: {}, weights: [], bodyFats: [], mealCount: 0, partNames: new Map(),
    goalWeightKg: 80, weeklyGoals: {} as GrowthData['weeklyGoals'], weeklyTrainingGoal: 3, weightUnit: 'kg', ...o,
  });
  test('体重と体脂肪率は直近 7 日の平均、なければ最新の値。記録がなければ null', () => {
    const m = measuresFrom(growth({
      weights: [{ date: '2026-10-01', weightKg: 70 }, { date: '2026-11-04', weightKg: 76.2 }, { date: '2026-11-07', weightKg: 76.3 }],
      bodyFats: [{ date: '2026-10-20', pct: 18.2 }],
    }), TODAY);
    expect(m).toMatchObject({ weightKg: 76.3, weightBasis: 'week', bodyFatPct: 18.2, big3: null, growthScore: null });
    expect(measuresFrom(growth({ weights: [{ date: '2026-10-01', weightKg: 70 }] }), TODAY)).toMatchObject({ weightKg: 70, weightBasis: 'latest' });
    expect(measuresFrom(growth(), TODAY)).toMatchObject({ weightKg: null, weightBasis: null });
    // 未来の日の記録は見ない
    expect(measuresFrom(growth({ weights: [{ date: '2026-11-20', weightKg: 99 }] }), TODAY).weightKg).toBeNull();
  });
  test('開始時の記録の形にする。BIG3 の合計は記録のある役だけ', () => {
    expect(snapshotOf({ weightKg: 76, weightBasis: 'week', bodyFatPct: null, big3: { bench: 95, squat: 120, deadlift: null }, growthScore: 70 }))
      .toEqual({ weight_kg: 76, body_fat_pct: null, big3: { bench: 95, squat: 120, deadlift: null }, growth_score: 70 });
    expect(big3Sum({ bench: 95, squat: 120, deadlift: 147.5 })).toBe(362.5);
    expect(big3Sum({ bench: null, squat: null, deadlift: null })).toBeNull();
    expect(big3Sum(null)).toBeNull();
  });
});

describe('設定のステップ', () => {
  test('目標体重の初期値：向きに合うアカウントの目標を取り込む。維持は今の体重', () => {
    expect(initialTarget('bulk', 80, 76)).toEqual({ kg: 80, imported: true });
    expect(initialTarget('cut', 80, 76)).toEqual({ kg: null, imported: false });
    expect(initialTarget('cut', 72, 76)).toEqual({ kg: 72, imported: true });
    expect(initialTarget('bulk', 80, null)).toEqual({ kg: 80, imported: true });
    expect(initialTarget('bulk', null, 76)).toEqual({ kg: null, imported: false });
    expect(initialTarget('maintain', 80, 76.04)).toEqual({ kg: 76, imported: false });
  });
  test('名前の自動・予定のペース・向きと逆の目標', () => {
    expect(autoName('bulk', 16)).toBe('増量 16週');
    expect(plannedWeeklyKg(76, 80, 16)).toBe(0.25);
    expect(plannedWeeklyKg(null, 80, 16)).toBeNull();
    expect(targetAgainstDirection('bulk', 76, 75)).toBe(true);
    expect(targetAgainstDirection('cut', 76, 72)).toBe(false);
    expect(targetAgainstDirection('maintain', 76, 77.5)).toBe(true);
    expect(targetAgainstDirection('bulk', null, 75)).toBe(false);
  });
  test('食事の目標：今の目標から取り込み、入力を確かめる。全部空なら目標なし', () => {
    const goal: NutritionGoal = {
      policy: 'bulk', body_weight_kg: 75, protein_per_kg: 2, eating_style: null, target_weight_kg: 80,
      targets: { training_day: { kcal: 2800, fat_g: 70, carbs_g: 380 }, rest_day: { kcal: 2500, fat_g: 70, carbs_g: 300 } },
    };
    expect(mealDraftFromGoal(goal)).toEqual({ training: '2800', rest: '2500', protein: '150' });
    expect(mealDraftFromGoal(null)).toEqual({ training: '', rest: '', protein: '' });
    expect(parseMealDraft({ training: '2,800', rest: '2500', protein: '150' })).toEqual({
      value: { training_day: { kcal: 2800, protein_g: 150 }, rest_day: { kcal: 2500, protein_g: 150 } },
    });
    expect(parseMealDraft({ training: '', rest: '', protein: '' })).toEqual({ value: null });
    expect(parseMealDraft({ training: '20001', rest: '', protein: '' })).toEqual({ error: 'kcal は0〜20000で入れてください' });
    expect(parseMealDraft({ training: '', rest: '', protein: '5001' })).toEqual({ error: 'たんぱく質は0〜5000g で入れてください' });
    expect(parseMealDraft({ training: 'abc', rest: '', protein: '' })).toEqual({ error: '筋トレの日の kcalを数字で入れてください' });
    expect(mealDraftFromPhase({ training_day: { kcal: 3000, protein_g: 150 }, rest_day: { kcal: null, protein_g: 150 } }))
      .toEqual({ training: '3000', rest: '', protein: '150' });
  });
});

describe('体重のグラフ', () => {
  test('週ごとの点：予定どおりなら判定する週は塗り、測ったのが 1 日の週は白抜き、測っていない週は点なし', () => {
    const weights = onPlan('2026-09-28', TODAY).filter((w) => !(w.date >= '2026-10-12' && w.date <= '2026-10-18' && w.date !== '2026-10-14'))
      .filter((w) => !(w.date >= '2026-10-19' && w.date <= '2026-10-25'));
    const c = weightChart(phase(), [phase()], weights, TODAY);
    expect(c.weeks).toBe(16);
    expect(c.xMax).toBe(112);
    expect(c.points.map((p) => [p.week, p.judged])).toEqual([[1, true], [2, true], [3, false], [5, true], [6, true]]);
    // 今週（6 週目）の点は今日まで
    expect(c.points[c.points.length - 1].x).toBe(41);
    expect(c.lines).toHaveLength(1);
    expect(c.changes).toEqual([]);
    expect(planSlopePerWeek(c)).toBeCloseTo((6 / 111) * 7, 5);
    expect(recentSlopePerWeek(c)).toBeCloseTo((6 / 111) * 7, 1);
    expect(projectedKg(c)).toBeCloseTo(80, 0);
  });
  test('目標を変えたら 2 本の線（前の線は current が false）と、変えた所', () => {
    const p = phase({
      targetWeightKg: 79,
      targetHistory: [
        { date: '2026-09-28', target_weight_kg: 80, end_date: '2027-01-17', weight_kg: 74 },
        { date: '2026-10-19', target_weight_kg: 79, end_date: '2027-01-17', weight_kg: 75 },
      ],
    });
    const c = weightChart(p, [p], onPlan('2026-09-28', TODAY), TODAY);
    expect(c.lines.map((l) => l.current)).toEqual([false, true]);
    expect(c.changes).toEqual([{ x: 21, from: 80, to: 79 }]);
  });
  test('療養で止めた日は横軸に入れない（時計が止まる）', () => {
    const r = rehab();
    const c = weightChart(phase(), [phase(), r], onPlan('2026-09-28', TODAY), TODAY);
    // 7 日止めたので、今日は時計の 34 日目（5 週目）
    expect(c.points[c.points.length - 1].x).toBe(34);
    expect(c.points[c.points.length - 1].week).toBe(5);
  });
  test('開始時の体重がなければ予定の線はなく、点だけ', () => {
    const p = phase({ snapshot: null });
    const c = weightChart(p, [p], onPlan('2026-11-01', TODAY), TODAY);
    expect(c.lines).toEqual([]);
    expect(c.points.length).toBeGreaterThan(0);
    expect(c.points.every((x) => !x.judged)).toBe(true);
    expect(planSlopePerWeek(c)).toBeNull();
  });
});

describe('ペース', () => {
  const fmt = (kg: number) => `${kg.toFixed(1)} kg`;
  test('理由の 1 文は Pace の値から', () => {
    const base = { weighIns: 2, weekAvgKg: 77.4, planKg: 77.5, diffKg: -0.1 };
    expect(paceSentence({ status: 'on_track', reason: null, ...base }, null, fmt, (d) => d))
      .toBe('この7日の平均は 77.4 kg。予定の 77.5 kg の幅（±0.3 kg）の中です。');
    expect(paceSentence({ status: 'slow', reason: null, ...base, weekAvgKg: 77, diffKg: -0.5 }, null, fmt, (d) => d)).toContain('より下です');
    expect(paceSentence({ status: null, reason: 'few_weigh_ins', weighIns: 1, weekAvgKg: null, planKg: null, diffKg: null }, null, fmt, (d) => d))
      .toBe('この7日に体重を測ったのが1日なので、判定していません（2日以上で判定します）。');
    expect(paceSentence({ status: null, reason: 'recovering', weighIns: 0, weekAvgKg: null, planKg: null, diffKg: null }, '2026-11-20', fmt, (d) => d))
      .toBe('療養から戻って2週間（2026-11-20まで）は、判定しません。');
  });
  test('2 週続けて同じ向きに外れたら崩れ。1 週だけ・判定しない週があれば出さない', () => {
    const slow = onPlan('2026-09-28', TODAY).map((w) => ({ ...w, kg: w.date >= '2026-10-26' ? w.kg - 0.6 : w.kg }));
    expect(offPaceStreak(phase(), [phase()], slow, TODAY)).toBe('slow');
    const once = onPlan('2026-09-28', TODAY).map((w) => ({ ...w, kg: w.date >= '2026-11-02' ? w.kg - 0.6 : w.kg }));
    expect(offPaceStreak(phase(), [phase()], once, TODAY)).toBeNull();
    expect(offPaceStreak(phase(), [phase()], onPlan('2026-09-28', TODAY), TODAY)).toBeNull();
    expect(offPaceStreak(phase(), [phase()], slow.filter((w) => w.date < '2026-11-01'), TODAY)).toBeNull();
  });
});

describe('中間の見直しと成功の指標', () => {
  test('中間の週は半分（4 週より短ければなし）。始まる日は止まった日だけ後ろへ', () => {
    expect(midWeek(16)).toBe(8);
    expect(midWeek(5)).toBe(3);
    expect(midWeek(3)).toBeNull();
    expect(midWeek(null)).toBeNull();
    expect(midDate(phase(), [phase()], TODAY, 8)).toBe('2026-11-16');
    expect(midDate(phase(), [phase(), rehab()], TODAY, 8)).toBe('2026-11-23');
  });
  test('主な指標を先に（維持は BIG3）。右下の 1 言', () => {
    const now = { weightKg: 77.4, bodyFatPct: 18.9, big3: { bench: 110, squat: 125, deadlift: null }, growthScore: 66 };
    const fmt = (kg: number) => `${kg.toFixed(1)} kg`;
    const bulk = successMetrics(phase(), now).metrics;
    expect(orderMetrics('bulk', bulk).map((m) => m.key)).toEqual(['weight', 'big3', 'body_fat']);
    expect(metricNote(bulk[0], 'bulk', 80, fmt)).toBe('目標まで あと 2.6 kg');
    expect(metricNote(bulk[1], 'bulk', 80, fmt)).toBe('伸びている');
    expect(metricNote(bulk[2], 'bulk', 80, fmt)).toBe('参考');
    const m = phase({ direction: 'maintain', targetWeightKg: 74 });
    const maint = successMetrics(m, { ...now, weightKg: 74.5 }).metrics;
    expect(orderMetrics('maintain', maint).map((x) => x.key)).toEqual(['big3', 'weight', 'growth_score', 'body_fat']);
    expect(metricNote(maint.find((x) => x.key === 'weight')!, 'maintain', 74, fmt)).toBe('ほぼ同じ（±1 kg の中）');
    const cut = successMetrics(phase({ direction: 'cut', targetWeightKg: 70 }), { ...now, weightKg: 72, big3: { bench: 98, squat: 118, deadlift: null } }).metrics;
    expect(metricNote(cut.find((x) => x.key === 'big3')!, 'cut', 70, fmt)).toBe('保てている（−3% 以内）');
    expect(metricNote(cut.find((x) => x.key === 'weight')!, 'cut', 70, fmt)).toBe('目標まで あと 2.0 kg');
  });
});
