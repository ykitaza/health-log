import { detailLeft, hitColumns, isScrub, nearestIndex, selectedIndex, toggleSelection } from '../chart';
import { exerciseSetCounts, TrainingSetRow } from '../training';

// グラフの棒・点を押して選ぶ（#327）。画面の部品は components/chartSelect.tsx
describe('toggleSelection・selectedIndex：選びはキー（日付）で持つ', () => {
  test('押すと選ぶ。同じものをもう一度押すと外す。ほかを押すとそれに変える', () => {
    expect(toggleSelection(null, '2026-11-07')).toBe('2026-11-07');
    expect(toggleSelection('2026-11-07', '2026-11-07')).toBeNull();
    expect(toggleSelection('2026-11-07', '2026-11-05')).toBe('2026-11-05');
  });

  test('並びの中の位置。期間や週を変えて並びから外れたら -1（別の日を指さない）', () => {
    const keys = ['2026-11-05', '2026-11-07', '2026-11-08'];
    expect(selectedIndex(keys, '2026-11-07')).toBe(1);
    expect(selectedIndex(keys, null)).toBe(-1);
    expect(selectedIndex(keys, '2026-10-01')).toBe(-1);
  });
});

describe('nearestIndex・hitColumns：押せる範囲は、となりとの真ん中で分けた列', () => {
  const xs = [20, 60, 100];
  test('押した横の位置にいちばん近いもの。端の外もいちばん端のもの', () => {
    expect(nearestIndex(xs, 0)).toBe(0);
    expect(nearestIndex(xs, 39)).toBe(0);
    expect(nearestIndex(xs, 41)).toBe(1);
    expect(nearestIndex(xs, 300)).toBe(2);
    expect(nearestIndex([], 10)).toBe(-1);
  });

  test('列はグラフの左端から右端まで、すき間なく並ぶ', () => {
    expect(hitColumns(xs, 0, 120)).toEqual([{ left: 0, width: 40 }, { left: 40, width: 40 }, { left: 80, width: 40 }]);
    expect(hitColumns([50], 0, 100)).toEqual([{ left: 0, width: 100 }]);
  });

  test('7 日の棒は、360 の幅のカードの中でも列の幅が 40 以上（グラフの幅 296）', () => {
    const w = 296;
    const seven = Array.from({ length: 7 }, (_, i) => ((i + 0.5) / 7) * w);
    for (const c of hitColumns(seven, 0, w)) expect(c.width).toBeGreaterThanOrEqual(40);
  });
});

describe('detailLeft：札の三角はグラフの幅からはみ出さない', () => {
  test('まん中に合わせ、端では寄せる', () => {
    expect(detailLeft(100, 12, 300)).toBe(94);
    expect(detailLeft(2, 12, 300)).toBe(0);
    expect(detailLeft(299, 12, 300)).toBe(288);
    expect(detailLeft(10, 400, 300)).toBe(0);
  });
});

describe('isScrub：横になぞったときだけ選びを移す（縦はスクロール）', () => {
  test('横に 8 より大きく、縦の 1.5 倍より大きく動いたとき', () => {
    expect(isScrub(12, 2)).toBe(true);
    expect(isScrub(-12, 0)).toBe(true);
    expect(isScrub(6, 0)).toBe(false);
    expect(isScrub(12, 10)).toBe(false);
    expect(isScrub(2, 40)).toBe(false);
  });
});

describe('exerciseSetCounts：選んだ日・週の札の種目ごとのセット数', () => {
  const row = (date: string, exerciseId: string): TrainingSetRow => ({ date, exerciseId, bodyPartId: 'p', weightKg: 60, reps: 10 });
  const rows = [row('2026-11-05', 'bench'), row('2026-11-05', 'bench'), row('2026-11-05', 'squat'), row('2026-11-06', 'squat'), row('2026-11-06', 'squat'), row('2026-11-06', 'squat')];
  test('期間の中だけを数え、多い順', () => {
    expect(exerciseSetCounts(rows, '2026-11-05', '2026-11-05')).toEqual([{ exerciseId: 'bench', sets: 2 }, { exerciseId: 'squat', sets: 1 }]);
    expect(exerciseSetCounts(rows, '2026-11-02', '2026-11-08')).toEqual([{ exerciseId: 'squat', sets: 4 }, { exerciseId: 'bench', sets: 2 }]);
    expect(exerciseSetCounts(rows, '2026-11-07', '2026-11-08')).toEqual([]);
  });
});
