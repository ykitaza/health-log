// 「記録で育つ形」の入力と、衛星の状態。lib/growth.ts（別の PR）にも同じ形で置かれる。あとで1つにまとめる

/** その日までの記録の値。volumeKg は筋トレの合計負荷量の累計、foodDays・sleepDays は食事・睡眠を記録した日数、days は最初の記録の日からの日数 */
export type GrowthParams = { volumeKg: number; foodDays: number; sleepDays: number; days: number };

/** 今日の衛星。none＝点線の軌道だけ、dim＝薄い衛星、bright＝明るく光る衛星 */
export type SatState = 'none' | 'dim' | 'bright';

/** 形の種類。あとで 'galaxy' | 'tree' を足す */
export type ShapeKind = 'attractor';
