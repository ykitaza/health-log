import { bmi, fatMass, goalProgress, leanMass, metricValue, muscleMass, weeklyPace } from '../body';

test('体組成の計算（68.4kg・16.2%・筋肉率33.5%・身長170cm）', () => {
  expect(bmi(68.4, 170)).toBeCloseTo(23.67, 2);
  expect(fatMass(68.4, 16.2)).toBeCloseTo(11.08, 2);
  expect(leanMass(68.4, 16.2)).toBeCloseTo(57.32, 2);
  expect(muscleMass(68.4, 33.5)).toBeCloseTo(22.91, 2);
});

test('値が足りなければ null', () => {
  expect(bmi(68, null)).toBeNull();
  expect(bmi(68, 0)).toBeNull();
  expect(leanMass(null, 16)).toBeNull();
  expect(metricValue({ weightKg: 70, bodyFatPct: null, musclePct: null, waistCm: 80 }, 'waist', null)).toBe(80);
  expect(metricValue({ weightKg: 70, bodyFatPct: null, musclePct: null, waistCm: null }, 'bmi', null)).toBeNull();
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
