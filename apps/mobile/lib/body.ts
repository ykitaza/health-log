import { addDays, addMonths, DateKey, daysBetween } from './date';

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

/** 体組成の1件（1日に複数あり得る）。source は手入力（manual）か Health Connect の取り込み（health_connect） */
export type BodyRecordLike = BodyValues & {
  date: DateKey;
  measuredAt: string; // ISO 8601
  updatedAt: string;
  memo: string;
  source?: 'manual' | 'health_connect'; // 省くと手入力
};

export type BodyField = 'weightKg' | 'bodyFatPct' | 'musclePct' | 'waistCm';

/** imported：取り込みの値を出している項目（手入力の値がない項目だけ。どれもなければ省く） */
export type DailyBody = BodyValues & { date: DateKey; memo: string; imported?: BodyField[] };

const FIELDS: BodyField[] = ['weightKg', 'bodyFatPct', 'musclePct', 'waistCm'];

const isManual = (r: BodyRecordLike) => (r.source ?? 'manual') === 'manual';

/**
 * 1日に1つの値を出すときの選び方：項目ごとに、その日の手入力の記録のうち、いちばん新しいもの（measured_at、同じなら updated_at）の
 * 空でない値を使う。手入力の値がない項目だけ、取り込み（Health Connect）の同じ決まりの値を使う。
 * 朝に体重計で体重だけ、夜に手で体脂肪率を入れた、という日でも両方が出る。体重計の値を手で直したら、手の値が出る。
 * サーバー（services/training/training/domain/body.py の daily_body_values）と同じ（testdata/training/body.json）
 */
export function dailyBodyValues(records: BodyRecordLike[]): DailyBody[] {
  const sorted = [...records].sort((a, b) => {
    if (isManual(a) !== isManual(b)) return isManual(a) ? -1 : 1;
    return a.measuredAt === b.measuredAt ? (a.updatedAt < b.updatedAt ? 1 : -1) : a.measuredAt < b.measuredAt ? 1 : -1;
  }); // 手入力が先、その中で新しい順
  const byDate = new Map<DateKey, DailyBody>();
  for (const r of sorted) {
    let d = byDate.get(r.date);
    if (!d) {
      d = { date: r.date, weightKg: null, bodyFatPct: null, musclePct: null, waistCm: null, memo: '' };
      byDate.set(r.date, d);
    }
    for (const f of FIELDS) {
      if (d[f] != null || r[f] == null) continue;
      d[f] = r[f];
      if (!isManual(r)) d.imported = FIELDS.filter((x) => x === f || d!.imported?.includes(x));
    }
    if (d.memo === '' && r.memo !== '') d.memo = r.memo;
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

/**
 * 体組成の画面の、体重の推移（1か月）と目標体重のカード。
 * 目標は、開いている日ではなく、今日までのいちばん新しい体重で見る。目標か体重がなければ progress は null
 */
export function weightOverview(daily: { date: DateKey; weightKg: number | null }[], goalKg: number | null, today: DateKey) {
  const weights = daily.filter((d) => d.weightKg != null).map((d) => ({ date: d.date, weightKg: d.weightKg! }));
  const from = addMonths(today, -1);
  const recent = weights.filter((p) => p.date >= from && p.date <= today);
  const latest = weights.filter((p) => p.date <= today).at(-1);
  const pace = weeklyPace(weights, today);
  const progress = latest && goalKg != null ? goalProgress(latest.weightKg, goalKg, pace) : null;
  const monthChange = recent.length >= 2 ? recent[recent.length - 1].weightKg - recent[0].weightKg : null;
  return { from, recent, pace, progress, monthChange };
}

/**
 * 体重の移動平均（既定は7日）。記録のある日ごとに、その日までの days 日（その日を含む）にある記録の平均を出す。
 * 記録のない日は出さない（グラフでは記録のある日をつなぐ）。古い順
 */
export function weightMovingAverage(points: { date: DateKey; weightKg: number }[], days = 7): { date: DateKey; avgKg: number }[] {
  const sorted = [...points].sort((a, b) => (a.date < b.date ? -1 : 1));
  return sorted.map((p) => {
    const from = addDays(p.date, -(days - 1));
    const window = sorted.filter((q) => q.date >= from && q.date <= p.date);
    return { date: p.date, avgKg: window.reduce((a, q) => a + q.weightKg, 0) / window.length };
  });
}

/** from〜to（両端を含む）の体重の平均（記録のある日だけで出す）。記録がなければ null */
export function averageWeight(points: { date: DateKey; weightKg: number }[], from: DateKey, to: DateKey): number | null {
  const inRange = points.filter((p) => p.date >= from && p.date <= to);
  return inRange.length === 0 ? null : inRange.reduce((a, p) => a + p.weightKg, 0) / inRange.length;
}
