// フェーズの食事の目標の自動計算（lib/phaseMeals.ts）と、直す・計画を変えるときの計算し直し（lib/phaseEdit.ts）
import type { Maintenance } from '../autoGoal';
import { changeFields, correctFields } from '../phaseEdit';
import { maintenanceOf, missingNote, PhaseMealPlan, phaseDailyDelta, phaseMealTargets, rehabMealTargets } from '../phaseMeals';
import { Phase } from '../phases';

// 体重 70.0kg・体脂肪率 15%・よく動く（1.55）：BMR 370 + 21.6 × 59.5 = 1655.2、維持 1655.2 × 1.55 = 2565.56
const M: Maintenance = { bmr: 1655.2, tdeeRest: 2565.56, bodyWeightKg: 70 };
const plan = (o: Partial<PhaseMealPlan>): PhaseMealPlan => ({ kind: 'normal', direction: 'bulk', fromKg: 70, targetKg: 72.5, days: 56, ...o });
const kcal = (t: ReturnType<typeof phaseMealTargets>) => [t.training_day.kcal, t.rest_day.kcal, t.training_day.protein_g, t.rest_day.protein_g];

describe('フェーズの食事の目標：維持のカロリー＋(目標 − 始まり) × 7,200 ÷ 日数。筋トレの日は +280、たんぱく質は体重 × 2.0', () => {
  test('増量：70.0 → 72.5kg を 8 週（56 日）で、1 日 +321kcal', () => {
    expect(phaseDailyDelta(M, plan({}))).toBeCloseTo(321.43, 2);
    // 休み 2565.56 + 321.43 = 2886.99 → 2890、筋トレ 3166.99 → 3170
    expect(kcal(phaseMealTargets(M, plan({})))).toEqual([3170, 2890, 140, 140]);
  });

  test('減量：70.0 → 66.0kg を 16 週で、1 日 −257kcal', () => {
    const p = plan({ direction: 'cut', targetKg: 66, days: 112 });
    expect(phaseDailyDelta(M, p)).toBeCloseTo(-257.14, 2);
    expect(kcal(phaseMealTargets(M, p))).toEqual([2590, 2310, 140, 140]);
  });

  test('維持と療養は差 0（維持のカロリー。療養で減らさない）', () => {
    const maintain = plan({ direction: 'maintain', targetKg: 71 });
    expect(phaseDailyDelta(M, maintain)).toBe(0);
    expect(kcal(phaseMealTargets(M, maintain))).toEqual([2850, 2570, 140, 140]);
    const rehab = plan({ kind: 'rehab', direction: null, targetKg: 60 });
    expect(phaseDailyDelta(M, rehab)).toBe(0);
    expect(kcal(phaseMealTargets(M, rehab))).toEqual([2850, 2570, 140, 140]);
    expect(rehabMealTargets(M)).toEqual(phaseMealTargets(M, maintain));
    expect(rehabMealTargets(null)).toBeNull();
  });

  test('目標が向きと逆（増量なのに目標が下・減量なのに上）なら差 0。増量で減らさない・減量で増やさない', () => {
    expect(phaseDailyDelta(M, plan({ targetKg: 68 }))).toBe(0);
    expect(phaseDailyDelta(M, plan({ direction: 'cut', targetKg: 72 }))).toBe(0);
  });

  test('線の始まりの体重か日数がなければ、決まった速さ（増量は週に 0.25%、減量は 0.5%。suggest_goals と同じ）', () => {
    expect(phaseDailyDelta(M, plan({ fromKg: null }))).toBeCloseTo(180, 6); // 70 × 0.0025 × 7200 ÷ 7
    expect(phaseDailyDelta(M, plan({ direction: 'cut', days: null }))).toBeCloseTo(-360, 6);
    expect(kcal(phaseMealTargets(M, plan({ fromKg: null })))).toEqual([3030, 2750, 140, 140]);
  });

  test('下限は基礎代謝（下回る日は基礎代謝を 10kcal に切り上げた値）', () => {
    const low: Maintenance = { bmr: 1801, tdeeRest: 2000, bodyWeightKg: 70 };
    expect(kcal(phaseMealTargets(low, plan({ direction: 'cut', targetKg: 60, days: 28 })))).toEqual([1810, 1810, 140, 140]);
  });
});

describe('維持のカロリー', () => {
  const basis = (bodyFat: number | null) => ({
    weightKg: 70.04, weightFrom: '2026-11-02', weightTo: '2026-11-08', weightDays: 7,
    bodyFat: bodyFat == null ? null : { pct: bodyFat, from: '2026-11-02', to: '2026-11-08', days: 3 },
  });
  test('体脂肪率があれば Katch-McArdle（体重は 0.1kg に丸める）', () => {
    const m = maintenanceOf({ basis: basis(15), activity: 'moderate', heightCm: null, sex: null, birthYear: null, today: '2026-11-08' })!;
    expect(m.bodyWeightKg).toBe(70);
    expect(m.bmr).toBeCloseTo(1655.2, 6);
    expect(m.tdeeRest).toBeCloseTo(2565.56, 6);
  });
  test('なければ Mifflin-St Jeor。身長・性別・生まれた年・活動の量のどれかがなければ null', () => {
    const m = maintenanceOf({ basis: basis(null), activity: 'sedentary', heightCm: 175, sex: 'male', birthYear: 1990, today: '2026-11-08' })!;
    expect(m.bmr).toBeCloseTo(10 * 70 + 6.25 * 175 - 5 * 36 + 5, 6);
    expect(maintenanceOf({ basis: basis(null), activity: 'sedentary', heightCm: null, sex: 'male', birthYear: 1990, today: '2026-11-08' })).toBeNull();
    expect(maintenanceOf({ basis: basis(15), activity: null, heightCm: null, sex: null, birthYear: null, today: '2026-11-08' })).toBeNull();
    expect(maintenanceOf({ basis: null, activity: 'light', heightCm: 175, sex: 'male', birthYear: 1990, today: '2026-11-08' })).toBeNull();
  });
  test('足りない入力の説明', () => {
    expect(missingNote(['weight'])).toBe('体重の記録がないので、食事の目標は自動で計算できません。');
    expect(missingNote(['sex', 'activity'])).toBe('自動で計算するには、アカウントの画面の性別・活動の量が要ります。');
  });
});

