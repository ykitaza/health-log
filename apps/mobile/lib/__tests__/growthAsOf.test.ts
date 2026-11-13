import { growthScore, growthScoreAsOf, GrowthDay, scoreDetail, scoreDetailAsOf } from '../growth';

const day = (date: string, p: Partial<GrowthDay> = {}): GrowthDay => ({
  date, trained: (p.volumeKg ?? 0) > 0, volumeKg: 0, mealRecorded: false, mealGoalReached: false, sleepMin: null, ...p,
});

describe('growthScoreAsOf（月末アンカー）', () => {
  const days = [
    day('2026-10-20', { volumeKg: 4000 }),
    day('2026-11-06', { volumeKg: 500, mealRecorded: true, mealGoalReached: true, sleepMin: 420 }),
    day('2026-11-08', { volumeKg: 500 }),
    day('2026-12-25', { volumeKg: 99999, mealRecorded: true, sleepMin: 600 }),
  ];
  test('asOf = today のとき growthScore と同じ（既存の呼び出しの互換）', () => {
    expect(growthScoreAsOf(days, '2026-11-11', 3)).toEqual(growthScore(days, '2026-11-11', 3));
    expect(growthScoreAsOf(days, '2026-11-11')).toEqual(growthScore(days, '2026-11-11'));
  });
  test('asOf より後の記録は見ない', () => {
    const withoutFuture = days.filter((d) => d.date <= '2026-11-11');
    expect(growthScoreAsOf(days, '2026-11-11')).toEqual(growthScoreAsOf(withoutFuture, '2026-11-11'));
  });
  test('過去の月末にアンカーすると、その週（asOf で終わる7日）で計算する', () => {
    const s = growthScoreAsOf(days, '2026-11-08');
    // 11/2〜11/8：筋トレ2日・負荷量1000、食事は届いた日が記録日の全部、睡眠は420分が1日
    expect(s.total).toBe(growthScore(days.filter((d) => d.date <= '2026-11-08'), '2026-11-08').total);
    expect(s.diffFromLastWeek).not.toBeNull();
  });
  test('scoreDetailAsOf は scoreDetail の as-of 版で、asOf = today で一致する', () => {
    expect(scoreDetailAsOf(days, '2026-11-11')).toEqual(scoreDetail(days, '2026-11-11'));
  });
});
