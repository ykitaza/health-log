import { addDays, daysBetween, DateKey, weekStart, yearMonth, addMonths } from './date';
import { parseNumber } from './units';

/**
 * 1セット分の値（重さは kg。回数だけの種目は weightKg が null）。
 * bodyweightLoadKg は回数だけのセットの負荷（体重 × 種目の割合。lib/bodyweight.ts）。体重がなければ null
 */
export type SetValues = { weightKg: number | null; reps: number | null; bodyweightLoadKg?: number | null };

/** 集計に使う1セット分の行。bodyweightRatio は回数だけの種目の割合（重量×回数の種目は null） */
export type TrainingSetRow = SetValues & {
  date: DateKey;
  exerciseId: string;
  bodyPartId: string;
  bodyweightRatio?: number | null;
};

/**
 * 推定1RM。推定1RM を出すところ（RM計算機、ホーム、その日の画面、自己ベスト、グラフ）はすべてこれを使う。
 * 1回なら重量そのもの、2回以上は Epley 式：重量 ×（1 ＋ 回数 ÷ 30）
 */
export function estimated1RM(weightKg: number | null, reps: number | null): number {
  if (weightKg == null || reps == null || weightKg <= 0 || reps <= 0) return 0;
  if (reps === 1) return weightKg;
  return weightKg * (1 + reps / 30);
}

/** 負荷量（重量 × 回数）。回数だけの種目は、自重の負荷（体重 × 割合）× 回数。自重の負荷がなければ（体重の記録がない）0 */
export function setVolume(s: SetValues): number {
  const load = s.weightKg != null ? s.weightKg : s.bodyweightLoadKg;
  if (load == null || s.reps == null || load <= 0 || s.reps <= 0) return 0;
  return load * s.reps;
}

export function totalVolume(sets: SetValues[]): number {
  return sets.reduce((a, s) => a + setVolume(s), 0);
}

/** 推定1RM が最も大きいセット */
export function bestSet<T extends SetValues>(sets: T[]): (T & { e1rm: number }) | null {
  let best: (T & { e1rm: number }) | null = null;
  for (const s of sets) {
    const e1rm = estimated1RM(s.weightKg, s.reps);
    if (e1rm > 0 && (!best || e1rm > best.e1rm)) best = { ...s, e1rm };
  }
  return best;
}

/** 重量が最も大きいセット（同じ重さなら回数の多いもの）。「前回 80kg × 8」の表示用 */
export function topSet<T extends SetValues>(sets: T[]): T | null {
  let top: T | null = null;
  for (const s of sets) {
    if (!top) { top = s; continue; }
    const w = s.weightKg ?? 0, tw = top.weightKg ?? 0;
    if (w > tw || (w === tw && (s.reps ?? 0) > (top.reps ?? 0))) top = s;
  }
  return top;
}

/**
 * 種目ごとの「前回」：その日まで（その日を含む）でいちばん新しく記録した日と、その日のいちばん重いセット。
 * 過去の日に記録するときは、その日より後の記録は使わない
 */
export function lastTopSets(rows: TrainingSetRow[], date: DateKey): Map<string, { date: DateKey; top: TrainingSetRow }> {
  const byEx = new Map<string, { date: DateKey; sets: TrainingSetRow[] }>();
  for (const r of rows) {
    if (r.date > date) continue;
    const cur = byEx.get(r.exerciseId);
    if (!cur || r.date > cur.date) byEx.set(r.exerciseId, { date: r.date, sets: [r] });
    else if (r.date === cur.date) cur.sets.push(r);
  }
  const m = new Map<string, { date: DateKey; top: TrainingSetRow }>();
  for (const [id, v] of byEx) {
    const top = topSet(v.sets);
    if (top) m.set(id, { date: v.date, top });
  }
  return m;
}

/** from〜to（両端を含む）の負荷量の合計 */
export function volumeBetween(rows: TrainingSetRow[], from: DateKey, to: DateKey): number {
  return rows.reduce((a, r) => (r.date >= from && r.date <= to ? a + setVolume(r) : a), 0);
}

