// 「記録で育つ形」の計算（ホームの形・今日の衛星・成長スコア・成長を見る画面が使う）。どれも純粋な関数で、DB は読まない
// （読むのは lib/growthData.ts。画面からは hooks/data.ts の useGrowthData）
import { addDays, DateKey, daysBetween, weekStart } from './date';
import type { Big3Role } from './exercises';
import { goalStreak, WeeklyGoals } from './goals';
import { LONG_SLEEP_MIN } from './health';
import type { DaySummary } from './meals';
import { BALANCE_PARTS } from './partBalance';
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
  /** その日の部位ごとのセット数（lib/partBalance.ts の BALANCE_PARTS の順に6つ）。省けば 0 */
  partSets?: readonly number[];
};

/**
 * 形を描く値。その日までの累計。partSets は部位ごとのセット数の累計（BALANCE_PARTS の順に6つ。木の枝・銀河の腕が育つ）
 */
export type GrowthParams = { volumeKg: number; foodDays: number; sleepDays: number; days: number; partSets: number[] };

/** 部位のセット数が全部 0 の値（記録がまだないとき） */
export const NO_PART_SETS: readonly number[] = BALANCE_PARTS.map(() => 0);

/** 今日の衛星。none＝点線の軌道だけ、dim＝薄い衛星、bright＝明るく光る衛星 */
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
 * sleepDays は 7時間（420分）以上寝た日数。partSets は部位ごとのセット数の累計。記録が1つもなければ空の配列
 */
