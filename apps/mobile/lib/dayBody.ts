// その日の体（3D の体と種目の札 EX-01〜）の札の置き場所と、記録から札を作るところ、光らせ方。ホームの LATEST と、筋トレの記録の画面で使う。
// three.js は読まない（jest で確かめる）
import { colors } from '@/theme';
import { boxOf, projectFront, Vec3 } from './bodyModel';
import { calloutSet } from './dayCallouts';
import { recoveryAnchor, recoveryMeshesFor } from './recoveryMap';
import { dayFocus, SetValues } from './training';
import type { WeightUnit } from './units';

/** その日の記録（種目の並び）から、種目の札（番号・種目・いちばん重いセット・部位）と、その日の部位を作る。セットのない種目は外す */
export function dayBodyEntries(entries: { id: string; exerciseName: string; bodyPartName: string; sets: SetValues[] }[], unit: WeightUnit) {
  const list = entries.filter((e) => e.sets.length > 0);
  return {
    entries: list.map((e, i) => ({ key: e.id, no: i + 1, name: e.exerciseName, set: calloutSet(e.sets, unit), part: e.bodyPartName })),
    parts: dayFocus(list).names,
  };
}

/** 鍛えた部位（記録のない日は前回の部位）の光の色：明るいミント（ふだんの体はアクセントの緑） */
export const TRAINED_GLOW = colors.onAccentDark;

/**
 * 3D の体の光らせ方。parts（その日・前回の部位）の部品は明るさ 1（ミント）、recovery（部品ごとの回復の明るさ。lib/recoveryMap.ts の recoveryLevels）が
 * 0 より大きい部品はその明るさ（暖色。ミントより優先）。warm は暖色にする部品
 */
export function dayBodyGlow(parts: string[], recovery: Record<string, number>): { levels: Record<string, number>; warm: Set<string> } {
  const levels: Record<string, number> = Object.fromEntries(parts.flatMap((p) => recoveryMeshesFor(p).map((m) => [m, 1])));
  const warm = new Set<string>();
  for (const [m, k] of Object.entries(recovery)) {
    if (k <= 0) continue;
    levels[m] = k;
    warm.add(m);
  }
  return { levels, warm };
}

/** 3D の体で押した部品にあたる部位（チップの並びのまま。前腕のように、いくつかの部位にあたる部品もある）。どれにもなければ空 */
export function partsOfMesh<T extends { name: string }>(mesh: string, parts: T[]): T[] {
  return parts.filter((b) => recoveryMeshesFor(b.name).includes(mesh));
}

/** 3D の体の種目の札（EX-01〜）。no は種目の番号（1 から） */
export type DayBodyCalloutInput = { key: string; no: number; part: string };
export type DayBodyCallout = { key: string; no: number; side: 'left' | 'right'; top: number; anchor: Vec3; facing: 'front' | 'back' };

/**
 * 部位の付け根を、画面の side の側の片から選ぶ（左右のある部位は、正面を向いた体で画面のその側に見える片。腹筋のように片のない部位はまん中）。
 * 前後の向きは回復マップの札と同じ（recoveryAnchor）。知らない部位は null
 */
export function dayBodyAnchor(part: string, side: 'left' | 'right', w: number, h: number): { anchor: Vec3; facing: 'front' | 'back' } | null {
  const base = recoveryAnchor(part);
  if (!base) return null;
  const meshes = recoveryMeshesFor(part);
  const groups = ['_r', '_l'].map((sfx) => meshes.filter((m) => m.endsWith(sfx)));
  const center = meshes.filter((m) => !/_[rl]$/.test(m));
  const anchorOf = (list: string[]): Vec3 | null => {
    const boxes = list.map(boxOf).filter((b): b is [Vec3, Vec3] => b != null);
    if (boxes.length === 0) return null;
    const lo = [0, 1, 2].map((i) => Math.min(...boxes.map((b) => b[0][i])));
    const hi = [0, 1, 2].map((i) => Math.max(...boxes.map((b) => b[1][i])));
    return [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, base.facing === 'front' ? hi[2] : lo[2]];
  };
  const options = [...groups.map(anchorOf), anchorOf(center)].filter((a): a is Vec3 => a != null);
  if (options.length === 0) return base;
  const want = side === 'left' ? -1 : 1;
  const best = options.reduce((a, b) => ((projectFront(b, w, h).x - w / 2) * want > (projectFront(a, w, h).x - w / 2) * want ? b : a));
  return { anchor: best, facing: base.facing };
}

