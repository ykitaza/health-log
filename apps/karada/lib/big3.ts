import type { Big3Role } from './exercises';

/** BIG3 の役ごとの値（推定1RM、kg）。値のない役は null */
export type Big3Values = Record<Big3Role, number | null>;

/**
 * BIG3 の合計を出すときの、そろわない役の扱い。
 * - present：値のある役だけを足す（どの役にもなければ null）。ホーム・推移・フェーズの設定の合計
 * - all：3つそろわなければ null。月のレポートの合計（タイルを出さない）
 * 開始時と今の両方にある役だけを足すもの（lib/phases.ts の big3Totals）は、両方にある役に絞ってから present で足す
 */
export type Big3Missing = 'present' | 'all';

/**
 * 役ごとの値から BIG3 の合計を出す。丸めない（丸めは呼ぶ側）。
 * 足す順はベンチプレス・スクワット・デッドリフト（寄せる前のどの出し方とも同じ数字になる順）
 */
export function big3TotalOf(v: Big3Values, missing: Big3Missing): number | null {
  let sum = 0;
  let count = 0;
  for (const x of [v.bench, v.squat, v.deadlift]) {
    if (x == null) {
      if (missing === 'all') return null;
      continue;
    }
    sum += x;
    count += 1;
  }
  return count === 0 ? null : sum;
}
