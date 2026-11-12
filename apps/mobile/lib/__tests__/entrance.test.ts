import { countAt, entranceOf } from '../entrance';

describe('ホームに来たときの動きを、いつ動かすか', () => {
  test('読み込む前（null）は動かさない', () => {
    expect(entranceOf(undefined, null)).toEqual({ fresh: false, prev: null });
    expect(entranceOf({ sig: '12', value: 12 }, null)).toEqual({ fresh: false, prev: null });
  });
  test('アプリを開いて初めて見せるときは 0 から', () => {
    expect(entranceOf(undefined, '12')).toEqual({ fresh: true, prev: null });
  });
  test('前と同じ値（タブの行き来・読み直し・画面の作り直し）では動かさない', () => {
    expect(entranceOf({ sig: '12', value: 12 }, '12').fresh).toBe(false);
  });
  test('値が変わったら、前の値から', () => {
    expect(entranceOf({ sig: '12', value: 12 }, '15')).toEqual({ fresh: true, prev: 12 });
  });
  test('数え上げの途中の値', () => {
    expect(countAt(0, 10, 0)).toBe(0);
    expect(countAt(0, 10, 0.5)).toBe(5);
    expect(countAt(12, 15, 1)).toBe(15);
    expect(countAt(15, 12, 0.5)).toBe(13.5);
  });
});
