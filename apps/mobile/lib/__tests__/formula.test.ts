import { SHAPES } from '@/components/growth/shapes';
import { attractorPoints, cliffordOrbit, MAX_POINTS } from '../shapes/attractor';
import { Formula, formatCoord, formula, FormulaLine, formulaValues, pointNumber, pointValue } from '../shapes/formula';
import { galaxyPoints } from '../shapes/galaxy';
import { ANGLE, LENGTH_RATIO, treeShape } from '../shapes/tree';
import { SHAPE_KINDS } from '../shapes/types';

const SUB: Record<string, string> = {
  0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', k: 'ₖ', '+': '₊',
};
/** 式の1行を、下付きを Unicode の下付きの文字にした1つの文字列に（見た目の確かめ用） */
const text = (line: FormulaLine) => line.map((p) => (p.sub ? [...p.text].map((c) => SUB[c]).join('') : p.text)).join('');
const lines = (f: Formula) => f.lines.map(text);

describe('形ごとの題と式', () => {
  const v = { x: 0.8144, y: -1.2051 };

  test('点の軌跡：Clifford の式。右はしが x・y の値', () => {
    const f = formula('attractor', 4120, v);
    expect(f.title).toBe('CLIFFORD ATTRACTOR');
    expect(lines(f)).toEqual([
      'x₄₁₂₀ = sin(a·y) + c·cos(a·x) =  0.814',
      'y₄₁₂₀ = sin(b·x) + d·cos(b·y) = −1.205',
    ]);
  });

  test('銀河：対数らせん', () => {
    const f = formula('galaxy', 4120, v);
    expect(f.title).toBe('LOGARITHMIC SPIRAL');
    expect(lines(f)).toEqual([
      'x₄₁₂₀ = a·e^(bθ)·cos θ =  0.814',
      'y₄₁₂₀ = a·e^(bθ)·sin θ = −1.205',
    ]);
  });

  test('木：1行目は枝分かれの決まり（tree.ts の長さの比と開く角度）、2行目はいまの点の座標', () => {
    const f = formula('tree', 4120, v);
    expect(f.title).toBe('BRANCHING TREE');
    expect(lines(f)).toEqual([
      `Lₖ₊₁ = ${LENGTH_RATIO}·Lₖ   θₖ₊₁ = θₖ ± ${ANGLE}`,
      '(x, y)₄₁₂₀ = ( 0.814, −1.205)',
    ]);
    expect(text(f.lines[0])).toBe('Lₖ₊₁ = 0.72·Lₖ   θₖ₊₁ = θₖ ± 0.55');
  });

  test('右はしの値は value、番号は sub の印が付く（描くときに幅をそろえる・下に寄せる）', () => {
    for (const kind of SHAPE_KINDS) {
      const parts = formula(kind, 12, v).lines[1];
      expect(parts.filter((p) => p.value).map((p) => p.text)).toContain('−1.205');
      expect(parts.find((p) => p.sub)?.text).toBe('12');
    }
  });

  test('記録がまだないとき：題と式は出し、番号は 0、値は 0.000', () => {
    for (const kind of SHAPE_KINDS) {
      const values = formulaValues(kind);
      const n = pointNumber(SHAPES[kind].layout({ volumeKg: 0, foodDays: 0, sleepDays: 0, days: 0 }).count);
      expect(n).toBe(0);
      const f = formula(kind, n, pointValue(values, n));
      expect(f.title.length).toBeGreaterThan(0);
      const sub = f.lines[1].find((p) => p.sub);
      expect(sub?.text).toBe('0');
      expect(f.lines[1].filter((p) => p.value).map((p) => p.text)).toEqual(kind === 'tree' ? [' 0.000', ' 0.000'] : [' 0.000']);
    }
  });
});

