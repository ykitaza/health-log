// レポート詳細の週の表の集計（lib/reportView.ts）：期間の合計負荷量と、日ごとの主な部位の並び
import type { InjuryReportEntry } from '../injuryReport';
import { periodPartSequence, periodVolumeKg, uniqueInjuryEntries } from '../reportView';
import type { TrainingSetRow } from '../training';

const set = (date: string, part: string, weightKg: number | null, reps: number, bodyweightLoadKg: number | null = null): TrainingSetRow => ({
  date, exerciseId: `ex-${part}`, bodyPartId: part, weightKg, reps, bodyweightLoadKg,
});

describe('periodVolumeKg', () => {
  it('期間の中のセットだけを足す。回数だけの種目は自重の負荷で数える', () => {
    const rows = [set('2026-11-01', 'chest', 100, 5), set('2026-11-02', 'chest', 60, 10), set('2026-11-03', 'abs', null, 10, 35), set('2026-11-09', 'legs', 100, 5)];
    expect(periodVolumeKg(rows, '2026-11-02', '2026-11-08')).toBe(600 + 350);
  });
  it('記録がなければ 0', () => {
    expect(periodVolumeKg([], '2026-11-02', '2026-11-08')).toBe(0);
  });
});

describe('periodPartSequence', () => {
  const names: Record<string, string> = { chest: '胸', legs: '脚', back: '背中' };
  const name = (id: string) => names[id] ?? '';
  it('日ごとにいちばんセットの多い部位を、古い日から並べる', () => {
    const rows = [
      set('2026-11-04', 'back', 80, 5), set('2026-11-04', 'back', 80, 5), set('2026-11-04', 'chest', 60, 5),
      set('2026-11-02', 'chest', 60, 5),
      set('2026-11-03', 'legs', 100, 5),
    ];
    expect(periodPartSequence(rows, name, '2026-11-02', '2026-11-08')).toEqual(['胸', '脚', '背中']);
  });
  it('同じ数なら先に出てきた部位。名前のない部位と期間の外は数えない', () => {
    const rows = [set('2026-11-02', 'legs', 100, 5), set('2026-11-02', 'chest', 60, 5), set('2026-11-02', 'gone', 1, 1), set('2026-11-09', 'back', 1, 1)];
    expect(periodPartSequence(rows, name, '2026-11-02', '2026-11-08')).toEqual(['脚']);
  });
});

describe('uniqueInjuryEntries', () => {
  const entry = (id: string, periodReviewCount = 0) => ({ id, periodReviewCount, periodReviews: [] } as unknown as InjuryReportEntry);
  it('3分類に重なるケガは1件にし、振り返ったケガは振り返りのある行を使う', () => {
    const a = entry('a'); const aReviewed = entry('a', 2); const b = entry('b');
    const out = uniqueInjuryEntries({ occurred: [a, b], reviewed: [aReviewed], fixing: [a, entry('c')] });
    expect(out.map((o) => o.entry.id)).toEqual(['a', 'b', 'c']);
    expect(out[0]).toEqual({ entry: aReviewed, reviewed: true });
    expect(out[1].reviewed).toBe(false);
  });
});
