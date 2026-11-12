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
  /**
   * 部位ごとの育ち具合（0〜1。partGrowth の値）。点の並びの parts（どの部位の点か）と partMin（その点が出る最小の育ち具合）と比べる
   * （木の枝・銀河の腕）。部位を使わない形では省く
   */
  parts?: readonly number[];
  /** 部位ごとの大きさの倍率（木の太い枝の長さ。その部位の付け根 pivots を中心に縮める）。省けば 1 */
  partScale?: readonly number[];
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

/** 部位のセット数の育ち方の目安（このセット数で約 0.63） */
export const PART_SCALE_SETS = 110;

/** 部位の累計セット数 → 育ち具合（0〜1）。セット数が多いほど 1 に近づく */
export function partGrowth(sets: number): number {
  'worklet';
  return grow(sets, PART_SCALE_SETS);
}

/** 出す点の数・組・部位の端で、なめらかに現れる幅（点の数・割合・育ち具合） */
export const FADE_POINTS = 60;
export const FADE_FILL = 0.04;
export const FADE_PART = 0.05;

/**
 * 点 i をどれだけ出すか（1 以上ならそのまま、0 以下なら出さない。あいだは小さく描いて、なめらかに現れる）。
 * 描くとき（GrowthShape）と確かめ（jest・見た目の画像）で同じものを使う。
 * - 並びの先頭から count 個（筋トレの量）
 * - 組のある点（gates）は、その組の出す割合（fills）が順位を超えたら（木の葉は食事、光の粒は睡眠）
 * - 部位のある点（parts）は、その部位の育ち具合（growth）が、その点の出る最小の育ち具合（partMin）を超えたら
 */
export function pointShown(
  i: number, count: number, gates: Float32Array, fills: readonly number[], parts: Float32Array, partMin: Float32Array, growth: readonly number[],
): number {
  'worklet';
  let k = Math.min(1, (count - i) / FADE_POINTS);
  if (k <= 0) return k;
  const g = i < gates.length ? gates[i] : -1;
  if (g >= 0) {
    const c = Math.floor(g);
    k = Math.min(k, ((fills[c] ?? 1) - (g - c)) / FADE_FILL);
  }
  const p = i < parts.length ? parts[i] : -1;
  if (p >= 0) k = Math.min(k, ((growth[p] ?? 1) - partMin[i]) / FADE_PART + 1);
  return k;
}

/**
 * 揺れ（木）：根元（y = rootY。y は下が正）より上の点を、高さの2乗に比べて横へずらす。bend は揺れの量（左右の向きで符号）
 */
export function swayX(x: number, y: number, rootY: number, bend: number): number {
  'worklet';
  const h = Math.max(0, rootY - y);
  return x + bend * h * h;
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

/** placePoint で、点ごとに変わらない値（毎フレーム1回だけ決める） */
export type PlaceFrame = {
  /** Y 軸まわりの回転の cos・sin（揺れる形は 1・0） */
  cos: number;
  sin: number;
  /** 手前に倒す傾きの cos・sin */
  tiltCos: number;
  tiltSin: number;
  /** 揺れの量（swayX の bend）と、揺れの根元の y（回す形は bend を 0） */
  bend: number;
  rootY: number;
};

/** 1つの点（x, y, z）を揺らし、回して倒し、奥行きをつける（placePoint の後半。部位の名前の位置にも使う） */
export function projectPoint(x: number, y: number, z: number, f: PlaceFrame): { x: number; y: number; p: number } {
  'worklet';
  const xs = f.bend === 0 ? x : swayX(x, y, f.rootY, f.bend);
  const x1 = xs * f.cos + z * f.sin;
  const z1 = z * f.cos - xs * f.sin;
  const y2 = y * f.tiltCos - z1 * f.tiltSin;
  const z2 = y * f.tiltSin + z1 * f.tiltCos;
  const p = 1 / (1 - z2 * PERSPECTIVE);
  return { x: x1 * p, y: y2 * p, p };
}

/**
 * 点 i の画面の上の位置（形の半径を 1、中心を 0 としたとき。y は下が正）と、奥行きの倍率 p。
 * 部位のある点は、その部位の付け根（pivots）を中心に partScale 倍に縮め、揺らし、Y 軸まわりに回してから X 軸まわりに倒す。
 * 描くとき（GrowthShape）と見た目の確かめで同じものを使う
 */
export function placePoint(
  points: Float32Array, i: number, parts: Float32Array, pivots: Float32Array, partScale: readonly number[], f: PlaceFrame,
): { x: number; y: number; p: number } {
  'worklet';
  let x = points[i * 3];
  let y = points[i * 3 + 1];
  let z = points[i * 3 + 2];
  const part = i < parts.length ? parts[i] : -1;
  if (part >= 0 && part < partScale.length) {
    const s = partScale[part];
    const px = pivots[part * 3];
    const py = pivots[part * 3 + 1];
    const pz = pivots[part * 3 + 2];
    x = px + (x - px) * s;
    y = py + (y - py) * s;
    z = pz + (z - pz) * s;
  }
  return projectPoint(x, y, z, f);
}

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

/**
 * 揺れる形（回さない形）が、画面の上で中心から横・縦にどこまで届くか。揺れのいちばん端（左右）と、揺れていないときで調べる。
 * 回す形の shapeExtent と同じ使い方
 */
export function swayExtent(points: Float32Array, tilt: number, perspective: number, rootY: number, bend: number): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const b of [-bend, 0, bend]) {
    const moved = new Float32Array(points);
    for (let i = 0; i < moved.length; i += 3) moved[i] = swayX(points[i], points[i + 1], rootY, b);
    const e = projectedExtent(moved, tilt, perspective, [0]);
    x = Math.max(x, e.x);
    y = Math.max(y, e.y);
  }
  return { x: x * EXTENT_MARGIN, y: y * EXTENT_MARGIN };
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
  const angles = Array.from({ length: EXTENT_STEPS }, (_, k) => (k / EXTENT_STEPS) * Math.PI * 2);
  const e = projectedExtent(points, tilt, perspective, angles);
  return { x: e.x * EXTENT_MARGIN, y: e.y * EXTENT_MARGIN };
}

/** 点の並びを Y 軸まわりに angles の向きへ回して倒したとき、画面の上で届く横・縦（上乗せなし） */
function projectedExtent(points: Float32Array, tilt: number, perspective: number, angles: number[]): { x: number; y: number } {
  const tc = Math.cos(tilt);
  const ts = Math.sin(tilt);
  let x = 0;
  let y = 0;
  for (const a of angles) {
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
  return { x, y };
}
