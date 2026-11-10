// 左右のスワイプで日（週）を動かす判定。縦のスクロールを邪魔しないよう、横の動きが十分大きく、縦の倍以上のときだけ受ける

/** 指を受け取り始める横の動き（dp）。これより小さい動きは、押す・縦のスクロールのまま */
export const SWIPE_CLAIM_DX = 24;
/** 放したときに日を動かす横の動き（dp） */
export const SWIPE_MIN_DX = 64;

const mostlyHorizontal = (dx: number, dy: number) => Math.abs(dx) >= Math.abs(dy) * 2;

/** 動いている途中で、スワイプとして指を受け取るか */
export function claimsSwipe(dx: number, dy: number): boolean {
  return Math.abs(dx) >= SWIPE_CLAIM_DX && mostlyHorizontal(dx, dy);
}

/**
 * 放したときの向き。指を右へ動かすと前（prev：前の日・前の週）、左へ動かすと次（next）。
 * 動きが小さい・斜めすぎるときは null
 */
export function swipeDirection(dx: number, dy: number): 'prev' | 'next' | null {
  if (Math.abs(dx) < SWIPE_MIN_DX || !mostlyHorizontal(dx, dy)) return null;
  return dx > 0 ? 'prev' : 'next';
}