export function growthSeries(days: GrowthDay[], today: DateKey): GrowthParams[] {
  const start = firstRecordDate(days, today);
  if (start == null) return [];
  const byDate = new Map(days.map((d) => [d.date, d]));
  const out: GrowthParams[] = [];
  let volumeKg = 0;
  let foodDays = 0;
  let sleepDays = 0;
  const partSets = BALANCE_PARTS.map(() => 0);
  const n = daysBetween(start, today) + 1;
  for (let i = 0; i < n; i++) {
    const d = byDate.get(addDays(start, i));
    if (d) {
      volumeKg += d.volumeKg;
      if (d.mealRecorded && d.mealGoalReached) foodDays++;
      if (d.sleepMin != null && d.sleepMin >= LONG_SLEEP_MIN) sleepDays++;
      d.partSets?.forEach((v, k) => { if (k < partSets.length) partSets[k] += v; });
    }
    out.push({ volumeKg, foodDays, sleepDays, days: i + 1, partSets: [...partSets] });
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

/**
 * スコアの計算の途中の値（成長を見る画面の「成長スコアの内訳」のカードに、柱ごとの数え方として出す）。
 * volumeRatio は前4週の週平均に対する直近7日の負荷量の割合（上限 1）。前4週に負荷量がなければ null（回数の割合で代える）。
 * sleepAvgMin は記録のある日の平均（分、四捨五入しない）。記録がなければ null
 */
export type ScoreDetail = {
  trainDays: number;
  weeklyTarget: number;
  countPoints: number;
  volumeRatio: number | null;
  volumePoints: number;
  mealDays: number;
  mealGoalDays: number;
  sleepAvgMin: number | null;
};

function scoreAt(byDate: Map<DateKey, GrowthDay>, end: DateKey, weeklyTarget: number): ScoreCore & { detail: ScoreDetail } {
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
  const countPoints = SCORE_MAX.training / 2 * countRatio;
  const volumePoints = SCORE_MAX.training / 2 * volumeRatio;
  const training = countPoints + volumePoints;

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
  return {
    total, training: pillars[0], meal: pillars[1], sleep: pillars[2],
    detail: {
      trainDays, weeklyTarget, countPoints, volumeRatio: baseline > 0 ? volumeRatio : null, volumePoints,
      mealDays: meals.length, mealGoalDays, sleepAvgMin,
    },
  };
}

const weeklyTargetOf = (goal: number | null) => (goal != null && goal > 0 ? goal : DEFAULT_WEEKLY_TRAINING);

/** 直近7日（today を含む）のスコアの、柱ごとの数え方（growthScore と同じ計算） */
export function scoreDetail(days: GrowthDay[], today: DateKey, weeklyTrainingGoal: number | null = null): ScoreDetail {
  return scoreAt(new Map(days.map((d) => [d.date, d])), today, weeklyTargetOf(weeklyTrainingGoal)).detail;
}

/** 週ごとの点数の1本。start〜end の7日（end で終わる）の成長スコア */
export type WeekScore = { start: DateKey; end: DateKey; total: number };

/**
 * 週ごとの点数の推移：today で終わる7日を、7日ずつさかのぼって計算する（growthScore と同じ計算）。古い順。
 * 7日の終わりが最初の記録の日以降の週だけ（始めた週から今週まで）。記録が1つもなければ空
 */
export function weeklyScores(days: GrowthDay[], today: DateKey, weeklyTrainingGoal: number | null = null): WeekScore[] {
  const first = firstRecordDate(days, today);
  if (first == null) return [];
  const byDate = new Map(days.map((d) => [d.date, d]));
  const target = weeklyTargetOf(weeklyTrainingGoal);
  const out: WeekScore[] = [];
  for (let end = today; end >= first; end = addDays(end, -SCORE_DAYS)) {
    out.push({ start: addDays(end, -(SCORE_DAYS - 1)), end, total: scoreAt(byDate, end, target).total });
  }
  return out.reverse();
}

/**
 * 直近7日（today を含む）の成長スコア（0〜100 点）と内訳。
 * weeklyTrainingGoal：週の目標の筋トレの回数（未設定・0 以下なら 3 回とみなす）
 */
export function growthScore(days: GrowthDay[], today: DateKey, weeklyTrainingGoal: number | null = null): GrowthScore {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const target = weeklyTargetOf(weeklyTrainingGoal);
  const { total, training, meal, sleep } = scoreAt(byDate, today, target);
  const lastWeekEnd = addDays(today, -7);
  const first = firstRecordDate(days, today);
  const diffFromLastWeek = first != null && first <= lastWeekEnd ? total - scoreAt(byDate, lastWeekEnd, target).total : null;
  return { total, training, meal, sleep, diffFromLastWeek };
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

  // BIG3 の推定1RM の合計の節目（記録がある種目だけの合計。種目が増えた日に、いくつか飛び越えることがあり、その日はいちばん高い節目だけ出る）
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

  // 自己ベスト：その日の種目の最高の推定1RM が、前の最高を超えた日
  for (const pb of personalBestEvents(sets, today)) {
    add(pb.date, 'personalBest', `${exerciseNames.get(pb.exerciseId) ?? '種目'} 自己ベスト ${w(pb.e1rm)}`);
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

/**
 * いちばん長く続いた連続：筋トレした日（セットの記録がある日）が、暦の上で1日も空かずに続いた最長の日数。
 * 同じ日が何度あっても1日と数える。today より後は見ない。記録がなければ 0
 */
export function longestTrainingStreak(dates: DateKey[], today: DateKey): number {
  const sorted = [...new Set(dates.filter((d) => d <= today))].sort();
  let best = 0;
  let run = 0;
  for (let i = 0; i < sorted.length; i++) {
    run = i > 0 && daysBetween(sorted[i - 1], sorted[i]) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return best;
}

/** 字幕を出す間隔（再生の秒）。この間に1つまで */
export const SUBTITLE_SECONDS = 3;

export type Subtitle = Highlight & { atSec: number };

/**
 * 再生で実際に出す字幕。startDate から totalDays 日ぶん（最初の記録の日〜今日）の再生を、speed で見るとき。
 * - 出すのは 3秒に1つまで（再生の秒で区切り、同じ3秒に重なったら優先度の高いもの。同じなら早い日）
 * - markDates：下の線に点を置く日（範囲内のハイライトの日。重ならず古い順）
 */
export function pickSubtitles(items: Highlight[], totalDays: number, speed: PlaybackSpeed, startDate: DateKey): { subtitles: Subtitle[]; markDates: DateKey[] } {
  const inRange = items.filter((h) => {
    const i = daysBetween(startDate, h.date);
    return i >= 0 && i < totalDays;
  });
  const markDates = [...new Set(inRange.map((h) => h.date))].sort();
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
