// 成長スコアの計算（フェーズの記録・振り返り・月のまとめが使う）と、食事の目標に届いた日・自己ベストの更新の数え方。
// どれも純粋な関数で、DB は読まない（読むのは lib/growthData.ts。画面からは hooks/data.ts の useGrowthData）
import { addDays, DateKey } from './date';
import { LONG_SLEEP_MIN } from './health';
import type { DaySummary } from './meals';
import { estimated1RM, TrainingSetRow } from './training';

/** その日の記録。記録のない日は渡さなくてよい。日付は重ならないこと */
export type GrowthDay = {
  date: DateKey;
  trained: boolean;            // その日に筋トレのセットの記録があるか（自重だけの日も true）
  volumeKg: number;            // その日の筋トレの負荷量の合計（なければ 0）
  mealRecorded: boolean;       // その日に食事の記録があるか
  mealGoalReached: boolean;    // 食事の目標（カロリーとたんぱく質）に届いたか
  sleepMin: number | null;     // 睡眠（分）。記録がなければ null
};

/** 食事の目標に届いたとみなす割合（カロリーとたんぱく質の両方が、その日の目標のこれ以上） */
export const MEAL_GOAL_RATIO = 0.9;

/**
 * 食事の目標に届いたか（GrowthDay.mealGoalReached の決まり）。
 * 食事の記録があり、カロリーとたんぱく質の目標がどちらもあり、どちらも目標の 90% 以上のとき。
 * 目標が設定されていない日（目標なし・カロリーかたんぱく質の片方だけ）は、届いたことにしない
 */
export function mealGoalReached(day: Pick<DaySummary, 'meals' | 'total' | 'target'>): boolean {
  const kcal = day.target?.kcal;
  const protein = day.target?.protein_g;
  if (day.meals.length === 0 || kcal == null || protein == null || kcal <= 0 || protein <= 0) return false;
  return day.total.kcal >= kcal * MEAL_GOAL_RATIO && day.total.protein_g >= protein * MEAL_GOAL_RATIO;
}

/** 最初の記録の日（today までで）。記録が1つもなければ null */
export function firstRecordDate(days: GrowthDay[], today: DateKey): DateKey | null {
  let first: DateKey | null = null;
  for (const d of days) if (d.date <= today && (first == null || d.date < first)) first = d.date;
  return first;
}

/** 成長スコアの配点 */
export const SCORE_MAX = { training: 40, meal: 30, sleep: 30 } as const;
/** 筋トレの回数の割合で、週の目標が未設定のときに使う回数 */
export const DEFAULT_WEEKLY_TRAINING = 3;
/** スコアを見る日数 */
export const SCORE_DAYS = 7;
/** 筋トレの負荷量の割合で比べる、その前の週数 */
const BASELINE_WEEKS = 4;

/** 柱ごとの点。points が null のときは、その柱の記録が7日に1日もない（画面では「—」）。点は丸めない */
export type ScorePillar = { points: number | null; max: number };

export type GrowthScore = {
  /** 0〜100 の整数。points が null の柱は外し、残りを 100点満点に換算する */
  total: number;
  training: ScorePillar;
  meal: ScorePillar;
  sleep: ScorePillar;
  /** 先週（7日前で終わる7日）の合計との差。先週が計算できない（最初の記録がそれより後）なら null */
  diffFromLastWeek: number | null;
};

type ScoreCore = Omit<GrowthScore, 'diffFromLastWeek'>;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

function scoreAt(byDate: Map<DateKey, GrowthDay>, end: DateKey, weeklyTarget: number): ScoreCore {
  const range = (from: DateKey, to: DateKey) => {
    const out: GrowthDay[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) { const x = byDate.get(d); if (x) out.push(x); }
    return out;
  };
  const week = range(addDays(end, -(SCORE_DAYS - 1)), end);

  // 筋トレ 40点：回数 20 ＋ 負荷量 20。筋トレの日は、セットの記録がある日
  const trainDays = week.filter((d) => d.trained).length;
  const countRatio = clamp01(trainDays / weeklyTarget);
  const weekVolume = week.reduce((a, d) => a + d.volumeKg, 0);
  const before = range(addDays(end, -(SCORE_DAYS - 1) - BASELINE_WEEKS * 7), addDays(end, -SCORE_DAYS));
  const baseline = before.reduce((a, d) => a + d.volumeKg, 0) / BASELINE_WEEKS;
  const volumeRatio = baseline > 0 ? clamp01(weekVolume / baseline) : countRatio;
  const training = SCORE_MAX.training / 2 * countRatio + SCORE_MAX.training / 2 * volumeRatio;

  // 食事 30点：記録のある日のうち、目標に届いた日の割合（記録のない日は外す）
  const meals = week.filter((d) => d.mealRecorded);
  const mealGoalDays = meals.filter((d) => d.mealGoalReached).length;
  const meal = meals.length === 0 ? null : (mealGoalDays / meals.length) * SCORE_MAX.meal;

  // 睡眠 30点：記録のある日の平均 ÷ 7時間（上限 1）
  const sleeps = week.flatMap((d) => (d.sleepMin == null ? [] : [d.sleepMin]));
  const sleepAvgMin = sleeps.length === 0 ? null : sleeps.reduce((a, b) => a + b, 0) / sleeps.length;
  const sleep = sleepAvgMin == null ? null : clamp01(sleepAvgMin / LONG_SLEEP_MIN) * SCORE_MAX.sleep;

  const pillars = [
    { points: training, max: SCORE_MAX.training },
    { points: meal, max: SCORE_MAX.meal },
    { points: sleep, max: SCORE_MAX.sleep },
  ];
  const live = pillars.filter((p) => p.points != null);
  const total = Math.round((live.reduce((a, p) => a + p.points!, 0) / live.reduce((a, p) => a + p.max, 0)) * 100);
  return { total, training: pillars[0], meal: pillars[1], sleep: pillars[2] };
}

