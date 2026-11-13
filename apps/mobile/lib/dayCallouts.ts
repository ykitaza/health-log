// 記録の画面の、鍛えた部位の図に付ける札（種目ごとの注釈）。種目 → 部位 → 図の向きと点、札の並べ方
import { formatSetShort } from './format';
import { FIGURE_PIECES, Muscle, MuscleView, pairFigureFor, Point } from './muscleFigure';
import { SetValues, topSet } from './training';
import type { WeightUnit } from './units';

/** 種目の番号（種目のカードの左の番号と同じ。英字の小さな見出しの決まりで「EX-01」） */
export const exerciseNumber = (n: number) => `EX-${String(n).padStart(2, '0')}`;

/** 点を置く筋肉を、pairFigureFor の最初の筋肉から変える部位（背中は僧帽筋より広背筋がまん中） */
const ANCHOR_MUSCLE: Record<string, Muscle> = { 背中: 'lats' };

/** 部位の点：図の向き、筋肉、点（100×200 の図の座標） */
export type Anchor = { view: MuscleView; muscle: Muscle; point: Point };

/**
 * 部位の点。部位の向きと筋肉は pairFigureFor（塗る図と同じ。上腕三頭筋は後ろの図の三頭筋）。
 * 左右のある筋肉は札の側の片に置く（前の図は札が左なので画面の左、後ろの図は画面の右）。線が体を横切らない。
 * 知らない部位・空の部位は null
 */
export function partAnchor(part: string): Anchor | null {
  const spec = pairFigureFor(part);
  const muscle = ANCHOR_MUSCLE[part.trim()] ?? spec.muscles[0];
  if (!muscle) return null;
  const centers = FIGURE_PIECES[spec.view]
    .filter((p) => p.muscle === muscle)
    .map((p) => ({ x: (p.box.x0 + p.box.x1) / 2, y: (p.box.y0 + p.box.y1) / 2 }));
  if (centers.length === 0) return null;
  const point = centers.reduce((a, c) => ((spec.view === 'front' ? c.x < a.x : c.x > a.x) ? c : a));
  return { view: spec.view, muscle, point };
}

/** 札にする種目（no は種目のカードの番号。1 から） */
export type CalloutInput = { key: string; no: number; part: string };

/** 置いた札。entry は種目の札（anchor が null なら線を引かない）、more は出せなかった種目をまとめた「+N」 */
export type PlacedCallout =
  | { kind: 'entry'; key: string; no: number; anchor: Anchor | null; top: number }
  | { kind: 'more'; nos: number[]; top: number };

export type CalloutLayout = { left: PlacedCallout[]; right: PlacedCallout[]; height: number };

export type CalloutOptions = {
  /** 図の高さ（px。図の座標の 200 がこの高さ） */
  figureHeight: number;
  /** 札の段の高さの下限（px。図と「前・後ろ」の行） */
  minHeight: number;
  /** 札の高さと、札のあいだ（px） */
  slot: number;
  gap: number;
  /** 片側に出す札の数（「+N」も 1 つと数える） */
  perSide: number;
};

/**
 * 札の並べ方。前の図の点の札は左、後ろの図の点の札は右（知らない部位は左。線は引かない）。
 * 片側が perSide を超えたら、perSide - 1 個の種目と、残りをまとめた「+N」にする。
 * 出す種目は、まず筋肉ごとに 1 つ（番号の小さい順）、空きがあれば残りを番号の順（図の役目は、どこを鍛えたかを見せること。
 * 胸の種目が 4 つ・肩・三頭の日でも、肩と腕の点に札が付く）。
 * 札は点の高さにそろえ、重ならないように上から順に下へ、下から順に上へずらす。「+N」と線のない札は下。
 * 段の高さは、図の高さと札の数の多いほう
 */
export function layoutCallouts(items: CalloutInput[], o: CalloutOptions): CalloutLayout {
  const withAnchor = items.map((it) => ({ ...it, anchor: partAnchor(it.part) }));
  const sides = {
    left: withAnchor.filter((it) => it.anchor?.view !== 'back'),
    right: withAnchor.filter((it) => it.anchor?.view === 'back'),
  };
  const count = (n: number) => Math.min(n, o.perSide);
  const height = Math.max(o.minHeight, ...[sides.left.length, sides.right.length].map((n) => count(n) * (o.slot + o.gap) - o.gap));
  const scale = o.figureHeight / 200;

  const place = (list: typeof withAnchor): PlacedCallout[] => {
    let shown = list;
    let rest: typeof list = [];
    if (list.length > o.perSide) {
      const picked = new Set<string>();
      const muscles = new Set<string>();
      for (const it of list) {
        if (picked.size < o.perSide - 1 && it.anchor && !muscles.has(it.anchor.muscle)) {
          muscles.add(it.anchor.muscle);
          picked.add(it.key);
        }
      }
      for (const it of list) if (picked.size < o.perSide - 1) picked.add(it.key);
      shown = list.filter((it) => picked.has(it.key));
      rest = list.filter((it) => !picked.has(it.key));
    }
    const want = (it: (typeof list)[number]) => (it.anchor ? it.anchor.point.y * scale - o.slot / 2 : Infinity);
    const ordered: { c: PlacedCallout; want: number }[] = [...shown]
      .sort((a, b) => want(a) - want(b) || a.no - b.no)
      .map((it) => ({ c: { kind: 'entry', key: it.key, no: it.no, anchor: it.anchor, top: 0 }, want: want(it) }));
    if (rest.length > 0) ordered.push({ c: { kind: 'more', nos: rest.map((it) => it.no), top: 0 }, want: Infinity });
    // 上から順に、点の高さか前の札のすぐ下
    let next = 0;
    const tops = ordered.map(({ want: w }) => {
      const top = Math.max(next, Number.isFinite(w) ? w : height);
      next = top + o.slot + o.gap;
      return top;
    });
    // 下から順に、段の中に収める
    let limit = height - o.slot;
    for (let i = tops.length - 1; i >= 0; i--) {
      tops[i] = Math.max(0, Math.min(tops[i], limit));
      limit = tops[i] - o.slot - o.gap;
    }
    return ordered.map(({ c }, i) => ({ ...c, top: tops[i] }));
  };

  return { left: place(sides.left), right: place(sides.right), height };
}

/** 札のセット：いちばん重いセット（「80kg × 8」。回数だけなら「12回」）。回数のないときはセット数（「3セット」） */
export function calloutSet(sets: SetValues[], unit: WeightUnit): string {
  const top = topSet(sets);
  return top?.reps != null ? formatSetShort(top.weightKg, top.reps, unit) : `${sets.length}セット`;
}

/** 図の読み上げ：「鍛えた部位の図。1 ベンチプレス 胸、2 懸垂 背中」（部位が空なら名前だけ。種目がなければ title だけ） */
export function dayFigureLabel(title: string, entries: { name: string; part: string }[]): string {
  const list = entries.map((e, i) => [String(i + 1), e.name, e.part.trim()].filter(Boolean).join(' '));
  return list.length > 0 ? `${title}。${list.join('、')}` : title;
}