/** 7日間（今日を含む）、28日間、総合計の負荷量（kg） */
export function periodTotals(rows: TrainingSetRow[], today: DateKey) {
  return {
    last7: volumeBetween(rows, addDays(today, -6), today),
    last28: volumeBetween(rows, addDays(today, -27), today),
    total: rows.reduce((a, r) => (r.date <= today ? a + setVolume(r) : a), 0),
  };
}

/** 週ごと（日曜始まり）の負荷量。[0] が今週、[1] が1週前… */
export function weeklyVolumes(rows: TrainingSetRow[], today: DateKey, weeks = 6): number[] {
  const thisWeek = weekStart(today);
  const out = new Array<number>(weeks).fill(0);
  for (const r of rows) {
    if (r.date > today) continue;
    const idx = Math.floor(daysBetween(weekStart(r.date), thisWeek) / 7);
    if (idx >= 0 && idx < weeks) out[idx] += setVolume(r);
  }
  return out;
}

/** たとえに使う乗り物の重さ（t） */
export const VEHICLES = {
  car: { label: '車', tonnes: 1.5 },
  bus: { label: 'バス', tonnes: 15 },
  jumbo: { label: 'ジャンボ機', tonnes: 346 },
} as const;
export type Vehicle = keyof typeof VEHICLES;

/** 負荷量（kg）が乗り物の何台分か */
export function vehicleRatio(volumeKg: number, vehicle: Vehicle): number {
  return volumeKg / 1000 / VEHICLES[vehicle].tonnes;
}

/** トレーニングした日（重複なし、昇順） */
export function trainingDates(rows: { date: DateKey }[]): DateKey[] {
  return [...new Set(rows.map((r) => r.date))].sort();
}

/** その月にトレーニングした日数 */
export function daysInMonth(dates: DateKey[], year: number, month: number): number {
  return dates.filter((d) => {
    const ym = yearMonth(d);
    return ym.year === year && ym.month === month;
  }).length;
}

export type DailyPoint = { date: DateKey; volume: number; max1RM: number };

