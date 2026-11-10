// 今週の目標と、週・日の達成（ホーム・レポートの画面が使う）。どれも純粋な関数で、DB は読まない
// （読むのは db/repositories/achievements.ts、画面からは hooks/data.ts の useWeeklyAchievement・useDailyAchievement）
import { addDays, DateKey, weekday } from './date';
import type { DaySummary, DayType } from './meals';
import { estimated1RM, personalBests, setVolume, TrainingSetRow } from './training';

/** 設定の選択肢（設定の画面のチップと、読むときの確かめに使う）。0 は「切」 */
export const WEEKLY_TRAINING_OPTIONS = [2, 3, 4, 5, 6] as const;
export const WEEKLY_MEAL_OPTIONS = [3, 5, 7] as const;
export const WEEKLY_SLEEP_OPTIONS = [0, 3, 4, 5, 7] as const;
export const REST_TIMER_OPTIONS = [0, 60, 90, 120, 180] as const;

/** 7時間以上寝た日を数える（分） */
export const SLEEP_GOAL_MIN = 7 * 60;

export type WeeklyGoals = {
  /** 1週間に筋トレをする回数（日数） */
  trainingDays: number;
  /** 1週間に食事を記録する日数 */
  mealDays: number;
  /** 7時間以上寝る日数。0 は目標なし（切） */
  sleepDays: number;
};

/** その日を含む週（月曜始まり、月〜日） */
export function weekOf(date: DateKey): { start: DateKey; end: DateKey } {
  const start = addDays(date, -((weekday(date) + 6) % 7));
  return { start, end: addDays(start, 6) };
}

/** 目標に対する日数。goal が null なら目標なし（reached は false） */
export type GoalProgress = { days: number; goal: number | null; reached: boolean };

export type WeekDayMark = {
  date: DateKey;
  trained: boolean;
  mealRecorded: boolean;
  /** たんぱく質がその日の目標に届いた。目標がない日は false */
  proteinReached: boolean;
  /** 7時間以上寝た（その日に起きた分の合計） */
  sleptEnough: boolean;
};

export type WeeklyAchievement = {
  start: DateKey;
  end: DateKey;
  /** 筋トレをした日数（セットの記録がある日）。目標は weeklyGoalTrainingDays */
  training: GoalProgress;
  /** 食事を記録した日数。目標は weeklyGoalMealDays */
  meals: GoalProgress;
  /**
   * たんぱく質が目標に届いた日数。目標の日数は食事の記録と同じ（weeklyGoalMealDays）。
   * 食事の目標にたんぱく質がない（週のどの日にも目標がない）ときは null
   */
  protein: GoalProgress | null;
  /** 7時間以上寝た日数。目標が切（0）なら goal は null */
  sleep: GoalProgress;
  /** 月〜日の7日ぶん */
  days: WeekDayMark[];
};

const progress = (days: number, goal: number | null): GoalProgress => ({ days, goal, reached: goal != null && days >= goal });

/**
 * ある日を含む週（月〜日）の達成。
 * - trainingDates：筋トレの記録（セット）がある日（db の meals.trainingDays と同じ）
 * - meals：週の日ごとの食事のまとめ（db の meals.summaries。日の種類ごとの目標が入っている）
 * - sleep：日ごとの睡眠（db の health.sleepDays。起きた日でまとめ、その日の分を足したもの）
 * 週の外の日は数えない
 */