/**
 * LATEST の札の置き場所。種目の番号の順に、少ないほうの側へ交互に置く（同じ数なら、その部位の付け根が見える側。胸の日でも左右に分かれる）。
 * 片側 perSide まで。あふれた種目は more（「+N」）で、右の下に 1 つ分の場所（moreTop）を空ける。高さは付け根に合わせ、band（上下の四隅の数字の間）の中で重ならないようにずらす。
 * 位置は体が正面を向いたときで決め、回っても札は動かさない（線の先だけが追う。回復マップと同じ）
 */
export function dayBodyCallouts(
  items: DayBodyCalloutInput[], w: number, h: number, o: { perSide: number; height: number; gap: number; top: number; bottom: number },
): { placed: DayBodyCallout[]; more: number[]; moreTop: number | null } {
  // まず片側 perSide まで置いてみて、あふれるなら右の下の 1 つ分を「+N」に空ける（右は perSide - 1 まで）
  const first = assign(items, w, h, { left: o.perSide, right: o.perSide });
  const cap = first.more.length > 0 ? { left: o.perSide, right: o.perSide - 1 } : { left: o.perSide, right: o.perSide };
  const { chosen, more } = first.more.length > 0 ? assign(items, w, h, cap) : first;
  const moreTop = more.length > 0 ? o.bottom - o.height : null;
  const placed = (['left', 'right'] as const).flatMap((side) => {
    const list = chosen.filter((c) => c.side === side).sort((a, b) => a.y - b.y || a.no - b.no);
    let next = o.top;
    const tops = list.map((c) => { const t = Math.max(next, c.y - o.height / 2); next = t + o.height + o.gap; return t; });
    // 右に「+N」があれば、その上まで
    let limit = (side === 'right' && moreTop != null ? moreTop - o.gap : o.bottom) - o.height;
    for (let i = tops.length - 1; i >= 0; i--) { tops[i] = Math.max(o.top, Math.min(tops[i], limit)); limit = tops[i] - o.height - o.gap; }
    return list.map(({ y: _y, ...c }, i) => ({ ...c, top: tops[i] }));
  });
  return { placed, more, moreTop };
}


/** 種目を左右に割り振る（番号の順に、少ないほうの側へ。同じ数ならその部位の付け根が見える側）。cap は側ごとの数の上限 */
function assign(items: DayBodyCalloutInput[], w: number, h: number, cap: { left: number; right: number }) {
  const count = { left: 0, right: 0 };
  const chosen: (DayBodyCallout & { y: number })[] = [];
  const more: number[] = [];
  for (const it of [...items].sort((a, b) => a.no - b.no)) {
    const natural = recoveryAnchor(it.part);
    const naturalSide: 'left' | 'right' = natural && projectFront(natural.anchor, w, h).x > w / 2 ? 'right' : 'left';
    const side: 'left' | 'right' = count.left === count.right ? naturalSide : count.left < count.right ? 'left' : 'right';
    const other = side === 'left' ? 'right' : 'left';
    const pick = count[side] < cap[side] ? side : count[other] < cap[other] ? other : null;
    const at = pick ? dayBodyAnchor(it.part, pick, w, h) : null;
    if (!pick || !at) { more.push(it.no); continue; }
    count[pick] += 1;
    chosen.push({ key: it.key, no: it.no, side: pick, top: 0, anchor: at.anchor, facing: at.facing, y: projectFront(at.anchor, w, h).y });
  }
  return { chosen, more };
}