/** 種目ごとの、日ごとの総負荷量と最大の推定1RM（昇順） */
export function exerciseDailySeries(rows: TrainingSetRow[], exerciseId: string): DailyPoint[] {
  const map = new Map<DateKey, DailyPoint>();
  for (const r of rows) {
    if (r.exerciseId !== exerciseId) continue;
    const p = map.get(r.date) ?? { date: r.date, volume: 0, max1RM: 0 };
    p.volume += setVolume(r);
    p.max1RM = Math.max(p.max1RM, estimated1RM(r.weightKg, r.reps));
    map.set(r.date, p);
  }
  return [...map.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

export type Period = '1m' | '3m' | '6m' | '1y' | 'all';
export const PERIOD_LABELS: Record<Period, string> = {
  '1m': '1か月', '3m': '3か月', '6m': '6か月', '1y': '1年', all: 'すべて',
};

/** 期間の始まりの日（すべてなら null） */
export function periodStart(today: DateKey, period: Period): DateKey | null {
  switch (period) {
    case '1m': return addMonths(today, -1);
    case '3m': return addMonths(today, -3);
    case '6m': return addMonths(today, -6);
    case '1y': return addMonths(today, -12);
    case 'all': return null;
  }
}

export function filterSince<T extends { date: DateKey }>(items: T[], from: DateKey | null): T[] {
  return from == null ? items : items.filter((i) => i.date >= from);
}

/** 最初と最後の差（2点未満なら null） */
export function changeOver<T>(items: T[], value: (t: T) => number): number | null {
  if (items.length < 2) return null;
  return value(items[items.length - 1]) - value(items[0]);
}

export type WeeklyByPart = { weekStart: DateKey; byPart: Record<string, number>; total: number };

/** 部位ごとの、週ごとの総負荷量（古い順。最後が今週） */
export function weeklyVolumeByBodyPart(rows: TrainingSetRow[], today: DateKey, weeks = 8): WeeklyByPart[] {
  const thisWeek = weekStart(today);
  const out: WeeklyByPart[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    out.push({ weekStart: addDays(thisWeek, -7 * i), byPart: {}, total: 0 });
  }
  for (const r of rows) {
    if (r.date > today) continue;
    const idx = weeks - 1 - Math.floor(daysBetween(weekStart(r.date), thisWeek) / 7);
    if (idx < 0 || idx >= weeks) continue;
    const v = setVolume(r);
    if (v === 0) continue;
    const w = out[idx];
    w.byPart[r.bodyPartId] = (w.byPart[r.bodyPartId] ?? 0) + v;
    w.total += v;
  }
  return out;
}

export type DailyByPart = { date: DateKey; byPart: Record<string, number>; total: number };

/**
 * 部位ごとの、日ごとの総負荷量（古い順）。週ごと（weeklyVolumeByBodyPart）と同じ weeks 週（日曜始まり）の
 * 7 × weeks 日で、今週の土曜まで並べる。今日より後の日と、トレーニングしなかった日は 0。
 * 同じ weeks なら、日ごとの合計は週ごとの合計と同じになる
 */
export function dailyVolumeByBodyPart(rows: TrainingSetRow[], today: DateKey, weeks = 4): DailyByPart[] {
  const first = addDays(weekStart(today), -7 * (weeks - 1));
  const out: DailyByPart[] = [];
  for (let i = 0; i < 7 * weeks; i++) out.push({ date: addDays(first, i), byPart: {}, total: 0 });
  for (const r of rows) {
    if (r.date > today) continue;
    const idx = daysBetween(first, r.date);
    if (idx < 0 || idx >= out.length) continue;
    const v = setVolume(r);
    if (v === 0) continue;
    const d = out[idx];
    d.byPart[r.bodyPartId] = (d.byPart[r.bodyPartId] ?? 0) + v;
    d.total += v;
  }
  return out;
}

/** 日ごとの総負荷量の見出しの数字：期間の合計、いちばん多かった日（同じなら早い日。なければ null）、トレーニングした日数 */
export function dailySummary(days: DailyByPart[]) {
  let peak: DailyByPart | null = null;
  for (const d of days) if (d.total > 0 && (!peak || d.total > peak.total)) peak = d;
  return { total: days.reduce((a, d) => a + d.total, 0), peak, activeDays: days.filter((d) => d.total > 0).length };
}

/** 週ごとの総負荷量の見出しの数字：今週、先週、期間の週の平均 */
export function weeklySummary(weeks: WeeklyByPart[]) {
  const thisWeek = weeks[weeks.length - 1].total;
  const lastWeek = weeks[weeks.length - 2]?.total ?? 0;
  const avg = weeks.reduce((a, w) => a + w.total, 0) / weeks.length;
  return { thisWeek, lastWeek, avg };
}

export type PersonalBest = { exerciseId: string; e1rm: number; weightKg: number; reps: number; date: DateKey };

/** 種目ごとの自己ベスト（推定1RM が最大のセット）。beforeDate を渡すと、その日より前だけで見る */
export function personalBests(rows: TrainingSetRow[], beforeDate?: DateKey): Map<string, PersonalBest> {
  const map = new Map<string, PersonalBest>();
  for (const r of rows) {
    if (beforeDate && r.date >= beforeDate) continue;
    const e1rm = estimated1RM(r.weightKg, r.reps);
    if (e1rm <= 0) continue;
    const cur = map.get(r.exerciseId);
    if (!cur || e1rm > cur.e1rm) {
      map.set(r.exerciseId, { exerciseId: r.exerciseId, e1rm, weightKg: r.weightKg!, reps: r.reps!, date: r.date });
    }
  }
  return map;
}

/** RM計算機の表：割合と回数の目安 */
export const RM_TABLE = [
  { pct: 95, reps: 2 },
  { pct: 90, reps: 4 },
  { pct: 85, reps: 6 },
  { pct: 80, reps: 8 },
  { pct: 75, reps: 10 },
  { pct: 70, reps: 12 },
] as const;

export function rmTable(oneRm: number) {
  return RM_TABLE.map((r) => ({ ...r, weight: (oneRm * r.pct) / 100 }));
}

/** RM計算機の入力（文字列）から推定1RM。数でない・0 以下・回数が整数でないときは 0 */
export function rmFromInput(weight: string, reps: string): number {
  const r = parseNumber(reps);
  return estimated1RM(parseNumber(weight), r != null && Number.isInteger(r) ? r : null);
}
