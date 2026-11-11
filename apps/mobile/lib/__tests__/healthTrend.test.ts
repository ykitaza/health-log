import { average, averageClock, formatHM, formatSteps, sevenDayAverage, sleepWeek, stepWeek } from '../health';

// 睡眠・心拍の推移の画面の数字。時刻は端末の時刻で作る（どの時間帯で動かしても同じ結果）
const at = (h: number, m: number, day = 8) => new Date(2026, 10, day, h, m).toISOString();

describe('睡眠・心拍の推移の数字', () => {
  test('分を「時間:分」に', () => {
    expect(formatHM(416)).toBe('6:56');
    expect(formatHM(60)).toBe('1:00');
    expect(formatHM(5)).toBe('0:05');
  });

  test('平均（空なら null）', () => {
    expect(average([58, 60, 62])).toBe(60);
    expect(average([])).toBeNull();
  });

  test('寝た時刻の平均は 0時をまたいでも正しい（23:50 と 0:10 → 0:00、23:00 と 23:30 → 23:15）', () => {
    expect(averageClock([at(23, 50, 7), at(0, 10)], true)).toBe(0);
    expect(averageClock([at(23, 0), at(23, 30)], true)).toBe(23 * 60 + 15);
    expect(averageClock([at(22, 50), at(1, 10)], true)).toBe(0);
  });

  test('起きた時刻の平均はそのまま（6:00 と 7:00 → 6:30）。空なら null', () => {
    expect(averageClock([at(6, 0), at(7, 0)], false)).toBe(6 * 60 + 30);
    expect(averageClock([], false)).toBeNull();
  });
});

describe('からだの推移の睡眠のカード（直近7日）', () => {
  test('今日までの7日。記録のない日は null。平均は記録のある日だけ。7時間以上の日の曜日', () => {
    const w = sleepWeek([
      { date: '2026-10-31', asleepMin: 480 }, // 7日より前
      { date: '2026-11-03', asleepMin: 430 }, // 火
      { date: '2026-11-04', asleepMin: 360 },
      { date: '2026-11-07', asleepMin: 420 }, // 土（ちょうど7時間）
      { date: '2026-11-08', asleepMin: 410 },
    ], '2026-11-08');
    expect(w.days.map((d) => d.date)).toEqual(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']);
    expect(w.days.map((d) => d.weekday)).toEqual(['月', '火', '水', '木', '金', '土', '日']);
    expect(w.days.map((d) => d.asleepMin)).toEqual([null, 430, 360, null, null, 420, 410]);
    expect(w.average).toBeCloseTo((430 + 360 + 420 + 410) / 4, 5);
    expect(w.longDays).toEqual(['火', '土']);
  });

  test('記録がなければ平均は null', () => {
    const w = sleepWeek([], '2026-11-08');
    expect(w.average).toBeNull();
    expect(w.longDays).toEqual([]);
  });
});

describe('歩数', () => {
  test('3桁ごとのカンマ', () => {
    expect(formatSteps(8240)).toBe('8,240');
    expect(formatSteps(10320)).toBe('10,320');
    expect(formatSteps(999)).toBe('999');
    expect(formatSteps(1000000)).toBe('1,000,000');
    expect(formatSteps(7859.6)).toBe('7,860');
  });

  test('直近7日：記録のない日は null、平均は記録のある日だけ、いちばん多い日（同じなら新しい日）', () => {
    // 2026-11-08 は日曜。11-02（月）〜11-08（日）
    const days = [
      { date: '2026-11-01', steps: 99999 }, // 7日より前
      { date: '2026-11-02', steps: 6000 },
      { date: '2026-11-04', steps: 9000 },
      { date: '2026-11-07', steps: 10320 },
      { date: '2026-11-08', steps: 6120 },
    ];
    const week = stepWeek(days, '2026-11-08');
    expect(week.days.map((d) => [d.weekday, d.steps])).toEqual([
      ['月', 6000], ['火', null], ['水', 9000], ['木', null], ['金', null], ['土', 10320], ['日', 6120],
    ]);
    expect(week.average).toBe((6000 + 9000 + 10320 + 6120) / 4);
    expect(week.best).toMatchObject({ weekday: '土', steps: 10320 });
    expect(stepWeek([{ date: '2026-11-03', steps: 5000 }, { date: '2026-11-05', steps: 5000 }], '2026-11-08').best?.date).toBe('2026-11-05');
  });

  test('7日に記録がなければ、平均もいちばん多い日もない', () => {
    const week = stepWeek([], '2026-11-08');
    expect(week.average).toBeNull();
    expect(week.best).toBeNull();
    expect(week.days.every((d) => d.steps == null)).toBe(true);
  });
});

describe('その日の記録がない行の、その日までの7日の平均', () => {
  test('その日を含む7日のうち、記録のある日の平均。範囲の外は入れない。記録がなければ null', () => {
    const pts = [
      { date: '2026-11-01', value: 100 }, // 8日前：入れない
      { date: '2026-11-02', value: 400 },
      { date: '2026-11-07', value: 444 },
      { date: '2026-11-09', value: 999 }, // 先の日：入れない
    ];
    expect(sevenDayAverage(pts, '2026-11-08')).toBe(422);
    expect(formatHM(422)).toBe('7:02');
    expect(sevenDayAverage(pts.slice(0, 1), '2026-11-08')).toBeNull();
  });
});
