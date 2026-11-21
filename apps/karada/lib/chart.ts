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

/**
 * グラフで選んだもの（棒・点）を押したときの次の選び：同じものをもう一度押すと外す（null）、ほかを押すとそれに変える。
 * 選びは日付などのキーで持つ（期間や週を変えて並びが変わっても、別の日を指したままにならない）
 */
export function toggleSelection(current: string | null, key: string): string | null {
  return current === key ? null : key;
}

/** 選んだキーの並びの中の位置。並びにない（期間を変えて外れた）ときは -1 */
export function selectedIndex(keys: readonly string[], selected: string | null): number {
  return selected == null ? -1 : keys.indexOf(selected);
}

/**
 * 横の位置 x（グラフの左からの px）にいちばん近いもの（棒のまん中・点）の位置。xs は左から順の px。空なら -1
 */
export function nearestIndex(xs: readonly number[], x: number): number {
  if (xs.length === 0) return -1;
  let best = 0;
  for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - x) < Math.abs(xs[best] - x)) best = i;
  return best;
}

/**
 * 各もの（棒・点）の押せる列：となりとの真ん中から真ん中まで。端の列は、グラフの左端（from）・右端（to）まで。
 * 列はすき間なく並ぶので、細い棒でも、その列のどこを押してもよい。返すのは { left, width }（px）
 */
export function hitColumns(xs: readonly number[], from: number, to: number): { left: number; width: number }[] {
  return xs.map((x, i) => {
    const l = i === 0 ? from : (xs[i - 1] + x) / 2;
    const r = i === xs.length - 1 ? to : (x + xs[i + 1]) / 2;
    return { left: l, width: Math.max(0, r - l) };
  });
}

/**
 * 選んだものの札の左の位置：札のまん中を cx に合わせ、グラフの幅（0〜width）からはみ出さないよう端に寄せる。札が幅より広いときは 0
 */
export function detailLeft(cx: number, cardW: number, width: number): number {
  if (cardW >= width) return 0;
  return Math.min(width - cardW, Math.max(0, cx - cardW / 2));
}

/** 指でなぞったと決める横の動き（px）。縦のスクロールより横が大きいときだけ */
export function isScrub(dx: number, dy: number): boolean {
  return Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.5;
}
