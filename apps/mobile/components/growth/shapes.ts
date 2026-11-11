// 形ごとの「値 → 点の並び」。形を足すとき（銀河・木）は、ここに1つ足す
import { attractorLayout, attractorPoints, AttractorLayout, MAX_POINTS, pointTints } from '@/lib/shapes/attractor';
import type { GrowthParams, ShapeKind } from '@/lib/shapes/types';

export type ShapeDef = {
  /** 点の数の上限（描く入れ物の大きさ） */
  maxPoints: number;
  /** 点の並び（x, y, z の順に3つずつ、-1〜1）と、点ごとの色の混ぜ具合（0＝紫、1＝緑）。最初に1回だけ作る */
  build: () => { points: Float32Array; tints: Float32Array };
  /** 記録の値から、出す点の数・広がり・光の強さ（UI スレッドで呼ぶ worklet） */
  layout: (p: GrowthParams) => AttractorLayout;
  /** 軌道の中心の、形の中心からのずれ（描く箱の高さに対する割合。下が正） */
  orbitOffsetY: number;
};

export const SHAPES: Record<ShapeKind, ShapeDef> = {
  attractor: {
    maxPoints: MAX_POINTS,
    build: () => {
      const points = attractorPoints(MAX_POINTS);
      return { points, tints: pointTints(points) };
    },
    layout: attractorLayout,
    orbitOffsetY: 0,
  },
};
