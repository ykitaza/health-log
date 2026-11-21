// #326 計算の見直し：今あるテストが実装をなぞっていないか、手で出した答えで確かめる（集計・境界）
import { movingAverage, weightOverview, weeklyPace } from '../body';
import { addMonths, weekStart } from '../date';
import { weightOn, withBodyweight } from '../bodyweight';
import { dailyAchievement } from '../goals';
import { big3Gauge, latestSession, loadGauge, monthSummary, sleepGauge } from '../homeHud';
import { partVolume } from '../partVolume';
import { big3Total, bodyChange } from '../reports';
import {
  dailyVolumeByBodyPart, estimated1RM, exerciseTrend, periodStart, personalBests, setVolume, TrainingSetRow, weeklyVolumeByBodyPart,
} from '../training';

const row = (date: string, ex: string, part: string, weightKg: number | null, reps: number, ratio: number | null = null): TrainingSetRow =>
  ({ date, exerciseId: ex, bodyPartId: part, weightKg, reps, bodyweightRatio: ratio });

describe('日付の境界', () => {
  test('週は月曜始まり：日曜 11/22 の週は 11/16（月）から、月曜 11/23 は 11/23 から', () => {
    expect(weekStart('2026-11-22')).toBe('2026-11-16');
    expect(weekStart('2026-11-23')).toBe('2026-11-23');
    // 年をまたぐ週：2027-01-01（金）の週は 2026-12-28（月）から
    expect(weekStart('2027-01-01')).toBe('2026-12-28');
  });

  test('月末・うるう年：3/31 の 1 か月前は 2/28（2028 年は 2/29）、2028-02-29 の 1 年前は 2027-02-28', () => {
    expect(periodStart('2027-03-31', '1m')).toBe('2027-02-28');
    expect(periodStart('2028-03-31', '1m')).toBe('2028-02-29');
    expect(periodStart('2028-02-29', '1y')).toBe('2027-02-28');
    expect(addMonths('2026-08-31', -6)).toBe('2026-02-28');
  });
});

describe('総負荷量（重量×回数、自重は体重×割合×回数）', () => {
  test('100kg×5 ＋ 自重の懸垂（体重 70kg × 割合 1.0 × 10 回）＝ 500 ＋ 700', () => {
    const rows = withBodyweight([row('2026-11-20', 'bench', 'chest', 100, 5), row('2026-11-20', 'chin', 'back', null, 10, 1)],
      [{ date: '2026-11-19', weightKg: 70 }]);
    expect(rows.map(setVolume)).toEqual([500, 700]);
  });

  test('自重の体重は前の 30 日まで：30 日前の体重は使い、31 日前は使わない', () => {
    expect(weightOn([{ date: '2026-10-21', weightKg: 70 }], '2026-11-20')).toBe(70);
    expect(weightOn([{ date: '2026-10-20', weightKg: 70 }], '2026-11-20')).toBeNull();
    // その日より後の体重は使わない
    expect(weightOn([{ date: '2026-11-21', weightKg: 70 }], '2026-11-20')).toBeNull();
  });

  test('週ごと（月曜始まり）と日ごとの合計が一致し、日曜の記録はその週、月曜の記録は次の週', () => {
    const rows = [
      row('2026-11-15', 'bench', 'chest', 100, 10), // 日曜：11/9 の週
      row('2026-11-16', 'squat', 'legs', 100, 5), // 月曜：11/16 の週
      row('2026-11-21', 'bench', 'chest', 50, 10), // 土曜（今日）
      row('2026-11-22', 'bench', 'chest', 999, 10), // 明日：入れない
    ];
    const weeks = weeklyVolumeByBodyPart(rows, '2026-11-21', 2);
    expect(weeks.map((w) => [w.weekStart, w.total])).toEqual([['2026-11-09', 1000], ['2026-11-16', 1000]]);
    expect(weeks[1].byPart).toEqual({ legs: 500, chest: 500 });
    const days = dailyVolumeByBodyPart(rows, '2026-11-21', 2);
    expect(days.reduce((a, d) => a + d.total, 0)).toBe(2000);
    expect(days.find((d) => d.date === '2026-11-22')!.total).toBe(0);
  });

  test('今週の負荷量と先週比：月曜〜今日（水）と、先週の月曜〜水曜を比べる。1500 ÷ 1000 − 1 ＝ +50%', () => {
    const rows = [row('2026-11-16', 'b', 'c', 100, 10), row('2026-11-18', 'b', 'c', 50, 10), row('2026-11-09', 'b', 'c', 100, 10), row('2026-11-12', 'b', 'c', 100, 30)];
    const g = loadGauge(rows, '2026-11-18');
    expect(g.totalKg).toBe(1500);
    expect(g.thisWeek).toEqual([1000, 0, 500, null, null, null, null]);
    expect(g.lastWeek).toEqual([1000, 0, 0, 3000, 0, 0, 0]);
    expect(g.vsLastWeekPct).toBe(50);
  });

  test('今月の負荷量は 1 日から今日まで（前の月の末日は入れない）。月の筋トレの日数', () => {
    const rows = [row('2026-10-31', 'b', 'c', 100, 10), row('2026-11-01', 'b', 'c', 100, 1), row('2026-11-01', 'b', 'c', 100, 2), row('2026-11-03', 'b', 'c', 10, 10)];
    expect(monthSummary(rows, '2026-11-03')).toMatchObject({ month: 'NOV', monthJa: '11月', days: 2, volumeKg: 400 });
  });

  test('直近のトレーニング：種目 2・セット 3・負荷量 100×5＋100×5＋60×10＝1600', () => {
    const rows = [row('2026-11-20', 'bench', 'c', 100, 5), row('2026-11-20', 'bench', 'c', 100, 5), row('2026-11-20', 'row', 'b', 60, 10), row('2026-11-18', 'x', 'c', 1, 1)];
    expect(latestSession(rows, '2026-11-21')).toMatchObject({ date: '2026-11-20', exercises: 2, sets: 3, volumeKg: 1600 });
  });
});

