// 「記録で育つ形」の入力と、衛星の状態。形は lib/growth.ts に1つだけ置き、ここからも使えるように出し直す

export type { GrowthParams, SatState } from '../growth';

/** 形の種類。あとで 'galaxy' | 'tree' を足す */
export type ShapeKind = 'attractor';
