import { MIN_TOUCH, touchRoom, touchSlop } from '../touch';

describe('押せる範囲（48×48dp）', () => {
  test('見た目の大きさに hitSlop を足すと 48 以上', () => {
    for (const size of [20, 32, 34, 36, 40, 44, 47]) expect(size + 2 * touchSlop(size)).toBeGreaterThanOrEqual(MIN_TOUCH);
  });
  test('48 以上なら足さない。least より小さくしない', () => {
    expect(touchSlop(56)).toBe(0);
    expect(touchSlop(44, 6)).toBe(6);
  });
  test('親を広げても、まわりとの間（margin＋padding）は変わらない', () => {
    const r = touchRoom(15, { top: 22, bottom: 10 });
    expect(r.marginTop + r.paddingVertical).toBe(22);
    expect(r.marginBottom + r.paddingVertical).toBe(10);
  });
});
