// サーバー（services/training）と同じテストのデータ（testdata/training/*.json）で、アプリの計算を確かめる。
// 両方で同じ結果になることを、小数の誤差まで（toEqual で）確かめる。
import * as fs from 'fs';
import * as path from 'path';
import { bmi, dailyBodyValues, fatMass, goalProgress, leanMass, muscleMass, weeklyPace } from '../body';
import {
  bestSet, estimated1RM, exerciseDailySeries, periodTotals, personalBests, rmTable, setVolume, topSet,
  totalVolume, TrainingSetRow, trainingDates, weeklyVolumeByBodyPart, weeklyVolumes,
} from '../training';

const load = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'testdata', 'training', name), 'utf8'));

type SetCase = { weight_kg: number | null; reps: number | null; expected: number };
type Row = { date: string; exercise_id: string; body_part_id: string; weight_kg: number | null; reps: number | null };
const toRow = (r: Row): TrainingSetRow =>
  ({ date: r.date, exerciseId: r.exercise_id, bodyPartId: r.body_part_id, weightKg: r.weight_kg, reps: r.reps });
const toBest = (b: { exercise_id: string; e1rm: number; weight_kg: number; reps: number; date: string }) =>
  ({ exerciseId: b.exercise_id, e1rm: b.e1rm, weightKg: b.weight_kg, reps: b.reps, date: b.date });

describe('estimated_1rm.json', () => {
  const cases: SetCase[] = load('estimated_1rm.json').cases;
  test.each(cases)('$weight_kg kg × $reps 回', ({ weight_kg, reps, expected }) => {
    expect(estimated1RM(weight_kg, reps)).toEqual(expected);
  });
});

describe('set_volume.json', () => {
  const cases: SetCase[] = load('set_volume.json').cases;
  test.each(cases)('$weight_kg kg × $reps 回', ({ weight_kg, reps, expected }) => {
    expect(setVolume({ weightKg: weight_kg, reps })).toEqual(expected);
  });
});

describe('aggregates.json', () => {
  const data = load('aggregates.json');
  const rows: TrainingSetRow[] = data.rows.map(toRow);
  const e = data.expected;

  test('総負荷量・期間の合計', () => {
    expect(totalVolume(rows)).toEqual(e.total_volume);
    expect(periodTotals(rows, data.today)).toEqual(e.period_totals);
  });

  test('週ごとの負荷量', () => {
    expect(weeklyVolumes(rows, data.today, e.weekly_volumes.weeks)).toEqual(e.weekly_volumes.result);
  });

  test('部位ごとの、週ごとの負荷量', () => {
    const expected = e.weekly_volume_by_body_part.result.map(
      (w: { week_start: string; by_part: Record<string, number>; total: number }) =>
        ({ weekStart: w.week_start, byPart: w.by_part, total: w.total }));
    expect(weeklyVolumeByBodyPart(rows, data.today, e.weekly_volume_by_body_part.weeks)).toEqual(expected);
  });

  test('種目ごとの日ごとの推移', () => {
    for (const [exerciseId, points] of Object.entries(e.exercise_daily_series)) {
      const expected = (points as { date: string; volume: number; max_1rm: number }[])
        .map((p) => ({ date: p.date, volume: p.volume, max1RM: p.max_1rm }));
      expect(exerciseDailySeries(rows, exerciseId)).toEqual(expected);
    }
  });

  test('自己ベスト', () => {
    const asObject = (m: Map<string, unknown>) => Object.fromEntries(m);
    const map = (o: Record<string, any>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, toBest(v)]));
    expect(asObject(personalBests(rows))).toEqual(map(e.personal_bests));
    expect(asObject(personalBests(rows, e.personal_bests_before.before))).toEqual(map(e.personal_bests_before.result));
  });

  test('トレーニングした日・ベストのセット・重量が最も大きいセット・RM 表', () => {
    expect(trainingDates(rows)).toEqual(e.training_dates);
    expect(bestSet(rows)).toEqual({ ...rows[e.best_set.index], e1rm: e.best_set.e1rm });
    expect(topSet(rows)).toEqual(rows[e.top_set.index]);
    expect(rmTable(e.rm_table.one_rm)).toEqual(e.rm_table.result);
  });
});

describe('body.json', () => {
  const data = load('body.json');

  test('BMI・体脂肪量・除脂肪体重・筋肉量', () => {
    for (const c of data.bmi) expect(bmi(c.weight_kg, c.height_cm)).toEqual(c.expected);
    for (const c of data.fat_mass) expect(fatMass(c.weight_kg, c.pct)).toEqual(c.expected);
    for (const c of data.lean_mass) expect(leanMass(c.weight_kg, c.pct)).toEqual(c.expected);
    for (const c of data.muscle_mass) expect(muscleMass(c.weight_kg, c.pct)).toEqual(c.expected);
  });

  test('体重のペース', () => {
    for (const c of data.weekly_pace) {
      const points = c.points.map((p: { date: string; weight_kg: number }) => ({ date: p.date, weightKg: p.weight_kg }));
      expect(weeklyPace(points, c.today, c.days)).toEqual(c.expected);
    }
  });

  test('目標体重までの進み具合', () => {
    for (const c of data.goal_progress) {
      expect(goalProgress(c.current_kg, c.goal_kg, c.pace_per_week)).toEqual(c.expected);
    }
  });

  test('1日に1つの値', () => {
    const records = data.daily_body_values.records.map((r: any) => ({
      date: r.date, measuredAt: r.measured_at, updatedAt: r.updated_at, weightKg: r.weight_kg,
      bodyFatPct: r.body_fat_pct, musclePct: r.muscle_pct, waistCm: r.waist_cm, memo: r.memo,
    }));
    const expected = data.daily_body_values.expected.map((d: any) => ({
      date: d.date, weightKg: d.weight_kg, bodyFatPct: d.body_fat_pct, musclePct: d.muscle_pct, waistCm: d.waist_cm, memo: d.memo,
    }));
    expect(dailyBodyValues(records)).toEqual(expected);
  });
});
