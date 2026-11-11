// 「記録で育つ形」の入力と、衛星の状態。形は lib/growth.ts に1つだけ置き、ここからも使えるように出し直す

export type { GrowthParams, SatState } from '../growth';

/** 形の種類：点の軌跡（最初の形）・木・銀河 */
export type ShapeKind = 'attractor' | 'tree' | 'galaxy';

/** 選べる形の並び（「形を選ぶ」のシートの順）。先頭が最初の形 */
export const SHAPE_KINDS: readonly ShapeKind[] = ['attractor', 'tree', 'galaxy'];
