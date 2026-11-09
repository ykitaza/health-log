import { average, averageClock, formatHM } from '../health';

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
