import { addDays, daysBetween, DateKey, weekStart, yearMonth, addMonths } from './date';
import type { Big3Role } from './exercises';
import type { SetInput } from './sets';
import { fmt1, kgToUnit, parseNumber, WeightUnit } from './units';

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
 * 部位ごとの、日ごとの総負荷量（古い順）。週ごと（weeklyVolumeByBodyPart）と同じ weeks 週（月曜始まり）の
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

// ---- 筋トレの推移（記録のカードと BIG3 のグラフ）と、前回のメニュー ----

/** 推移の種目の記録に出す日（新しい順）。exerciseId を渡すと、その種目をした日だけ */
export function trendDays(rows: { date: DateKey; exerciseId: string }[], exerciseId: string | null): DateKey[] {
  return trainingDates(exerciseId == null ? rows : rows.filter((r) => r.exerciseId === exerciseId)).reverse();
}

export type ExerciseTrend = {
  /** いちばん新しい記録の日の値（kg。今日まで。なければ null） */
  current: number | null;
  /** 1か月前の日までで、いちばん新しい記録の日の値（kg。なければ null） */
  monthAgo: number | null;
  /** from〜today の、記録のあった日の点（古い順） */
  points: DailyPoint[];
};

/**
 * 推移で種目を選んだときの折れ線（筋トレのタブの「推移」）。value で日ごとの値（推定1RM・総負荷量）を選ぶ。
 * 値が 0 の日（回数だけの記録の推定1RM など）は点にしない
 */
export function exerciseTrend(rows: TrainingSetRow[], exerciseId: string, today: DateKey, from: DateKey, value: (p: DailyPoint) => number): ExerciseTrend {
  const series = exerciseDailySeries(rows, exerciseId).filter((p) => p.date <= today && value(p) > 0);
  const monthAgo = addMonths(today, -1);
  const last = series[series.length - 1];
  const before = series.filter((p) => p.date <= monthAgo).pop();
  return {
    current: last ? value(last) : null,
    monthAgo: before ? value(before) : null,
    points: series.filter((p) => p.date >= from),
  };
}

/**
 * 「同じメニューで始める」で今日に写す中身：種目ごとに、重さと回数だけ（メモと完了は写さない。種目ごとの「前回をコピー」と同じ）。
 * 種目の並びはその日のまま
 */
export function menuFromDay(entries: { exerciseId: string; sets: { weightKg: number | null; reps: number }[] }[]): { exerciseId: string; sets: SetInput[] }[] {
  return entries
    .filter((e) => e.sets.length > 0)
    .map((e) => ({ exerciseId: e.exerciseId, sets: e.sets.map((s) => ({ weightKg: s.weightKg, reps: s.reps, memo: '', done: false })) }));
}

export type Big3Lift = {
  role: Big3Role;
  /** 割り当てた種目（なければ null） */
  exerciseId: string | null;
  /** 今日までの最高の推定1RM（kg。記録がなければ null） */
  current: number | null;
  /** 1か月前の日までの最高の推定1RM（kg。なければ null） */
  monthAgo: number | null;
};

export type Big3Trend = {
  lifts: Big3Lift[];
  /** まだ割り当てていない役 */
  unassigned: Big3Role[];
  /** 割り当てたが、推定1RM の出る記録がまだない役 */
  noRecord: Big3Role[];
  /** 3種目の今の合計（そろわなければ null）と、1か月前の合計（そのときにそろっていなければ null） */
  total: number | null;
  totalMonthAgo: number | null;
  /** 合計の折れ線（from〜today。3種目がそろった日から。記録のあった日と、from・today の点） */
  points: { date: DateKey; total: number }[];
};

/**
 * BIG3 の推定1RM の合計。役ごとに、その日までの最高の推定1RM（estimated1RM）を出し、3つの和を合計とする。
 * 推移は from〜today（3か月など）。from より前の記録も「その日までの最高」には入る
 */
