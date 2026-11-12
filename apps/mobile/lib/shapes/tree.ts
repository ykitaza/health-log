// 形「木」：幹から6本の太い枝が左右に3本ずつ分かれ、上で広がる樹冠になる木。枝に沿って並べた点と、枝先の葉・光の粒の点で作る。
// 6本の太い枝は部位（lib/partBalance.ts の BALANCE_PARTS。ホームの「部位のバランス」のレーダーと同じ並び）で、
// その部位の累計セット数が多いほど、枝が長く（付け根を中心に 0.5〜1 倍）・深く分かれ（3〜5段）・葉が多く茂る。
// 枝はほぼ画面の面（XY 面）に広げ、回さずに左右へ小さく揺らす（枝と部位の対応が崩れないように）。
// 点の並びは根元からの枝の道のりの順（幹 → 太い枝 → 細い枝 → 葉）。「先頭から N 個を出す」だけで、幹から先へ伸びていく。
// 葉と光の粒には組（gates）を付け、食事・睡眠で出す割合を決める。枝と葉には部位（parts）と、出る最小の育ち具合（partMin）を付ける。
// 乱数は種を固定する（同じ値なら毎回同じ形）。treeLayout は UI スレッドで毎フレーム呼ぶので worklet
import { axisAngle, BALANCE_PARTS } from '../partBalance';
import { FOOD_SCALE_DAYS, MIN_POINTS, SEED_RAMP_DAYS, SLEEP_SCALE_DAYS, VOLUME_SCALE_KG } from './attractor';
import { gaussian, grow, partGrowth, seededRandom, seedRamp, ShapeLayout } from './common';
import type { GrowthParams } from './types';

/** 点の数の上限と内訳（枝・根・葉・光の粒） */
const BRANCH_POINTS = 2400;
const ROOT_POINTS = 100;
const LEAF_POINTS = 2400;
const SPARK_POINTS = 600;
export const TREE_POINTS = BRANCH_POINTS + ROOT_POINTS + LEAF_POINTS + SPARK_POINTS;

/** 部位の数（太い枝の数） */
const PARTS = BALANCE_PARTS.length;
/** 枝分かれの段の数（幹が 0、太い枝が 1）。いちばん育った部位でこの段まで、育っていない部位でも MIN_DEPTH 段まで出す */
const DEPTH = 5;
const MIN_DEPTH = 3;
/** 太い枝の長さの倍率の下限（育っていない部位。育つと 1） */
export const MIN_BRANCH_SCALE = 0.5;
/** 幹の長さ、太い枝の長さ（上の段。下の段ほど少し短い）、子の枝の長さの比、幹の太さ */
const TRUNK_LENGTH = 0.8;
const MAIN_LENGTH = 0.62;
export const LENGTH_RATIO = 0.7;
const TRUNK_THICKNESS = 0.055;
/** 子の枝が親から開く角度（ラジアン）と、上へ寄せる強さ（向きの角度に掛ける） */
export const ANGLE = 0.3;
const UPWARD = 0.9;
/** 太い枝の付け根の高さ（幹の長さに対する割合）と、まっすぐ上からの傾き（ラジアン）。上の段 → まん中 → 下の段 */
const ATTACH_HEIGHTS = [1.0, 0.84, 0.68];
const ATTACH_LEANS = [0.3, 0.8, 1.25];
/** 揺れの量（swayX の bend の最大。根元からの高さ 1 で、形の半径のこの割合だけ横へずれる） */
export const TREE_SWAY = 0.025;
/** 枝の奥行き（Z）の揺らぎ。ほぼ面に広げ、少しだけ奥行きをつける */
const DEPTH_JITTER = 0.18;
/** 枝先の葉と光の粒の、枝先からの散らばり */
const LEAF_SPREAD = 0.06;
const SPARK_SPREAD = 0.1;
/** 葉・光の粒が現れる順を、枝先の道のりから少しだけずらす幅 */
const LEAF_ORDER_JITTER = 0.12;
const SEED = 20261112;

