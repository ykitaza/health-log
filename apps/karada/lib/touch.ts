/** 押せるものの最小の大きさ（Material 3・Android のアクセシビリティの指針。48×48dp） */
export const MIN_TOUCH = 48;

/** 見た目の大きさ size のものを、押せる範囲で MIN_TOUCH にするための片側の hitSlop（least 以上） */
export function touchSlop(size: number, least = 0): number {
  return Math.max(least, Math.ceil((MIN_TOUCH - size) / 2));
}

/**
 * 親の高さを、見た目（まわりとの間）を変えずに上下へ n 広げるスタイル。Android では hitSlop が親の外に出ないので、
 * 小さな行の中の押せるものは、親を広げてから hitSlop を付ける。margin はもとの上下の margin
 */
export const touchRoom = (n: number, margin: { top?: number; bottom?: number } = {}) =>
  ({ paddingVertical: n, marginTop: (margin.top ?? 0) - n, marginBottom: (margin.bottom ?? 0) - n });

/**
 * 見た目と並びの大きさが size×size の押せるもの（44 のボタンなど）を、押せる範囲だけ MIN_TOUCH にするスタイル。
 * 外へ広げた分を負の margin で打ち消すので、並びと見た目（中の印の位置）は変わらない
 */
export const touchSquare = (size: number) => ({ width: MIN_TOUCH, height: MIN_TOUCH, margin: -(MIN_TOUCH - size) / 2 });

/** 高さ height の行（メニューの行など）を、押せる範囲だけ縦 MIN_TOUCH にするスタイル（並びは負の margin で打ち消して今のまま） */
export const touchRow = (height: number) => ({ minHeight: MIN_TOUCH, marginVertical: -(MIN_TOUCH - height) / 2 });
