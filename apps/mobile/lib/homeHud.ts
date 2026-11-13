// ホームの「計器の盤」（刷新 A）の集計：LATEST（直近のトレーニング）・BIG3・LOAD・SLEEP・LOG（週ごとの方眼）・PARTS（部位のレーダー）・FUEL（今日の食事）。
// 画面（components/homeHud.tsx）から切り離し、jest で確かめる。フェーズのデータはまだ使わない（Δ は 28 日前から、週の番号は直近 4 週の通し番号）
import { addDays, DateKey, daysBetween, MONTH_NAMES_EN, weekStart, yearMonth } from './date';
import type { Big3Role } from './exercises';
import { mealGoalReached, personalBestEvents, PersonalBestEvent } from './growth';
import { average } from './health';
import { thisWeekVolume } from './home';
import { DaySummary, DayType, pfcRatio } from './meals';
import { BALANCE_PARTS, BalancePart, balanceAxisOf, partBalanceBetween } from './partBalance';
import type { PartRecovery } from './recoveryMap';
import { big3Trend, daysInMonth, focusByDate, setVolume, trainingDates, TrainingSetRow, volumeBetween } from './training';

/** PARTS の期間（日）。今の 28 日と、その前の 28 日を比べる */
export const PARTS_DAYS = 28;
/** BIG3 の差の基準（日前） */
export const BIG3_DELTA_DAYS = 28;
/** BIG3 の線の幅（週） */
export const BIG3_WEEKS = 16;
/** LOG の週の数 */
export const LOG_WEEKS = 4;
/** SLEEP の目標の線（分） */
export const SLEEP_GOAL_MIN = 7 * 60;

// ---- LATEST ----

export type LatestSession = {
  date: DateKey;
  /** 種目の数・セットの数・合計負荷量（kg） */
  exercises: number;
  sets: number;
  volumeKg: number;
  /** その日に自己ベストを更新した種目（その種目の最初の日は数えない） */
  prs: PersonalBestEvent[];
};

/**
 * 直近のトレーニング：upTo（今日）までで、いちばん新しい記録の日のまとめ。記録がなければ null。
 * 負荷量は回数だけの種目も自重の負荷で足す（記録の画面のまとめと同じ）
 */
export function latestSession(rows: TrainingSetRow[], upTo: DateKey): LatestSession | null {
  let date: DateKey | null = null;
  for (const r of rows) if (r.date <= upTo && (date == null || r.date > date)) date = r.date;
  if (date == null) return null;
  const day = rows.filter((r) => r.date === date);
  return {
    date,
    exercises: new Set(day.map((r) => r.exerciseId)).size,
    sets: day.length,
    volumeKg: day.reduce((a, r) => a + setVolume(r), 0),
    prs: personalBestEvents(rows, date).filter((e) => e.date === date),
  };
}

// ---- BIG3 ----

export type Big3Gauge = {
  /** B・S・D の今の推定1RM（kg。記録がなければ null） */
  lifts: { role: Big3Role; kg: number | null }[];
  totalKg: number;
  /** 差（kg）と、その基準：28D（28 日前）か START（記録が 28 日に満たないので、16 週の中の最初の点） */
  deltaKg: number | null;
  deltaBase: '28D' | 'START';
  /** 16 週の線の点（x は 0〜1。合計はその日までの最高の推定1RM の和なので、右へ下がらない） */
  points: { x: number; kg: number }[];
  /** 線の始まり・自己ベスト・今の点の番号（points の中）。自己ベストは今と同じ点になることが多い */
  start: number;
  best: number;
  now: number;
};