const weeklyTargetOf = (goal: number | null) => (goal != null && goal > 0 ? goal : DEFAULT_WEEKLY_TRAINING);

/**
 * asOf で終わる7日の成長スコア（0〜100 点）と内訳（growthScore の as-of 版）。
 * 月のまとめで「月末時点のスコア」を出すために使う。計算は growthScore とまったく同じで、
 * アンカーの日だけが違う（asOf より後の記録は、scoreAt の範囲と firstRecordDate の上限で見ない）。
 * diffFromLastWeek は asOf の7日前で終わる7日との差（その週が計算できなければ null）
 */
export function growthScoreAsOf(days: GrowthDay[], asOf: DateKey, weeklyTrainingGoal: number | null = null): GrowthScore {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const target = weeklyTargetOf(weeklyTrainingGoal);
  const { total, training, meal, sleep } = scoreAt(byDate, asOf, target);
  const lastWeekEnd = addDays(asOf, -7);
  const first = firstRecordDate(days, asOf);
  const diffFromLastWeek = first != null && first <= lastWeekEnd ? total - scoreAt(byDate, lastWeekEnd, target).total : null;
  return { total, training, meal, sleep, diffFromLastWeek };
}

/**
 * 直近7日（today を含む）の成長スコア（0〜100 点）と内訳。
 * weeklyTrainingGoal：週の目標の筋トレの回数（未設定・0 以下なら 3 回とみなす）
 */
export function growthScore(days: GrowthDay[], today: DateKey, weeklyTrainingGoal: number | null = null): GrowthScore {
  return growthScoreAsOf(days, today, weeklyTrainingGoal);
}

/** 自己ベストの比べで、同じ値とみなす差 */
const EPS = 1e-9;

/** 自己ベストを更新した1回。weightKg × reps はその日の推定1RM が最高のセット（同じ値なら先に記録したセット） */
export type PersonalBestEvent = { date: DateKey; exerciseId: string; weightKg: number; reps: number; e1rm: number };

/**
 * 自己ベストを更新した日の一覧（古い順。同じ日は記録の順）。その日の種目の最高の推定1RM が、前の日までの最高を超えた日。
 * 前に記録がない種目（その種目の最初の日）は数えない（lib/goals.ts の dailyAchievement、再生の字幕と同じ）。today より後は見ない
 */
export function personalBestEvents(sets: TrainingSetRow[], today: DateKey): PersonalBestEvent[] {
  const byDate = new Map<DateKey, Map<string, PersonalBestEvent>>();
  for (const s of sets) {
    if (s.date > today) continue;
    const e = estimated1RM(s.weightKg, s.reps);
    if (e <= 0) continue;
    const day = byDate.get(s.date) ?? new Map<string, PersonalBestEvent>();
    const cur = day.get(s.exerciseId);
    if (!cur || e > cur.e1rm) day.set(s.exerciseId, { date: s.date, exerciseId: s.exerciseId, weightKg: s.weightKg!, reps: s.reps!, e1rm: e });
    byDate.set(s.date, day);
  }
  const out: PersonalBestEvent[] = [];
  const best = new Map<string, number>();
  for (const date of [...byDate.keys()].sort()) {
    for (const [id, ev] of byDate.get(date)!) {
      const prev = best.get(id);
      if (prev != null && ev.e1rm > prev + EPS) out.push(ev);
      if (prev == null || ev.e1rm > prev) best.set(id, ev.e1rm);
    }
  }
  return out;
}
