// からだのタブの「回復マップ」：筋トレの部位ごとの最後に鍛えた日と、部位ごとの回復の日数から、3D の体（assets/models/body.glb）の
// 部品の光の強さと色を決める。three.js は読まない（テストで確かめられるように）
import type { Injury } from '@/db/repositories/injuries';
import { colors, figureColors } from '@/theme';
import { addDays, DateKey, daysBetween } from './date';
import { anchorFor, boxOf, facingOf, partsFor, Vec3 } from './bodyModel';
import { isSiteCode, SiteCode } from './injuries';
import type { Muscle } from './muscleFigure';
import { BALANCE_DAYS } from './partBalance';
import type { TrainingSetRow } from './training';

/**
 * 部位ごとの回復の日数 R（鍛えた日を 0 日目として、R 日目までが回復中、R+1 日目から回復済み）。
 * 筋トレでよく言われる目安（小さな筋肉・腹筋は短く、背中・脚の大きな筋肉は長い）で、医学の助言ではない（2026-11-13 ユーザーの要望）。
 * 知らない部位は 2日
 */
const RECOVERY_DAYS_BY_PART: Record<string, number> = {
  腹筋: 1, 腹: 1,
  上腕二頭筋: 2, 上腕三頭筋: 2, 腕: 2,
  肩: 2, 胸: 2,
  背中: 3, 脚: 3,
};
export const DEFAULT_RECOVERY_DAYS = 2;

export function recoveryDaysFor(part: string): number {
  return RECOVERY_DAYS_BY_PART[part.trim()] ?? DEFAULT_RECOVERY_DAYS;
}

/**
 * 回復済みの期限（日）。回復済みになった日（R+1 日目）を 0 日目として、この日数を過ぎたら「空いている」（2026-11-15 ユーザーの要望：
 * 3か月前に鍛えたきりの部位も回復済みと出て、しばらく鍛えていないことが分からない）。
 * 回復の日数 R と同じ数え方で、回復済みになった日から 7 日目（鍛えた日から R+8 日目）までが回復済み、8 日目（R+9 日目）から空いている。
 * 例：胸（R=2）は 3〜10 日目が回復済み、11 日目から空いている
 */
export const IDLE_AFTER_DAYS = 7;

/** 部位の英字の名前（一覧と注釈の札。計器の読み出しのように Mono で出す） */
const PART_EN: Record<string, string> = {
  胸: 'CHEST', 背中: 'BACK', 肩: 'SHOULDERS', 脚: 'LEGS', 上腕二頭筋: 'BICEPS', 上腕三頭筋: 'TRICEPS', 腕: 'ARMS', 腹筋: 'ABS', 腹: 'ABS',
};
export const partEnglish = (part: string) => PART_EN[part.trim()] ?? 'PART';

// ---- 回復マップの色（ケガの画面の BODY MAP は変えない）----
// 色相は3つだけにする（2026-11-13 ユーザーの要望：緑・青・橙・赤の4色はちらついて見える）。
// 回復済み（明るさ 0）はアプリのアクセントの緑（ケガの画面のふだんと同じ）、回復中は明るさが高いほど暖色（黄 → 橙）、ケガは赤。
// 空いている・まだ（一度も鍛えていない）は、色相のない控えめな灰色（2026-11-15。色相は増やさない）。
// 色は HSL の色相を回して混ぜる（RGB でまっすぐ混ぜると、緑と黄・黄と橙の間がくすむ）。回復中の明るさは最小でも 0.25（背中の最後の日）
// なので、0.25 を黄、0.75 からを橙にし、鍛えた日と次の日が橙、最後の日が黄に寄るようにする

/** 回復済み（3D のホログラムの色。体の輪郭・皮膚の線・台もこの色。カードの枠と同じ緑） */
export const REST_GREEN = colors.accent;
/**
 * 回復済み（2D の図の塗り）。平らに塗る 2D で明るい緑をいちめんに塗ると、回復中の暖色より目立つので、控えめな緑にする
 * （3D の緑は弱い縁の光なので、見た目の強さがそろう）
 */
export const REST_FILL = colors.accentMuted;
/**
 * 空いている・まだ（3D の部品の光、凡例、一覧の印）。入力欄の枠と同じ灰色。
 * まだ（一度も鍛えていない）も、いちばん長く空いている部位として同じ灰色にする（緑だと回復済みと見分けられない）。見分けは文字（「まだ」と「空いて N日」）
 */
