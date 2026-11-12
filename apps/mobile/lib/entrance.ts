// ホームの動き（数え上げ・折れ線・レーダー）を、いつ動かすか。
// ホームのタブが見えるようになるたび（フォーカスされるたび）と、見えているあいだに値が変わったときに動かす。
// 見えているあいだの同じ値の読み直しでは動かさない

/** 動かすかどうかの状態。sig は値を比べるための文字（読み込む前は null）、token は動かすたびに 1 増える */
export type Entrance<T> = { focused: boolean; sig: string | null; value: T | null; token: number; prev: T | null };

export const INITIAL_ENTRANCE: Entrance<never> = { focused: false, sig: null, value: null, token: 0, prev: null };

/**
 * 状態を進める。動かすのは、sig があって（読み込み済みで）、フォーカスされた（または見えているあいだに値が変わった）とき。
 * prev は動きの始まり。フォーカスされて動かすときと、読み込んで初めて見せるときは null（＝ 0 から）、見えているあいだに値が変わったときは前の値
 */
export function nextEntrance<T>(st: Entrance<T>, focused: boolean, sig: string | null, value: T | null): Entrance<T> {
  if (st.focused === focused && st.sig === sig) return st;
  const gained = focused && !st.focused;
  const play = focused && sig != null && (gained || st.sig !== sig);
  if (!play) return { ...st, focused, sig, value };
  const prev = gained || st.sig == null ? null : st.value;
  return { focused, sig, value, token: st.token + 1, prev };
}

/** 数え上げの途中の値（from から to へ。eased は 0〜1 のイージング済みの進み） */
export function countAt(from: number, to: number, eased: number): number {
  return from + (to - from) * eased;
}