/** BIG3 の計器：今の合計と B・S・D、28 日前からの差、16 週の線。1 種目も記録がなければ null（筋トレの推移と同じ big3Trend） */
export function big3Gauge(rows: TrainingSetRow[], assignments: Partial<Record<Big3Role, string>>, today: DateKey): Big3Gauge | null {
  const from = addDays(today, -BIG3_WEEKS * 7);
  const trend = big3Trend(rows, assignments, today, from);
  if (trend.total == null || trend.points.length === 0) return null;
  const span = daysBetween(from, today);
  const points = trend.points.map((p) => ({ x: daysBetween(from, p.date) / span, kg: p.total }));
  const baseDate = addDays(today, -BIG3_DELTA_DAYS);
  const base = trend.points.filter((p) => p.date <= baseDate).pop();
  const deltaBase = base ? '28D' : 'START';
  const ref = base ?? trend.points[0];
  let best = 0;
  points.forEach((p, i) => { if (p.kg >= points[best].kg) best = i; });
  return {
    lifts: trend.lifts.map((l) => ({ role: l.role, kg: l.current })),
    totalKg: trend.total,
    deltaKg: trend.points.length > 1 || base ? trend.total - ref.total : null,
    deltaBase,
    points,
    start: 0,
    best,
    now: points.length - 1,
  };
}

// ---- LOAD ----

export type LoadGauge = {
  /** 今週（月〜日）の日ごとの負荷量（kg）。今日より後は null */
  thisWeek: (number | null)[];
  /** 先週の日ごとの負荷量（kg） */
  lastWeek: number[];
  /** 今週の月曜から今日まで（ホームの今までの「合計負荷量／今週」と同じ） */
  totalKg: number;
  /** 先週の同じ曜日まで（月曜〜今日と同じ曜日）と比べた増減（%）。先週のその分が 0 なら null */
  vsLastWeekPct: number | null;
};

export function loadGauge(rows: TrainingSetRow[], today: DateKey): LoadGauge {
  const mon = weekStart(today);
  const lastMon = addDays(mon, -7);
  const thisWeek = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(mon, i);
    return d > today ? null : volumeBetween(rows, d, d);
  });
  const lastWeek = Array.from({ length: 7 }, (_, i) => { const d = addDays(lastMon, i); return volumeBetween(rows, d, d); });
  const totalKg = thisWeekVolume(rows, today);
  const lastToDate = volumeBetween(rows, lastMon, addDays(today, -7));
  return { thisWeek, lastWeek, totalKg, vsLastWeekPct: lastToDate > 0 ? Math.round((totalKg / lastToDate - 1) * 100) : null };
}

// ---- SLEEP ----

export type SleepGauge = {
  /** 昨夜（今日に起きた分。なければ null） */
  lastNightMin: number | null;
  /** 今日までの 7 日（古い順。記録がない日は null） */
  days: { date: DateKey; min: number | null }[];
  /** 記録のある日の平均（分。なければ null） */
  averageMin: number | null;
  goalMin: number;
};

/** 睡眠は起きた日でまとめてある（Health Connect の取り込み）。今日の分が昨夜 */
export function sleepGauge(sleep: { date: DateKey; asleepMin: number }[], today: DateKey): SleepGauge {
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(today, i - 6);
    return { date, min: sleep.find((s) => s.date === date)?.asleepMin ?? null };
  });
  return {
    lastNightMin: days[6].min,
    days,
    averageMin: average(days.flatMap((d) => (d.min == null ? [] : [d.min]))),
    goalMin: SLEEP_GOAL_MIN,
  };
}

// ---- LOG ----

/** 部位の頭文字（方眼のマスの右下）。レーダーの軸に当たれば軸の 1 文字目（背中 → 背、上腕三頭筋 → 腕）、なければ名前の 1 文字目 */
export function partInitial(part: string): string {
  const axis = balanceAxisOf(part);
  return (axis ?? part.trim()).slice(0, 1);
}

export type LogCell = {
  date: DateKey;
  day: number;
  /** 今日より後（中身を出さない） */
  future: boolean;
  today: boolean;
  /** 負荷量（kg）と、塗りの濃さの段（0 は記録なし、1〜3） */
  volumeKg: number;
  level: 0 | 1 | 2 | 3;
  /** その日の主な部位（なければ null）と頭文字。今日がまだなら、おすすめの部位（suggested） */
  part: string | null;
  initial: string | null;
  suggested: boolean;
  /** 食事の目標を達成した（カロリーとたんぱく質が目標の 90% 以上。成長スコアと同じ） */
  mealGoal: boolean;
  /** 体重を測った */
  weighed: boolean;
  /** ケガをした日 */
  injury: boolean;
};

