// ホームに来たときの動き（数え上げ・折れ線・レーダー）を、いつ動かすか。
// アプリを開いているあいだ、前に見せた値を覚えておき、初めて見せるときと値が変わったときだけ動かす（タブの行き来や画面の作り直しでは動かさない）

/** 前に見せた値。sig は比べるための文字（数ならその文字、配列なら「,」でつないだもの） */
export type Shown<T> = { sig: string; value: T };

/**
 * 今の値を動かして見せるか。value が null（読み込む前）なら動かさない。
 * 前に見せた値がなければ（アプリを開いて初めて）動かし、前の値と違えば動かす。prev は動きの始まり（初めてなら null ＝ 0 から）
 */
export function entranceOf<T>(memo: Shown<T> | undefined, sig: string | null): { fresh: boolean; prev: T | null } {
  if (sig == null) return { fresh: false, prev: null };
  if (memo == null) return { fresh: true, prev: null };
  return { fresh: memo.sig !== sig, prev: memo.value };
}

/** 数え上げの途中の値（from から to へ。eased は 0〜1 のイージング済みの進み） */
export function countAt(from: number, to: number, eased: number): number {
  return from + (to - from) * eased;
}
