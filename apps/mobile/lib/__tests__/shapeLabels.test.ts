import {
  DEFAULT_SHAPE, growthShapeLabel, growthStageLabel, parseShapeKind, SHAPE_LABELS, SHAPE_PREVIEW_PARAMS, shapeOptionLabel,
} from '../shapes/labels';
import { attractorLayout, MAX_POINTS } from '../shapes/attractor';
import { SHAPE_KINDS } from '../shapes/types';

describe('選んだ形の保存の値の読み方', () => {
  test('知っている値は、その形', () => {
    for (const k of SHAPE_KINDS) expect(parseShapeKind(k)).toBe(k);
  });

  test('値がない・知らない値は、最初の形（点の軌跡）', () => {
    expect(DEFAULT_SHAPE).toBe('attractor');
    for (const v of [null, undefined, '', 'Tree', 'nebula', ' tree']) expect(parseShapeKind(v)).toBe('attractor');
  });
});

describe('形の名前と説明', () => {
  test('3つの形の名前と説明', () => {
    expect(SHAPE_KINDS.map((k) => SHAPE_LABELS[k])).toEqual([
      { name: '点の軌跡', description: '点が増えて形が浮かび、広がる' },
      { name: '木', description: '枝が伸び、葉が増え、光の粒が増える' },
      { name: '銀河', description: '腕が伸び、星が増え、中心が光る' },
    ]);
  });
});

describe('読み上げの文', () => {
  test('シートの行は、名前と説明', () => {
    expect(shapeOptionLabel('tree')).toBe('木。枝が伸び、葉が増え、光の粒が増える');
  });

  test('成長を見る画面の形と、ホームの段は、選んだ形の名前を入れる', () => {
    expect(growthShapeLabel('galaxy', 12)).toBe('記録で育つ形（銀河）。DAY 12');
    expect(growthStageLabel('attractor')).toBe('成長の形（点の軌跡）。押すと成長を見る画面を開く');
  });
});

describe('シートの小さな絵の値', () => {
  test('十分育った姿（点の数・広がり・光が、どれも伸びしろの 9 割以上）', () => {
    const l = attractorLayout(SHAPE_PREVIEW_PARAMS);
    expect(l.count).toBeGreaterThan(MAX_POINTS * 0.9);
    expect(l.spread).toBeGreaterThan(0.95);
    expect(l.glow).toBeGreaterThan(0.95);
  });
});
