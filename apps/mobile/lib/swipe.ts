// 左右のスワイプで日（週）を動かす判定。縦のスクロールを邪魔しないよう、横の動きが十分大きく、縦の倍以上のときだけ受ける

/** 指を受け取り始める横の動き（dp）。これより小さい動きは、押す・縦のスクロールのまま */
export const SWIPE_CLAIM_DX = 24;
/** 放したときに日を動かす横の動き（dp） */
export const SWIPE_MIN_DX = 64;

export type SwipeDirection = 'prev' | 'next';

const mostlyHorizontal = (dx: number, dy: number) => Math.abs(dx) >= Math.abs(dy) * 2;

/** 動いている途中で、スワイプとして指を受け取るか */
export function claimsSwipe(dx: number, dy: number): boolean {
  return Math.abs(dx) >= SWIPE_CLAIM_DX && mostlyHorizontal(dx, dy);
}

/**
 * 放したときの向き。指を右へ動かすと前（prev：前の日・前の週）、左へ動かすと次（next）。
 * 動きが小さい・斜めすぎるときは null
 */
export function swipeDirection(dx: number, dy: number): SwipeDirection | null {
  if (Math.abs(dx) < SWIPE_MIN_DX || !mostlyHorizontal(dx, dy)) return null;
  return dx > 0 ? 'prev' : 'next';
}

/** 放したときに動かす向き。次へ進めない（今日・今週を見ている）ときの次は null（元の位置へ戻す） */
export function releaseDirection(dx: number, dy: number, canNext: boolean): SwipeDirection | null {
  const d = swipeDirection(dx, dy);
  return d === 'next' && !canNext ? null : d;
}

/** 進めない向きへ引いたときに、中身が動く上限（dp）。指をどれだけ動かしても、これより先へは動かない */
export const RUBBER_MAX_DX = 72;
/** ゴムの抵抗。小さいほど重い（引き始めは指の動きの約 0.55 倍で、だんだん重くなる） */
const RUBBER_K = 0.55;

/** ゴムのような抵抗をつけた動き。いつも指の動きより小さく、RUBBER_MAX_DX を超えない。向きは指と同じ */
export function rubberBand(dx: number, max = RUBBER_MAX_DX): number {
  const a = Math.abs(dx);
  if (a === 0) return 0;
  return Math.sign(dx) * (1 - 1 / ((a * RUBBER_K) / max + 1)) * max;
}

/**
 * 指を動かしている途中の、中身の横の位置（dp）。指を受け取るまでの SWIPE_CLAIM_DX の分は引いて、受け取った所から
 * なめらかに動き出す。次へ進めないときに左へ引いた分は、ゴムの抵抗をつける
 */
export function dragOffset(dx: number, canNext: boolean): number {
  const d = dx - Math.sign(dx) * Math.min(Math.abs(dx), SWIPE_CLAIM_DX);
  return d < 0 && !canNext ? rubberBand(d) : d;
}

/** 日（週）を変えたときの向き。'YYYY-MM-DD' の大小で決める（シートで選んだとき、今日に戻るとき）。同じ日なら null */
export function pageDirection(from: string, to: string): SwipeDirection | null {
  if (from === to) return null;
  return to < from ? 'prev' : 'next';
}

/** 中身が出ていく向き（横の位置の符号）。次は指を左へ動かすので左（-1）へ出て、右から入る。前はその逆 */
export function slideSign(direction: SwipeDirection): 1 | -1 {
  return direction === 'next' ? -1 : 1;
}

// 最初の数回だけのヒント（画面を開いたときに中身が少し左へずれて戻り、日付の切り替えの下に文を出す）

/** ヒントを出す画面（数は画面ごとに数える） */
export type SwipeHintKind = 'meal-day' | 'meal-week' | 'training-day';
/** 1つの画面でヒントを出す回数の上限 */
export const SWIPE_HINT_MAX = 3;
/** ヒントで中身をずらす幅（dp） */
export const SWIPE_HINT_NUDGE_DX = 24;

/** shown：その画面でヒントを出した回数。used：どこかの画面で一度でもスワイプで日（週）を動かしたか */
export type SwipeHintState = { shown: number; used: boolean };

/** ヒントを出すか。一度スワイプで動かしたら、もう出さない。出したのが上限に届いたら出さない */
export function showsSwipeHint(s: SwipeHintState): boolean {
  return !s.used && s.shown < SWIPE_HINT_MAX;
}

export function swipeHintText(kind: SwipeHintKind): string {
  return `左右にスワイプで${kind === 'meal-week' ? '週' : '日'}を移れます`;
}
