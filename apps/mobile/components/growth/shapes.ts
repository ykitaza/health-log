// 形ごとの「値 → 点の並び」。形を足すときは、ここに1つ足す
import { attractorLayout, attractorPoints, MAX_POINTS, pointTints } from '@/lib/shapes/attractor';
import type { ShapeLayout } from '@/lib/shapes/common';
import { GALAXY_POINTS, galaxyLayout, galaxyShape, galaxyTints } from '@/lib/shapes/galaxy';
import { TREE_POINTS, TREE_SWAY, treeLayout, treeShape } from '@/lib/shapes/tree';
import type { GrowthParams, ShapeKind } from '@/lib/shapes/types';
import { growthColors } from '@/theme';

export type ShapeDef = {
  /** 点の数の上限（描く入れ物の大きさ） */
  maxPoints: number;
  /**
   * 最初に1回だけ作るもの。点の並び（x, y, z の順に3つずつ、-1〜1）と、点ごとの色の混ぜ具合（palette の位置、0〜1）。
   * gates は点ごとの組（組の番号 ＋ 0〜1 の順位。組なしは -1）で、layout の fills と比べて出すかを決める。
   * seedY は種を置く所の y（-1〜1、下が正。省けば 0＝まん中）。
   * parts は点ごとの部位（-1 は部位なし）、partMin はその点が出る最小の育ち具合で、layout の parts と比べる（木の枝・銀河の腕）。
   * pivots は部位ごとの付け根（layout の partScale で縮める中心）、tips は木の部位の名前を置く枝の先の候補（lib/shapes/tree.ts の partTip）
   */
  build: () => ShapeBuild;
  /** 記録の値から、出す点の数・広がり・光の強さ（UI スレッドで呼ぶ worklet） */
  layout: (p: GrowthParams) => ShapeLayout;
  /** 点の色。混ぜ具合 0 が先頭、1 が最後で、あいだはとなりどうしを混ぜる */
  palette: readonly string[];
  /** 手前に倒す傾き（ラジアン） */
  tilt: number;
  /** 軌道の中心の、形の中心からのずれ（描く箱の高さに対する割合。下が正） */
  orbitOffsetY: number;
  /**
   * どう回しても（揺れる形はどう揺れても）形が画面の上で届く範囲（形の半径を 1 としたとき。lib/shapes/common.ts の shapeExtent、揺れる形は swayExtent の値を、小数4桁に切り上げたもの）。
   * 実機では計算に1秒近くかかり、形を選ぶシートを開くたびに画面が止まったので、先に計算した値を置く。
   * 点の並びか tilt・sway を変えたら、lib/__tests__/shapes.test.ts が新しい値を教える
   */
  extent: { x: number; y: number };
  /**
   * 揺れの量（lib/shapes/common.ts の swayX の bend の最大）。渡した形は回さず、根元（seedY）を中心に左右へ小さく揺らす（木）。
   * 省けば Y 軸まわりに回す
   */
  sway?: number;
};

export type ShapeBuild = {
  points: Float32Array; tints: Float32Array; gates?: Float32Array; seedY?: number;
  parts?: Float32Array; partMin?: Float32Array; pivots?: Float32Array; tips?: Float32Array;
};

/** 紫（中心に近い）→ 緑（外側） */
const PURPLE_GREEN = [growthColors.sleep, growthColors.training] as const;

const attractor: ShapeDef = {
  maxPoints: MAX_POINTS,
  build: () => {
    const points = attractorPoints(MAX_POINTS);
    return { points, tints: pointTints(points) };
  },
  layout: attractorLayout,
  palette: PURPLE_GREEN,
  tilt: 0.35,
  orbitOffsetY: 0,
  extent: { x: 1.0353, y: 0.6785 },
};

const galaxy: ShapeDef = {
  maxPoints: GALAXY_POINTS,
  build: () => {
    const { points, parts, partMin } = galaxyShape();
    return { points, tints: galaxyTints(points), parts, partMin };
  },
  layout: galaxyLayout,
  palette: PURPLE_GREEN,
  // 円盤を斜め上から見る
  tilt: 0.42,
  orbitOffsetY: 0,
  extent: { x: 1.0320, y: 0.5202 },
};

const tree: ShapeDef = {
  maxPoints: TREE_POINTS,
  build: treeShape,
  layout: treeLayout,
  // 光の粒（紫）・幹（暗い緑）・細い枝（緑）・葉（水色寄り）
  palette: [growthColors.sleep, '#287A58', growthColors.training, '#7EE8D8'],
  // 少しだけ上から見る
  tilt: 0.12,
  // 衛星は樹冠ではなく幹のまん中あたりを回る
  orbitOffsetY: 0.15,
  extent: { x: 1.0102, y: 0.9315 },
  // 回さずに、左右へ小さく揺らす（枝と部位の対応が崩れないように）
  sway: TREE_SWAY,
};

export const SHAPES: Record<ShapeKind, ShapeDef> = { attractor, tree, galaxy };

/** 作った点の並びを、形ごとに1回だけ作って使い回す（ホーム・成長を見る・形を選ぶシートで同じ形を何度も作らない） */
const built = new Map<ShapeKind, ShapeBuild>();
export function shapeBuild(kind: ShapeKind): ShapeBuild {
  let b = built.get(kind);
  if (!b) {
    b = SHAPES[kind].build();
    built.set(kind, b);
  }
  return b;
}