describe('推定1RM（Epley）と自己ベスト', () => {
  test('100kg × 10 回 ＝ 100 ×（1 ＋ 10/30）＝ 133.33…、1 回はそのまま、0 回・重量なしは 0', () => {
    expect(estimated1RM(100, 10)).toBeCloseTo(133.3333333, 6);
    expect(estimated1RM(100, 1)).toBe(100);
    expect(estimated1RM(100, 0)).toBe(0);
    expect(estimated1RM(null, 10)).toBe(0);
  });

  test('自己ベストは推定1RM の最大（重量の最大ではない）：90×10（120）＞ 110×1（110）', () => {
    const pb = personalBests([row('2026-11-01', 'b', 'c', 110, 1), row('2026-11-02', 'b', 'c', 90, 10)]).get('b')!;
    expect(pb).toMatchObject({ weightKg: 90, reps: 10, date: '2026-11-02' });
    expect(pb.e1rm).toBeCloseTo(120, 9);
  });

  test('日の達成の自己ベスト：前の日までを超えた種目だけ（初めての種目は数えない）', () => {
    const sets = [row('2026-11-01', 'b', 'c', 100, 5), row('2026-11-10', 'b', 'c', 100, 6), row('2026-11-10', 'new', 'c', 50, 5)];
    const a = dailyAchievement({ date: '2026-11-10', sets, meal: { dayType: 'training', meals: [], total: { kcal: 0, protein_g: 0, fat_g: 0, carbs_g: 0 }, target: null }, sleep: null });
    expect(a.training).toEqual({ volumeKg: 850, exercises: 2, personalBestExerciseIds: ['b'] });
  });

  test('種目の推移の「1か月前」は、1か月前の日までのいちばん新しい日の値', () => {
    const rows = [row('2026-10-01', 'b', 'c', 100, 1), row('2026-10-21', 'b', 'c', 105, 1), row('2026-10-22', 'b', 'c', 110, 1), row('2026-11-20', 'b', 'c', 120, 1)];
    const t = exerciseTrend(rows, 'b', '2026-11-21', '2026-10-21', (p) => p.max1RM);
    expect(t).toMatchObject({ current: 120, monthAgo: 105 });
    expect(t.points.map((p) => p.date)).toEqual(['2026-10-21', '2026-10-22', '2026-11-20']);
  });
});

describe('BIG3 の計器', () => {
  const lifts = { bench: 'b', squat: 's', deadlift: 'd' };
  test('合計は役ごとのその日までの最高の和。差は 28 日前の合計から', () => {
    const rows = [
      row('2026-10-01', 'b', 'c', 100, 1), row('2026-10-01', 's', 'l', 140, 1), row('2026-10-01', 'd', 'b', 180, 1),
      row('2026-11-20', 'b', 'c', 105, 1), // ベンチだけ +5
      row('2026-11-21', 'd', 'b', 170, 1), // 最高より低い：合計は変わらない
    ];
    const g = big3Gauge(rows, lifts, '2026-11-21')!;
    expect(g.totalKg).toBe(105 + 140 + 180);
    expect(g.deltaBase).toBe('28D');
    expect(g.deltaKg).toBe(5);
  });

  test('月のまとめの BIG3 は期間の中の最高の和、前の同じ長さの期間からの差。どれかが欠ければ出さない', () => {
    const rows = [
      row('2026-10-05', 'b', 'c', 100, 1), row('2026-10-05', 's', 'l', 140, 1), row('2026-10-05', 'd', 'b', 180, 1),
      row('2026-11-05', 'b', 'c', 102.5, 1), row('2026-11-05', 's', 'l', 150, 1), row('2026-11-06', 'd', 'b', 185, 1),
    ];
    // 11 月（30 日）の前は 10/2〜10/31
    expect(big3Total(rows, lifts, '2026-11-01', '2026-11-30')).toEqual({ totalKg: 437.5, deltaKg: 17.5 });
    expect(big3Total(rows.filter((r) => r.exerciseId !== 'd' || r.date < '2026-11-01'), lifts, '2026-11-01', '2026-11-30')).toBeNull();
  });
});

