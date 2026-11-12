// 形に共通の道具：値 → 点の数・広がり・光の型、育ち方の曲線、固定の種の乱数、形が箱に収まる大きさ。
// grow は、再生のとき UI スレッドで毎フレーム呼ぶので worklet にしている（jest ではただの関数として動く）
import { outerOrbitRadius } from './orbits';

export type ShapeLayout = {
  /** 出す点の数（並びの先頭から。小数。端の点はなめらかに現れる）。記録がまだなければ 0 */
  count: number;
  /** 広がり（形の大きさの倍率、0.55〜1） */
  spread: number;
  /** 光の強さ（0.35〜1） */
  glow: number;
  /**
   * 組ごとの、出す割合（0〜1）。点の並びの gates と合わせて使う（木の葉は食事、光の粒は睡眠）。
   * 組を使わない形では省く
   */
  fills?: readonly number[];
};

/** 0 から始まり、scale のとき約 0.63、増えるほど 1 に近づく。負の値や数でない値は 0 として扱う */
export function grow(value: number, scale: number): number {
  'worklet';
  const v = Number.isFinite(value) && value > 0 ? value : 0;
  return 1 - Math.exp(-v / scale);
}

/** 記録を始めた日から ramp 日かけて 0 → 1（種から形へ）。数でない値は 0 */
export function seedRamp(days: number, rampDays: number): number {
  'worklet';
  return Number.isFinite(days) ? Math.min(1, Math.max(0, days / rampDays)) : 0;
}

export function smoothstep(a: number, b: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** 種を固定した乱数（mulberry32）。0 以上 1 未満を返す。同じ種なら毎回同じ並び */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 平均 0・標準偏差 1 のばらつき（Box-Muller） */
export function gaussian(rand: () => number): number {
  const u = 1 - rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

/** 奥行きの強さ（手前の点を少し大きく、奥を少し小さく） */
export const PERSPECTIVE = 0.22;
/** 広がりが最大のとき、形の半径はいちばん外の軌道のこの割合 */
export const SHAPE_RATIO = 0.75;
/** 衛星を描かないとき、広がりが最大の形の半径は、箱の短い辺の半分のこの割合 */
export const SOLO_RATIO = 0.94;

/**
 * 広がりが最大のときの形の半径（dp）。衛星ありなら軌道（中心をずらさないとき）に合わせ、なしなら箱いっぱい。
 * そのうえで、縦長・横長の形（木・銀河）も、どう回しても箱（端から margin の内側）からはみ出さない大きさに抑える。
 * extent は shapeExtent の値
 */
export function shapeUnit(width: number, height: number, extent: { x: number; y: number }, withSats: boolean, margin: number): number {
  return Math.min(
    withSats ? outerOrbitRadius(width, height) * SHAPE_RATIO : (Math.min(width, height) / 2) * SOLO_RATIO,
    Math.max(0, width / 2 - margin) / extent.x,
    Math.max(0, height / 2 - margin) / extent.y,
  );
}

/** 点の大きさと濃さを、そのまま（1倍）にする形の半径（dp）。「成長を見る」の大きな形がこのくらい */
export const DOT_FULL_UNIT = 190;
/** 小さい形（ホーム、形を選ぶシートの絵）で、点の大きさを下げる下限の倍率 */
export const DOT_MIN_SCALE = 0.3;

/**
 * 形の大きさ（unit：広がりが最大のときの形の半径、dp）に合わせた、点の大きさの倍率と濃さの倍率。
 * 点を形の大きさによらず同じ大きさで描くと、小さい形では数千の点が重なって白くにじみ、線が太く見える（実機）。
 * 小さい形ほど点を小さく、少し薄くする（大きさは形の半径に比べて、濃さはその半分ほどの割合で下げる）
 */
export function dotStyle(unit: number): { size: number; alpha: number } {
  const size = Math.min(1, Math.max(DOT_MIN_SCALE, unit / DOT_FULL_UNIT));
  return { size, alpha: 0.55 + 0.45 * size };
}

/** shapeExtent で調べる回転の向きの数と、そのあいだを見落とす分の上乗せ */
const EXTENT_STEPS = 72;
const EXTENT_MARGIN = 1.01;

/**
 * 点の並びを Y 軸まわりに回し（1周を EXTENT_STEPS に分けて調べる）、X 軸まわりに tilt 倒し、奥行き（perspective）を
 * つけたとき、画面の上で中心から横・縦にどこまで届くか（形の半径を 1 としたとき）。描くときと同じ計算
 * （components/growth/GrowthShape.tsx）。形を箱に収める大きさを決めるのに使う
 */
export function shapeExtent(points: Float32Array, tilt: number, perspective: number): { x: number; y: number } {
  const tc = Math.cos(tilt);
  const ts = Math.sin(tilt);
  let x = 0;
  let y = 0;
  for (let k = 0; k < EXTENT_STEPS; k++) {
    const a = (k / EXTENT_STEPS) * Math.PI * 2;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    for (let i = 0; i < points.length; i += 3) {
      const x1 = points[i] * cos + points[i + 2] * sin;
      const z1 = points[i + 2] * cos - points[i] * sin;
      const y2 = points[i + 1] * tc - z1 * ts;
      const z2 = points[i + 1] * ts + z1 * tc;
      const p = 1 / (1 - z2 * perspective);
      x = Math.max(x, Math.abs(x1 * p));
      y = Math.max(y, Math.abs(y2 * p));
    }
  }
  return { x: x * EXTENT_MARGIN, y: y * EXTENT_MARGIN };
}
