import { dateLabels, datePoints, niceTicks } from '../chart';
import { addDays, addMonths, daysBetween, formatJpDate, monthMatrix, relativeDays, toDateKey, weekStart } from '../date';

test('日付の文字列と日数の計算', () => {
  expect(toDateKey(new Date(2026, 10, 8))).toBe('2026-11-08');
  expect(addDays('2026-11-08', -8)).toBe('2026-10-31');
  expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  expect(daysBetween('2026-11-06', '2026-11-08')).toBe(2);
});

test('週は日曜始まり', () => {
  expect(weekStart('2026-11-08')).toBe('2026-11-08'); // 日曜
  expect(weekStart('2026-11-07')).toBe('2026-11-01'); // 土曜
});

test('月をまたぐときは末日に丸める', () => {
  expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
  expect(addMonths('2026-01-15', -3)).toBe('2025-10-15');
});

test('月のカレンダーは6週×7日で、日曜から始まる', () => {
  const m = monthMatrix(2026, 11);
  expect(m).toHaveLength(6);
  expect(m[0][0]).toEqual({ key: '2026-11-01', day: 1, inMonth: true });
  expect(m[4][1]).toEqual({ key: '2026-11-30', day: 30, inMonth: true });
  expect(m[4][2].inMonth).toBe(false);
  const oct = monthMatrix(2026, 10);
  expect(oct[0][0]).toEqual({ key: '2026-09-27', day: 27, inMonth: false });
});

test('表示の形', () => {
  expect(formatJpDate('2026-11-08')).toBe('11月8日（日）');
  expect(relativeDays('2026-11-06', '2026-11-08')).toBe('2日前');
  expect(relativeDays('2026-11-08', '2026-11-08')).toBe('今日');
});

test('グラフの横の位置と目盛り', () => {
  const pts = datePoints([{ date: '2026-11-01', v: 1 }, { date: '2026-11-08', v: 2 }], (i) => i.v, '2026-11-01', '2026-11-11');
  expect(pts).toEqual([{ x: 0, y: 1 }, { x: 0.7, y: 2 }]);
  expect(dateLabels('2026-11-01', '2026-11-10', 4).map((l) => l.label)).toEqual(['11/1', '11/4', '11/7', '11/10']);
});

test('縦軸の目盛りは最小と最大を含む', () => {
  expect(niceTicks(95, 101.3)).toEqual([95, 100, 105]);
  expect(niceTicks(1100, 2030)).toEqual([1000, 1500, 2000, 2500]);
  const t = niceTicks(68, 68);
  expect(t[0]).toBeLessThanOrEqual(68);
  expect(t[t.length - 1]).toBeGreaterThanOrEqual(68);
});
