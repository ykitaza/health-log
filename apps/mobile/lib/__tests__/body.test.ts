import {
  averageBetween, bmi, fatMass, goalProgress, leanMass, metricValue, mondayOf, movingAverage, previousWeight, weekAverage, weeklyPace,
} from '../body';

test('体組成の計算（68.4kg・16.2%・身長170cm）', () => {
  expect(bmi(68.4, 170)).toBeCloseTo(23.67, 2);
  expect(fatMass(68.4, 16.2)).toBeCloseTo(11.08, 2);
  expect(leanMass(68.4, 16.2)).toBeCloseTo(57.32, 2);
});

test('値が足りなければ null', () => {
  expect(bmi(68, null)).toBeNull();
  expect(bmi(68, 0)).toBeNull();
  expect(leanMass(null, 16)).toBeNull();
  expect(metricValue({ weightKg: 70, bodyFatPct: 20 }, 'leanMass', null)).toBe(56);
  expect(metricValue({ weightKg: 70, bodyFatPct: null }, 'bmi', null)).toBeNull();
});

test('体重のペース（kg／週）', () => {
  const pts = [
    { date: '2026-10-01', weightKg: 80 }, // 範囲の外
    { date: '2026-10-12', weightKg: 70.4 },
    { date: '2026-11-08', weightKg: 68.0 },
  ];
  expect(weeklyPace(pts, '2026-11-08')).toBeCloseTo((-2.4 / 27) * 7, 5);
  expect(weeklyPace([pts[2]], '2026-11-08')).toBeNull();
});

test('目標体重まで', () => {
  expect(goalProgress(68.4, 65, -0.7)).toEqual({ remaining: expect.closeTo(3.4, 5), direction: 'lose', weeks: 5 });
  expect(goalProgress(68.4, 65, 0.2).weeks).toBeNull(); // 逆向き
  expect(goalProgress(65, 65, -0.5)).toMatchObject({ remaining: 0, direction: 'reached', weeks: null });
});

describe('7日の移動平均', () => {
  test('記録のある日ごとに、その日を含む前の7日の記録の平均。記録のない日は点を作らない', () => {
    const pts = [
      { date: '2026-11-08', value: 68 },
      { date: '2026-11-01', value: 70 },
      { date: '2026-11-02', value: 69 },
      { date: '2026-11-05', value: 68.5 },
    ];
    const avg = movingAverage(pts);
    expect(avg.map((p) => p.date)).toEqual(['2026-11-01', '2026-11-02', '2026-11-05', '2026-11-08']);
    expect(avg[0].value).toBe(70);
    expect(avg[1].value).toBeCloseTo(69.5, 5);
    expect(avg[2].value).toBeCloseTo((70 + 69 + 68.5) / 3, 5);
    // 11/8 の窓は 11/2〜11/8（11/1 は入らない）
    expect(avg[3].value).toBeCloseTo((69 + 68.5 + 68) / 3, 5);
  });

  test('空なら空', () => {
    expect(movingAverage([])).toEqual([]);
  });
});

describe('期間の平均と週の平均（月曜始まり）', () => {
  const pts = [
    { date: '2026-11-01', value: 70 }, // 日曜（前の週）
    { date: '2026-11-02', value: 69 }, // 月曜
    { date: '2026-11-04', value: 68 },
    { date: '2026-11-08', value: 67 }, // 日曜
    { date: '2026-11-09', value: 66 }, // 次の週の月曜
  ];
  test('両端を含む。記録がなければ null', () => {
    expect(averageBetween(pts, '2026-11-02', '2026-11-04')).toBeCloseTo(68.5, 5);
    expect(averageBetween(pts, '2026-11-05', '2026-11-07')).toBeNull();
  });
  test('月曜〜日曜の週。その日より後の日も、同じ週なら入る', () => {
    expect(mondayOf('2026-11-08')).toBe('2026-11-02');
    expect(mondayOf('2026-11-02')).toBe('2026-11-02');
    expect(mondayOf('2026-11-01')).toBe('2026-10-26');
    expect(weekAverage(pts, '2026-11-08')).toBeCloseTo(68, 5);
    expect(weekAverage(pts, '2026-11-03')).toBeCloseTo(68, 5);
    expect(weekAverage(pts, '2026-11-01')).toBe(70);
    expect(weekAverage([], '2026-11-08')).toBeNull();
  });
});

test('前回の体重：その日より前の、いちばん新しい体重の記録（体重のない日は飛ばす）', () => {
  const daily = [
    { date: '2026-11-04', weightKg: 69 },
    { date: '2026-11-06', weightKg: 68.5 },
    { date: '2026-11-07', weightKg: null },
    { date: '2026-11-08', weightKg: 68 },
  ];
  expect(previousWeight(daily, '2026-11-08')).toEqual({ date: '2026-11-06', weightKg: 68.5 });
  expect(previousWeight(daily, '2026-11-07')).toEqual({ date: '2026-11-06', weightKg: 68.5 });
  expect(previousWeight(daily, '2026-11-04')).toBeNull();
});
