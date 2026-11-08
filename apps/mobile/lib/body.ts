import { addDays, DateKey, daysBetween } from './date';

/** BMI ＝ 体重 ÷ 身長(m)² */
export function bmi(weightKg: number | null, heightCm: number | null): number | null {
  if (weightKg == null || heightCm == null || heightCm <= 0) return null;
  const m = heightCm / 100;
  return weightKg / (m * m);
}

/** 体脂肪量 ＝ 体重 × 体脂肪率 */
export function fatMass(weightKg: number | null, bodyFatPct: number | null): number | null {
  if (weightKg == null || bodyFatPct == null) return null;
  return (weightKg * bodyFatPct) / 100;
}

/** 除脂肪体重 ＝ 体重 − 体脂肪量 */
export function leanMass(weightKg: number | null, bodyFatPct: number | null): number | null {
  const f = fatMass(weightKg, bodyFatPct);
  return f == null || weightKg == null ? null : weightKg - f;
}

/** 筋肉量 ＝ 体重 × 筋肉率 */
export function muscleMass(weightKg: number | null, musclePct: number | null): number | null {
  if (weightKg == null || musclePct == null) return null;
  return (weightKg * musclePct) / 100;
}

export type BodyValues = {
  weightKg: number | null;
  bodyFatPct: number | null;
  musclePct: number | null;
  waistCm: number | null;
};

export type BodyMetric = 'weight' | 'bodyFat' | 'muscle' | 'waist' | 'bmi' | 'fatMass' | 'leanMass' | 'muscleMass';

export const BODY_METRICS: Record<BodyMetric, { label: string; unit: string; trendTitle: string }> = {
  weight: { label: '体重', unit: 'kg', trendTitle: '体重の推移' },
  bodyFat: { label: '体脂肪率', unit: '%', trendTitle: '体脂肪率の推移' },
  muscle: { label: '筋肉率', unit: '%', trendTitle: '筋肉率の推移' },
  waist: { label: 'ウエスト', unit: 'cm', trendTitle: 'ウエストの推移' },
  bmi: { label: 'BMI', unit: '', trendTitle: 'BMI の推移' },
  fatMass: { label: '体脂肪量', unit: 'kg', trendTitle: '体脂肪量の推移' },
  leanMass: { label: '除脂肪体重', unit: 'kg', trendTitle: '除脂肪体重の推移' },
  muscleMass: { label: '筋肉量', unit: 'kg', trendTitle: '筋肉量の推移' },
};

/** 記録と身長から、項目の値を出す */
export function metricValue(v: BodyValues, metric: BodyMetric, heightCm: number | null): number | null {
  switch (metric) {
    case 'weight': return v.weightKg;
    case 'bodyFat': return v.bodyFatPct;
    case 'muscle': return v.musclePct;
    case 'waist': return v.waistCm;
    case 'bmi': return bmi(v.weightKg, heightCm);
    case 'fatMass': return fatMass(v.weightKg, v.bodyFatPct);
    case 'leanMass': return leanMass(v.weightKg, v.bodyFatPct);
    case 'muscleMass': return muscleMass(v.weightKg, v.musclePct);
  }
}

/**
 * 直近 days 日の体重のペース（kg／週）。最初と最後の記録から出す。
 * 記録が2つ未満か、同じ日だけなら null。
 */
export function weeklyPace(points: { date: DateKey; weightKg: number }[], today: DateKey, days = 28): number | null {
  const from = addDays(today, -(days - 1));
  const inRange = points.filter((p) => p.date >= from && p.date <= today).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (inRange.length < 2) return null;
  const first = inRange[0];
  const last = inRange[inRange.length - 1];
  const span = daysBetween(first.date, last.date);
  if (span <= 0) return null;
  return ((last.weightKg - first.weightKg) / span) * 7;
}

/**
 * 目標体重までの残りと、今のペースでの週数。
 * ペースが目標の向きでなければ weeks は null。
 */
export function goalProgress(currentKg: number, goalKg: number, pacePerWeek: number | null) {
  const diff = goalKg - currentKg; // 減らすなら負
  const remaining = Math.abs(diff);
  let weeks: number | null = null;
  if (pacePerWeek != null && pacePerWeek !== 0 && remaining > 0 && Math.sign(pacePerWeek) === Math.sign(diff)) {
    weeks = Math.ceil(remaining / Math.abs(pacePerWeek));
  }
  return { remaining, direction: diff < 0 ? 'lose' : diff > 0 ? 'gain' : 'reached', weeks } as const;
}

/** 体組成の1件（1日に複数あり得る） */
export type BodyRecordLike = BodyValues & {
  date: DateKey;
  measuredAt: string; // ISO 8601
  updatedAt: string;
  memo: string;
};

export type DailyBody = BodyValues & { date: DateKey; memo: string };

const FIELDS = ['weightKg', 'bodyFatPct', 'musclePct', 'waistCm'] as const;

/**
 * 1日に1つの値を出すときの選び方：項目ごとに、その日のいちばん新しい記録（measured_at、同じなら updated_at）の、
 * 空でない値を使う。朝に体重計で体重だけ、夜に手で体脂肪率を入れた、という日でも両方が出る。
 * 手入力と取り込みのどちらを優先するかは第2段階で決める（今は時刻だけで選ぶ）。
 */
export function dailyBodyValues(records: BodyRecordLike[]): DailyBody[] {
  const sorted = [...records].sort((a, b) =>
    a.measuredAt === b.measuredAt ? (a.updatedAt < b.updatedAt ? 1 : -1) : a.measuredAt < b.measuredAt ? 1 : -1,
  ); // 新しい順
  const byDate = new Map<DateKey, DailyBody>();
  for (const r of sorted) {
    let d = byDate.get(r.date);
    if (!d) {
      d = { date: r.date, weightKg: null, bodyFatPct: null, musclePct: null, waistCm: null, memo: '' };
      byDate.set(r.date, d);
    }
    for (const f of FIELDS) if (d[f] == null && r[f] != null) d[f] = r[f];
    if (d.memo === '' && r.memo !== '') d.memo = r.memo;
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}
