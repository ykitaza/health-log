// 「記録で育つ形」に要る値を、DB から集める（読むだけ）。計算は lib/growth.ts の純粋な関数
// 画面からは hooks/data.ts の useGrowthData で使う（ホームの useFocusData と同じ読み方）
import type { Repositories } from '@/db';
import { weeklyGoalsOf } from '@/db/repositories/settings';
import type { DateKey } from './date';
import { big3Assignments, Big3Role } from './exercises';
import { WeeklyGoals } from './goals';
import { GrowthDay, mealGoalReached } from './growth';
import { daySummary, resolveDayType } from './meals';
import { BALANCE_PARTS, balanceAxisOf } from './partBalance';
import { setVolume, TrainingSetRow } from './training';
import type { WeightUnit } from './units';

/** 日付の下限（全期間を読む。DateKey は文字列で比べられる） */
const EARLIEST: DateKey = '0001-01-01';

export type GrowthData = {
  today: DateKey;
  /** 記録のある日だけ（古い順）。growthSeries・growthScore・highlights に渡す */
  days: GrowthDay[];
  /** 筋トレのすべてのセット（highlights に渡す） */
  sets: TrainingSetRow[];
  exerciseNames: Map<string, string>;
  big3: Partial<Record<Big3Role, string>>;
  weights: { date: DateKey; weightKg: number }[];
  /** 日ごとの体脂肪率（%。記録のある日だけ）。成長の記録の「体の変化」に使う */
  bodyFats: { date: DateKey; pct: number }[];
  /** 記録した食事の数（today まで。1回の食事を1と数える） */
  mealCount: number;
  /** 部位の ID → 名前（非表示の部位も）。成長の記録の「部位の積み重ね」に使う */
  partNames: Map<string, string>;
  goalWeightKg: number | null;
  weeklyGoals: WeeklyGoals;
  /** 週の目標の筋トレの回数（growthScore に渡す） */
  weeklyTrainingGoal: number;
  weightUnit: WeightUnit;
};

/** 日ごとの記録を1つにまとめる（日付の順）。純粋な関数 */
export function mergeGrowthDays(input: {
  today: DateKey;
  /** 筋トレのセットの記録がある日 → その日の負荷量（自重だけで 0 の日も入る。入っている日が trained） */
  volumeByDate: Map<DateKey, number>;
  /** 食事を記録した日と、目標に届いたか */
  meals: Map<DateKey, boolean>;
  sleep: { date: DateKey; asleepMin: number }[];
  /** 日ごとの部位ごとのセット数（BALANCE_PARTS の順）。筋トレの日だけ入る */
  partSetsByDate?: Map<DateKey, number[]>;
}): GrowthDay[] {
  const sleepByDate = new Map(input.sleep.map((s) => [s.date, s.asleepMin]));
  const dates = new Set<DateKey>([...input.volumeByDate.keys(), ...input.meals.keys(), ...sleepByDate.keys()]);
  return [...dates].filter((d) => d <= input.today).sort().map((date) => ({
    date,
    trained: input.volumeByDate.has(date),
    volumeKg: input.volumeByDate.get(date) ?? 0,
    mealRecorded: input.meals.has(date),
    mealGoalReached: input.meals.get(date) ?? false,
    sleepMin: sleepByDate.get(date) ?? null,
    ...(input.partSetsByDate?.has(date) ? { partSets: input.partSetsByDate.get(date) } : {}),
  }));
}

/**
 * 日ごとの、部位ごとのセット数（BALANCE_PARTS の順）。1行が1セット。数え方は lib/partBalance.ts の partBalanceBetween と同じ
 * （全期間を1回だけ走査する。日ごとに partBalanceBetween を呼ぶと、日数×セット数の計算になる）。today より後と、知らない部位は数えない
 */
export function partSetsByDate(rows: TrainingSetRow[], partName: (bodyPartId: string) => string, today: DateKey): Map<DateKey, number[]> {
  const out = new Map<DateKey, number[]>();
  for (const r of rows) {
    if (r.date > today) continue;
    const axis = balanceAxisOf(partName(r.bodyPartId));
    if (!axis) continue;
    let day = out.get(r.date);
    if (!day) {
      day = BALANCE_PARTS.map(() => 0);
      out.set(r.date, day);
    }
    day[BALANCE_PARTS.indexOf(axis)] += 1;
  }
  return out;
}

/**
 * 全期間の記録を読む。重くしないため、どの表も1回ずつ読み、日ごとの集計は1回の走査で行う
 * （筋トレ：allSetRows、食事：listRange と日の種類・筋トレの日、睡眠：sleepDays、体重と体脂肪率：listDaily、部位：listBodyParts）
 */
export async function loadGrowthData(r: Repositories, today: DateKey): Promise<GrowthData> {
  const [sets, settings, meals, chosen, trained, goalSummary, sleep, weights, exercises, parts] = await Promise.all([
    r.workouts.allSetRows(), r.settings.get(), r.meals.listRange(EARLIEST, today),
    r.meals.chosenDayTypes(EARLIEST, today), r.meals.trainingDays(EARLIEST, today), r.meals.summaries(today, today),
    r.health.sleepDays(EARLIEST, today), r.body.listDaily(),
    // BIG3 の割り当て（ホームと同じく、非表示の種目も）
    r.catalog.listExercises({ includeHidden: true }),
    r.catalog.listBodyParts({ includeHidden: true }),
  ]);
  const goal = goalSummary.goal;

  const volumeByDate = new Map<DateKey, number>();
  for (const s of sets) {
    if (s.date > today) continue;
    volumeByDate.set(s.date, (volumeByDate.get(s.date) ?? 0) + setVolume(s));
  }

  const mealsByDate = new Map<DateKey, typeof meals>();
  for (const m of meals) {
    const list = mealsByDate.get(m.date);
    if (list) list.push(m); else mealsByDate.set(m.date, [m]);
  }
  const mealDays = new Map<DateKey, boolean>();
  for (const [date, list] of mealsByDate) {
    mealDays.set(date, mealGoalReached(daySummary(date, resolveDayType(chosen.get(date) ?? null, trained.has(date)), list, goal)));
  }

  const partNames = new Map(parts.map((p) => [p.id, p.name]));
  const partSets = partSetsByDate(sets, (id) => partNames.get(id) ?? '', today);

  return {
    today,
    days: mergeGrowthDays({ today, volumeByDate, meals: mealDays, sleep, partSetsByDate: partSets }),
    sets,
    exerciseNames: new Map(exercises.map((e) => [e.id, e.name])),
    big3: big3Assignments(exercises),
    weights: weights.flatMap((d) => (d.weightKg == null ? [] : [{ date: d.date, weightKg: d.weightKg }])),
    bodyFats: weights.flatMap((d) => (d.bodyFatPct == null || d.date > today ? [] : [{ date: d.date, pct: d.bodyFatPct }])),
    mealCount: meals.length,
    partNames,
    goalWeightKg: settings.goalWeightKg,
    weeklyGoals: weeklyGoalsOf(settings),
    weeklyTrainingGoal: settings.weeklyGoalTrainingDays,
    weightUnit: settings.weightUnit,
  };
}
