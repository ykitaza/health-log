// ケガの画面の 3D の体（assets/models/body.glb）の部品と、ケガの部位のコード（lib/injuries.ts）の対応。
// 3D の描画（components/InjuryBodyMap3D.native.tsx）から使う。three.js は読まない（テストで確かめられるように）
import { isSiteCode, Side, SiteCode, SITES } from './injuries';
import { markPoint } from './muscleFigure';

/** 体の座標（メートル。上が +y、顔の向きが +z、本人の右が −x） */
export type Vec3 = [number, number, number];

/** 筋肉の部位 → GLB の部品の名前の頭（左右のある部位は `_r`・`_l` を付ける） */
const MUSCLE_PARTS: Partial<Record<SiteCode, string>> = {
  shoulder_front: 'delt_front', shoulder_rear: 'delt_rear', chest: 'pec', biceps: 'biceps', triceps: 'triceps',
  forearm: 'forearm', trapezius: 'trap', abs: 'abs', obliques: 'oblique', lats: 'lat',
  upper_back: 'erector_up', lower_back: 'erector_low', glutes: 'glute', quads: 'quad', hamstrings: 'ham',
  shins: 'shin', calves: 'calf',
};

/**
 * 関節の印の位置（本人の右の側。左右のある関節は x を反対にした左もある）。モデルに関節の部品はないので、まわりの筋肉の囲みから決めた
 */
const JOINTS: Partial<Record<SiteCode, Vec3>> = {
  neck: [0, 1.55, 0.03],
  shoulder_joint: [-0.19, 1.4, 0],
  elbow: [-0.21, 1.09, -0.05],
  wrist: [-0.29, 0.79, 0],
  waist: [0, 1.0, -0.1],
  hip: [-0.1, 0.92, 0.06],
  knee: [-0.09, 0.44, 0.04],
  ankle: [-0.09, 0.07, 0.02],
};

/**
 * 部品の囲み（本人の右の部品と腹筋。[最小, 最大]、GLB の頂点の範囲。左の部品は x を反対にしたもの）。
 * 吹き出しの置き場所を、GLB を読み込む前に決めるため（テストで GLB と照らし合わせる）
 */
const BOXES: Record<string, [Vec3, Vec3]> = {
  delt_front_r: [[-0.203, 1.284, -0.024], [-0.09, 1.432, 0.021]],
  delt_rear_r: [[-0.219, 1.268, -0.097], [-0.084, 1.417, -0.021]],
  pec_r: [[-0.194, 1.184, -0.018], [-0.006, 1.413, 0.119]],
  biceps_r: [[-0.235, 1.075, -0.039], [-0.135, 1.416, 0.009]],
  triceps_r: [[-0.228, 1.108, -0.081], [-0.135, 1.377, -0.028]],
  forearm_r: [[-0.305, 0.756, -0.055], [-0.179, 1.224, 0.066]],
  trap_r: [[-0.162, 1.133, -0.124], [0.003, 1.584, -0.001]],
  oblique_r: [[-0.14, 0.872, -0.062], [-0.004, 1.288, 0.118]],
  quad_r: [[-0.16, 0.396, -0.042], [-0.036, 0.947, 0.052]],
  shin_r: [[-0.117, 0.042, -0.027], [-0.069, 0.432, 0.043]],
  glute_r: [[-0.145, 0.747, -0.12], [0.001, 1.01, -0.023]],
  ham_r: [[-0.126, 0.363, -0.081], [-0.013, 0.842, 0.002]],
  calf_r: [[-0.116, 0.113, -0.094], [-0.022, 0.51, -0.01]],
  erector_up_r: [[-0.101, 1.131, -0.102], [0.002, 1.448, -0.025]],
  erector_low_r: [[-0.068, 0.909, -0.109], [0, 1.146, -0.042]],
  lat_r: [[-0.18, 1.115, -0.145], [-0.05, 1.384, -0.013]],
  abs: [[-0.078, 1.02, 0.089], [0.076, 1.309, 0.125]],
};

/** 部品の囲み（左の部品は右の部品を x で反対にする。モデルはほぼ左右対称） */
export function boxOf(part: string): [Vec3, Vec3] | null {
  if (BOXES[part]) return BOXES[part];
  const r = BOXES[part.replace(/_l$/, '_r')];
  if (!part.endsWith('_l') || !r) return null;
  return [[-r[1][0], r[0][1], r[0][2]], [-r[0][0], r[1][1], r[1][2]]];
}

const suffix = (side: Side) => (side === 'right' ? '_r' : '_l');

/**
 * 部位で光らせる部品の名前。左右のある部位で左右が分からないもの（左右を持つ前に記録した腰の筋肉など）は両方。
 * 関節や知らないコードは空
 */
export function partsFor(site: string, side: Side | null): string[] {
  if (!isSiteCode(site)) return [];
  const head = MUSCLE_PARTS[site];
  if (!head) return [];
  if (!SITES[site].sided) return [head];
  return side ? [head + suffix(side)] : [head + '_r', head + '_l'];
}

/** 関節の印の位置。左右が分からないときは、まん中に寄せる */
export function jointAnchor(site: string, side: Side | null): Vec3 | null {
  if (!isSiteCode(site)) return null;
  const p = JOINTS[site];
  if (!p) return null;
  if (!SITES[site].sided) return p;
  if (side == null) return [0, p[1], p[2]];
  return side === 'right' ? p : [-p[0], p[1], p[2]];
}

