// 形「点の軌跡」：奇妙なアトラクタ（Clifford）で点を並べ、記録の値から、出す点の数・広がり・光の強さを決める。
// 点の並びは固定の順（同じ値なら毎回同じ形）。値が変わっても並びは作り直さず、「先頭から N 個を出す」だけにする。
// attractorLayout は、再生のとき UI スレッドで毎フレーム呼ぶので worklet にしている（jest ではただの関数として動く）
import type { GrowthParams } from './types';

/** 出す点の数の下限と上限。最初の数週間でもまばらにならない数と、Pixel で毎フレーム回しても重くならない数 */
export const MIN_POINTS = 900;
export const MAX_POINTS = 6000;

/**
 * 値がこの量のとき、伸びしろの約 63% まで育つ（1 - e^-1）。そこから先はゆっくり近づく。
 * 筋トレは1回 5〜10t ほどなので、20 回（2〜3か月）ほどで 63%。食事・睡眠は記録した日数
 */
export const VOLUME_SCALE_KG = 150_000;
export const FOOD_SCALE_DAYS = 60;
export const SLEEP_SCALE_DAYS = 60;
/** 記録を始めてからこの日数をかけて、種から点の群れへ移る（再生で種から形へ飛ばないように） */
export const SEED_RAMP_DAYS = 3;

// Clifford のアトラクタの係数（x, y）と、高さ（z）を作る係数。乱数は使わず、始まりの点も固定
const A = -1.7;
const B = 1.8;
const C = -1.9;
const D = -0.4;
const E = 1.3;
const F = 0.9;
/** 始めの数回は、点がアトラクタに落ち着くまでの道のりなので捨てる */
const BURN_IN = 200;

/**
 * 点の並び（x, y, z の順に3つずつ）。どの値も -1〜1 に収める。先頭からどこで切っても、アトラクタ全体に散らばる
 * （軌道を順にたどった並びなので、点を増やすと形が埋まっていく）
 */
export function attractorPoints(count: number = MAX_POINTS): Float32Array {
  const out = new Float32Array(count * 3);
  let x = 0.1;
  let y = 0.1;
  let max = 0;
  for (let i = -BURN_IN; i < count; i++) {
    const nx = Math.sin(A * y) + C * Math.cos(A * x);
    const ny = Math.sin(B * x) + D * Math.cos(B * y);
    x = nx;
    y = ny;
    if (i < 0) continue;
    const z = Math.sin(E * x) * Math.cos(F * y);
    out[i * 3] = x;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = z;
    max = Math.max(max, Math.hypot(x, y, z));
  }
  for (let i = 0; i < out.length; i++) out[i] /= max || 1;
  return out;
}

/**
 * 点ごとの色の混ぜ具合。0＝紫（中心に近い）、1＝緑（外側）。中心からの距離でなめらかに移す
 */
export function pointTints(points: Float32Array): Float32Array {
  const n = points.length / 3;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = Math.hypot(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]);
    out[i] = smoothstep(0.18, 0.5, r);
  }
  return out;
}

function smoothstep(a: number, b: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** 0 から始まり、scale のとき約 0.63、増えるほど 1 に近づく。負の値や数でない値は 0 として扱う */
function grow(value: number, scale: number): number {
  'worklet';
  const v = Number.isFinite(value) && value > 0 ? value : 0;
  return 1 - Math.exp(-v / scale);
}

export type AttractorLayout = {
  /** 出す点の数（小数。端の点はなめらかに現れる）。記録がまだなければ 0 */
  count: number;
  /** 広がり（形の大きさの倍率、0.55〜1） */
  spread: number;
  /** 光の強さ（0.35〜1） */
  glow: number;
};

/**
 * 記録の値から、点の数（筋トレ）・広がり（食事）・光の強さ（睡眠）を決める。段階ではなく連続して変わる。
 * days が 0（記録がまだない）なら点は出さない（種だけを出す）。そこから SEED_RAMP_DAYS 日かけて点が増える
 */
export function attractorLayout(p: GrowthParams): AttractorLayout {
  'worklet';
  const spread = 0.55 + 0.45 * grow(p.foodDays, FOOD_SCALE_DAYS);
  const glow = 0.35 + 0.65 * grow(p.sleepDays, SLEEP_SCALE_DAYS);
  const ramp = Number.isFinite(p.days) ? Math.min(1, Math.max(0, p.days / SEED_RAMP_DAYS)) : 0;
  const count = (MIN_POINTS + (MAX_POINTS - MIN_POINTS) * grow(p.volumeKg, VOLUME_SCALE_KG)) * ramp;
  return { count, spread, glow };
}
