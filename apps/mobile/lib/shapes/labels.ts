// 形の名前と説明、選んだ形の保存の値の読み方、読み上げの文（「形を選ぶ」のシート・成長を見る・ホームの段で使う）
import { SHAPE_KINDS } from './types';
import type { GrowthParams, ShapeKind } from './types';

/** 形の名前と、育ち方のひとこと */
export const SHAPE_LABELS: Record<ShapeKind, { name: string; description: string }> = {
  attractor: { name: '点の軌跡', description: '点が増えて形が浮かび、広がる' },
  tree: { name: '木', description: '枝が伸び、葉が増え、光の粒が増える' },
  galaxy: { name: '銀河', description: '腕が伸び、星が増え、中心が光る' },
};

/** 選んだ形を置く場所（sync_meta。同期しない。端末だけ） */
export const GROWTH_SHAPE_KEY = 'growth.shape';

/** 最初の形（値がない・知らない値のとき） */
export const DEFAULT_SHAPE: ShapeKind = SHAPE_KINDS[0];

/** 置いてある値を形の種類に。値がない・知らない値（あとの版で足した形など）なら最初の形 */
export function parseShapeKind(value: string | null | undefined): ShapeKind {
  return SHAPE_KINDS.find((k) => k === value) ?? DEFAULT_SHAPE;
}

/** シートの小さな絵に描く値（十分育った姿。どの値も伸びしろの 95% ほど） */
export const SHAPE_PREVIEW_PARAMS: GrowthParams = { volumeKg: 450_000, foodDays: 180, sleepDays: 180, days: 365 };

/** シートの行の読み上げ（名前と説明。選んだかどうかはラジオボタンの状態で伝える） */
export const shapeOptionLabel = (kind: ShapeKind) => `${SHAPE_LABELS[kind].name}。${SHAPE_LABELS[kind].description}`;

/** 成長を見る画面の形の読み上げ */
export const growthShapeLabel = (kind: ShapeKind, dayNumber: number) => `記録で育つ形（${SHAPE_LABELS[kind].name}）。DAY ${dayNumber}`;

/** ホームの形の段（押すと成長を見る画面）の読み上げ */
export const growthStageLabel = (kind: ShapeKind) => `成長の形（${SHAPE_LABELS[kind].name}）。押すと成長を見る画面を開く`;