/** 部位が体の前と後ろのどちらにあるか（2D の図と同じ。引き出し線の付け根を表と裏のどちらに置くか） */
export function facingOf(site: string, side: Side | null): 'front' | 'back' {
  return markPoint(site, side)?.view ?? 'front';
}

/**
 * 引き出し線の付け根（体の座標）。筋肉は部品の囲みのまん中の、前の部位なら前の面、後ろの部位なら後ろの面。関節は決めた点。
 * 左右の部品を両方光らせるとき（左右が分からない）は、2つの囲みを合わせたまん中
 */
export function anchorFor(site: string, side: Side | null): Vec3 | null {
  const joint = jointAnchor(site, side);
  if (joint) return joint;
  const boxes = partsFor(site, side).map(boxOf).filter((b): b is [Vec3, Vec3] => b != null);
  if (boxes.length === 0) return null;
  const lo = [0, 1, 2].map((i) => Math.min(...boxes.map((b) => b[0][i])));
  const hi = [0, 1, 2].map((i) => Math.max(...boxes.map((b) => b[1][i])));
  return [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, facingOf(site, side) === 'front' ? hi[2] : lo[2]];
}

// ---- カメラと、吹き出しの置き場所 ----

/** カメラ（縦の画角 30 度。体の正面の少し上から、胸の少し下を見る） */
export const CAMERA = { fov: 30, position: [0, 1.0, 3.7] as Vec3, target: [0, 0.84, 0] as Vec3, near: 0.1, far: 20 };

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };

/** 体が正面を向いているとき（回していないとき）の、体の座標の点の画面の位置（w×h の枠の中の px） */
export function projectFront(p: Vec3, w: number, h: number): { x: number; y: number } {
  const f = norm(sub(CAMERA.target, CAMERA.position));
  const r = norm(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  const d = sub(p, CAMERA.position);
  const t = Math.tan((CAMERA.fov * Math.PI) / 360) * dot(d, f);
  return { x: (dot(d, r) / (t * (w / h)) * 0.5 + 0.5) * w, y: (-dot(d, u) / t * 0.5 + 0.5) * h };
}

/** 吹き出しの高さ（px）と、左右それぞれに出す数 */
export const CALLOUT_H = 80;
export const CALLOUTS_PER_SIDE = 2;

export type CalloutInput = { id: string; anchor: Vec3; facing: 'front' | 'back'; fixing: boolean; occurredOn: string };
export type CalloutPlace = { id: string; side: 'left' | 'right'; top: number };

/**
 * 吹き出しの置き場所。体が正面を向いたときの印の位置で決めて、回しても動かさない（引き出し線の先だけが印を追う）。
 * 画面の左の印は左に、右の印は右に。まん中の印（腹筋・腰・首）は、体の前なら左、後ろなら右。
 * 左右それぞれ2つまで（直している途中を先に、痛めた日の新しい順）。高さは印に合わせ、重ならないように下へずらす。
 * 回復マップは、左右に出す数（perSide）と吹き出しの高さ（height）を変えて使う（fixing はケガのある部位、occurredOn は最後に鍛えた日）
 */
export function layoutCallouts(
  items: CalloutInput[], w: number, h: number, opts: { perSide: number; height: number } = { perSide: CALLOUTS_PER_SIDE, height: CALLOUT_H },
): CalloutPlace[] {
  const placed = items.map((it) => {
    const p = projectFront(it.anchor, w, h);
    const side: 'left' | 'right' = Math.abs(p.x - w / 2) > 12 ? (p.x < w / 2 ? 'left' : 'right') : (it.facing === 'front' ? 'left' : 'right');
    return { it, side, y: p.y };
  });
  return (['left', 'right'] as const).flatMap((side) => {
    let next = 0;
    return placed
      .filter((p) => p.side === side)
      .sort((a, b) => Number(b.it.fixing) - Number(a.it.fixing) || (a.it.occurredOn < b.it.occurredOn ? 1 : -1))
      .slice(0, opts.perSide)
      .sort((a, b) => a.y - b.y)
      .map((p) => {
        const top = Math.min(Math.max(next, p.y - 16), h - opts.height);
        next = top + opts.height + 4;
        return { id: p.it.id, side, top };
      });
  });
}

/** 部品の名前 → 部位と左右（押した部品の名前を出す）。部位のない部品（三角筋の中部、皮膚）は null */
export function siteOfPart(name: string): { site: SiteCode; side: Side | null } | null {
  const m = /^(.*?)(?:_([rl]))?$/.exec(name)!;
  const site = (Object.keys(MUSCLE_PARTS) as SiteCode[]).find((c) => MUSCLE_PARTS[c] === m[1]);
  if (!site) return null;
  return { site, side: m[2] === 'r' ? 'right' : m[2] === 'l' ? 'left' : null };
}

/** 光らせる部品の名前（GLB の部品の名前の一覧。テストで GLB と照らし合わせる） */
export const ALL_PARTS: string[] = Object.entries(MUSCLE_PARTS).flatMap(([site, head]) =>
  SITES[site as SiteCode].sided ? [head + '_r', head + '_l'] : [head]);
