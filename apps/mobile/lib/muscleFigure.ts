import { isSiteCode, Side, SiteCode, SITES } from './injuries';
import { MUSCLES } from './muscleFigurePaths';

/** 筋肉の図の向き。背中は後ろ姿、ほかは前から */
export type MuscleView = 'front' | 'back';

/** 筋肉の図で塗り分ける筋肉（Figma「部品案：筋肉の図」のパーツ。左右はまとめる） */
export type Muscle =
  | 'trapezius' | 'deltoid' | 'pecs' | 'biceps' | 'triceps' | 'forearm' | 'abs' | 'obliques'
  | 'lats' | 'erectors' | 'glutes' | 'quads' | 'hamstrings' | 'shins' | 'calves';

export type MuscleFigureSpec = { view: MuscleView; muscles: Muscle[] };

/**
 * 部位の名前（種目と部位の管理の名前。db/seed.ts の初期の部位）→ 筋肉の図の向きと塗る筋肉。
 * 腕（上腕二頭筋・上腕三頭筋）は Figma の「腕（前）」のとおり前から二頭筋と前腕を塗る（前の図に三頭筋のパーツはない）。
 * 「腕」「腹」は名前を付け替えたとき用。
 * 知らない部位は前から見た図で、どこも塗らない
 */
const PART_MUSCLES: Record<string, MuscleFigureSpec> = {
  胸: { view: 'front', muscles: ['pecs'] },
  背中: { view: 'back', muscles: ['trapezius', 'lats', 'erectors'] },
  肩: { view: 'front', muscles: ['deltoid'] },
  脚: { view: 'front', muscles: ['quads', 'shins'] },
  上腕二頭筋: { view: 'front', muscles: ['biceps', 'forearm'] },
  上腕三頭筋: { view: 'front', muscles: ['biceps', 'forearm'] },
  腕: { view: 'front', muscles: ['biceps', 'forearm'] },
  腹筋: { view: 'front', muscles: ['abs', 'obliques'] },
  腹: { view: 'front', muscles: ['abs', 'obliques'] },
};

export function muscleFigureFor(part: string): MuscleFigureSpec {
  return PART_MUSCLES[part.trim()] ?? { view: 'front', muscles: [] };
}

// ---- ケガの部位を図で選ぶ・印を付ける（lib/injuries.ts の部位のコード） ----

/** 図の中の点（100×200 の座標） */
export type Point = { x: number; y: number };
type Box = { x0: number; y0: number; x1: number; y1: number };

/**
 * 図の左右と、本人の左右。前の図は向かい合うので画面の左が本人の右（R FRONT L）、後ろの図は画面の左が本人の左（L BACK R）。
 * 保存は本人の左右
 */
export function sideAt(view: MuscleView, x: number): Side {
  const screenLeft = x < 50;
  return view === 'front' ? (screenLeft ? 'right' : 'left') : (screenLeft ? 'left' : 'right');
}

/** 本人の左右が、図の画面の左か */
const onScreenLeft = (view: MuscleView, side: Side) => (view === 'front') === (side === 'right');

/** 筋肉のパーツ → 部位のコード（前の三角筋は前、後ろは後ろ。後ろの脊柱起立筋は腰の筋肉） */
const MUSCLE_SITES: Record<MuscleView, Partial<Record<Muscle, SiteCode>>> = {
  front: {
    trapezius: 'trapezius', deltoid: 'shoulder_front', pecs: 'chest', biceps: 'biceps', forearm: 'forearm', abs: 'abs', obliques: 'obliques',
    quads: 'quads', shins: 'shins',
  },
  back: {
    trapezius: 'trapezius', deltoid: 'shoulder_rear', lats: 'lats', erectors: 'lower_back', triceps: 'triceps', forearm: 'forearm', glutes: 'glutes',
    hamstrings: 'hamstrings', calves: 'calves',
  },
};

/**
 * 関節の押せる点（画面の左の点。左右のある関節は 100 - x に右の点もある）。関節は見やすいほうの図の1つにだけ置く
 * （首・肩・手首・股関節・ひざ・足首は前、ひじ・腰は後ろ）
 */
const JOINTS: Record<MuscleView, { site: SiteCode; x: number; y: number }[]> = {
  front: [
    { site: 'neck', x: 50, y: 27 }, { site: 'shoulder_joint', x: 32, y: 37 }, { site: 'wrist', x: 20, y: 98 },
    { site: 'hip', x: 39, y: 99 }, { site: 'knee', x: 41, y: 144 }, { site: 'ankle', x: 40, y: 184 },
  ],
  back: [{ site: 'elbow', x: 27, y: 73 }, { site: 'waist', x: 50, y: 93 }],
};

/** パスを、M で始まる部分パスに分ける */
export const subpaths = (d: string) => d.split(/(?=M)/).filter((p) => p.trim() !== '');

