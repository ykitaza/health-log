// レポート詳細の週の表（WEEKLY STATUS）に出す、記録からの集計。DB は読まない（読むのは components/report/WeeklyReportBlocks.tsx）
import type { DateKey } from './date';
import { goalProgress } from './goalBar';
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
 * レポート詳細の目標体重の棒（モックの GOAL PROGRESS）。増量（目標が今より上）は 0kg から目標までの棒（モックと同じ：現在÷目標、節目÷目標）。
 * 減量は 0kg からだと棒がいつも満杯に近くなるので、startKg（期間や28日の初めの体重）から目標までの棒にする（lib/goalBar.ts の startKg つき）。
 * scaleStartKg は棒の左端の値（増量は 0、減量は startKg）
 */
export function weightGoalProgress(currentKg: number, goalKg: number, startKg: number) {
  const gain = goalKg >= currentKg;
  const p = gain ? goalProgress({ currentKg, goalKg }) : goalProgress({ currentKg, goalKg, startKg });
  return { ...p, gain, scaleStartKg: gain ? 0 : startKg };
}
