// からだのタブの「回復マップ」：筋トレの部位ごとの最後に鍛えた日と2週間のセット数から、3D の体（assets/models/body.glb）の
// 部品の光の強さを決める。three.js は読まない（テストで確かめられるように）
import type { Injury } from '@/db/repositories/injuries';
import { addDays, DateKey, daysBetween } from './date';
import { partsFor } from './bodyModel';
import { BALANCE_DAYS } from './partBalance';
import type { TrainingSetRow } from './training';

/** 光が消えるまでの日数の目安。鍛えた日・次の日がいちばん強く、8日目にはふだんの光 */
export const RECOVERY_DAYS = 7;

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
 * 光の明るさ（0〜1）。鍛えた日からの日数 d で、d が 0（今日）・1（昨日）は 1、そこから1日ごとに 1/7 ずつ下げ、8日目で 0。
 * 一度も鍛えていなければ 0（ふだんの光）
 */
export function recoveryLevel(days: number | null): number {
  if (days == null) return 0;
  return Math.min(1, Math.max(0, (RECOVERY_DAYS + 1 - Math.max(days, 1)) / RECOVERY_DAYS));
}

export type PartRecovery = {
  /** 部位の名前 */
  name: string;
  /** その日までの最後に鍛えた日（1セットでもあれば）。一度もなければ null */
  last: DateKey | null;
  /** その日から何日前か */
  days: number | null;
  /** その日までの2週間（その日を含む14日）のセット数 */
  sets: number;
  /** 光の明るさ（0〜1） */
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
    return [{ name, last: l, days, sets: sets.get(name) ?? 0, level: recoveryLevel(days), meshes }];
  });
}

/** 部品ごとの明るさ。いくつかの部位が同じ部品を光らせるとき（前腕）は、いちばん明るいもの */
export function recoveryLevels(list: PartRecovery[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of list) for (const m of p.meshes) out[m] = Math.max(out[m] ?? 0, p.level);
  return out;
}

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
 * 部位にかかわるケガ：ケガの部位の部品が部位の部品と重なるもの（左右は問わない）か、痛めた種目がその部位の種目のもの
 * （ひざ・ひじなどの関節は部品がないので、種目で結ぶ）。partOfExercise は種目の ID → 部位の名前
 */
export function injuriesForPart(p: PartRecovery, injuries: Injury[], partOfExercise: (exerciseId: string) => string | null): Injury[] {
  const own = new Set(p.meshes);
  return injuries.filter((i) => partsFor(i.site, null).some((m) => own.has(m))
    || (i.exerciseId != null && partOfExercise(i.exerciseId)?.trim() === p.name));
}