describe('睡眠（ホームの SLEEP）', () => {
  test('今日に起きた分が昨夜。平均は 7 日のうち記録のある日だけ（360・420・480 → 420）', () => {
    const g = sleepGauge([
      { date: '2026-11-14', asleepMin: 600 }, // 7 日より前
      { date: '2026-11-15', asleepMin: 360 }, { date: '2026-11-18', asleepMin: 420 }, { date: '2026-11-21', asleepMin: 480 },
    ], '2026-11-21');
    expect(g.lastNightMin).toBe(480);
    expect(g.averageMin).toBe(420);
    expect(g.days[0].date).toBe('2026-11-15');
  });
});

describe('体重', () => {
  test('7 日の移動平均：その日を含む前の 7 日の記録だけ（8 日前は入れない）', () => {
    const m = movingAverage([{ date: '2026-11-01', value: 80 }, { date: '2026-11-02', value: 70 }, { date: '2026-11-08', value: 72 }, { date: '2026-11-09', value: 74 }]);
    expect(m.map((p) => p.value)).toEqual([80, 75, 71, 73]); // 11/8 は 11/2〜8（70・72）、11/9 は 11/3〜9（72・74）
  });

  test('直近 28 日のペース：最初と最後の記録の差 ÷ 日数 × 7（70 → 69 を 14 日で −0.5kg／週）', () => {
    expect(weeklyPace([{ date: '2026-10-24', weightKg: 80 }, { date: '2026-11-07', weightKg: 70 }, { date: '2026-11-21', weightKg: 69 }], '2026-11-21')).toBeCloseTo(-0.5, 9);
  });

  test('体重のカードの 1 か月の変化は、1 か月前の日から今日までの最初と最後の差', () => {
    const o = weightOverview([{ date: '2026-10-20', weightKg: 75 }, { date: '2026-10-21', weightKg: 72 }, { date: '2026-11-21', weightKg: 70.5 }], 68, '2026-11-21');
    expect(o.from).toBe('2026-10-21');
    expect(o.monthChange).toBeCloseTo(-1.5, 9);
    expect(o.progress).toMatchObject({ direction: 'lose' });
    expect(o.progress!.remaining).toBeCloseTo(2.5, 9);
  });

  test('月のまとめの体の変化：7 日の平均で初めと終わり。目標まで 1kg を 0.5kg／14 日で進むなら約 4 週', () => {
    const daily = [
      { date: '2026-11-01', weightKg: 71 }, { date: '2026-11-15', weightKg: 70.5 },
    ];
    const c = bodyChange(daily, 69.5, '2026-11-01', '2026-11-30')!;
    expect(c.first.value).toBe(71);
    expect(c.last.value).toBe(70.5); // 11/15 の 7 日に 11/1 は入らない
    expect(c.change).toBeCloseTo(-0.5, 9);
    expect(c.eta).toBe('約 4 週'); // 1 ÷ (0.5/14) ＝ 28 日
  });
});

describe('部位の量（part_sets）', () => {
  test('今週の途中（水曜）なら、前の期間は先週の月〜水。1 行が 1 セット、回数だけのセットも数える', () => {
    const name = (id: string) => ({ c: '胸', l: '脚' }[id] ?? '');
    const rows = [
      row('2026-11-16', 'b', 'c', 100, 5), row('2026-11-16', 'b', 'c', 100, 5), row('2026-11-18', 'p', 'c', null, 20),
      row('2026-11-09', 'b', 'c', 100, 5), row('2026-11-12', 'b', 'c', 100, 5), // 木曜は前の期間に入らない
    ];
    const v = partVolume(rows, name, '2026-11-16', '2026-11-22', '2026-11-18');
    expect([v.to, v.previous_from, v.previous_to]).toEqual(['2026-11-18', '2026-11-09', '2026-11-11']);
    const chest = v.parts.find((p) => p.part === '胸')!;
    expect(chest).toMatchObject({ sets: 3, previous: 1, delta: 2, short: 7, over: 0, trend: 'toward' });
  });
});