export function big3Trend(rows: TrainingSetRow[], assignments: Partial<Record<Big3Role, string>>, today: DateKey, from: DateKey): Big3Trend {
  const roles: Big3Role[] = ['bench', 'squat', 'deadlift'];
  const series = new Map(roles.map((role) => {
    const id = assignments[role];
    return [role, id ? exerciseDailySeries(rows, id).filter((p) => p.max1RM > 0 && p.date <= today) : []];
  }));
  const bestUpTo = (role: Big3Role, d: DateKey): number | null => {
    let best: number | null = null;
    for (const p of series.get(role)!) if (p.date <= d && (best == null || p.max1RM > best)) best = p.max1RM;
    return best;
  };
  const sumAt = (d: DateKey): number | null => {
    let sum = 0;
    for (const role of roles) {
      const v = assignments[role] ? bestUpTo(role, d) : null;
      if (v == null) return null;
      sum += v;
    }
    return sum;
  };
  const monthAgo = addMonths(today, -1);
  const lifts = roles.map((role) => ({
    role, exerciseId: assignments[role] ?? null, current: bestUpTo(role, today), monthAgo: bestUpTo(role, monthAgo),
  }));
  const dates = new Set<DateKey>([from, today]);
  for (const role of roles) for (const p of series.get(role)!) if (p.date > from) dates.add(p.date);
  const points: { date: DateKey; total: number }[] = [];
  for (const d of [...dates].sort()) {
    const total = sumAt(d);
    if (total != null) points.push({ date: d, total });
  }
  return {
    lifts,
    unassigned: roles.filter((r) => !assignments[r]),
    noRecord: lifts.filter((l) => l.exerciseId && l.current == null).map((l) => l.role),
    total: sumAt(today),
    totalMonthAgo: sumAt(monthAgo),
    points,
  };
}

/** その日の部位で2番目の部位も出す、1番目の負荷量に対する割合（7割以上なら「胸・肩」） */
export const SECOND_PART_RATIO = 0.7;

/**
 * その日の部位。部位ごとに総負荷量（重さ×回数。自重の種目は自重の負荷量）を足し、いちばん多い部位。
 * 2番目が1番目の 7 割以上なら2つ。負荷量がどれも 0（体重の記録のない自重の種目だけなど）なら、セットの数で比べる。
 * 同じ量なら先に出た部位を先に。部位は名前で（種目と部位の管理の名前のまま）、名前のない部位は数えない
 */
export function focusParts(sets: { part: string; volume: number }[]): string[] {
  const byPart = new Map<string, { volume: number; sets: number }>();
  for (const s of sets) {
    const name = s.part.trim();
    if (name === '') continue;
    const cur = byPart.get(name) ?? { volume: 0, sets: 0 };
    cur.volume += s.volume;
    cur.sets += 1;
    byPart.set(name, cur);
  }
  const all = [...byPart];
  const anyVolume = all.some(([, v]) => v.volume > 0);
  const score = (v: { volume: number; sets: number }) => (anyVolume ? v.volume : v.sets);
  // sort は同じ値の並びを保つので、同じ量なら先に出た部位が先
  const [first, second] = all.sort((a, b) => score(b[1]) - score(a[1]));
  if (!first) return [];
  return second && score(second[1]) >= score(first[1]) * SECOND_PART_RATIO ? [first[0], second[0]] : [first[0]];
}

/**
 * 記録のまとめの「部位」：その日の種目から「胸」「胸・肩」（focusParts）。spoken は読み上げ用（「胸、肩」）。種目がなければ空
 */
export function dayFocus(entries: { bodyPartName: string; sets: SetValues[] }[]): { names: string[]; text: string; spoken: string } {
  const names = focusParts(entries.flatMap((e) => e.sets.map((s) => ({ part: e.bodyPartName, volume: setVolume(s) }))));
  if (names.length === 0) return { names, text: '', spoken: '' };
  return { names, text: names.join('・'), spoken: names.join('、') };
}