describe('直す・計画を変えると、食事の目標を新しい計画から計算し直す', () => {
  const TODAY = '2026-11-08';
  const manual = { training_day: { kcal: 2800, protein_g: 150 }, rest_day: { kcal: 2500, protein_g: 150 } };
  // 11/1 から 16 週（112 日）、72 → 80kg。本人が直した食事の目標を持つ
  const phase = (o: Partial<Phase> = {}): Phase => ({
    id: 'p1', kind: 'normal', direction: 'bulk', name: '', startDate: '2026-11-01', endDate: '2027-02-20', targetWeightKg: 80, mealTargets: manual,
    snapshot: { weight_kg: 72, body_fat_pct: null, big3: null, growth_score: null }, status: 'active', pausedPhaseId: null,
    targetHistory: [{ date: '2026-11-01', target_weight_kg: 80, end_date: '2027-02-20', weight_kg: 72 }],
    endedOn: null, createdAt: '2026-11-01T00:00:00Z', ...o,
  });

  test('直す：開始時の体重から目標まで、全体の週数 × 7 日で（本人が直した値も置き換える）', () => {
    const f = correctFields(phase(), { startDate: '2026-11-01', weeks: 16, targetWeightKg: 80, snapshot: null, maintenance: M });
    // (80 − 72) × 7200 ÷ 112 = 514.29 → 休み 3079.85 → 3080、筋トレ 3360
    expect(kcal(f.mealTargets!)).toEqual([3360, 3080, 140, 140]);
  });

  test('計画を変える：目標を変えたら、今の週平均から目標まで、残りの日数（112 − 7 = 105 日）で', () => {
    const f = changeFields(phase(), { weeks: 16, targetWeightKg: 82, weekAvgKg: 72.8, maintenance: M }, TODAY)!;
    // (82 − 72.8) × 7200 ÷ 105 = 630.86 → 休み 3196.42 → 3200、筋トレ 3480
    expect(kcal(f.mealTargets!)).toEqual([3480, 3200, 140, 140]);
  });

  test('計画を変える：期間だけなら、前の線の今日の値から（20 週・残り 133 日）', () => {
    const f = changeFields(phase(), { weeks: 20, targetWeightKg: 80, weekAvgKg: 72.8, maintenance: M }, TODAY)!;
    const from = 72 + (8 * 7) / 111; // 前の線の 11/8 の値
    const delta = ((80 - from) * 7200) / 133;
    expect(kcal(f.mealTargets!)).toEqual([
      Math.round((M.tdeeRest + 280 + delta) / 10) * 10, Math.round((M.tdeeRest + delta) / 10) * 10, 140, 140,
    ]);
  });

  test('療養で止まった日は、残りの日数に数えない', () => {
    // 11/3〜11/5 の 3 日止まった（終えた療養）：時計は 11/8 で 4 日目 → 残り 112 − 4 = 108 日
    const r: Phase = { ...phase({ id: 'r1', kind: 'rehab', direction: null, endDate: null, targetWeightKg: null, targetHistory: [], pausedPhaseId: 'p1' }),
      startDate: '2026-11-03', status: 'ended', endedOn: '2026-11-06' };
    const f = changeFields(phase(), { weeks: 16, targetWeightKg: 82, weekAvgKg: 72.8, maintenance: M }, TODAY, [phase(), r])!;
    const delta = ((82 - 72.8) * 7200) / 108;
    expect(f.mealTargets!.rest_day.kcal).toBe(Math.round((M.tdeeRest + delta) / 10) * 10);
  });

  test('開始時の体重がなく期間だけ変えたら、今の週平均から', () => {
    const p = phase({ snapshot: null, targetHistory: [{ date: '2026-11-01', target_weight_kg: 80, end_date: '2027-02-20', weight_kg: null }] });
    const f = changeFields(p, { weeks: 20, targetWeightKg: 80, weekAvgKg: 72.8, maintenance: M }, TODAY)!;
    expect(f.mealTargets!.rest_day.kcal).toBe(Math.round((M.tdeeRest + ((80 - 72.8) * 7200) / 133) / 10) * 10);
  });

  test('維持のカロリーが出せなければ、今の食事の目標のまま', () => {
    expect(correctFields(phase(), { startDate: '2026-11-01', weeks: 16, targetWeightKg: 80, snapshot: null }).mealTargets).toBe(manual);
    expect(changeFields(phase(), { weeks: 16, targetWeightKg: 82, weekAvgKg: 72.8, maintenance: null }, TODAY)!.mealTargets).toBe(manual);
  });
});
