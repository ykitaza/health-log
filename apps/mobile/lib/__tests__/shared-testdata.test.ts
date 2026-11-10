// サーバー（services/training）と同じテストのデータ（testdata/training/*.json）で、アプリの計算を確かめる。
// 両方で同じ結果になることを、小数の誤差まで（toEqual で）確かめる。
import * as fs from 'fs';
import * as path from 'path';
import { bmi, dailyBodyValues, fatMass, goalProgress, leanMass, weeklyPace } from '../body';
import { defaultRatio, missingBodyweight, weightOn, withBodyweight } from '../bodyweight';
import { big3Assignments, Big3Role } from '../exercises';
import type { RecordType } from '../sets';
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

describe('bodyweight.json：自重の種目の負荷量（体重 × 割合 × 回数）', () => {
  const data = load('bodyweight.json');
  const weights = data.weights.map((w: { date: string; weight_kg: number }) => ({ date: w.date, weightKg: w.weight_kg }));
  const rows = withBodyweight(
    (data.rows as (Row & { bodyweight_ratio: number | null })[]).map((r) => ({ ...toRow(r), bodyweightRatio: r.bodyweight_ratio })),
    weights,
  );
  const e = data.expected;

  test('名前から決める割合', () => {
    for (const c of data.default_ratio) expect([c.name, defaultRatio(c.name)]).toEqual([c.name, c.expected]);
  });

  test('その日の体重（なければ30日以内のいちばん近い前の日）', () => {
    for (const c of data.weight_on) expect([c.date, weightOn(weights, c.date)]).toEqual([c.date, c.expected]);
  });

  test('セットごとの自重の負荷と負荷量、合計', () => {
    expect(rows.map((r) => r.bodyweightLoadKg ?? null)).toEqual(e.bodyweight_load_kg);
    expect(rows.map((r) => setVolume(r))).toEqual(e.volumes);
    expect(totalVolume(rows)).toEqual(e.total_volume);
    expect(periodTotals(rows, data.today)).toEqual(e.period_totals);
    expect(weeklyVolumes(rows, data.today, e.weekly_volumes.weeks)).toEqual(e.weekly_volumes.result);
    const byPart = e.weekly_volume_by_body_part.result.map(
      (w: { week_start: string; by_part: Record<string, number>; total: number }) => ({ weekStart: w.week_start, byPart: w.by_part, total: w.total }));
    expect(weeklyVolumeByBodyPart(rows, data.today, e.weekly_volume_by_body_part.weeks)).toEqual(byPart);
    for (const [exerciseId, points] of Object.entries(e.exercise_daily_series)) {
      const expected = (points as { date: string; volume: number; max_1rm: number }[]).map((p) => ({ date: p.date, volume: p.volume, max1RM: p.max_1rm }));
      expect(exerciseDailySeries(rows, exerciseId)).toEqual(expected);
    }
  });

  test('自重の種目は推定1RM・自己ベストを出さない。体重がなくて入らなかったセットを数える', () => {
    expect(Object.keys(Object.fromEntries(personalBests(rows))).sort()).toEqual(Object.keys(e.personal_bests).sort());
    expect(missingBodyweight(rows)).toBe(e.missing_bodyweight);
  });
});

describe('body.json', () => {
  const data = load('body.json');

  test('BMI・体脂肪量・除脂肪体重', () => {
    for (const c of data.bmi) expect(bmi(c.weight_kg, c.height_cm)).toEqual(c.expected);
    for (const c of data.fat_mass) expect(fatMass(c.weight_kg, c.pct)).toEqual(c.expected);
    for (const c of data.lean_mass) expect(leanMass(c.weight_kg, c.pct)).toEqual(c.expected);
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

  test('1日に1つの値（手入力が先、取り込みは手入力の値がない項目だけ）', () => {
    const records = data.daily_body_values.records.map((r: any) => ({
      date: r.date, measuredAt: r.measured_at, updatedAt: r.updated_at, weightKg: r.weight_kg,
      bodyFatPct: r.body_fat_pct, memo: r.memo, source: r.source,
    }));
    const expected = data.daily_body_values.expected.map((d: any) => ({
      date: d.date, weightKg: d.weight_kg, bodyFatPct: d.body_fat_pct, memo: d.memo,
    }));
    const daily = dailyBodyValues(records);
    expect(daily.map(({ imported: _, ...v }) => v)).toEqual(expected);
    // 取り込みの値を出している項目（体組成の画面の印）
    const names: Record<string, string> = { weightKg: 'weight_kg', bodyFatPct: 'body_fat_pct' };
    expect(Object.fromEntries(daily.filter((d) => d.imported).map((d) => [d.date, d.imported!.map((f) => names[f])])))
      .toEqual(data.daily_body_values.expected_imported);
  });
});

describe('big3.json：BIG3 の役と種目の対応（割り当てがなければ名前で決める）', () => {
  type Case = {
    name: string;
    exercises: { id: string; name: string; hidden?: boolean; record_type?: RecordType; big3?: Big3Role }[];
    expected: Partial<Record<Big3Role, string>>;
  };
  const cases: Case[] = load('big3.json').cases;
  test.each(cases)('$name', ({ exercises, expected }) => {
    expect(big3Assignments(exercises.map((e) => ({
      id: e.id, name: e.name, hidden: e.hidden ?? false, recordType: e.record_type ?? 'weight_reps', big3: e.big3 ?? null,
    })))).toEqual(expected);
  });
});
