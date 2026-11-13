// レポート詳細の週の表（WEEKLY STATUS）に出す、記録からの集計。DB は読まない（読むのは components/report/WeeklyReportBlocks.tsx）
import type { DateKey } from './date';
import type { InjuryPeriodReport, InjuryReportEntry } from './injuryReport';
import { setVolume, TrainingSetRow } from './training';

/** 期間（start〜end）の合計負荷量（kg）。lib/training.ts の setVolume の合計（回数だけの種目は自重の負荷） */
export function periodVolumeKg(rows: TrainingSetRow[], start: DateKey, end: DateKey): number {
  return rows.filter((r) => r.date >= start && r.date <= end).reduce((a, r) => a + setVolume(r), 0);
}

/**
 * 期間の筋トレの日ごとの主な部位（その日にいちばんセットの多い部位。同じ数なら先に出てきた部位）を、古い日から順に。
 * 部位の名前がない（消した部位など）セットは数えない
 */
export function periodPartSequence(rows: TrainingSetRow[], partName: (bodyPartId: string) => string, start: DateKey, end: DateKey): string[] {
  const byDate = new Map<DateKey, Map<string, number>>();
  for (const r of rows) {
    if (r.date < start || r.date > end) continue;
    const name = partName(r.bodyPartId);
    if (!name) continue;
    const counts = byDate.get(r.date) ?? new Map<string, number>();
    counts.set(name, (counts.get(name) ?? 0) + 1);
    byDate.set(r.date, counts);
  }
  return [...byDate.keys()].sort().map((d) => {
    let best = '';
    let n = 0;
    for (const [name, c] of byDate.get(d)!) if (c > n) { best = name; n = c; }
    return best;
  });
}

/**
 * 週のケガの振り返りに1件ずつ出すケガ（3分類のどれかに入るものを重ねずに。並びは 痛めた → 振り返った → 直している途中 の順で最初に出たところ）。
 * 同じケガが「振り返った」にも入るときは、期間の振り返り（periodReviews）を持つ「振り返った」の行を使う（痛めた・直している途中の行は振り返りが空のため）
 */
export function uniqueInjuryEntries(r: Pick<InjuryPeriodReport, 'occurred' | 'reviewed' | 'fixing'>): { entry: InjuryReportEntry; reviewed: boolean }[] {
  const reviewed = new Map(r.reviewed.map((e) => [e.id, e]));
  const seen = new Set<string>();
  const out: { entry: InjuryReportEntry; reviewed: boolean }[] = [];
  for (const e of [...r.occurred, ...r.reviewed, ...r.fixing]) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    const rv = reviewed.get(e.id);
    out.push({ entry: rv ?? e, reviewed: rv != null });
  }
  return out;
}
