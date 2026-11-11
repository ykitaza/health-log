// 今日の衛星の軌道。形のまわりに、傾いただ円を3本（内側から 筋トレ・食事・睡眠）。
// 色（theme の growthColors）だけで見分けなくてよいように、衛星の形も変える（丸・ひし形・輪）。orbitPoint は UI スレッドで毎フレーム呼ぶので worklet

export type SatMark = 'dot' | 'diamond' | 'ring';

export type Orbit = {
  key: 'training' | 'food' | 'sleep';
  mark: SatMark;
  /** 軌道の傾き（ラジアン。画面の上で、右回りが正） */
  tilt: number;
  /** だ円の縦の比（横の半径に対する縦の半径） */
  aspect: number;
  /** いちばん外の軌道に対する半径の比 */
  radius: number;
  /** 衛星が1周する秒数（ゆっくり。軌道ごとにずらして、そろって動かないようにする） */
  period: number;
  /** 衛星の始めの位置（ラジアン） */
  phase: number;
};

export const ORBITS: readonly Orbit[] = [
  { key: 'training', mark: 'dot', tilt: -0.6, aspect: 0.3, radius: 0.62, period: 28, phase: 0.6 },
  { key: 'food', mark: 'diamond', tilt: -0.12, aspect: 0.34, radius: 0.82, period: 36, phase: 2.6 },
  { key: 'sleep', mark: 'ring', tilt: 0.38, aspect: 0.3, radius: 1.0, period: 46, phase: 4.4 },
];

/** 衛星の大きさ（半径、dp）。軌道を箱に収めるときの余白にも使う */
export const SAT_RADIUS = 5;

/** 傾いただ円の、横と縦の半分の幅（いちばん外の軌道の半径を 1 としたとき） */
function extent(o: Orbit): { x: number; y: number } {
  const a = o.radius;
  const b = o.radius * o.aspect;
  const c = Math.cos(o.tilt);
  const s = Math.sin(o.tilt);
  return { x: Math.hypot(a * c, b * s), y: Math.hypot(a * s, b * c) };
}

/**
 * いちばん外の軌道の半径（dp）。3本の軌道と衛星（光を含む）が、width × height の箱からはみ出さない最大の大きさ。
 * center は軌道の中心の、箱のまん中からのずれ（dp）
 */
export function outerOrbitRadius(width: number, height: number, center: { x: number; y: number } = { x: 0, y: 0 }): number {
  const margin = SAT_RADIUS * 2;
  const halfW = width / 2 - Math.abs(center.x) - margin;
  const halfH = height / 2 - Math.abs(center.y) - margin;
  let r = Infinity;
  for (const o of ORBITS) {
    const e = extent(o);
    r = Math.min(r, halfW / e.x, halfH / e.y);
  }
  return Math.max(0, r);
}

/** 衛星の位置（軌道の中心からのずれ、dp）。outer はいちばん外の軌道の半径、seconds は回し始めてからの秒数 */
export function orbitPoint(o: Orbit, outer: number, seconds: number): { x: number; y: number } {
  'worklet';
  const t = o.phase + (seconds / o.period) * Math.PI * 2;
  const ex = Math.cos(t) * outer * o.radius;
  const ey = Math.sin(t) * outer * o.radius * o.aspect;
  const c = Math.cos(o.tilt);
  const s = Math.sin(o.tilt);
  return { x: ex * c - ey * s, y: ex * s + ey * c };
}