describe('いま打った点の番号', () => {
  test('出している点の数を整数に（切り捨て）。0・負・数でない値は 0', () => {
    expect(pointNumber(4120.9)).toBe(4120);
    expect(pointNumber(1)).toBe(1);
    expect(pointNumber(0.4)).toBe(0);
    expect(pointNumber(0)).toBe(0);
    expect(pointNumber(-3)).toBe(0);
    expect(pointNumber(NaN)).toBe(0);
  });

  test('いちばん育っても、点の数の上限（4桁）を超えない', () => {
    for (const kind of SHAPE_KINDS) {
      const n = pointNumber(SHAPES[kind].layout({ volumeKg: 1e9, foodDays: 1e6, sleepDays: 1e6, days: 1e6 }).count);
      expect(n).toBeLessThanOrEqual(SHAPES[kind].maxPoints);
      expect(String(n)).toHaveLength(4);
    }
  });
});

describe('値の書式', () => {
  test('小数3桁。正は前に空白、負は「−」で、どれも同じ幅', () => {
    expect(formatCoord(0.8144)).toBe(' 0.814');
    expect(formatCoord(-1.2051)).toBe('−1.205');
    expect(formatCoord(1.9996)).toBe(' 2.000');
    for (const s of [formatCoord(0.8144), formatCoord(-1.2051), formatCoord(0)]) expect(s).toHaveLength(6);
  });

  test('0 に丸まる負の値は −0.000 にしない。数でない値は 0.000', () => {
    expect(formatCoord(-0.0001)).toBe(' 0.000');
    expect(formatCoord(0)).toBe(' 0.000');
    expect(formatCoord(NaN)).toBe(' 0.000');
  });
});

describe('点の値', () => {
  test('点の軌跡：正規化する前の値（点の並び × 倍率）で、Clifford の式をそのまま満たす', () => {
    const values = formulaValues('attractor');
    const { max } = cliffordOrbit(MAX_POINTS);
    const pts = attractorPoints(MAX_POINTS);
    expect(values).toHaveLength(MAX_POINTS * 2);
    for (const i of [0, 1, 999, MAX_POINTS - 1]) {
      expect(values[i * 2]).toBeCloseTo(pts[i * 3] * max, 4);
      expect(values[i * 2 + 1]).toBeCloseTo(pts[i * 3 + 1] * max, 4);
    }
    // attractor.ts の係数で、前の点から次の点を作り直して合う（番号は式をくり返した回数）
    const [a, b, c, d] = [-1.7, 1.8, -1.9, -0.4];
    for (const i of [1, 500, 4119]) {
      const x = values[(i - 1) * 2];
      const y = values[(i - 1) * 2 + 1];
      expect(values[i * 2]).toBeCloseTo(Math.sin(a * y) + c * Math.cos(a * x), 4);
      expect(values[i * 2 + 1]).toBeCloseTo(Math.sin(b * x) + d * Math.cos(b * y), 4);
    }
    // 正規化した -1〜1 ではなく、式の値の広さ（-2〜2 くらい）
    let far = 0;
    for (const v of values) far = Math.max(far, Math.abs(v));
    expect(far).toBeGreaterThan(1.5);
    expect(far).toBeLessThan(3);
  });

  test('銀河：円盤の面の x と z。木：x と、上を正にした y', () => {
    const g = galaxyPoints();
    const gv = formulaValues('galaxy');
    expect(gv[10]).toBe(g[15]);
    expect(gv[11]).toBe(g[17]);
    const t = treeShape().points;
    const tv = formulaValues('tree');
    expect(tv[10]).toBe(t[15]);
    expect(tv[11]).toBe(-t[16]);
  });

  test('番号は 1 から（番号 n は並びの n − 1 番目の点）。0 と並びの外は 0', () => {
    const values = formulaValues('attractor');
    expect(pointValue(values, 1)).toEqual({ x: values[0], y: values[1] });
    expect(pointValue(values, 4120)).toEqual({ x: values[4119 * 2], y: values[4119 * 2 + 1] });
    expect(pointValue(values, 0)).toEqual({ x: 0, y: 0 });
    expect(pointValue(values, MAX_POINTS + 1)).toEqual({ x: 0, y: 0 });
  });
});
