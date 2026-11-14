// BIG3 の合計の出し方を1つの土台（lib/big3.ts の big3TotalOf と、lib/training.ts の big3Series・bestIn）に寄せる前と後で、
// 同じ入力から同じ数字が出ることを確かめる（イシュー #213 の M4・A6）。寄せる前の出し方は下にそのまま写して比べる
import { addDays, addMonths, DateKey, daysBetween } from '../date';
import type { Big3Role } from '../exercises';
import { big3Growth } from '../growthRecords';
import { big3Totals } from '../phases';
import { big3Best, big3Sum } from '../phaseView';
import { big3Total, Big3Lifts } from '../reports';
import { big3Trend, estimated1RM, exerciseDailySeries, TrainingSetRow } from '../training';
import { big3TotalOf } from '../big3';

type Big3Values = { bench: number | null; squat: number | null; deadlift: number | null };

// ---- 寄せる前の出し方（main の 3d4b445 のまま） ----

function oldBig3TrendSums(rows: TrainingSetRow[], assignments: Partial<Record<Big3Role, string>>, today: DateKey, from: DateKey) {
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
    let count = 0;
    for (const role of roles) {
      const v = bestUpTo(role, d);
      if (v == null) continue;
      sum += v;
      count += 1;
    }
    return count === 0 ? null : sum;
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

function oldBig3Growth(sets: TrainingSetRow[], big3: Partial<Record<Big3Role, string>>, today: DateKey) {
  const out: { role: Big3Role; startDate: DateKey; startKg: number; nowKg: number; pct: number | null }[] = [];
  for (const role of ['bench', 'squat', 'deadlift'] as const) {
    const id = big3[role];
    if (!id) continue;
    const series = exerciseDailySeries(sets, id).filter((p) => p.max1RM > 0 && p.date <= today);
    if (series.length === 0) continue;
    const startKg = series[0].max1RM;
    const nowKg = Math.max(...series.map((p) => p.max1RM));
    out.push({ role, startDate: series[0].date, startKg, nowKg, pct: startKg > 0 ? Math.round(((nowKg - startKg) / startKg) * 100) : null });
  }
  return out;
}

function oldBig3Total(sets: TrainingSetRow[], lifts: Big3Lifts | null, start: DateKey, end: DateKey) {
  if (!lifts) return null;
  const sum = (from: DateKey, to: DateKey) => {
    let total = 0;
    for (const id of [lifts.squat, lifts.bench, lifts.deadlift]) {
      const best = Math.max(0, ...sets.filter((r) => r.exerciseId === id && r.date >= from && r.date <= to).map((r) => estimated1RM(r.weightKg, r.reps)));
      if (best <= 0) return null;
      total += best;
    }
    return total;
  };
  const now = sum(start, end);
  if (now == null) return null;
  const length = daysBetween(start, end) + 1;
  const prev = sum(addDays(start, -length), addDays(start, -1));
  return { totalKg: now, deltaKg: prev == null ? null : now - prev };
}

function oldBig3Totals(start: Big3Values | null, now: Big3Values | null): [number, number] | null {
  if (!start || !now) return null;
  const roles = (['bench', 'squat', 'deadlift'] as const).filter((r) => start[r] != null && now[r] != null);
  if (roles.length === 0) return null;
  return [roles.reduce((s, r) => s + start[r]!, 0), roles.reduce((s, r) => s + now[r]!, 0)];
}

function oldBig3Best(rows: TrainingSetRow[], assignments: Partial<Record<Big3Role, string>>, day: DateKey, since: DateKey | null = null): Big3Values | null {
  const roles = ['bench', 'squat', 'deadlift'] as const;
  const out = { bench: null, squat: null, deadlift: null } as Big3Values;
  for (const role of roles) {
    const id = assignments[role];
    if (!id) continue;
    let best = 0;
    for (const r of rows) {
      if (r.exerciseId !== id || r.date > day || (since != null && r.date < since)) continue;
      best = Math.max(best, estimated1RM(r.weightKg, r.reps));
    }
    out[role] = best > 0 ? Math.round(best * 10) / 10 : null;
  }
  return roles.some((r) => out[r] != null) ? out : null;
}

function oldBig3Sum(b: Big3Values | null): number | null {
  if (!b) return null;
  const v = [b.bench, b.squat, b.deadlift].filter((x): x is number => x != null);
  return v.length === 0 ? null : Math.round(v.reduce((s, x) => s + x, 0) * 10) / 10;
}

// ---- 入力 ----

const row = (date: string, exerciseId: string, weightKg: number | null, reps: number): TrainingSetRow =>
  ({ date, exerciseId, bodyPartId: 'p', weightKg, reps });

/** 割り切れない推定1RM（62.5×7 など）、0 回・重さなし、期間の端の日、未来の日を混ぜる */
const ROWS: TrainingSetRow[] = [
  row('2026-06-03', 'b', 62.5, 7), row('2026-06-03', 'b', 60, 9), row('2026-06-03', 's', 82.5, 7),
  row('2026-07-01', 'b', 67.5, 7), row('2026-07-01', 'd', 102.5, 7), row('2026-07-01', 's', 0, 5),
  row('2026-08-01', 's', 92.5, 7), row('2026-08-01', 'd', null, 10), row('2026-08-01', 'b', 70, 0),
  row('2026-08-31', 'b', 72.5, 7), row('2026-09-01', 'd', 107.5, 3), row('2026-09-15', 's', 97.5, 4),
  row('2026-09-30', 'b', 71.7, 11), row('2026-10-01', 'd', 112.5, 6), row('2026-10-31', 's', 100, 1),
  row('2026-11-01', 'b', 73.3, 8), row('2026-11-14', 'd', 117.5, 7), row('2026-11-20', 'b', 200, 5),
  row('2026-10-10', 'other', 50, 5), row('2026-10-15', 'b', 70.8, 6), row('2026-11-10', 's', 102.5, 3),
];

const FULL = { bench: 'b', squat: 's', deadlift: 'd' };
const ASSIGNMENTS: Partial<Record<Big3Role, string>>[] = [
  FULL, { bench: 'b', squat: 's' }, { deadlift: 'd' }, { bench: 'b', squat: 'none', deadlift: 'd' }, {},
];
const DAYS: DateKey[] = ['2026-05-01', '2026-06-03', '2026-07-01', '2026-08-31', '2026-09-30', '2026-11-14', '2026-11-15'];
const SINCE: (DateKey | null)[] = [null, '2026-06-03', '2026-08-01', '2026-10-18', '2026-11-15'];
const PERIODS: [DateKey, DateKey][] = [
  ['2026-06-01', '2026-06-30'], ['2026-07-01', '2026-07-31'], ['2026-08-01', '2026-08-31'], ['2026-09-01', '2026-09-30'],
  ['2026-10-01', '2026-10-31'], ['2026-11-01', '2026-11-30'], ['2026-08-31', '2026-09-06'], ['2026-01-01', '2026-01-31'],
];
const VALUES: (Big3Values | null)[] = [
  null,
  { bench: null, squat: null, deadlift: null },
  { bench: 72.6, squat: null, deadlift: null },
  { bench: 72.6, squat: 113.8, deadlift: null },
  { bench: 0.1, squat: 0.2, deadlift: 0.3 },
  { bench: 76.4, squat: 113.8, deadlift: 131.3 },
  { bench: null, squat: 113.8, deadlift: 131.3 },
  { bench: 83.958, squat: 100.333, deadlift: 147.083 },
];

describe('BIG3 の合計：寄せる前と後で同じ数字', () => {
  test('ホーム・推移の合計（big3Trend）', () => {
    for (const a of ASSIGNMENTS) for (const today of DAYS) for (const from of [addMonths(today, -3), '2026-01-01', today]) {
      expect(big3Trend(ROWS, a, today, from)).toEqual(oldBig3TrendSums(ROWS, a, today, from));
    }
    expect(big3Trend(ROWS, FULL, '2026-11-14', '2026-08-14').points.length).toBeGreaterThan(3);
  });

  test('成長の記録の「始めたとき → 今」（big3Growth）', () => {
    for (const a of ASSIGNMENTS) for (const today of DAYS) {
      expect(big3Growth(ROWS, a, today).map(({ name: _name, ...rest }) => rest)).toEqual(oldBig3Growth(ROWS, a, today));
    }
  });

  test('月のレポートの合計と前の期間との差（big3Total）', () => {
    for (const lifts of [{ squat: 's', bench: 'b', deadlift: 'd' }, { squat: 's', bench: 'b', deadlift: 'none' }, null]) {
      for (const [start, end] of PERIODS) expect(big3Total(ROWS, lifts, start, end)).toEqual(oldBig3Total(ROWS, lifts, start, end));
    }
    // 比べた中に、合計と差の両方が出る期間がある（null どうしを比べただけにしない）
    expect(PERIODS.some(([s, e]) => big3Total(ROWS, FULL, s, e)?.deltaKg != null)).toBe(true);
  });

  test('フェーズの開始時・終わりの BIG3（big3Best）', () => {
    for (const a of ASSIGNMENTS) for (const day of DAYS) for (const since of SINCE) {
      expect(big3Best(ROWS, a, day, since)).toEqual(oldBig3Best(ROWS, a, day, since));
    }
  });

  test('開始時と今の両方にある役の合計（big3Totals）と、記録のある役の合計（big3Sum）', () => {
    for (const s of VALUES) {
      expect(big3Sum(s)).toBe(oldBig3Sum(s));
      for (const n of VALUES) expect(big3Totals(s, n)).toEqual(oldBig3Totals(s, n));
    }
  });
});

describe('big3TotalOf：そろわないときの扱い', () => {
  test('present は記録のある役だけを足し、どれもなければ null。all は3つそろわなければ null', () => {
    expect(big3TotalOf({ bench: 60, squat: null, deadlift: 100 }, 'present')).toBe(160);
    expect(big3TotalOf({ bench: null, squat: null, deadlift: null }, 'present')).toBeNull();
    expect(big3TotalOf({ bench: 60, squat: null, deadlift: 100 }, 'all')).toBeNull();
    expect(big3TotalOf({ bench: 60, squat: 80, deadlift: 100 }, 'all')).toBe(240);
  });
});