/** 葉・光の粒が、記録がなくても出る割合（はだかの木にしない） */
const LEAF_MIN = 0.2;
const SPARK_MIN = 0.1;

/**
 * 色の混ぜ具合（TREE_PALETTE の位置）。0＝光の粒（紫）、1/3＝幹（暗い緑）、2/3＝細い枝（緑）、1＝葉（水色寄り）
 */
const TINT_SPARK = 0;
const TINT_TRUNK = 1 / 3;
const TINT_TWIG = 0.6;
const TINT_LEAF = 2 / 3;

/** 点の組：葉は fills[0]（食事）、光の粒は fills[1]（睡眠）と比べる。枝と根は組なし（-1） */
const GATE_NONE = -1;
const GATE_LEAF = 0;
const GATE_SPARK = 1;

type Item = { key: number; x: number; y: number; z: number; tint: number; gate: number; part: number; min: number };
type Branch = {
  x: number; y: number; z: number; dx: number; dy: number; dz: number; length: number; thickness: number; depth: number; arc: number; part: number;
};

export type TreeShape = {
  /** 点の並び（x, y, z の順に3つずつ、-1〜1。y は下が正）。根元からの枝の道のりの順 */
  points: Float32Array;
  /** 点ごとの色の混ぜ具合（TREE_PALETTE の位置） */
  tints: Float32Array;
  /** 点ごとの組と、出る順（組の番号 ＋ 0〜1 の順位。組なしは -1） */
  gates: Float32Array;
  /** 点ごとの部位（BALANCE_PARTS の番号。幹と根は -1） */
  parts: Float32Array;
  /** 点ごとの、出る最小の育ち具合（0〜1。その部位の育ち具合がこれ以上なら出る） */
  partMin: Float32Array;
  /** 部位ごとの太い枝の付け根（x, y, z の順に3つずつ）。枝の長さはここを中心に縮める */
  pivots: Float32Array;
  /**
   * 名前を置く枝の先の候補（部位のある枝。1つにつき TIP_STRIDE 個の数）。
   * partTip で、いま出ている枝の先のうち付け根からいちばん遠いものを選ぶ
   */
  tips: Float32Array;
  /** 根元（種を置く所）の y（-1〜1。下が正） */
  seedY: number;
};

/**
 * 部位 i の太い枝の、付け根の段（0＝上、1＝まん中、2＝下）と左右（-1＝左、1＝右）。
 * レーダーの軸の向き（axisAngle）をそのまま使う：左上の胸は左の上、左の腹は左のまん中、左下の脚は左の下。
 * 右上の肩は右の上、右の背中は右のまん中、右下の腕は右の下
 */
export function treeBranchSlot(i: number): { tier: number; side: number } {
  const a = axisAngle(i);
  return { tier: Math.round(Math.sin(a) / Math.sin(Math.PI / 3)) + 1, side: Math.cos(a) < 0 ? -1 : 1 };
}

/**
 * 枝の点が出る最小の育ち具合。depth 段目の枝の、根元からの割合 s（0〜1）の所。
 * 段数は育ち具合 g で MIN_DEPTH + (DEPTH − MIN_DEPTH)・g まで伸びる（MIN_DEPTH 段までは、いつも出す）
 */
function branchMin(depth: number, s: number): number {
  return Math.min(1, Math.max(0, (depth - 1 + s - MIN_DEPTH) / (DEPTH - MIN_DEPTH)));
}

/** d に直交する2つの向き */
function basis(dx: number, dy: number, dz: number): [number[], number[]] {
  const ax = Math.abs(dy) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let ux = dy * ax[2] - dz * ax[1];
  let uy = dz * ax[0] - dx * ax[2];
  let uz = dx * ax[1] - dy * ax[0];
  const ul = Math.hypot(ux, uy, uz);
  ux /= ul;
  uy /= ul;
  uz /= ul;
  return [[ux, uy, uz], [dy * uz - dz * uy, dz * ux - dx * uz, dx * uy - dy * ux]];
}

