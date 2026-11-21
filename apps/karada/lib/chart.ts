import { DateKey, daysBetween, formatShortDate, addDays } from './date';

/** 日付の並びを、グラフの横の位置（0〜1）に置く。from〜to の範囲で */
export function datePoints<T extends { date: DateKey }>(items: T[], value: (t: T) => number, from: DateKey, to: DateKey) {
  const span = Math.max(1, daysBetween(from, to));
  return items.map((i) => ({ x: Math.min(1, Math.max(0, daysBetween(from, i.date) / span)), y: value(i) }));
}

/**
 * 線のグラフの読み上げの要約（例：「体重のグラフ。1か月。今 72.4kg、7日の平均 72.8kg、目標 70.0kg」）。
 * 値は表示と同じ単位の文字にしてから渡す。空（null・false・''）の項目は飛ばす
 */
export function lineSummary(title: string, span: string, parts: (string | null | false | undefined)[]): string {
  const body = parts.filter(Boolean).join('、');
  return `${title}のグラフ。${span}${body ? `。${body}` : ''}`;
}

/**
 * 推移の画面の、期間の記録（from〜to、両端を含む。古い順）と、その数・記録の始まり。
 * since は、選んだ期間より記録が短いとき（期間より前に記録がなく、期間の最初の記録が期間の始まりより後）だけ、その最初の記録の日。
 * 記録のない日は数えない（平均の母数は記録のある日の数）。期間を長くしても平均が変わらないのは、記録がその期間の分しかないとき
 */
export function periodRecords<T extends { date: DateKey }>(all: T[], from: DateKey, to: DateKey): { items: T[]; count: number; since: DateKey | null } {
  const items = all.filter((d) => d.date >= from && d.date <= to);
  const earlier = all.some((d) => d.date < from);
  const first = items[0]?.date ?? null;
  return { items, count: items.length, since: !earlier && first != null && first > from ? first : null };
}

/** 記録の始まりの添え書き（「（記録は 11/1 から）」）。since がなければ空 */
export function sinceNote(since: DateKey | null): string {
  return since == null ? '' : `（記録は ${formatShortDate(since)} から）`;
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
