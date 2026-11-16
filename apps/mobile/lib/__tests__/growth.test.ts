import { addDays } from '../date';
import { growthScore, GrowthDay, mealGoalReached, personalBestEvents } from '../growth';
import type { TrainingSetRow } from '../training';

// trained は、指定がなければ「負荷量があれば true」
const day = (date: string, p: Partial<GrowthDay> = {}): GrowthDay => ({
  date, trained: (p.volumeKg ?? 0) > 0, volumeKg: 0, mealRecorded: false, mealGoalReached: false, sleepMin: null, ...p,
});

describe('mealGoalReached（食事の目標：カロリーとたんぱく質の両方が 90% 以上）', () => {
  const d = (kcal: number, protein: number, target: { kcal: number | null; protein_g: number | null } | null, n = 1) => ({
    meals: Array(n).fill({}) as never[],
    total: { kcal, protein_g: protein, fat_g: 0, carbs_g: 0 },
    target: target && { ...target, fat_g: null, carbs_g: null },
  });
  test('ちょうど 90% で届く。片方が足りなければ届かない', () => {
    expect(mealGoalReached(d(1800, 90, { kcal: 2000, protein_g: 100 }))).toBe(true);
    expect(mealGoalReached(d(1799, 90, { kcal: 2000, protein_g: 100 }))).toBe(false);
    expect(mealGoalReached(d(1800, 89, { kcal: 2000, protein_g: 100 }))).toBe(false);
  });
  test('記録なし・目標なし・片方の目標だけのときは届かない', () => {
    expect(mealGoalReached(d(2000, 100, { kcal: 2000, protein_g: 100 }, 0))).toBe(false);
    expect(mealGoalReached(d(2000, 100, null))).toBe(false);
    expect(mealGoalReached(d(2000, 100, { kcal: null, protein_g: 100 }))).toBe(false);
  });
});

describe('growthScore', () => {
  const today = '2026-11-11'; // 直近7日は 11/5〜11/11
  test('筋トレ：回数（目標が未設定なら3回）と、前の4週間の週平均に対する負荷量', () => {
    const days = [
      day('2026-10-20', { volumeKg: 4000 }), // 前の4週間（週平均 1000）
      day('2026-11-06', { volumeKg: 500 }),
      day('2026-11-08', { volumeKg: 500 }),
    ];
    // 回数 2/3 × 20 ＋ 負荷量 1000/1000 × 20
    expect(growthScore(days, today, null).training.points).toBeCloseTo(20 * (2 / 3) + 20, 6);
    expect(growthScore(days, today, 2).training.points).toBeCloseTo(40, 6);
    // 負荷量の割合は上限 1
    expect(growthScore([...days, day('2026-11-09', { volumeKg: 9000 })], today, 2).training.points).toBeCloseTo(40, 6);
  });
  test('自重だけで負荷量 0 の日も、筋トレの回数に入る', () => {
    const s = growthScore([day('2026-11-06', { trained: true })], today, 4);
    expect(s.training.points).toBeCloseTo(40 * (1 / 4), 6);
  });
  test('前の4週間に記録がなければ、負荷量の割合は回数の割合そのまま', () => {
    const s = growthScore([day('2026-11-06', { volumeKg: 500 })], today, 4);
    expect(s.training.points).toBeCloseTo(40 * (1 / 4), 6);
  });
  test('7日の窓は today を含み、today より後の日は含まない', () => {
    expect(growthScore([day('2026-11-12', { volumeKg: 500 })], today, 1).training.points).toBe(0);
    expect(growthScore([day('2026-11-05', { volumeKg: 500 })], today, 1).training.points).toBeCloseTo(40, 6);
    // 11/4 は窓の外（前の4週間に入る）。回数は 0
    const out = growthScore([day('2026-11-04', { volumeKg: 500 })], today, 1);
    expect(out.training.points).toBe(0);
  });
  test('食事：記録のある日のうち、目標に届いた日の割合。記録のない日は外す', () => {
    const days = [
      day('2026-11-06', { mealRecorded: true, mealGoalReached: true }),
      day('2026-11-07', { mealRecorded: true }),
      // 11/8〜11 は記録なし（0点にしない）
    ];
    expect(growthScore(days, today).meal.points).toBeCloseTo(15, 6);
  });
  test('睡眠：記録のある日の平均 ÷ 420分、上限 1', () => {
    expect(growthScore([day('2026-11-06', { sleepMin: 210 }), day('2026-11-07', { sleepMin: 420 })], today).sleep.points).toBeCloseTo(22.5, 6);
    expect(growthScore([day('2026-11-06', { sleepMin: 600 })], today).sleep.points).toBeCloseTo(30, 6);
  });
  test('食事・睡眠の記録がなければその柱は null。残りの柱を 100 点満点に換算する', () => {
    const s = growthScore([day('2026-11-06', { volumeKg: 500 })], today, 1);
    expect(s.meal.points).toBeNull();
    expect(s.sleep.points).toBeNull();
    expect(s.training.points).toBeCloseTo(40, 6);
    expect(s.total).toBe(100);
    const half = growthScore([day('2026-11-06', { volumeKg: 500, sleepMin: 210 })], today, 1);
    expect(half.meal.points).toBeNull();
    // 筋トレ 40/40、睡眠 15/30 → 55/70
    expect(half.total).toBe(Math.round((55 / 70) * 100));
  });
  test('満点は 100、記録が何もなければ 0', () => {
    const full = growthScore([day('2026-11-06', { volumeKg: 500, mealRecorded: true, mealGoalReached: true, sleepMin: 420 })], today, 1);
    expect(full.total).toBe(100);
    expect(full.training.max + full.meal.max + full.sleep.max).toBe(100);
    expect(growthScore([], today).total).toBe(0);
  });
  test('先週との差：7日前で終わる7日の合計との差。先週が計算できなければ null', () => {
    // 先週（10/29〜11/4）：食事が届かず 0点、今週：届いた 30点。柱は筋トレ（0点）と食事の2つ
    const days = [
      day('2026-10-30', { mealRecorded: true }),
      day('2026-11-06', { mealRecorded: true, mealGoalReached: true }),
    ];
    const s = growthScore(days, today);
    expect(s.total).toBe(Math.round((30 / 70) * 100));
    expect(s.diffFromLastWeek).toBe(s.total);
    // 最初の記録が先週の終わり（11/4）より後
    expect(growthScore([day('2026-11-06', { volumeKg: 1 })], today).diffFromLastWeek).toBeNull();
    expect(growthScore([], today).diffFromLastWeek).toBeNull();
  });
});

describe('personalBestEvents', () => {
  const set = (date: string, exerciseId: string, weightKg: number, reps: number): TrainingSetRow => ({ date, exerciseId, bodyPartId: 'p', weightKg, reps });
  test('前に記録がある種目で、推定1RM を超えた日。同じ値や初回は出さない。today より後は見ない', () => {
    const sets = [
      set('2026-01-01', 'bench', 80, 1), set('2026-01-03', 'bench', 80, 1), set('2026-01-05', 'bench', 82.5, 1),
      set('2026-02-01', 'bench', 90, 1),
    ];
    const r = personalBestEvents(sets, '2026-01-31');
    expect(r.map((e) => [e.date, e.exerciseId, e.e1rm])).toEqual([['2026-01-05', 'bench', 82.5]]);
  });
});