export type LogWeek = { label: string; current: boolean; cells: LogCell[] };

export type LogInput = {
  rows: TrainingSetRow[];
  partName: (bodyPartId: string) => string;
  /** 方眼の期間の食事のまとめ（日ごと） */
  meals: Pick<DaySummary, 'date' | 'meals' | 'total' | 'target'>[];
  /** 体重を測った日 */
  weighed: Set<DateKey>;
  /** ケガをした日 */
  injured: Set<DateKey>;
  /** 今日がまだのときのおすすめの部位 */
  suggest: string | null;
};

/** 方眼の最初の日（直近 4 週の月曜） */
export const logFrom = (today: DateKey) => addDays(weekStart(today), -7 * (LOG_WEEKS - 1));

/** 塗りの段：方眼の中でいちばん多い日を 3 として、3 等分 */
export function volumeLevel(volumeKg: number, maxKg: number): 0 | 1 | 2 | 3 {
  if (volumeKg <= 0 || maxKg <= 0) return 0;
  const r = volumeKg / maxKg;
  return r <= 1 / 3 ? 1 : r <= 2 / 3 ? 2 : 3;
}

/** 週ごとの方眼（直近 4 週、月曜始まり、古い週が上）。週の名前は W1〜W4（直近の週の通し番号。フェーズが入ったらフェーズの週に変える） */
export function logGrid(input: LogInput, today: DateKey): LogWeek[] {
  const from = logFrom(today);
  const dates = Array.from({ length: LOG_WEEKS * 7 }, (_, i) => addDays(from, i));
  const inRange = input.rows.filter((r) => r.date >= from && r.date <= today);
  const volumes = new Map<DateKey, number>();
  for (const r of inRange) volumes.set(r.date, (volumes.get(r.date) ?? 0) + setVolume(r));
  const max = Math.max(0, ...volumes.values());
  const focus = new Map(focusByDate(inRange, input.partName).map((d) => [d.date, d.parts[0]]));
  const meals = new Map(input.meals.map((m) => [m.date, m]));
  const cells = dates.map((date): LogCell => {
    const future = date > today;
    const isToday = date === today;
    const trained = inRange.some((r) => r.date === date);
    const own = focus.get(date) ?? null;
    const suggested = isToday && !trained && input.suggest != null;
    const part = future ? null : own ?? (suggested ? input.suggest : null);
    const meal = meals.get(date);
    const volumeKg = volumes.get(date) ?? 0;
    return {
      date, day: Number(date.slice(8)), future, today: isToday,
      volumeKg, level: future ? 0 : trained ? Math.max(1, volumeLevel(volumeKg, max)) as 1 | 2 | 3 : 0,
      part, initial: part ? partInitial(part) : null, suggested,
      mealGoal: !future && meal != null && mealGoalReached(meal),
      weighed: !future && input.weighed.has(date),
      injury: !future && input.injured.has(date),
    };
  });
  return Array.from({ length: LOG_WEEKS }, (_, w) => ({
    label: `W${w + 1}`, current: w === LOG_WEEKS - 1, cells: cells.slice(w * 7, w * 7 + 7),
  }));
}

/** 方眼の右上：今月の英字（NOV）、今月の筋トレの日数、今月の合計負荷量（kg） */
export function monthSummary(rows: TrainingSetRow[], today: DateKey): { month: string; days: number; volumeKg: number } {
  const { year, month } = yearMonth(today);
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  const dates = trainingDates(rows.filter((r) => r.date <= today));
  return { month: MONTH_NAMES_EN[month - 1].slice(0, 3).toUpperCase(), days: daysInMonth(dates, year, month), volumeKg: volumeBetween(rows, first, today) };
}

