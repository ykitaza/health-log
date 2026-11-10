/**
 * 同期で受け取った記録の件数（ホームの「食事を2件、筋トレを1件取り込みました」）。同期の動きは変えず、受け取った変更を数えるだけ。
 * - 数えるのは、新しく作られた（op が create）食事と筋トレだけ。直した・消したものは数えない。受け取った時点で消えているものも数えない
 * - 自分の端末から送った変更（device_id が自分）は数えない。MCP（device_id なし）と、ほかの端末から送ったものを数える
 * - 食事は1件ずつ（meal）。筋トレは日ごと（workout_entry の日付の数。1日に何種目足しても「1件」）
 * - 初めての同期のスナップショットは数えない（それまでの記録が全部届くため）
 */
import type { EntityState } from '@/lib/api';

export type Received = {
  meals: number;
  training: number;
  /** 受け取った食事のいちばん新しい日（「見る」で開く日）。なければ null */
  mealDate: string | null;
  /** 受け取った筋トレのいちばん新しい日。なければ null */
  trainingDate: string | null;
};

export const NOTHING_RECEIVED: Received = { meals: 0, training: 0, mealDate: null, trainingDate: null };

type Entry = { change: unknown; state: EntityState };

const later = (a: string | null, b: string) => (a == null || b > a ? b : a);

export function countReceived(entries: Entry[], deviceId: string): Received {
  let meals = 0;
  let mealDate: string | null = null;
  const trainingDates = new Set<string>();
  for (const { change, state } of entries) {
    const c = (change ?? {}) as { op?: unknown; device_id?: unknown };
    if (c.op !== 'create' || c.device_id === deviceId || state.deleted) continue;
    const date = typeof state.fields?.date === 'string' ? state.fields.date : null;
    if (state.entity_type === 'meal') {
      meals++;
      if (date) mealDate = later(mealDate, date);
    } else if (state.entity_type === 'workout_entry' && date) {
      trainingDates.add(date);
    }
  }
  const trainingDate = [...trainingDates].reduce<string | null>(later, null);
  return { meals, training: trainingDates.size, mealDate, trainingDate };
}

/** 知らせの文。何も受け取っていなければ null（出さない） */
export function receivedMessage(r: Received): string | null {
  const parts = [r.meals > 0 ? `食事を${r.meals}件` : null, r.training > 0 ? `筋トレを${r.training}件` : null].filter(Boolean);
  return parts.length === 0 ? null : `${parts.join('、')}取り込みました`;
}

/** 「見る」で開くもの。食事を受け取っていればその日の食事、でなければその日の筋トレ */
export function receivedTarget(r: Received): { kind: 'meals' | 'training'; date: string } | null {
  if (r.meals > 0 && r.mealDate) return { kind: 'meals', date: r.mealDate };
  if (r.training > 0 && r.trainingDate) return { kind: 'training', date: r.trainingDate };
  return null;
}
