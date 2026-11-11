// 「記録で育つ形」の計算（ホームの形・今日の衛星・成長スコア・成長を見る画面が使う）。どれも純粋な関数で、DB は読まない
// （読むのは lib/growthData.ts。画面からは hooks/data.ts の useGrowthData）
import { addDays, DateKey, daysBetween, weekStart } from './date';
import type { Big3Role } from './exercises';
import { goalStreak, WeeklyGoals } from './goals';
import { LONG_SLEEP_MIN } from './health';
import type { DaySummary } from './meals';
import { big3Trend, estimated1RM, trainingDates, TrainingSetRow } from './training';
import { fmt1, kgToUnit, WeightUnit } from './units';

/** その日の記録。記録のない日は渡さなくてよい（growthSeries が埋める）。日付は重ならないこと */
export type GrowthDay = {
  date: DateKey;
  trained: boolean;            // その日に筋トレのセットの記録があるか（自重だけの日も true）
  volumeKg: number;            // その日の筋トレの負荷量の合計（なければ 0）
  mealRecorded: boolean;       // その日に食事の記録があるか
  mealGoalReached: boolean;    // 食事の目標（カロリーとたんぱく質）に届いたか
  sleepMin: number | null;     // 睡眠（分）。記録がなければ null
};

/** 形を描く値。その日までの累計 */
export type GrowthParams = { volumeKg: number; foodDays: number; sleepDays: number; days: number };

export type SatState = 'none' | 'dim' | 'bright';

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

/**
 * 最初の記録の日から today までの毎日について、その日までの累計。記録のない日も埋める（休んでも値は減らない）。
 * 配列の i 番目は、最初の記録の日の i 日後。days は最初の記録の日を 1 と数える（最後の要素の days ＝ 日数）。
 * sleepDays は 7時間（420分）以上寝た日数。記録が1つもなければ空の配列
 */
export function growthSeries(days: GrowthDay[], today: DateKey): GrowthParams[] {
  const start = firstRecordDate(days, today);
  if (start == null) return [];
  const byDate = new Map(days.map((d) => [d.date, d]));
  const out: GrowthParams[] = [];
  let volumeKg = 0;
  let foodDays = 0;
  let sleepDays = 0;
  const n = daysBetween(start, today) + 1;
  for (let i = 0; i < n; i++) {
    const d = byDate.get(addDays(start, i));
    if (d) {
      volumeKg += d.volumeKg;
      if (d.mealRecorded && d.mealGoalReached) foodDays++;
      if (d.sleepMin != null && d.sleepMin >= LONG_SLEEP_MIN) sleepDays++;
    }
    out.push({ volumeKg, foodDays, sleepDays, days: i + 1 });
  }
  return out;
}

/** 今日の衛星の状態（形のまわりの3つ） */
export function satellites(day: GrowthDay | null | undefined): { training: SatState; meal: SatState; sleep: SatState } {
  if (!day) return { training: 'none', meal: 'none', sleep: 'none' };
  return {
    training: day.trained ? 'bright' : 'none',
    meal: !day.mealRecorded ? 'none' : day.mealGoalReached ? 'bright' : 'dim',
    sleep: day.sleepMin == null ? 'none' : day.sleepMin >= LONG_SLEEP_MIN ? 'bright' : 'dim',
  };
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
  const meal = meals.length === 0 ? null : (meals.filter((d) => d.mealGoalReached).length / meals.length) * SCORE_MAX.meal;

  // 睡眠 30点：記録のある日の平均 ÷ 7時間（上限 1）
  const sleeps = week.flatMap((d) => (d.sleepMin == null ? [] : [d.sleepMin]));
  const sleep = sleeps.length === 0 ? null : clamp01(sleeps.reduce((a, b) => a + b, 0) / sleeps.length / LONG_SLEEP_MIN) * SCORE_MAX.sleep;

  const pillars = [
    { points: training, max: SCORE_MAX.training },
    { points: meal, max: SCORE_MAX.meal },
    { points: sleep, max: SCORE_MAX.sleep },
  ];
  const live = pillars.filter((p) => p.points != null);
  const total = Math.round((live.reduce((a, p) => a + p.points!, 0) / live.reduce((a, p) => a + p.max, 0)) * 100);
  return { total, training: pillars[0], meal: pillars[1], sleep: pillars[2] };
}

/**
 * 直近7日（today を含む）の成長スコア（0〜100 点）と内訳。
 * weeklyTrainingGoal：週の目標の筋トレの回数（未設定・0 以下なら 3 回とみなす）
 */
