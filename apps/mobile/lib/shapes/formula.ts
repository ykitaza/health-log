// 成長を見る画面の左上に出す、形を描いている数式と、いま打った点の値・番号。どれも純粋な値と関数。
// 並び：題、式（形ごとに2〜3行。固定）、形を決める定数の行（固定。木はなし）、いまの点の値の行、点の番号の行（この2行だけが更新される）。
// 点の番号は「並びの先頭から何番目の点か」（1 から。出している点の数を整数にしたもの）。
// 点の軌跡は、並びが軌道をたどった順なので、番号がそのまま式をくり返した回数（始めに捨てる BURN_IN 回のあと）になる。
// 銀河と木は、点の並びを中心から・根元からの順に並べ替えているので、番号は並びの何番目かで、式をくり返した回数ではない
import { A, B, C, cliffordOrbit, D, MAX_POINTS } from './attractor';
import { ARM_START, GALAXY_POINTS, galaxyPoints, PITCH } from './galaxy';
import { ANGLE, LENGTH_RATIO, TREE_POINTS, treeShape } from './tree';
import type { ShapeKind } from './types';

/** 式の1行の部品。sub は下付き（小さい文字で下に寄せて描く）、value は値（幅をそろえて右に寄せる） */
export type FormulaPart = { text: string; sub?: boolean; value?: boolean };
export type FormulaLine = FormulaPart[];
export type Formula = {
  title: string;
  /** 式（固定） */
  equations: FormulaLine[];
  /** 形を決める定数の行（固定）。式に数字が入っている形は null */
  constants: string | null;
  /** いまの点の値の行（「x −0.814   y −1.205」） */
  values: FormulaLine;
  /** いまの点の番号の行（「point 4,120 / 6,000」） */
  point: string;
};

/** 点の値（式の x・y） */
export type FormulaValue = { x: number; y: number };

const ZERO: FormulaValue = { x: 0, y: 0 };

/** 出している点の数（小数）→ いま打った点の番号（整数。数でない値・負の値は 0） */
export function pointNumber(count: number): number {
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

/** 点の値を小数3桁に。符号の幅をそろえる（正は前に空白、負は「−」）。-0.000 は出さない */
export function formatCoord(v: number): string {
  const r = Math.round((Number.isFinite(v) ? v : 0) * 1000) / 1000;
  const s = Math.abs(r).toFixed(3);
  return `${r < 0 ? '−' : ' '}${s}`;
}

/** 整数を3桁ごとにカンマで区切る（端末の言語の設定によらない） */
export function formatCount(n: number): string {
  return String(Math.max(0, Math.floor(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 定数の数字（負は「−」） */
function num(v: number): string {
  return `${v < 0 ? '−' : ''}${Math.abs(v)}`;
}

/**
 * 形ごとの、点の並びの順の式の値（x, y の順に2つずつ）。最初に1回だけ作る。
 * 点の軌跡：正規化する前の Clifford の x・y（-2〜2 くらい）。
 * 銀河：点の並びの x と z（円盤は XZ 面にあるので、らせんの sin θ の向きは z）。-1〜1。
 * 木：点の並びの x と、上を正にした y（並びの y は下が正）。-1〜1
 */
export function formulaValues(kind: ShapeKind): Float32Array {
  if (kind === 'attractor') return pick(cliffordOrbit(MAX_POINTS).points, 1, 1);
  if (kind === 'galaxy') return pick(galaxyPoints(), 2, 1);
  return pick(treeShape().points, 1, -1);
}

/** x, y, z の並びから、x と（yAxis の位置の値 × ySign）を取り出す */
function pick(points: Float32Array, yAxis: number, ySign: number): Float32Array {
  const n = points.length / 3;
  const out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    out[i * 2] = points[i * 3];
    out[i * 2 + 1] = points[i * 3 + yAxis] * ySign;
  }
  return out;
}

/** 番号 n（1 から）の点の値。0（記録がまだない）や並びの外は 0 */
export function pointValue(values: Float32Array, n: number): FormulaValue {
  const i = n - 1;
  if (i < 0 || i * 2 + 1 >= values.length) return ZERO;
  return { x: values[i * 2], y: values[i * 2 + 1] };
}

const N: FormulaPart = { text: 'n', sub: true };
const N1: FormulaPart = { text: 'n+1', sub: true };
const K: FormulaPart = { text: 'k', sub: true };
const K1: FormulaPart = { text: 'k+1', sub: true };

/** 形ごとの題・式・定数（固定の部分） */
const FIXED: Record<ShapeKind, { title: string; equations: FormulaLine[]; constants: string | null; max: number }> = {
  // attractor.ts の式（x と y を同時に次へ進める）
  attractor: {
    title: 'CLIFFORD ATTRACTOR',
    equations: [
      [{ text: 'x' }, N1, { text: ' = sin(a·y' }, N, { text: ') + c·cos(a·x' }, N, { text: ')' }],
      [{ text: 'y' }, N1, { text: ' = sin(b·x' }, N, { text: ') + d·cos(b·y' }, N, { text: ')' }],
    ],
    constants: `a = ${num(A)}   b = ${num(B)}   c = ${num(C)}   d = ${num(D)}`,
    max: MAX_POINTS,
  },
  // galaxy.ts の腕（対数らせん r = ARM_START・e^(PITCH・θ)）
  galaxy: {
    title: 'LOGARITHMIC SPIRAL',
    equations: [[{ text: 'r = a·e^(bθ)' }], [{ text: 'x = r·cos θ' }], [{ text: 'y = r·sin θ' }]],
    constants: `a = ${num(ARM_START)}   b = ${num(PITCH)}`,
    max: GALAXY_POINTS,
  },
  // tree.ts の枝分かれ（子の枝は親の LENGTH_RATIO 倍の長さで、ANGLE だけ開く）。数字は式に入れるので、定数の行はなし
  tree: {
    title: 'BRANCHING TREE',
    equations: [
      [{ text: 'L' }, K1, { text: ` = ${LENGTH_RATIO}·L` }, K],
      [{ text: 'θ' }, K1, { text: ' = θ' }, K, { text: ` ± ${ANGLE}` }],
    ],
    constants: null,
    max: TREE_POINTS,
  },
};

/** 形ごとの題と式。n はいま打った点の番号、v はその点の値 */
export function formula(kind: ShapeKind, n: number, v: FormulaValue): Formula {
  const f = FIXED[kind];
  return {
    title: f.title,
    equations: f.equations,
    constants: f.constants,
    values: [{ text: 'x ' }, { text: formatCoord(v.x), value: true }, { text: '   y ' }, { text: formatCoord(v.y), value: true }],
    point: `point ${formatCount(n)} / ${formatCount(f.max)}`,
  };
}