/** 木の点の並び・色・組・部位。最初に1回だけ作る */
export function treeShape(): TreeShape {
  const rand = seededRandom(SEED);
  // 枝を幹から順に作る（y が上）
  const branches: Branch[] = [];
  /** MIN_DEPTH 段より先の枝。その先に葉と光の粒を置く */
  const leafTips: Branch[] = [];
  const addBranch = (b: Branch) => {
    branches.push(b);
    if (b.depth >= MIN_DEPTH) leafTips.push(b);
    if (b.depth === DEPTH) return;
    const ex = b.x + b.dx * b.length;
    const ey = b.y + b.dy * b.length;
    const ez = b.z + b.dz * b.length;
    const kids = rand() < 0.35 ? 3 : 2;
    // 親の向き（画面の面の中の角度。0＝まっすぐ上、正＝右）から、左右に開く。少しだけ上へ寄せる
    const base = Math.atan2(b.dx, b.dy);
    for (let k = 0; k < kids; k++) {
      const off = kids === 2 ? (k === 0 ? -1 : 1) : k - 1;
      const a = (base + off * ANGLE * (0.8 + 0.4 * rand()) + (rand() - 0.5) * 0.15) * UPWARD;
      const dz = (rand() - 0.5) * DEPTH_JITTER;
      const h = Math.sqrt(1 - dz * dz);
      addBranch({
        x: ex, y: ey, z: ez, dx: Math.sin(a) * h, dy: Math.cos(a) * h, dz,
        length: b.length * LENGTH_RATIO * (0.85 + 0.3 * rand()),
        thickness: b.thickness * 0.62,
        depth: b.depth + 1,
        arc: b.arc + b.length,
        part: b.part,
      });
    }
  };
  branches.push({ x: 0, y: 0, z: 0, dx: 0, dy: 1, dz: 0, length: TRUNK_LENGTH, thickness: TRUNK_THICKNESS, depth: 0, arc: 0, part: -1 });
  const pivotsUp: number[][] = [];
  for (let p = 0; p < PARTS; p++) {
    const { tier, side } = treeBranchSlot(p);
    const y = TRUNK_LENGTH * ATTACH_HEIGHTS[tier];
    const a = side * ATTACH_LEANS[tier];
    pivotsUp.push([0, y, 0]);
    addBranch({
      x: 0, y, z: 0, dx: Math.sin(a), dy: Math.cos(a), dz: 0,
      length: MAIN_LENGTH * (1 - 0.1 * tier), thickness: TRUNK_THICKNESS * 0.62, depth: 1, arc: y, part: p,
    });
  }

  const items: Item[] = [];
  // 名前を置く枝の先の候補（部位のある枝。あとで並びの番号を付ける）
  const ends = branches.filter((b) => b.part >= 0);
  // 枝：長さと太さに応じて点を割り振る。太い枝は点を太さの中に散らす
  const weights = branches.map((b) => b.length * (0.4 + b.thickness / TRUNK_THICKNESS));
  const total = weights.reduce((s, w) => s + w, 0);
  let left = BRANCH_POINTS;
  branches.forEach((b, bi) => {
    const n = bi === branches.length - 1 ? left : Math.min(left, Math.round((BRANCH_POINTS * weights[bi]) / total));
    left -= n;
    const [u, v] = basis(b.dx, b.dy, b.dz);
    const tint = TINT_TRUNK + (TINT_TWIG - TINT_TRUNK) * (b.depth / DEPTH);
    for (let i = 0; i < n; i++) {
      const s = rand() * b.length;
      const r = b.thickness * (1 - 0.3 * (s / b.length)) * Math.sqrt(rand());
      const f = rand() * Math.PI * 2;
      items.push({
        key: b.arc + s,
        x: b.x + b.dx * s + (u[0] * Math.cos(f) + v[0] * Math.sin(f)) * r,
        y: b.y + b.dy * s + (u[1] * Math.cos(f) + v[1] * Math.sin(f)) * r,
        z: b.z + b.dz * s + (u[2] * Math.cos(f) + v[2] * Math.sin(f)) * r,
        tint,
        gate: GATE_NONE,
        part: b.part,
        min: b.part < 0 ? 0 : branchMin(b.depth, s / b.length),
      });
    }
  });
  // 根：根元から外へ、少し下がる短い根を5本
  for (let i = 0; i < ROOT_POINTS; i++) {
    const k = i % 5;
    const f = (k / 5) * Math.PI * 2 + 0.4;
    const s = rand() * (0.2 + 0.06 * Math.sin(k * 2.3));
    items.push({
      key: s * 0.5,
      x: Math.cos(f) * s,
      y: -s * 0.25 + gaussian(rand) * 0.004,
      z: Math.sin(f) * s * 0.4,
      tint: TINT_TRUNK,
      gate: GATE_NONE,
      part: -1,
      min: 0,
    });
  }
  // 葉と光の粒：MIN_DEPTH 段より先の枝先のまわり。枝先までの道のりのあとに現れ、その枝先まで伸びたら出る
  const scatter = (count: number, spread: number, jitter: number, gate: number, tint: () => number) => {
    for (let i = 0; i < count; i++) {
      const b = leafTips[i % leafTips.length];
      const ex = b.x + b.dx * b.length;
      const ey = b.y + b.dy * b.length;
      const ez = b.z + b.dz * b.length;
      items.push({
        key: b.arc + b.length + rand() * jitter,
        x: ex + gaussian(rand) * spread,
        y: ey + gaussian(rand) * spread * 0.8 + spread * 0.3,
        z: ez + gaussian(rand) * spread * 0.5,
        tint: tint(),
        gate: gate + rand() * 0.999,
        part: b.part,
        min: Math.max(0, branchMin(b.depth, 1) - rand() * 0.06),
      });
    }
  };
  scatter(LEAF_POINTS, LEAF_SPREAD, LEAF_ORDER_JITTER, GATE_LEAF, () => TINT_LEAF + (1 - TINT_LEAF) * rand());
  scatter(SPARK_POINTS, SPARK_SPREAD, LEAF_ORDER_JITTER * 1.5, GATE_SPARK, () => TINT_SPARK);

  items.sort((p, q) => p.key - q.key);
  // 縦のまん中を 0 にし、y を下が正に。いちばん遠い点が半径 1 になるようにそろえる
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of items) {
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const midY = (minY + maxY) / 2;
  let max = 0;
  for (const p of items) max = Math.max(max, Math.hypot(p.x, p.y - midY, p.z));
  const n = items.length;
  const points = new Float32Array(n * 3);
  const tints = new Float32Array(n);
  const gates = new Float32Array(n);
  const parts = new Float32Array(n);
  const partMin = new Float32Array(n);
  items.forEach((p, i) => {
    points[i * 3] = p.x / max;
    points[i * 3 + 1] = (midY - p.y) / max;
    points[i * 3 + 2] = p.z / max;
    tints[i] = p.tint;
    gates[i] = p.gate;
    parts[i] = p.part;
    partMin[i] = p.min;
  });
  const pivots = new Float32Array(PARTS * 3);
  pivotsUp.forEach(([x, y, z], p) => pivots.set([x / max, (midY - y) / max, z / max], p * 3));
  // 名前を置く枝の先の候補：枝の根元と先、それぞれが並びの何番目か（先頭から count 個を出すとき、count がこれを超えたら届いている）、
  // それぞれが出る最小の育ち具合
  const indexOf = (key: number) => {
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (items[mid].key < key) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const tips = new Float32Array(ends.length * TIP_STRIDE);
  ends.forEach((b, k) => {
    tips.set([
      b.part, b.x / max, (midY - b.y) / max, b.z / max,
      (b.x + b.dx * b.length) / max, (midY - (b.y + b.dy * b.length)) / max, (b.z + b.dz * b.length) / max,
      indexOf(b.arc), indexOf(b.arc + b.length), branchMin(b.depth, 0), branchMin(b.depth, 1),
    ], k * TIP_STRIDE);
  });
  return { points, tints, gates, parts, partMin, pivots, tips, seedY: midY / max };
}

/** tips の1つ分の数（部位、根元の x・y・z、先の x・y・z、根元と先の並びの番号、根元と先が出る最小の育ち具合） */
export const TIP_STRIDE = 11;

/**
 * 部位 p の名前を置く枝の先（x, y, z。長さの倍率 scale をかけたあと）。先頭から count 個を出し、その部位の育ち具合が g のとき、
 * 出ている枝（伸びている途中の枝は、伸びた所まで）の先のうち、付け根からいちばん遠いもの。その部位の枝がまだ出ていなければ null（名前を出さない）
 */
export function partTip(
  tips: Float32Array, pivots: Float32Array, p: number, count: number, g: number, scale: number,
): { x: number; y: number; z: number } | null {
  'worklet';
  const px = pivots[p * 3];
  const py = pivots[p * 3 + 1];
  const pz = pivots[p * 3 + 2];
  let far = -1;
  let bx = 0;
  let by = 0;
  let bz = 0;
  for (let k = 0; k < tips.length; k += TIP_STRIDE) {
    if (tips[k] !== p) continue;
    // 枝の根元から先まで、どこまで出ているか（0〜1）。点の数と育ち具合の、短いほう
    const byCount = tips[k + 8] > tips[k + 7] ? (count - tips[k + 7]) / (tips[k + 8] - tips[k + 7]) : count > tips[k + 8] ? 1 : 0;
    const byGrowth = tips[k + 10] > tips[k + 9] ? (g - tips[k + 9]) / (tips[k + 10] - tips[k + 9]) : g >= tips[k + 10] ? 1 : 0;
    const f = Math.min(1, byCount, byGrowth);
    if (f <= 0) continue;
    const x = tips[k + 1] + (tips[k + 4] - tips[k + 1]) * f;
    const y = tips[k + 2] + (tips[k + 5] - tips[k + 2]) * f;
    const d = Math.hypot(x - px, y - py);
    if (d > far) {
      far = d;
      bx = x;
      by = y;
      bz = tips[k + 3] + (tips[k + 6] - tips[k + 3]) * f;
    }
  }
  if (far < 0) return null;
  return { x: px + (bx - px) * scale, y: py + (by - py) * scale, z: pz + (bz - pz) * scale };
}

/**
 * 記録の値から、点の数（筋トレ：幹から枝先へ伸びる）・広がり（食事）・光の強さ（睡眠）と、
 * 葉の割合（食事）・光の粒の割合（睡眠）、部位ごとの育ち具合と太い枝の長さの倍率（部位の累計セット数）を決める。
 * 点の軌跡と同じく、days が 0 なら点は出さず（種だけ）、SEED_RAMP_DAYS 日かけて最小の点の数に届く
 */
export function treeLayout(p: GrowthParams): ShapeLayout {
  'worklet';
  const food = grow(p.foodDays, FOOD_SCALE_DAYS);
  const sleep = grow(p.sleepDays, SLEEP_SCALE_DAYS);
  const count = (MIN_POINTS + (TREE_POINTS - MIN_POINTS) * grow(p.volumeKg, VOLUME_SCALE_KG)) * seedRamp(p.days, SEED_RAMP_DAYS);
  const parts: number[] = [];
  const partScale: number[] = [];
  for (let i = 0; i < PARTS; i++) {
    const g = partGrowth(p.partSets?.[i] ?? 0);
    parts.push(g);
    partScale.push(MIN_BRANCH_SCALE + (1 - MIN_BRANCH_SCALE) * g);
  }
  return {
    count,
    spread: 0.55 + 0.45 * food,
    glow: 0.35 + 0.65 * sleep,
    fills: [LEAF_MIN + (1 - LEAF_MIN) * food, SPARK_MIN + (1 - SPARK_MIN) * sleep],
    parts,
    partScale,
  };
}