export function growthScore(days: GrowthDay[], today: DateKey, weeklyTrainingGoal: number | null = null): GrowthScore {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const target = weeklyTrainingGoal != null && weeklyTrainingGoal > 0 ? weeklyTrainingGoal : DEFAULT_WEEKLY_TRAINING;
  const now = scoreAt(byDate, today, target);
  const lastWeekEnd = addDays(today, -7);
  const first = firstRecordDate(days, today);
  const diffFromLastWeek = first != null && first <= lastWeekEnd ? now.total - scoreAt(byDate, lastWeekEnd, target).total : null;
  return { ...now, diffFromLastWeek };
}

export type PlaybackSpeed = 1 | 2 | 4;

/** 再生の長さ（秒）。1x は 日数 × 0.5秒（最短 8秒、最長 30秒）、2x は半分、4x は4分の1 */
export function playbackSeconds(dayCount: number, speed: PlaybackSpeed = 1): number {
  return Math.min(30, Math.max(8, dayCount * 0.5)) / speed;
}

export type HighlightKind = 'goalWeight' | 'big3Total' | 'trainingCount' | 'personalBest' | 'goalStreak';

/** 再生中に出す出来事。priority は大きいほど大事（goalWeight 5 > big3Total 4 > trainingCount 3 > personalBest 2 > goalStreak 1） */
export type Highlight = { date: DateKey; kind: HighlightKind; text: string; priority: number };

const PRIORITY: Record<HighlightKind, number> = { goalWeight: 5, big3Total: 4, trainingCount: 3, personalBest: 2, goalStreak: 1 };
/** BIG3 の推定1RM の合計の節目（kg） */
export const BIG3_STEP_KG = 50;
/** 目標の連続達成を出す週数 */
export const STREAK_MILESTONES = [2, 4, 8, 12, 26, 52];
/** 自己ベストの比べで、同じ値とみなす差 */
const EPS = 1e-9;

/** 筋トレの回数の節目：10・25・50・100、以後 100 ごと */
export function isTrainingCountMilestone(n: number): boolean {
  return n === 10 || n === 25 || n === 50 || (n >= 100 && n % 100 === 0);
}

export type HighlightInput = {
  today: DateKey;
  /** 筋トレのすべてのセット（db の workouts.allSetRows） */
  sets: TrainingSetRow[];
  /** 食事の記録と睡眠（連続達成を見るため。growthSeries と同じ GrowthDay[]） */
  days: GrowthDay[];
  /** 種目の ID → 名前 */
  exerciseNames: ReadonlyMap<string, string>;
  /** BIG3 の役 → 種目の ID（lib/exercises.ts の big3Assignments） */
  big3: Partial<Record<Big3Role, string>>;
  /** 日ごとの体重と目標体重 */
  weights: { date: DateKey; weightKg: number }[];
  goalWeightKg: number | null;
  /** 今週の目標（設定） */
  weeklyGoals: WeeklyGoals;
  /** 文言の重さの単位（既定 kg） */
  unit?: WeightUnit;
};

/**
 * 再生中に字幕で出す出来事の一覧。日付の古い順（同じ日は優先度の高い順）。
 * 目標体重に届いた／BIG3 の推定1RM の合計が 50kg の節目を超えた／筋トレの回数の節目／種目の自己ベスト／目標の連続達成
 */
