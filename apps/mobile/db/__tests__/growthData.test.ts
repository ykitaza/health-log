// 「記録で育つ形」の読み込み：DB から集めて GrowthDay[] などにする（計算は lib/growth.ts）
import { migrate } from '../migrations';
import { SEED_EXERCISES } from '../seed';
import { growthSeries } from '@/lib/growth';
import { loadGrowthData, mergeGrowthDays } from '@/lib/growthData';
import type { ItemInput } from '@/lib/meals';
import { memoryDb, repos, testDeps } from '@/test-utils/nodeDb';

const BENCH = SEED_EXERCISES[0].id;
const egg: ItemInput = { name: '卵', amount: 1, unit: '個', kcal: 80, protein_g: 6, fat_g: 5, carbs_g: 0 };

async function setup() {
  const db = memoryDb();
  // 2026-11-10（火）
  const deps = testDeps('2026-11-10T12:00:00.000Z');
  await migrate(db, deps.now);
  const sleep = (date: string, asleepMin: number, n: number) => db.raw.prepare(
    `INSERT INTO sleep_sessions (id, date, start_at, end_at, asleep_min, awake_min, external_id, created_at, updated_at)
     VALUES (?, ?, 'x', 'y', ?, 0, ?, 'x', 'x')`,
  ).run(`s${n}`, date, asleepMin, `e${n}`);
  return { r: repos(db, deps), sleep };
}

test('全期間の記録を日ごとにまとめる：負荷量・筋トレの日・食事の目標・睡眠（昼寝は足す）', async () => {
  const { r, sleep } = await setup();
  await r.settings.update({ weeklyGoalTrainingDays: 4, goalWeightKg: 70 });
  await r.workouts.saveEntry({ date: '2026-11-01', exerciseId: BENCH, sets: [{ weightKg: 60, reps: 10, memo: '', done: true }, { weightKg: 50, reps: 10, memo: '', done: true }] });
  await r.workouts.saveEntry({ date: '2026-11-09', exerciseId: BENCH, sets: [{ weightKg: 60, reps: 5, memo: '', done: true }] });
  // たんぱく質の目標 10g、カロリーは 160（どちらの日の種類も）
  const day = { kcal: 160, fat_g: 10, carbs_g: 0 };
  await r.meals.saveGoal({ policy: 'maintain', body_weight_kg: 10, protein_per_kg: 1, targets: { training_day: day, rest_day: day }, eating_style: null, target_weight_kg: null });
  await r.meals.record({ date: '2026-11-09', slot: 'breakfast', source: 'text', items: [egg, egg] }); // 160kcal・12g：届いた
  await r.meals.record({ date: '2026-11-10', slot: 'breakfast', source: 'text', items: [egg] }); // 80kcal・6g（50%）：届かない
  sleep('2026-11-08', 300, 1);
  sleep('2026-11-08', 120, 2); // 昼寝も足して 420 分
  sleep('2026-11-09', 400, 3);
  await r.body.saveManual('2026-11-02', { weightKg: 75 });

  const g = await loadGrowthData(r, '2026-11-10');
  expect(g.days).toEqual([
    { date: '2026-11-01', trained: true, volumeKg: 1100, mealRecorded: false, mealGoalReached: false, sleepMin: null },
    { date: '2026-11-08', trained: false, volumeKg: 0, mealRecorded: false, mealGoalReached: false, sleepMin: 420 },
    { date: '2026-11-09', trained: true, volumeKg: 300, mealRecorded: true, mealGoalReached: true, sleepMin: 400 },
    { date: '2026-11-10', trained: false, volumeKg: 0, mealRecorded: true, mealGoalReached: false, sleepMin: null },
  ]);
  expect(g.sets).toHaveLength(3);
  expect(g.exerciseNames.get(BENCH)).toBeTruthy();
  expect(g.weights).toEqual([{ date: '2026-11-02', weightKg: 75 }]);
  expect(g.goalWeightKg).toBe(70);
  expect(g.weeklyTrainingGoal).toBe(4);
  expect(g.weeklyGoals).toMatchObject({ trainingDays: 4 });
  expect(g.weightUnit).toBe('kg');
  // 形の入力にそのまま使える：最初の記録の日（11/1）から今日まで 10日
  const series = growthSeries(g.days, g.today);
  expect(series).toHaveLength(10);
  expect(series[9]).toEqual({ volumeKg: 1400, foodDays: 1, sleepDays: 1, days: 10 });
});

test('今日より後の記録は入れない。記録が何もなければ空', async () => {
  const { r } = await setup();
  expect((await loadGrowthData(r, '2026-11-10')).days).toEqual([]);
  await r.workouts.saveEntry({ date: '2026-11-11', exerciseId: BENCH, sets: [{ weightKg: 60, reps: 5, memo: '', done: true }] });
  expect((await loadGrowthData(r, '2026-11-10')).days).toEqual([]);
});

test('mergeGrowthDays：自重だけで負荷量 0 の日も trained になる', () => {
  const days = mergeGrowthDays({ today: '2026-11-10', volumeByDate: new Map([['2026-11-09', 0]]), meals: new Map(), sleep: [] });
  expect(days).toEqual([{ date: '2026-11-09', trained: true, volumeKg: 0, mealRecorded: false, mealGoalReached: false, sleepMin: null }]);
});
