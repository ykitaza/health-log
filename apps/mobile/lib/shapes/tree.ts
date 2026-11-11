// 形「木」：幹から枝が四方へ分かれ、上で広がる樹冠になる3Dの木。枝に沿って並べた点と、枝先の葉・光の粒の点で作る。
// 幹は Y 軸の上に立てるので、Y 軸まわりに回すと幹を軸に回る。
// 点の並びは根元からの枝の道のりの順（幹 → 太い枝 → 細い枝 → 葉）。「先頭から N 個を出す」だけで、幹から先へ伸びていく。
// 葉と光の粒には組（gates）を付け、食事・睡眠で出す割合を決める（枝先まで伸びていない葉は出ない）。
// 乱数は種を固定する（同じ値なら毎回同じ形）。treeLayout は UI スレッドで毎フレーム呼ぶので worklet
import { FOOD_SCALE_DAYS, MIN_POINTS, SEED_RAMP_DAYS, SLEEP_SCALE_DAYS, VOLUME_SCALE_KG } from './attractor';
import { gaussian, grow, seededRandom, seedRamp, ShapeLayout } from './common';
import type { GrowthParams } from './types';

/** 点の数の上限と内訳（枝・根・葉・光の粒） */
const BRANCH_POINTS = 2400;
const ROOT_POINTS = 100;
const LEAF_POINTS = 1900;
const SPARK_POINTS = 500;
export const TREE_POINTS = BRANCH_POINTS + ROOT_POINTS + LEAF_POINTS + SPARK_POINTS;

/** 枝分かれの段の数（幹が 0）、幹の長さ、子の枝の長さの比、幹の太さ */
const DEPTH = 5;
const TRUNK_LENGTH = 0.8;
const LENGTH_RATIO = 0.72;
const TRUNK_THICKNESS = 0.06;
/** 枝が親から開く角度（ラジアン）。幹からの1段目は大きく開いて、上で広がる樹冠にする */
const FIRST_ANGLE = 0.8;
const ANGLE = 0.55;
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

type Item = { key: number; x: number; y: number; z: number; tint: number; gate: number };
type Branch = { x: number; y: number; z: number; dx: number; dy: number; dz: number; length: number; thickness: number; depth: number; arc: number };

export type TreeShape = {
  /** 点の並び（x, y, z の順に3つずつ、-1〜1。y は下が正）。根元からの枝の道のりの順 */
  points: Float32Array;
  /** 点ごとの色の混ぜ具合（TREE_PALETTE の位置） */
  tints: Float32Array;
  /** 点ごとの組と、出る順（組の番号 ＋ 0〜1 の順位。組なしは -1） */
  gates: Float32Array;
  /** 根元（種を置く所）の y（-1〜1。下が正） */
  seedY: number;
};

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

/** 木の点の並び・色・組。最初に1回だけ作る */
export function treeShape(): TreeShape {
  const rand = seededRandom(SEED);
  // 枝を幹から順に作る（y が上）
  const branches: Branch[] = [];
  const tips: Branch[] = [];
  const addBranch = (b: Branch) => {
    branches.push(b);
    if (b.depth === DEPTH) {
      tips.push(b);
      return;
    }
    const ex = b.x + b.dx * b.length;
    const ey = b.y + b.dy * b.length;
    const ez = b.z + b.dz * b.length;
    const [u, v] = basis(b.dx, b.dy, b.dz);
    const kids = b.depth === 0 ? 4 : rand() < 0.3 ? 3 : 2;
    const phase = rand() * Math.PI * 2;
    for (let k = 0; k < kids; k++) {
      const a = (b.depth === 0 ? FIRST_ANGLE : ANGLE) * (0.8 + 0.4 * rand());
      const f = phase + (k / kids) * Math.PI * 2 + (rand() - 0.5) * 0.6;
      let dx = b.dx * Math.cos(a) + (u[0] * Math.cos(f) + v[0] * Math.sin(f)) * Math.sin(a);
      let dy = b.dy * Math.cos(a) + (u[1] * Math.cos(f) + v[1] * Math.sin(f)) * Math.sin(a);
      let dz = b.dz * Math.cos(a) + (u[2] * Math.cos(f) + v[2] * Math.sin(f)) * Math.sin(a);
      // 少しだけ上へ向ける（垂れ下がらないように）
      dy += 0.12;
      const l = Math.hypot(dx, dy, dz);
      dx /= l;
      dy /= l;
      dz /= l;
      addBranch({
        x: ex, y: ey, z: ez, dx, dy, dz,
        length: b.length * LENGTH_RATIO * (0.85 + 0.3 * rand()),
        thickness: b.thickness * 0.62,
        depth: b.depth + 1,
        arc: b.arc + b.length,
      });
    }
  };
  addBranch({ x: 0, y: 0, z: 0, dx: 0, dy: 1, dz: 0, length: TRUNK_LENGTH, thickness: TRUNK_THICKNESS, depth: 0, arc: 0 });

  const items: Item[] = [];
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
      z: Math.sin(f) * s,
      tint: TINT_TRUNK,
      gate: GATE_NONE,
    });
  }
  // 葉と光の粒：枝先のまわり。枝先までの道のりのあとに現れる
  const scatter = (count: number, spread: number, jitter: number, gate: number, tint: () => number) => {
    for (let i = 0; i < count; i++) {
      const b = tips[i % tips.length];
      const ex = b.x + b.dx * b.length;
      const ey = b.y + b.dy * b.length;
      const ez = b.z + b.dz * b.length;
      items.push({
        key: b.arc + b.length + rand() * jitter,
        x: ex + gaussian(rand) * spread,
        y: ey + gaussian(rand) * spread * 0.8 + spread * 0.3,
        z: ez + gaussian(rand) * spread,
        tint: tint(),
        gate: gate + rand() * 0.999,
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
  const points = new Float32Array(items.length * 3);
  const tints = new Float32Array(items.length);
  const gates = new Float32Array(items.length);
  items.forEach((p, i) => {
    points[i * 3] = p.x / max;
    points[i * 3 + 1] = (midY - p.y) / max;
    points[i * 3 + 2] = p.z / max;
    tints[i] = p.tint;
    gates[i] = p.gate;
  });
  return { points, tints, gates, seedY: midY / max };
}

/**
 * 記録の値から、点の数（筋トレ：幹から枝先へ伸びる）・広がり（食事）・光の強さ（睡眠）と、
 * 葉の割合（食事）・光の粒の割合（睡眠）を決める。点の軌跡と同じく、days が 0 なら点は出さず（種だけ）、
 * SEED_RAMP_DAYS 日かけて最小の点の数に届く
 */
export function treeLayout(p: GrowthParams): ShapeLayout {
  'worklet';
  const food = grow(p.foodDays, FOOD_SCALE_DAYS);
  const sleep = grow(p.sleepDays, SLEEP_SCALE_DAYS);
  const count = (MIN_POINTS + (TREE_POINTS - MIN_POINTS) * grow(p.volumeKg, VOLUME_SCALE_KG)) * seedRamp(p.days, SEED_RAMP_DAYS);
  return {
    count,
    spread: 0.55 + 0.45 * food,
    glow: 0.35 + 0.65 * sleep,
    fills: [LEAF_MIN + (1 - LEAF_MIN) * food, SPARK_MIN + (1 - SPARK_MIN) * sleep],
  };
}