/** パスの点の囲み（M・C・Z だけのパスなので、数を2つずつ x, y として読む） */
function boxOf(d: string): Box {
  const n = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const xs = n.filter((_, i) => i % 2 === 0);
  const ys = n.filter((_, i) => i % 2 === 1);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/**
 * 図の筋肉の1片。side が null なら左右のない部位（腹筋・腰の筋肉）で、左右をつなげたまま。
 * clip は、1つのパスで左右にまたがる筋肉（後ろの僧帽筋。Figma でも1つのベクター）を、まん中（x = 50）で切って描く片
 */
export type FigurePiece = { muscle: Muscle; site: SiteCode; side: Side | null; d: string; clip?: 'left' | 'right'; box: Box };

function piecesOf(view: MuscleView): FigurePiece[] {
  const out: FigurePiece[] = [];
  for (const [muscle, d] of Object.entries(MUSCLES[view]) as [Muscle, string][]) {
    const code = MUSCLE_SITES[view][muscle]!;
    if (!SITES[code].sided) { out.push({ muscle, site: code, side: null, d, box: boxOf(d) }); continue; }
    const parts = subpaths(d);
    // 片の左右は、書き始めの点（M の x）で分ける（曲線の制御点はまん中を少し越えることがある）
    const startX = (p: string) => Number(/^M\s*(-?\d+(?:\.\d+)?)/.exec(p.trim())![1]);
    const left = parts.filter((p) => startX(p) < 50);
    const right = parts.filter((p) => startX(p) > 50);
    if (parts.length >= 2 && left.length > 0 && right.length > 0) {
      for (const [ps, screenLeft] of [[left, true], [right, false]] as const) {
        const dd = ps.join('');
        out.push({ muscle, site: code, side: sideAt(view, screenLeft ? 0 : 100), d: dd, box: boxOf(dd) });
      }
    } else {
      // まん中をまたぐ1つのパス：まん中で切った左右の片にする
      const b = boxOf(d);
      out.push({ muscle, site: code, side: sideAt(view, 0), d, clip: 'left', box: { ...b, x1: 50 } });
      out.push({ muscle, site: code, side: sideAt(view, 100), d, clip: 'right', box: { ...b, x0: 50 } });
    }
  }
  return out;
}

/** 図の筋肉の片（左右に分けたもの） */
export const FIGURE_PIECES: Record<MuscleView, FigurePiece[]> = { front: piecesOf('front'), back: piecesOf('back') };

/** 押せる部位（筋肉の片と関節の点） */
export type FigureTarget = { site: SiteCode; side: Side | null; view: MuscleView; center: Point; box: Box | null };

function targetsOf(view: MuscleView): FigureTarget[] {
  const muscles = FIGURE_PIECES[view].map((p): FigureTarget => ({
    site: p.site, side: p.side, view, box: p.box, center: { x: (p.box.x0 + p.box.x1) / 2, y: (p.box.y0 + p.box.y1) / 2 },
  }));
  const joints = JOINTS[view].flatMap((j): FigureTarget[] => (SITES[j.site].sided
    ? [j.x, 100 - j.x].map((x) => ({ site: j.site, side: sideAt(view, x), view, box: null, center: { x, y: j.y } }))
    : [{ site: j.site, side: null, view, box: null, center: { x: j.x, y: j.y } }]));
  return [...muscles, ...joints];
}

export const FIGURE_TARGETS: Record<MuscleView, FigureTarget[]> = { front: targetsOf('front'), back: targetsOf('back') };

/** 関節の点の大きさ（図の座標）。この中を押したら関節を選ぶ */
export const JOINT_RADIUS = 3;
/** 押した点から、いちばん近い部位までの遠さの上限（図の座標）。体の外を押したときは選ばない */
const PICK_RANGE = 10;

/** 押した点から部位までの遠さ。筋肉は片の囲みまで（中なら 0）、関節は点の輪まで。同じ遠さなら中心に近いほう */
function distance(t: FigureTarget, p: Point): number {
  const toCenter = Math.hypot(p.x - t.center.x, p.y - t.center.y);
  if (!t.box) return Math.max(0, toCenter - JOINT_RADIUS) + toCenter * 0.001;
  const dx = Math.max(t.box.x0 - p.x, 0, p.x - t.box.x1);
  const dy = Math.max(t.box.y0 - p.y, 0, p.y - t.box.y1);
  return Math.hypot(dx, dy) + toCenter * 0.01;
}

/** 押した点の近くの部位（近い順。同じ部位と左右は1つ）。図の上の小さな部位を、48dp のチップで選び直せるように出す */
export function targetsNear(view: MuscleView, p: Point, count = 4): FigureTarget[] {
  const seen = new Set<string>();
  return FIGURE_TARGETS[view]
    .map((t) => ({ t, dist: distance(t, p) }))
    .filter(({ dist }) => dist <= PICK_RANGE)
    .sort((a, b) => a.dist - b.dist)
    .filter(({ t }) => { const k = `${t.site}/${t.side}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, count)
    .map(({ t }) => t);
}

/** 押した点で選ぶ部位。体の外なら null */
export function pickTarget(view: MuscleView, p: Point): FigureTarget | null {
  return targetsNear(view, p, 1)[0] ?? null;
}

/**
 * 部位の印を置く図と位置。筋肉は片の囲みのまん中、関節は点。前と後ろの両方にある筋肉（前腕）は前、僧帽筋は後ろに置く。
 * 左右が分からないもの（左右のある部位で side が null）は、画面の左の片に置く。知らないコードは null
 */
export function markPoint(site: string, side: Side | null): { view: MuscleView; point: Point } | null {
  if (!isSiteCode(site)) return null;
  const order: MuscleView[] = site === 'trapezius' ? ['back', 'front'] : ['front', 'back'];
  for (const view of order) {
    const hits = FIGURE_TARGETS[view].filter((t) => t.site === site);
    if (hits.length === 0) continue;
    const t = hits.find((h) => h.side === side) ?? hits.find((h) => h.side == null || onScreenLeft(view, h.side)) ?? hits[0];
    return { view, point: t.center };
  }
  return null;
}

/** 選んだ部位の片（図で塗る）。左右のある部位で左右が分からないときは、両方 */
export function piecesFor(view: MuscleView, site: string, side: Side | null): FigurePiece[] {
  return FIGURE_PIECES[view].filter((p) => p.site === site && (side == null || p.side == null || p.side === side));
}

/** 関節の点（図に描く）。押せる点を見せる */
export const jointPoints = (view: MuscleView) => FIGURE_TARGETS[view].filter((t) => t.box == null);
