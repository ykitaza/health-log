// 今週の目標と、週・日の達成（ホーム・レポートの画面が使う）。どれも純粋な関数で、DB は読まない
// （読むのは db/repositories/achievements.ts、画面からは hooks/data.ts の useWeeklyAchievement・useDailyAchievement）
import { addDays, DateKey, weekStart } from './date';
import { LONG_SLEEP_MIN } from './health';
import type { DaySummary, DayType } from './meals';
import { estimated1RM, personalBests, setVolume, TrainingSetRow } from './training';

/** 設定の選択肢（設定の画面のチップと、読むときの確かめに使う）。0 は「切」 */
export const WEEKLY_TRAINING_OPTIONS = [2, 3, 4, 5, 6] as const;
export const WEEKLY_MEAL_OPTIONS = [3, 5, 7] as const;
export const WEEKLY_SLEEP_OPTIONS = [0, 3, 4, 5, 7] as const;
export const REST_TIMER_OPTIONS = [0, 60, 90, 120, 180] as const;

export type WeeklyGoals = {
  /** 1週間に筋トレをする回数（日数） */
  trainingDays: number;
  /** 1週間に食事を記録する日数 */
  mealDays: number;
  /** 7時間以上寝る日数。0 は目標なし（切） */
  sleepDays: number;
};

/** その日を含む週（月曜始まり、月〜日）。月曜は lib/date.ts の weekStart */
export function weekOf(date: DateKey): { start: DateKey; end: DateKey } {
  const start = weekStart(date);
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
      sleptEnough: (sleepByDate.get(date) ?? 0) >= LONG_SLEEP_MIN,
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

/** 設定の今週の目標（筋トレの回数・食事を記録した日数・睡眠（切でなければ））が、すべて届いたか。たんぱく質は設定の目標ではないので見ない */
export function allGoalsReached(a: Pick<WeeklyAchievement, 'training' | 'meals' | 'sleep'>): boolean {
  return a.training.reached && a.meals.reached && (a.sleep.goal == null || a.sleep.reached);
}

/** 連続の記録を数える週の上限（今週を含めて1年ぶん） */
export const STREAK_MAX_WEEKS = 52;

/** すべての目標を達成した週が続いている数。thisWeek は今週も達成しているか（していなければ、先週から数える） */
export type GoalStreak = { weeks: number; thisWeek: boolean };

/**
 * 今週から過去へ、週（月曜始まり、lib/date.ts の weekStart）ごとに、その週の目標をすべて達成したかを見て、続いている数を出す。
 * 今週がまだなら先週から数える（今週は途中なので途切れとしない）。過去の週の目標も、いまの設定の値で数える（設定の履歴は持たない）。
 * 数えるのは maxWeeks 週まで（今週を含む）。
 * - trainingDates：筋トレの記録（セット）がある日、mealDates：食事を記録した日、sleep：日ごとの睡眠（起きた日でまとめた分）
 */
export function goalStreak(input: {
  date: DateKey;
  goals: WeeklyGoals;
  trainingDates: Iterable<DateKey>;
  mealDates: Iterable<DateKey>;
  sleep: { date: DateKey; asleepMin: number }[];
  maxWeeks?: number;
}): GoalStreak {
  const trained = new Set(input.trainingDates);
  const meals = new Set(input.mealDates);
  const slept = new Set(input.sleep.filter((s) => s.asleepMin >= LONG_SLEEP_MIN).map((s) => s.date));
  const { goals } = input;
  const reachedWeek = (start: DateKey) => {
    const dates = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    const count = (set: Set<DateKey>) => dates.filter((d) => set.has(d)).length;
    return allGoalsReached({
      training: progress(count(trained), goals.trainingDays),
      meals: progress(count(meals), goals.mealDays),
      sleep: progress(count(slept), goals.sleepDays > 0 ? goals.sleepDays : null),
    });
  };
  const thisWeek = weekStart(input.date);
  const max = input.maxWeeks ?? STREAK_MAX_WEEKS;
  const reachedNow = reachedWeek(thisWeek);
  let weeks = 0;
  for (let i = reachedNow ? 0 : 1; i < max; i++) {
    if (!reachedWeek(addDays(thisWeek, -7 * i))) break;
    weeks++;
  }
  return { weeks, thisWeek: reachedNow };
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
    sleep: { asleepMin, goalMin: LONG_SLEEP_MIN, reached: asleepMin != null && asleepMin >= LONG_SLEEP_MIN },
  };
}
