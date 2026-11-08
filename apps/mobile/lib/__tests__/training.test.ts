import {
  bestSet, changeOver, epley1RM, exerciseDailySeries, filterSince, periodStart, periodTotals,
  personalBests, rmTable, setVolume, topSet, totalVolume, TrainingSetRow, trainingDates,
  daysInMonth, vehicleRatio, weeklyVolumeByBodyPart, weeklyVolumes,
} from '../training';

const row = (date: string, weightKg: number | null, reps: number, exerciseId = 'bench', bodyPartId = 'chest'): TrainingSetRow =>
  ({ date, weightKg, reps, exerciseId, bodyPartId });

describe('推定1RM（Epley 式）', () => {
  test('80kg × 8回 は 101.3kg', () => {
    expect(epley1RM(80, 8)).toBeCloseTo(101.333, 2);
  });
  test('重さか回数がなければ 0', () => {
    expect(epley1RM(null, 8)).toBe(0);
    expect(epley1RM(80, 0)).toBe(0);
    expect(epley1RM(-1, 5)).toBe(0);
  });
});

describe('負荷量', () => {
  test('重量 × 回数。回数だけの種目は 0', () => {
    expect(setVolume({ weightKg: 80, reps: 8 })).toBe(640);
    expect(setVolume({ weightKg: null, reps: 20 })).toBe(0);
    expect(totalVolume([{ weightKg: 80, reps: 8 }, { weightKg: 80, reps: 8 }, { weightKg: 80, reps: 7 }])).toBe(1840);
  });
  test('ベストのセットと、いちばん重いセット', () => {
    const sets = [{ weightKg: 80, reps: 8 }, { weightKg: 85, reps: 3 }, { weightKg: 75, reps: 10 }];
    expect(bestSet(sets)?.weightKg).toBe(80); // 101.3 > 100 > 93.5
    expect(topSet(sets)?.weightKg).toBe(85);
    expect(bestSet([])).toBeNull();
  });
});

describe('期間の合計と、週ごとの棒', () => {
  const today = '2026-11-08'; // 日曜
  const rows = [
    row('2026-11-08', 100, 10), // 1000（今日）
    row('2026-11-02', 100, 5), //  500（6日前、今週ではない）
    row('2026-11-01', 100, 3), //  300（7日前）
    row('2026-10-12', 100, 2), //  200（27日前）
    row('2026-10-11', 100, 1), //  100（28日前）
    row('2026-11-09', 100, 100), // 未来は数えない
  ];
  test('7日間・28日間・総合計', () => {
    expect(periodTotals(rows, today)).toEqual({ last7: 1500, last28: 2000, total: 2100 });
  });
  test('今週から5週前まで', () => {
    expect(weeklyVolumes(rows, today, 6)).toEqual([1000, 800, 0, 0, 300, 0]);
  });
  test('乗り物のたとえ', () => {
    expect(vehicleRatio(12450, 'car')).toBeCloseTo(8.3, 1);
    expect(vehicleRatio(48300, 'bus')).toBeCloseTo(3.22, 2);
    expect(vehicleRatio(970180, 'jumbo')).toBeCloseTo(2.8, 1);
  });
  test('トレーニングした日数', () => {
    const dates = trainingDates([...rows, row('2026-11-08', 50, 5)]);
    expect(dates).toHaveLength(6);
    expect(daysInMonth(dates, 2026, 11)).toBe(4);
  });
});

describe('種目ごとの推移', () => {
  const rows = [
    row('2026-11-06', 80, 8), row('2026-11-06', 75, 10),
    row('2026-11-01', 80, 6),
    row('2026-11-06', 100, 5, 'squat', 'legs'),
  ];
  test('日ごとの総負荷量と最大RM', () => {
    const s = exerciseDailySeries(rows, 'bench');
    expect(s.map((p) => p.date)).toEqual(['2026-11-01', '2026-11-06']);
    expect(s[1].volume).toBe(1390);
    expect(s[1].max1RM).toBeCloseTo(101.333, 2);
    expect(changeOver(s, (p) => p.volume)).toBe(1390 - 480);
    expect(changeOver([s[0]], (p) => p.volume)).toBeNull();
  });
  test('期間で絞る', () => {
    expect(periodStart('2026-11-08', '3m')).toBe('2026-08-08');
    expect(periodStart('2026-11-08', 'all')).toBeNull();
    expect(filterSince([{ date: '2026-08-07' }, { date: '2026-08-08' }], '2026-08-08')).toHaveLength(1);
  });
  test('自己ベスト（その日より前だけでも見られる）', () => {
    const pb = personalBests(rows);
    expect(pb.get('bench')).toMatchObject({ weightKg: 80, reps: 8, date: '2026-11-06' });
    expect(personalBests(rows, '2026-11-06').get('bench')).toMatchObject({ weightKg: 80, reps: 6 });
    expect(pb.get('squat')?.e1rm).toBeCloseTo(116.67, 1);
  });
});

test('部位ごとの週の総負荷量', () => {
  const rows = [
    row('2026-11-08', 100, 10, 'bench', 'chest'),
    row('2026-11-07', 50, 10, 'row', 'back'),
    row('2026-11-07', 100, 5, 'squat', 'legs'),
    row('2026-11-07', null, 20, 'pushup', 'chest'), // 回数だけは 0
  ];
  const w = weeklyVolumeByBodyPart(rows, '2026-11-08', 3);
  expect(w.map((x) => x.weekStart)).toEqual(['2026-10-25', '2026-11-01', '2026-11-08']);
  expect(w[2]).toEqual({ weekStart: '2026-11-08', byPart: { chest: 1000 }, total: 1000 });
  expect(w[1].byPart).toEqual({ back: 500, legs: 500 });
});

test('RM計算機の表', () => {
  const t = rmTable(100);
  expect(t).toHaveLength(6);
  expect(t[0]).toEqual({ pct: 95, reps: 2, weight: 95 });
  expect(t[5]).toEqual({ pct: 70, reps: 12, weight: 70 });
});
