import { countAt, Entrance, INITIAL_ENTRANCE, nextEntrance } from '../entrance';

const init = INITIAL_ENTRANCE as Entrance<number>;

describe('ホームの動きを、いつ動かすか', () => {
  test('読み込む前（sig が null）は動かさない', () => {
    expect(nextEntrance(init, true, null, null).token).toBe(0);
  });
  test('見えている状態で読み込んだら 0 から動かす', () => {
    expect(nextEntrance(init, true, '12', 12)).toMatchObject({ token: 1, prev: null });
  });
  test('見えていないあいだは動かさない', () => {
    expect(nextEntrance(init, false, '12', 12).token).toBe(0);
  });
  test('見えるようになるたび 0 から動かす（同じ値でも）', () => {
    const a = nextEntrance(init, true, '12', 12);
    const b = nextEntrance(a, false, '12', 12);
    expect(b.token).toBe(1);
    expect(nextEntrance(b, true, '12', 12)).toMatchObject({ token: 2, prev: null });
  });
  test('見えているあいだの同じ値の読み直しでは動かさない', () => {
    const a = nextEntrance(init, true, '12', 12);
    expect(nextEntrance(a, true, '12', 12)).toBe(a);
  });
  test('見えているあいだに値が変わったら、前の値から', () => {
    const a = nextEntrance(init, true, '12', 12);
    expect(nextEntrance(a, true, '15', 15)).toMatchObject({ token: 2, prev: 12 });
  });
  test('見えていないあいだに値が変わっても動かさず、戻ったときに 0 から', () => {
    const a = nextEntrance(init, true, '12', 12);
    const b = nextEntrance(nextEntrance(a, false, '12', 12), false, '15', 15);
    expect(b.token).toBe(1);
    expect(nextEntrance(b, true, '15', 15)).toMatchObject({ token: 2, prev: null });
  });
  test('数え上げの途中の値', () => {
    expect(countAt(0, 10, 0)).toBe(0);
    expect(countAt(0, 10, 0.5)).toBe(5);
    expect(countAt(12, 15, 1)).toBe(15);
    expect(countAt(15, 12, 0.5)).toBe(13.5);
  });
});
