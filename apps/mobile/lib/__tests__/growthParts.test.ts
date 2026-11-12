// 「記録で育つ形」の部位ごとの累計セット数（木の枝・銀河の腕）：DB の行 → 日ごと → 累計 → ホームの形の値
import { growthSeries } from '../growth';
import { mergeGrowthDays, partSetsByDate } from '../growthData';
import { homeGrowth } from '../home';
import { BALANCE_PARTS, partBalanceBetween } from '../partBalance';
import type { TrainingSetRow } from '../training';

const TODAY = '2026-11-11';
const names: Record<string, string> = {
  chest: '胸', back: '背中', shoulder: '肩', legs: '脚', biceps: '上腕二頭筋', triceps: '上腕三頭筋', abs: '腹筋', calf: 'ふくらはぎ',
};
const nameOf = (id: string) => names[id] ?? '';
const set = (date: string, bodyPartId: string): TrainingSetRow => ({ date, exerciseId: 'x', bodyPartId, weightKg: 50, reps: 10 });
const rows = [
  ...Array.from({ length: 5 }, () => set('2026-11-01', 'chest')),
  set('2026-11-01', 'biceps'),
  set('2026-11-01', 'triceps'),
  set('2026-11-03', 'legs'),
  set('2026-11-03', 'calf'), // 知らない部位は数えない
  set('2026-11-05', 'abs'),
  set('2026-11-05', 'back'),
  set('2026-11-12', 'shoulder'), // today より後は数えない
];

describe('部位ごとのセット数（形の枝・腕）', () => {
  test('日ごとに BALANCE_PARTS の順で数える。腕は上腕二頭筋・上腕三頭筋を合わせる。知らない部位と today より後は数えない', () => {
    const m = partSetsByDate(rows, nameOf, TODAY);
    expect([...m.keys()].sort()).toEqual(['2026-11-01', '2026-11-03', '2026-11-05']);
    expect(m.get('2026-11-01')).toEqual([5, 0, 0, 2, 0, 0]);
    expect(m.get('2026-11-03')).toEqual([0, 0, 0, 0, 1, 0]);
    expect(m.get('2026-11-05')).toEqual([0, 0, 1, 0, 0, 1]);
  });

  test('累計の最後（今日）は、これまでの部位のバランス（partBalanceBetween の from が null）と同じ', () => {
    const days = mergeGrowthDays({
      today: TODAY, volumeByDate: new Map([['2026-11-01', 100], ['2026-11-03', 50], ['2026-11-05', 50]]),
      meals: new Map(), sleep: [], partSetsByDate: partSetsByDate(rows, nameOf, TODAY),
    });
    const series = growthSeries(days, TODAY);
    expect(series[series.length - 1].partSets).toEqual(partBalanceBetween(rows, nameOf, null, TODAY).sets);
    // 筋トレのない日は部位を持たない（0 とみなす）
    expect(mergeGrowthDays({ today: TODAY, volumeByDate: new Map(), meals: new Map([['2026-11-02', true]]), sleep: [] })[0].partSets).toBeUndefined();
  });

  test('ホームの形の値にも届く。記録がなければ全部 0', () => {
    const days = mergeGrowthDays({
      today: TODAY, volumeByDate: new Map([['2026-11-01', 100]]), meals: new Map(), sleep: [],
      partSetsByDate: partSetsByDate(rows, nameOf, TODAY),
    });
    expect(homeGrowth(days, TODAY, null).params.partSets).toEqual([5, 0, 0, 2, 0, 0]);
    expect(homeGrowth([], TODAY, null).params.partSets).toEqual(BALANCE_PARTS.map(() => 0));
  });
});