export function highlights(input: HighlightInput): Highlight[] {
  const { today, exerciseNames } = input;
  const unit = input.unit ?? 'kg';
  const w = (kg: number) => `${fmt1(kgToUnit(kg, unit))} ${unit}`;
  const out: Highlight[] = [];
  const add = (date: DateKey, kind: HighlightKind, text: string) => out.push({ date, kind, text, priority: PRIORITY[kind] });
  const sets = input.sets.filter((s) => s.date <= today);

  // 目標体重：最初の体重から見て目標の向きに、はじめて目標に届いた日
  const weights = input.weights.filter((p) => p.date <= today).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (input.goalWeightKg != null && weights.length > 0) {
    const goal = input.goalWeightKg;
    const dir = Math.sign(goal - weights[0].weightKg);
    const hit = dir === 0 ? undefined : weights.find((p) => (dir < 0 ? p.weightKg <= goal : p.weightKg >= goal));
    if (hit) add(hit.date, 'goalWeight', `目標体重 ${w(goal)} に到達`);
  }

  // BIG3 の推定1RM の合計の節目
  if (sets.length > 0) {
    const from = sets.reduce((a, s) => (s.date < a ? s.date : a), today);
    let reachedStep = 0;
    for (const p of big3Trend(sets, input.big3, today, from).points) {
      const step = Math.floor(p.total / BIG3_STEP_KG);
      if (step > reachedStep) {
        reachedStep = step;
        add(p.date, 'big3Total', `BIG3 合計 ${w(step * BIG3_STEP_KG)} 突破`);
      }
    }
  }

  // 筋トレの回数の節目（セットの記録がある日を、古い順に数える）
  trainingDates(sets).forEach((date, i) => {
    if (isTrainingCountMilestone(i + 1)) add(date, 'trainingCount', `筋トレ ${i + 1}回目`);
  });

  // 自己ベスト：その日の種目の最高の推定1RM が、前の最高を超えた日。前に記録がない種目は数えない（lib/goals.ts の dailyAchievement と同じ）
  const byDate = new Map<DateKey, Map<string, number>>();
  for (const s of sets) {
    const e = estimated1RM(s.weightKg, s.reps);
    if (e <= 0) continue;
    const day = byDate.get(s.date) ?? new Map<string, number>();
    day.set(s.exerciseId, Math.max(day.get(s.exerciseId) ?? 0, e));
    byDate.set(s.date, day);
  }
  const best = new Map<string, number>();
  for (const date of [...byDate.keys()].sort()) {
    for (const [id, e] of byDate.get(date)!) {
      const prev = best.get(id);
      if (prev != null && e > prev + EPS) add(date, 'personalBest', `${exerciseNames.get(id) ?? '種目'} 自己ベスト ${w(e)}`);
      if (prev == null || e > prev) best.set(id, e);
    }
  }

  // 目標の連続達成：週の終わり（今週は today）に、連続の週数が節目になった日
  const first = firstRecordDate(input.days, today);
  if (first != null) {
    const mealDates = input.days.filter((d) => d.mealRecorded).map((d) => d.date);
    const sleep = input.days.flatMap((d) => (d.sleepMin == null ? [] : [{ date: d.date, asleepMin: d.sleepMin }]));
    const trainDates = trainingDates(sets);
    for (let start = weekStart(first); start <= weekStart(today); start = addDays(start, 7)) {
      const date = addDays(start, 6) < today ? addDays(start, 6) : today;
      const s = goalStreak({ date, goals: input.weeklyGoals, trainingDates: trainDates, mealDates, sleep });
      if (s.thisWeek && STREAK_MILESTONES.includes(s.weeks)) add(date, 'goalStreak', `${s.weeks}週連続で目標達成`);
    }
  }

  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : b.priority - a.priority));
}

/** 字幕を出す間隔（再生の秒）。この間に1つまで */
export const SUBTITLE_SECONDS = 3;

export type Subtitle = Highlight & { atSec: number };

/**
 * 再生で実際に出す字幕。startDate から totalDays 日ぶん（最初の記録の日〜今日）の再生を、speed で見るとき。
 * - 出すのは 3秒に1つまで（再生の秒で区切り、同じ3秒に重なったら優先度の高いもの。同じなら早い日）
 * - 4x では字幕を1つも出さない（subtitles は空）
 * - markDates：つまみの点を光らせる日（範囲内のハイライトの日。重ならず古い順。どの速さでも返す）
 */
export function pickSubtitles(items: Highlight[], totalDays: number, speed: PlaybackSpeed, startDate: DateKey): { subtitles: Subtitle[]; markDates: DateKey[] } {
  const inRange = items.filter((h) => {
    const i = daysBetween(startDate, h.date);
    return i >= 0 && i < totalDays;
  });
  const markDates = [...new Set(inRange.map((h) => h.date))].sort();
  if (speed === 4) return { subtitles: [], markDates };
  const duration = playbackSeconds(totalDays, speed);
  const span = Math.max(1, totalDays - 1);
  const chosen = new Map<number, Subtitle>();
  for (const h of [...inRange].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) {
    const atSec = (daysBetween(startDate, h.date) / span) * duration;
    const bucket = Math.floor(atSec / SUBTITLE_SECONDS);
    const cur = chosen.get(bucket);
    if (!cur || h.priority > cur.priority) chosen.set(bucket, { ...h, atSec });
  }
  return { subtitles: [...chosen.values()].sort((a, b) => a.atSec - b.atSec), markDates };
}

/** date より前のいちばん近いハイライトの日。なければ null */
export function prevHighlight(items: Highlight[], date: DateKey): DateKey | null {
  let best: DateKey | null = null;
  for (const h of items) if (h.date < date && (best == null || h.date > best)) best = h.date;
  return best;
}

/** date より後のいちばん近いハイライトの日。なければ null */
export function nextHighlight(items: Highlight[], date: DateKey): DateKey | null {
  let best: DateKey | null = null;
  for (const h of items) if (h.date > date && (best == null || h.date < best)) best = h.date;
  return best;
}