export function weeklyAchievement(input: {
  date: DateKey;
  goals: WeeklyGoals;
  trainingDates: Iterable<DateKey>;
  meals: Pick<DaySummary, 'date' | 'meals' | 'total' | 'target'>[];
  sleep: { date: DateKey; asleepMin: number }[];
}): WeeklyAchievement {
  const { start, end } = weekOf(input.date);
  const trained = new Set(input.trainingDates);
  const mealsByDate = new Map(input.meals.map((d) => [d.date, d]));
  const sleepByDate = new Map(input.sleep.map((s) => [s.date, s.asleepMin]));
  let hasProteinTarget = false;
  const days: WeekDayMark[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(start, i);
    const meal = mealsByDate.get(date);
    const proteinTarget = meal?.target?.protein_g ?? null;
    if (proteinTarget != null) hasProteinTarget = true;
    const recorded = (meal?.meals.length ?? 0) > 0;
    days.push({
      date,
      trained: trained.has(date),
      mealRecorded: recorded,
      proteinReached: recorded && proteinTarget != null && meal!.total.protein_g >= proteinTarget,
      sleptEnough: (sleepByDate.get(date) ?? 0) >= SLEEP_GOAL_MIN,
    });
  }
  const count = (f: (d: WeekDayMark) => boolean) => days.filter(f).length;
  return {
    start,
    end,
    training: progress(count((d) => d.trained), input.goals.trainingDays),
    meals: progress(count((d) => d.mealRecorded), input.goals.mealDays),
    protein: hasProteinTarget ? progress(count((d) => d.proteinReached), input.goals.mealDays) : null,
    sleep: progress(count((d) => d.sleptEnough), input.goals.sleepDays > 0 ? input.goals.sleepDays : null),
    days,
  };
}

export type DailyAchievement = {
  date: DateKey;
  training: {
    /** 合計負荷量（kg） */
    volumeKg: number;
    /** 種目数 */
    exercises: number;
    /** 自己ベスト（推定1RM）を超えた種目の ID。前にその種目の記録がなければ数えない（記録の入力の画面の「自己ベスト」と同じ） */
    personalBestExerciseIds: string[];
  };
  meals: {
    /** 食事を記録したか */
    recorded: boolean;
    dayType: DayType;
    kcal: number;
    proteinG: number;
    /** その日の種類の目標（目標がなければ null） */
    kcalTarget: number | null;
    proteinTarget: number | null;
  };
  sleep: {
    /** 前の夜の睡眠（その日に起きた分の合計、分）。記録がなければ null */
    asleepMin: number | null;
    goalMin: number;
    reached: boolean;
  };
};

/**
 * ある日の達成。
 * - sets：すべてのセット（db の workouts.allSetRows。自己ベストを見るため、前の日の分も渡す）
 * - meal：その日の食事のまとめ（db の meals.summaries(date, date) の1日）
 * - sleep：その日に起きた睡眠（db の health.sleepDay）
 */
export function dailyAchievement(input: {
  date: DateKey;
  sets: TrainingSetRow[];
  meal: Pick<DaySummary, 'dayType' | 'meals' | 'total' | 'target'>;
  sleep: { asleepMin: number } | null;
}): DailyAchievement {
  const { date, meal } = input;
  const today = input.sets.filter((r) => r.date === date);
  const before = personalBests(input.sets, date);
  const best = new Map<string, number>();
  for (const r of today) best.set(r.exerciseId, Math.max(best.get(r.exerciseId) ?? 0, estimated1RM(r.weightKg, r.reps)));
  const personalBestExerciseIds = [...best].filter(([id, e1rm]) => {
    const prev = before.get(id);
    return prev != null && e1rm > prev.e1rm + 1e-9;
  }).map(([id]) => id);
  const asleepMin = input.sleep?.asleepMin ?? null;
  return {
    date,
    training: {
      volumeKg: today.reduce((a, r) => a + setVolume(r), 0),
      exercises: best.size,
      personalBestExerciseIds,
    },
    meals: {
      recorded: meal.meals.length > 0,
      dayType: meal.dayType,
      kcal: meal.total.kcal,
      proteinG: meal.total.protein_g,
      kcalTarget: meal.target?.kcal ?? null,
      proteinTarget: meal.target?.protein_g ?? null,
    },
    sleep: { asleepMin, goalMin: SLEEP_GOAL_MIN, reached: asleepMin != null && asleepMin >= SLEEP_GOAL_MIN },
  };
}
