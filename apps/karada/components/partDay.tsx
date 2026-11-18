import type { Repositories } from '@/db';
import { DateKey, daysBetween } from '@/lib/date';
import { focusByDate, partSuggestion } from '@/lib/training';

/**
 * 日ごとの部位と、部位の名前（ID から名前を引く・おすすめに使う、非表示でない部位の名前）を読む。
 * rows を読んであれば渡す（ホームはほかの計算にも使うので二度読まない）
 */
export async function loadPartDays(r: Repositories, rows?: Awaited<ReturnType<Repositories['workouts']['allSetRows']>>) {
  const [setRows, parts] = await Promise.all([rows ?? r.workouts.allSetRows(), r.catalog.listBodyParts({ includeHidden: true })]);
  const nameById = new Map(parts.map((p) => [p.id, p.name]));
  return {
    days: focusByDate(setRows, (id) => nameById.get(id) ?? ''),
    /** 部位の ID → 名前（非表示の部位も） */
    nameById,
    names: parts.filter((p) => !p.hidden).map((p) => p.name),
  };
}
export type PartDays = Awaited<ReturnType<typeof loadPartDays>>;

/** 今日より前の最後の筋トレの日の部位と何日前か（前回）と、今日のおすすめ（ホームの LOG の今日のマス） */
export function todaySuggestion(data: PartDays, today: DateKey) {
  const prev = data.days.filter((d) => d.date < today).at(-1) ?? null;
  const { suggest } = partSuggestion(data.days, data.names, today);
  return { prev: prev ? { parts: prev.parts, days: daysBetween(prev.date, today) } : null, suggest };
}
