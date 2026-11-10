// 週・日の達成と、まだ作っていないまとめ：DB から集めて lib/goals.ts・lib/reports.ts に渡す
import { migrate } from '../migrations';
import { SEED_EXERCISES } from '../seed';
import { addDays } from '@/lib/date';
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
  return { db, deps, r: repos(db, deps), sleep };
}

test('週の達成：設定の目標で、筋トレ・食事・たんぱく質・睡眠（その日に起きた分の合計）を数える', async () => {
  const { r, sleep } = await setup();
  await r.settings.update({ weeklyGoalTrainingDays: 2, weeklyGoalSleepDays: 3 });
  await r.workouts.saveEntry({ date: '2026-11-09', exerciseId: BENCH, sets: [{ weightKg: 60, reps: 10, memo: '', done: true }] });
  await r.workouts.saveEntry({ date: '2026-11-08', exerciseId: BENCH, sets: [{ weightKg: 60, reps: 10, memo: '', done: true }] }); // 先週
  await r.meals.saveGoal({ policy: 'maintain', body_weight_kg: 10, protein_per_kg: 1, targets: null, eating_style: null, target_weight_kg: null });
  await r.meals.record({ date: '2026-11-09', slot: 'breakfast', source: 'text', items: [egg, egg] }); // 12g：届いた
  await r.meals.record({ date: '2026-11-10', slot: 'breakfast', source: 'text', items: [egg] }); // 6g
  sleep('2026-11-09', 300, 1);
  sleep('2026-11-09', 130, 2); // 昼寝も足す：430分
  sleep('2026-11-10', 400, 3);

  const a = await r.achievements.week('2026-11-12');
  expect(a).toMatchObject({
    start: '2026-11-09', end: '2026-11-15',
    training: { days: 1, goal: 2, reached: false },
    meals: { days: 2, goal: 5, reached: false },
    protein: { days: 1, goal: 5, reached: false },
    sleep: { days: 1, goal: 3, reached: false },
  });
});

test('すべて達成した週の連続：設定の今の目標で、今週から過去の週を数える（消した食事は数えない）', async () => {
  const { r, sleep } = await setup();
  await r.settings.update({ weeklyGoalTrainingDays: 2, weeklyGoalMealDays: 3, weeklyGoalSleepDays: 0 });
  const train = (date: string) => r.workouts.saveEntry({ date, exerciseId: BENCH, sets: [{ weightKg: 60, reps: 10, memo: '', done: true }] });
  const eat = (date: string) => r.meals.record({ date, slot: 'lunch', source: 'text', items: [egg] });
  // 先週（11/2〜）と先々週（10/26〜）は達成。今週（11/9〜）は筋トレ1日だけ
  for (const monday of ['2026-11-02', '2026-10-26']) {
    const [d0, d1, d2] = [0, 1, 2].map((i) => addDays(monday, i));
    await train(d0); await train(d2);
    await eat(d0); await eat(d1); await eat(d2);
  }
  await train('2026-11-09');
  expect(await r.achievements.streak('2026-11-10')).toEqual({ weeks: 2, thisWeek: false });

  // 今週も届くと、今週を含めて 3
  await train('2026-11-10');
  for (const d of ['2026-11-09', '2026-11-10', '2026-11-11']) await eat(d);
  expect(await r.achievements.streak('2026-11-10')).toEqual({ weeks: 3, thisWeek: true });

  // 先週の食事を1つ消すと、先週で途切れて今週の 1 だけ
  const last = (await r.meals.listDay('2026-11-03'))[0];
  await r.meals.remove(last.id);
  expect(await r.achievements.streak('2026-11-10')).toEqual({ weeks: 1, thisWeek: true });

  // 睡眠の目標を入れると、睡眠も数える
  await r.settings.update({ weeklyGoalSleepDays: 3 });
  expect(await r.achievements.streak('2026-11-10')).toEqual({ weeks: 0, thisWeek: false });
  sleep('2026-11-09', 420, 1); sleep('2026-11-10', 430, 2); sleep('2026-11-11', 500, 3);
  expect(await r.achievements.streak('2026-11-10')).toEqual({ weeks: 1, thisWeek: true });
});

test('日の達成：負荷量・種目数・自己ベスト、食事の合計と目標、その日に起きた睡眠', async () => {
  const { r, sleep } = await setup();
  await r.workouts.saveEntry({ date: '2026-11-01', exerciseId: BENCH, sets: [{ weightKg: 60, reps: 10, memo: '', done: true }] });
  await r.workouts.saveEntry({ date: '2026-11-10', exerciseId: BENCH, sets: [{ weightKg: 70, reps: 10, memo: '', done: true }] });
  await r.meals.record({ date: '2026-11-10', slot: 'lunch', source: 'text', items: [egg] });
  sleep('2026-11-10', 450, 1);

  const a = await r.achievements.day('2026-11-10');
  expect(a.training).toEqual({ volumeKg: 700, exercises: 1, personalBestExerciseIds: [BENCH] });
  expect(a.meals).toEqual({ recorded: true, dayType: 'training', kcal: 80, proteinG: 6, kcalTarget: null, proteinTarget: null });
  expect(a.sleep).toEqual({ asleepMin: 450, goalMin: 420, reached: true });
});

test('まだ作っていないまとめ：記録のある日（筋トレ・食事・体組成）だけ。閉じた分は端末だけに覚え、もう出さない', async () => {
  const { r, db } = await setup();
  await r.workouts.saveEntry({ date: '2026-11-09', exerciseId: BENCH, sets: [{ weightKg: 60, reps: 10, memo: '', done: true }] });
  await r.meals.record({ date: '2026-11-04', slot: 'lunch', source: 'text', items: [egg] });
  await r.body.saveManual('2026-10-20', { weightKg: 70 });
  expect(await r.achievements.recordDates('2026-10-01', '2026-11-10')).toEqual(['2026-10-20', '2026-11-04', '2026-11-09']);

  const now = new Date(2026, 10, 10, 10);
  const keys = async () => (await r.achievements.pending(now)).map((p) => p.key);
  expect(await keys()).toEqual(['daily:2026-11-09', 'daily:2026-11-04', 'weekly:2026-11-02', 'weekly:2026-10-19', 'monthly:2026-10-01']);

  const outbox = db.raw.prepare('SELECT COUNT(*) AS n FROM sync_outbox').get();
  await r.reports.dismissPending('daily:2026-11-09');
  await r.reports.dismissPending('weekly:2026-10-19');
  await r.reports.dismissPending('daily:2026-11-09'); // 2回閉じても1つ
  expect(await r.reports.dismissedPending()).toEqual(['weekly:2026-10-19', 'daily:2026-11-09']);
  expect(await keys()).toEqual(['daily:2026-11-04', 'weekly:2026-11-02', 'monthly:2026-10-01']);
  expect(db.raw.prepare('SELECT COUNT(*) AS n FROM sync_outbox').get()).toEqual(outbox); // 同期に載せない

  // 壊れた値は、閉じたものなしとして読む
  db.raw.prepare("UPDATE sync_meta SET value = '{' WHERE key = 'reports.dismissed_pending'").run();
  expect(await r.reports.dismissedPending()).toEqual([]);
});