/** 日ごとの部位（focusParts。日付の昇順）。partName は部位の ID から名前を引く */
export function focusByDate(rows: TrainingSetRow[], partName: (bodyPartId: string) => string): { date: DateKey; parts: string[] }[] {
  const byDate = new Map<DateKey, { part: string; volume: number }[]>();
  for (const r of rows) {
    const list = byDate.get(r.date) ?? [];
    list.push({ part: partName(r.bodyPartId), volume: setVolume(r) });
    byDate.set(r.date, list);
  }
  return [...byDate].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, sets]) => ({ date, parts: focusParts(sets) }))
    .filter((d) => d.parts.length > 0);
}

/** おすすめに使う3つの部位（この名前の部位だけ。同じだけあいていれば、この順） */
export const SUGGEST_PARTS = ['背中', '脚', '胸'] as const;

/** 部位ごとの前回：その部位の日だった、今日より前のいちばん新しい日と、今日から何日前か。一度もなければ null */
export type PartLast = { name: string; last: DateKey | null; days: number | null };

/**
 * 背中・脚・胸の前回と、今日のおすすめ（3つのうち、前回からいちばん日があいている部位。一度もやっていなければそれ）。
 * 「前回」はその日の部位（focusByDate）にその部位が入っていた日（「胸・肩」の日は胸と肩の両方）。今日とそれより後の日は見ない。
 * names はユーザーの部位の名前で、3つのうち名前があるものだけを出す。どれも一度もやっていなければ、何も出さない。
 * rows は前回の新しい順（一度もない部位は最後）
 */
export function partSuggestion(days: { date: DateKey; parts: string[] }[], names: string[], today: DateKey): { rows: PartLast[]; suggest: PartLast | null } {
  const have = new Set(names.map((n) => n.trim()));
  const rows: PartLast[] = SUGGEST_PARTS.filter((n) => have.has(n)).map((name) => {
    let last: DateKey | null = null;
    for (const d of days) if (d.date < today && d.parts.includes(name) && (last == null || d.date > last)) last = d.date;
    return { name, last, days: last == null ? null : daysBetween(last, today) };
  });
  if (rows.every((r) => r.last == null)) return { rows: [], suggest: null };
  // 一度もない部位をいちばんあいているとみなす
  const gap = (r: PartLast) => r.days ?? Infinity;
  const suggest = rows.reduce((a, b) => (gap(b) > gap(a) ? b : a));
  return { rows: [...rows].sort((a, b) => (gap(a) === gap(b) ? 0 : gap(a) - gap(b))), suggest };
}

/**
 * ホームの「最近の流れ」：今日より前の、直近 n 回の筋トレの日（古い順）と、今日の部位（今日やっていなければ null）
 */
export function recentFlow(days: { date: DateKey; parts: string[] }[], today: DateKey, n = 3): { past: { date: DateKey; parts: string[] }[]; today: string[] | null } {
  const past = days.filter((d) => d.date < today).slice(-n);
  return { past, today: days.find((d) => d.date === today)?.parts ?? null };
}

/**
 * 記録のタブの種目のカードの読み上げ：「ベンチプレスを直す。部位 胸、BIG3、推定1RM 101.3kg」。
 * 押したときの動き（◯◯を直す）を先に言い、あとに2行目の札と数字を並べる。部位・BIG3・推定1RM はあるものだけ
 */
export function entryCardLabel(e: { name: string; part: string; big3: boolean; e1rm: string | null }): string {
  const details = [e.part.trim() !== '' ? `部位 ${e.part.trim()}` : null, e.big3 ? 'BIG3' : null, e.e1rm != null ? `推定1RM ${e.e1rm}` : null]
    .filter((d): d is string => d != null);
  return details.length > 0 ? `${e.name}を直す。${details.join('、')}` : `${e.name}を直す`;
}