export const IDLE_GRAY = colors.outline;
/** 空いている・まだ（2D の図の塗り）。色を付けない筋肉と同じ灰色 */
export const IDLE_FILL = figureColors.muscle;
/** 回復中（鍛えた日・次の日） */
export const LOAD_ORANGE = '#FF8A3D';
/** 回復中（最後の日のあたり） */
export const LOAD_YELLOW = '#F5C94A';
/** ケガ（直している途中）。ケガの画面の琥珀色（INJURY_AMBER）とは別 */
export const INJURY_RED = '#FF5A4F';
/** 明るさ k（0〜1）と色の点。間は HSL で混ぜる */
const STOPS: [number, string][] = [[0, REST_GREEN], [0.25, LOAD_YELLOW], [0.75, LOAD_ORANGE], [1, LOAD_ORANGE]];

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
const toHex = (v: number[]) => `#${v.map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`;

function toHsl(c: string): [number, number, number] {
  const [r, g, b] = hex(c);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

function fromHsl(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return toHex([r + m, g + m, b + m]);
}

/** 明るさ k（0〜1）の色。0 は回復済みの緑、0.25 は黄、0.75 からは橙。色相は近いほうへ回す */
export function recoveryColor(k: number): string {
  const t = Math.min(1, Math.max(0, k));
  const i = STOPS.findIndex(([at]) => at >= t);
  if (i <= 0) return STOPS[0][1];
  const [a, ca] = STOPS[i - 1];
  const [b, cb] = STOPS[i];
  if (ca === cb || t === b) return cb;
  const f = (t - a) / (b - a);
  const x = toHsl(ca), y = toHsl(cb);
  const dh = ((y[0] - x[0] + 540) % 360) - 180;
  return fromHsl((x[0] + dh * f + 360) % 360, x[1] + (y[1] - x[1]) * f, x[2] + (y[2] - x[2]) * f);
}

/**
 * 部位の名前（種目と部位の管理の名前。db/seed.ts の初期の部位）→ GLB の部品の名前の頭（左右がある部品は `_r`・`_l` を両方光らせる）。
 * 考え方は lib/muscleFigure.ts の muscleFigureFor（2D の図）と同じ。2D の図は前か後ろの片方しか描けないので省いていた筋肉を、
 * 3D では足す：肩は中部と後部、脚はお尻・もも裏・ふくらはぎ、上腕三頭筋は三頭筋（2D は前の図に三頭筋がないので二頭筋を塗っていた）。
 * 「腕」「腹」は名前を付け替えたとき用。知らない部位は光らせない
 */
const PART_MESHES: Record<string, string[]> = {
  胸: ['pec'],
  背中: ['trap', 'lat', 'erector_up', 'erector_low'],
  肩: ['delt_front', 'delt_mid', 'delt_rear'],
  脚: ['quad', 'ham', 'glute', 'calf', 'shin'],
  上腕二頭筋: ['biceps', 'forearm'],
  上腕三頭筋: ['triceps', 'forearm'],
  腕: ['biceps', 'triceps', 'forearm'],
  腹筋: ['abs', 'oblique'],
  腹: ['abs', 'oblique'],
};

/** 左右のない部品（腹直筋） */
const UNSIDED = new Set(['abs']);

/** 部位で光らせる部品の名前。知らない部位は空 */
export function recoveryMeshesFor(part: string): string[] {
  return (PART_MESHES[part.trim()] ?? []).flatMap((h) => (UNSIDED.has(h) ? [h] : [`${h}_r`, `${h}_l`]));
}

/**
 * 光の明るさ（0〜1）。鍛えた日からの日数 d と回復の日数 R で、k = 1 − d ÷ (R+1)。R 日目を過ぎたら 0（回復済み、緑）。
 * 回復中の (R+1) 日を等しく刻むので、どの部位も鍛えた日がいちばん強く、最後の日でも 0 にならない（緑に戻るのは回復済みになった日だけ）。
 * 例：胸（R=2）は 1 → 0.67 → 0.33 → 0、腹筋（R=1）は 1 → 0.5 → 0、背中（R=3）は 1 → 0.75 → 0.5 → 0.25 → 0。
 * 一度も鍛えていなければ 0。未来の日（d < 0）は鍛えた日とみなす
 */
export function recoveryLevel(days: number | null, recoveryDays: number): number {
  if (days == null) return 0;
  const d = Math.max(days, 0);
  if (d > recoveryDays) return 0;
  return 1 - d / (recoveryDays + 1);
}

/** 回復済みになるまでの日数（回復中なら 1 以上。回復済み・一度もないなら null） */
export function remainingDays(days: number | null, recoveryDays: number): number | null {
  if (days == null) return null;
  const left = recoveryDays + 1 - Math.max(days, 0);
  return left > 0 ? left : null;
}

/**
 * 空いているか：回復済みになった日（R+1 日目）から IDLE_AFTER_DAYS 日を過ぎた（鍛えた日から R+9 日目から）。
 * 一度も鍛えていない（まだ）・回復中・回復済みは false
 */
export function isIdle(days: number | null, recoveryDays: number): boolean {
  return days != null && days - (recoveryDays + 1) > IDLE_AFTER_DAYS;
}

type StatusOf = Pick<PartRecovery, 'last' | 'days' | 'remaining' | 'idle'>;

/** 状態の文字：「回復中 あと1日」「回復済み」「空いて10日」（最後に鍛えてからの日数）「まだ」（一度も鍛えていない） */
export function recoveryStatusText(p: StatusOf): string {
  if (p.last == null) return 'まだ';
  if (p.remaining != null) return `回復中 あと${p.remaining}日`;
  return p.idle ? `空いて${p.days}日` : '回復済み';
}

/** 札の短い状態の文字：「あと1日」「回復済み」「空いて10日」「まだ」 */
export function recoveryShortText(p: StatusOf): string {
  return p.last != null && p.remaining != null ? `あと${p.remaining}日` : recoveryStatusText(p);
}

/** 回復中でない部位の色：回復済みは緑、空いている・まだは灰色 */
export const restColor = (p: Pick<PartRecovery, 'last' | 'idle'>) => (p.last != null && !p.idle ? REST_GREEN : IDLE_GRAY);

export type PartRecovery = {
  /** 部位の名前 */
  name: string;
  /** その日までの最後に鍛えた日（1セットでもあれば）。一度もなければ null */
  last: DateKey | null;
  /** その日から何日前か */
  days: number | null;
  /** その日までの2週間（その日を含む14日）のセット数 */
  sets: number;
  /** 回復の日数の目安 */
  recoveryDays: number;
  /** 回復済みになるまでの日数（回復中だけ） */
  remaining: number | null;
  /** 空いている（回復済みの期限を過ぎた。isIdle） */
  idle: boolean;
  /** 光の明るさ（0〜1。回復中だけ 0 より大きい） */
  level: number;
  /** 光らせる部品 */
  meshes: string[];
};

/**
 * 部位ごとの回復。names はユーザーの部位の名前（非表示でないもの、並びのまま）で、光らせる部品がある部位だけを出す。
 * 最後に鍛えた日は、その部位のセットが1つでもある日（その日の主な部位でなくても）。date より後の記録は見ない。
 * セット数は1行1セット（部位のバランスと同じ数え方。ただし部位の名前ごと）
 */
export function partRecoveries(rows: TrainingSetRow[], partName: (bodyPartId: string) => string, names: string[], date: DateKey): PartRecovery[] {
  const from = addDays(date, -(BALANCE_DAYS - 1));
  const last = new Map<string, DateKey>();
  const sets = new Map<string, number>();
  for (const r of rows) {
    if (r.date > date) continue;
    const n = partName(r.bodyPartId).trim();
    const cur = last.get(n);
    if (cur == null || r.date > cur) last.set(n, r.date);
    if (r.date >= from) sets.set(n, (sets.get(n) ?? 0) + 1);
  }
  return [...new Set(names.map((n) => n.trim()))].flatMap((name) => {
    const meshes = recoveryMeshesFor(name);
    if (meshes.length === 0) return [];
    const l = last.get(name) ?? null;
    const days = l == null ? null : daysBetween(l, date);
    const r = recoveryDaysFor(name);
    return [{ name, last: l, days, sets: sets.get(name) ?? 0, recoveryDays: r, remaining: remainingDays(days, r), idle: isIdle(days, r), level: recoveryLevel(days, r), meshes }];
  });
}

/** 部品ごとの明るさ。いくつかの部位が同じ部品を光らせるとき（前腕）は、いちばん明るいもの */
export function recoveryLevels(list: PartRecovery[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of list) for (const m of p.meshes) out[m] = Math.max(out[m] ?? 0, p.level);
  return out;
}

/**
 * 空いている・まだの部位だけにある部品（3D で灰色にする）。いくつかの部位にある部品（前腕）は、回復中・回復済みの部位にもあれば外す
 */
export function idleMeshes(list: PartRecovery[]): string[] {
  const fresh = new Set(list.filter((p) => p.last != null && !p.idle).flatMap((p) => p.meshes));
  return [...new Set(list.filter((p) => p.last == null || p.idle).flatMap((p) => p.meshes))].filter((m) => !fresh.has(m));
}

/** GLB の部品の名前の頭 → 2D の図の筋肉（三角筋の前・中・後ろは、図では1つの三角筋） */
const MESH_MUSCLE: Record<string, Muscle> = {
  pec: 'pecs', trap: 'trapezius', lat: 'lats', erector_up: 'erectorsUpper', erector_low: 'erectorsLower',
  delt_front: 'deltoid', delt_mid: 'deltoid', delt_rear: 'deltoid', quad: 'quads', ham: 'hamstrings', glute: 'glutes', calf: 'calves', shin: 'shins',
  biceps: 'biceps', triceps: 'triceps', forearm: 'forearm', abs: 'abs', oblique: 'obliques',
};

/** 部位の 2D の図の筋肉（3D の部品と同じ範囲。脚はもも裏・お尻・ふくらはぎ、上腕三頭筋は後ろの三頭筋も） */
export function recoveryMusclesFor(part: string): Muscle[] {
  return [...new Set((PART_MESHES[part.trim()] ?? []).map((h) => MESH_MUSCLE[h]))];
}

/**
 * 2D の図の筋肉ごとの塗り（記録の画面のヒーロー、からだのタブの web と 3D を描けないとき）。部位の筋肉は 3D の部品と同じ範囲（recoveryMusclesFor）。
 * 回復済みの筋肉は控えめな緑、回復中の筋肉は明るさの色、空いている・まだの筋肉は灰色。いくつかの部位にある筋肉は、回復中（明るいほう）→ 回復済み
 * → 空いている・まだの順に先。どの部位にもない筋肉は控えめな緑（今までどおり）
 */
export function muscleFills(list: PartRecovery[]): Record<Muscle, string> {
  const level: Partial<Record<Muscle, number>> = {};
  const fresh = new Set<Muscle>();
  const idle = new Set<Muscle>();
  for (const p of list) {
    for (const m of recoveryMusclesFor(p.name)) {
      level[m] = Math.max(level[m] ?? 0, p.level);
      (p.last != null && !p.idle ? fresh : idle).add(m);
    }
  }
  const fill = (m: Muscle) => ((level[m] ?? 0) > 0 ? recoveryColor(level[m]!) : idle.has(m) && !fresh.has(m) ? IDLE_FILL : REST_FILL);
  return Object.fromEntries(MUSCLE_NAMES.map((m) => [m, fill(m)])) as Record<Muscle, string>;
}

const MUSCLE_NAMES: Muscle[] = [
  'trapezius', 'deltoid', 'pecs', 'biceps', 'triceps', 'forearm', 'abs', 'obliques',
  'lats', 'erectorsUpper', 'erectorsLower', 'glutes', 'quads', 'hamstrings', 'shins', 'calves',
];

/** 押した部品の部位。いくつかの部位にあたるとき（前腕）は、最後に鍛えた日の新しいもの（同じなら並びの先）。どの部位にもなければ null */
export function partOfMesh(mesh: string, list: PartRecovery[]): PartRecovery | null {
  const hits = list.filter((p) => p.meshes.includes(mesh));
  return hits.reduce<PartRecovery | null>((a, b) => (a == null || (b.last ?? '') > (a.last ?? '') ? b : a), null);
}

/** その日に直している途中だったケガ（痛めた日がその日まで。直せた日がその日より後なら、その日はまだ途中） */
export function fixingOn(injuries: Injury[], date: DateKey): Injury[] {
  return injuries.filter((i) => i.occurredOn <= date && (i.status === 'fixing' || (i.fixedOn != null && i.fixedOn > date)));
}

/**
 * 関節（3D の部品がない）→ 近い筋肉の部品の頭。肩の関節は三角筋（肩）、ひざ・股関節・足首は脚、腰（関節）は腰の起立筋（背中）、
 * 首は僧帽筋（背中）、ひじ・手首は前腕（上腕二頭筋・上腕三頭筋）
 */
const JOINT_MESHES: Partial<Record<SiteCode, string[]>> = {
  shoulder_joint: ['delt_front', 'delt_mid', 'delt_rear'],
  knee: ['quad', 'ham'],
  hip: ['glute'],
  ankle: ['shin', 'calf'],
  waist: ['erector_low'],
  neck: ['trap'],
  elbow: ['forearm'],
  wrist: ['forearm'],
};

/** ケガの部位の部品の頭（左右は問わない）。筋肉は部品、関節は近い筋肉の部品 */
function injuryHeads(site: string): string[] {
  if (!isSiteCode(site)) return [];
  return JOINT_MESHES[site] ?? partsFor(site, null).map((m) => m.replace(/_[rl]$/, ''));
}

/**
 * 部位にかかわるケガ：ケガの部位の部品（関節は近い筋肉の部品）が、部位の部品と重なるもの（左右は問わない）。
 * 痛めた種目では結ばない（ベンチプレスで痛めた肩の関節は胸でなく肩、スクワットで痛めた腰は脚でなく背中）
 */
export function injuriesForPart(p: PartRecovery, injuries: Injury[]): Injury[] {
  const own = new Set(p.meshes.map((m) => m.replace(/_[rl]$/, '')));
  return injuries.filter((i) => injuryHeads(i.site).some((h) => own.has(h)));
}

/**
 * 今日すすめる部位：回復済み・空いている（回復の日数を過ぎた）で、最後に鍛えた日がいちばん古い部位。同じなら並びの先。
 * 一度も鍛えていない部位と、直している途中のケガがある部位はすすめない。なければ null
 */
export function suggestRecovered(list: PartRecovery[], hurt: (p: PartRecovery) => boolean): PartRecovery | null {
  return list
    .filter((p) => p.last != null && p.remaining == null && !hurt(p))
    .reduce<PartRecovery | null>((a, b) => (a == null || b.last! < a.last! ? b : a), null);
}

// ---- 注釈（3D の図の引き出し線つきの札）の付け根 ----

/**
 * 部位の札を引く側（本人の右 r・左 l）と、体の前と後ろのどちらか。左右対称の部位が図のまん中に集まらないよう、
 * 部位ごとに片側の部品に付け根を置き、画面の左右に分ける（前の部位は本人の右が画面の左。腹筋は左右なし）
 */
const ANCHOR_SIDE: Record<string, { side: 'r' | 'l' | null; facing: 'front' | 'back' }> = {
  胸: { side: 'r', facing: 'front' }, 上腕二頭筋: { side: 'r', facing: 'front' }, 腕: { side: 'r', facing: 'front' }, 腹筋: { side: null, facing: 'front' },
  腹: { side: null, facing: 'front' }, 肩: { side: 'l', facing: 'front' }, 上腕三頭筋: { side: 'l', facing: 'back' }, 背中: { side: 'l', facing: 'back' },
  脚: { side: 'l', facing: 'front' },
};

/**
 * 部位の注釈の付け根（体の座標）と向き。部位の片側の部品の囲みを合わせたまん中の、前の部位なら前の面、後ろの部位なら後ろの面
 * （lib/bodyModel.ts の anchorFor と同じ考え方）。囲みのない部品（三角筋の中部）は使わない。知らない部位は null
 */
export function recoveryAnchor(part: string): { anchor: Vec3; facing: 'front' | 'back' } | null {
  const a = ANCHOR_SIDE[part.trim()];
  if (!a) return null;
  const suffix = a.side ? `_${a.side}` : null;
  const boxes = recoveryMeshesFor(part)
    .filter((m) => (suffix ? m.endsWith(suffix) : !/_[rl]$/.test(m)))
    .map(boxOf).filter((b): b is [Vec3, Vec3] => b != null);
  if (boxes.length === 0) return null;
  const lo = [0, 1, 2].map((i) => Math.min(...boxes.map((b) => b[0][i])));
  const hi = [0, 1, 2].map((i) => Math.max(...boxes.map((b) => b[1][i])));
  return { anchor: [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, a.facing === 'front' ? hi[2] : lo[2]], facing: a.facing };
}

/** 部位の札に載せるケガ（部位にかかわるケガのうち、直している途中のものを先に。なければ先頭）。ケガがなければ null */
export function leadInjury(hurt: Injury[]): Injury | null {
  return hurt.find((i) => i.status === 'fixing') ?? hurt[0] ?? null;
}

/**
 * 部位の札の付け根と向き。ケガが載る部位（hurt はその部位にかかわるケガ。injuriesForPart）は、載せるケガ（leadInjury）の印の位置：
 * 赤く光る部品の囲みのまん中、関節は関節の点（lib/bodyModel.ts の anchorFor と facingOf。3D の印・にじみと同じ決め方）。
 * 部位の代表点（recoveryAnchor）のままだと、背中の札が腰のケガでなく背中のまん中に付いてずれる（2026-11-14 #205）。
 * ケガのない部位は recoveryAnchor のまま。知らない部位は null
 */
export function recoveryCalloutAnchor(part: string, hurt: Injury[]): { anchor: Vec3; facing: 'front' | 'back' } | null {
  const base = recoveryAnchor(part);
  const lead = leadInjury(hurt);
  const at = base && lead ? anchorFor(lead.site, lead.side) : null;
  return at && lead ? { anchor: at, facing: facingOf(lead.site, lead.side) } : base;
}
