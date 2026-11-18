import { DateKey, daysBetween, formatShortDate, addDays } from './date';

/** 日付の並びを、グラフの横の位置（0〜1）に置く。from〜to の範囲で */
export function datePoints<T extends { date: DateKey }>(items: T[], value: (t: T) => number, from: DateKey, to: DateKey) {
  const span = Math.max(1, daysBetween(from, to));
  return items.map((i) => ({ x: Math.min(1, Math.max(0, daysBetween(from, i.date) / span)), y: value(i) }));
}

/** 横軸の目盛り（両端を含めて count 個） */
export function dateLabels(from: DateKey, to: DateKey, count = 4) {
  const span = Math.max(1, daysBetween(from, to));
  return Array.from({ length: count }, (_, i) => {
    const x = count === 1 ? 1 : i / (count - 1);
    return { x, label: formatShortDate(addDays(from, Math.round(span * x))) };
  });
}

/** 縦軸の目盛り（1, 2, 5 × 10^n 刻み）。最小と最大を必ず含む */
export function niceTicks(min: number, max: number, count = 3): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) { min -= 1; max += 1; }
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.floor(min / step) * step; ; v += step) {
    out.push(Math.round(v * 1e6) / 1e6);
    if (v >= max - 1e-9) break;
  }
  return out;
}