/** マスの読み上げ：「11月6日 金曜、筋トレ 2.4トン 胸、食事の目標を達成、体重を測った、ケガ」 */
export function logCellLabel(c: LogCell, dateText: string, volumeText: string): string {
  if (c.future) return `${dateText}、これから`;
  return [
    dateText + (c.today ? ' 今日' : ''),
    c.level > 0 ? `筋トレ ${volumeText}${c.part ? ` ${c.part}` : ''}` : c.suggested && c.part ? `おすすめ ${c.part}` : '筋トレなし',
    c.mealGoal ? '食事の目標を達成' : '',
    c.weighed ? '体重を測った' : '',
    c.injury ? 'ケガ' : '',
  ].filter(Boolean).join('、');
}

// ---- PARTS ----

export type PartState = 'injury' | 'recovering' | null;

export type PartsRadar = {
  /** 軸ごと（BALANCE_PARTS の順）の、今の 28 日と前の 28 日のセット数 */
  sets: number[];
  prevSets: number[];
  /** 頂点の長さ（2 つの期間で同じ最大にそろえ、平方根で。0〜1） */
  ratios: number[];
  prevRatios: number[];
  /** 増減の向き */
  trend: ('up' | 'down' | 'flat')[];
  /** 今の 28 日でいちばん少ない軸（記録がなければ null） */
  low: BalancePart | null;
  total: number;
};

export function partsRadar(rows: TrainingSetRow[], partName: (bodyPartId: string) => string, today: DateKey): PartsRadar {
  const cur = partBalanceBetween(rows, partName, addDays(today, -(PARTS_DAYS - 1)), today);
  const prev = partBalanceBetween(rows, partName, addDays(today, -(PARTS_DAYS * 2 - 1)), addDays(today, -PARTS_DAYS));
  const max = Math.max(...cur.sets, ...prev.sets);
  const ratio = (n: number) => (max > 0 ? Math.sqrt(n) / Math.sqrt(max) : 0);
  let low: BalancePart | null = null;
  if (cur.total > 0) {
    let i = 0;
    cur.sets.forEach((n, j) => { if (n < cur.sets[i]) i = j; });
    low = BALANCE_PARTS[i];
  }
  return {
    sets: cur.sets, prevSets: prev.sets, ratios: cur.sets.map(ratio), prevRatios: prev.sets.map(ratio),
    trend: cur.sets.map((n, i) => (n > prev.sets[i] ? 'up' : n < prev.sets[i] ? 'down' : 'flat')),
    low, total: cur.total,
  };
}

/** 軸ごとの状態：ケガ（直している途中）があれば injury、回復中なら recovering。部位の名前を軸に寄せる（上腕二頭筋・三頭筋 → 腕） */
export function partStates(list: PartRecovery[], hurt: (p: PartRecovery) => boolean): PartState[] {
  return BALANCE_PARTS.map((axis) => {
    const own = list.filter((p) => balanceAxisOf(p.name) === axis);
    if (own.some(hurt)) return 'injury';
    return own.some((p) => p.level > 0) ? 'recovering' : null;
  });
}

// ---- FUEL ----

export type FuelGauge = {
  kcal: number;
  kcalTarget: number | null;
  dayType: DayType;
  /** PFC の kcal の割合（%）。何も食べていなければ null */
  ratio: { p: number; f: number; c: number } | null;
  grams: { key: 'P' | 'F' | 'C'; g: number; target: number | null }[];
};

export function fuelGauge(d: Pick<DaySummary, 'dayType' | 'total' | 'target'>): FuelGauge {
  return {
    kcal: d.total.kcal,
    kcalTarget: d.target?.kcal ?? null,
    dayType: d.dayType,
    ratio: pfcRatio(d.total),
    grams: [
      { key: 'P', g: d.total.protein_g, target: d.target?.protein_g ?? null },
      { key: 'F', g: d.total.fat_g, target: d.target?.fat_g ?? null },
      { key: 'C', g: d.total.carbs_g, target: d.target?.carbs_g ?? null },
    ],
  };
}
