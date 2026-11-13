import {
  axisAngle, BALANCE_PARTS, BALANCE_RANGES, balanceAxisOf, balanceRangeFrom, parseBalanceRange, partBalance, partBalanceAnchored,
  partBalanceForPeriod, partBalanceForRange, partBalanceLabel, partBalancePeriodLabel, partBalanceRangeLabel,
} from '../partBalance';
import type { TrainingSetRow } from '../training';

const NAMES: Record<string, string> = {
  chest: '胸', back: '背中', shoulder: '肩', legs: '脚', biceps: '上腕二頭筋', triceps: '上腕三頭筋', abs: '腹筋', calf: 'ふくらはぎ',
};
const nameOf = (id: string) => NAMES[id] ?? '';
const row = (date: string, bodyPartId: string): TrainingSetRow => ({ date, exerciseId: 'e', bodyPartId, weightKg: 50, reps: 10 });
const rows = (date: string, part: string, n: number) => Array.from({ length: n }, () => row(date, part));

describe('部位のバランス（直近2週のセット数）', () => {
  test('軸は胸・肩・背中・腕・脚・腹の順（BIG3 は1つ飛ばし）', () => {
    expect([...BALANCE_PARTS]).toEqual(['胸', '肩', '背中', '腕', '脚', '腹']);
  });

  test('上腕二頭筋・上腕三頭筋は腕、腹筋は腹。知らない部位は数えない', () => {
    expect(balanceAxisOf('上腕二頭筋')).toBe('腕');
    expect(balanceAxisOf('上腕三頭筋')).toBe('腕');
    expect(balanceAxisOf('腹筋')).toBe('腹');
    expect(balanceAxisOf(' 胸 ')).toBe('胸');
    expect(balanceAxisOf('ふくらはぎ')).toBeNull();
    expect(balanceAxisOf('')).toBeNull();
  });

  test('1行が1セット。頂点の長さはセット数の平方根で、最大の軸を 1 にそろえる', () => {
    const b = partBalance([
      ...rows('2026-11-12', 'chest', 18), ...rows('2026-11-10', 'back', 9), ...rows('2026-11-05', 'shoulder', 12),
      ...rows('2026-11-01', 'biceps', 6), ...rows('2026-11-01', 'triceps', 4), ...rows('2026-11-03', 'abs', 3),
      ...rows('2026-11-08', 'legs', 14), ...rows('2026-11-08', 'calf', 5),
    ], nameOf, '2026-11-12');
    expect(b.sets).toEqual([18, 12, 9, 10, 14, 3]);
    expect(b.total).toBe(66);
    expect(b.ratios[0]).toBe(1);
    expect(b.ratios[2]).toBeCloseTo(Math.sqrt(0.5));
    expect(b.ratios[5]).toBeCloseTo(Math.sqrt(3 / 18));
  });

  test('平方根：18 と 2 なら 1 と 1/3、0 は 0 のまま', () => {
    const b = partBalance([...rows('2026-11-12', 'chest', 18), ...rows('2026-11-12', 'shoulder', 2)], nameOf, '2026-11-12');
    expect(b.ratios[0]).toBe(1);
    expect(b.ratios[1]).toBeCloseTo(1 / 3);
    expect(b.ratios[2]).toBe(0);
  });

  test('今日を含む14日だけ（15日前と、今日より後は数えない）', () => {
    const b = partBalance([
      row('2026-10-30', 'chest'), // 13日前（最初の日）
      row('2026-10-29', 'chest'), // 14日前：数えない
      row('2026-11-12', 'back'),
      row('2026-11-13', 'back'), // 明日：数えない
    ], nameOf, '2026-11-12');
    expect(b.sets).toEqual([1, 0, 1, 0, 0, 0]);
  });

  test('記録がなければ、割合はすべて 0', () => {
    const b = partBalance([row('2026-11-12', 'calf')], nameOf, '2026-11-12');
    expect(b.total).toBe(0);
    expect(b.ratios).toEqual([0, 0, 0, 0, 0, 0]);
  });

  test('読み上げ', () => {
    const b = partBalance([...rows('2026-11-12', 'chest', 18), ...rows('2026-11-12', 'back', 9)], nameOf, '2026-11-12');
    expect(partBalanceLabel(b)).toBe('部位のバランス、直近2週のセット数。胸 18、肩 0、背中 9、腕 0、脚 0、腹 0');
    expect(partBalanceLabel(partBalance([], nameOf, '2026-11-12'))).toBe('部位のバランス、直近2週のセット数。まだ記録がありません');
    expect(partBalanceLabel(null)).toBe('部位のバランス');
  });

  test('軸の向き：胸が左上、背中が右、脚が左下、腹が左', () => {
    const at = (i: number) => ({ x: Math.round(Math.cos(axisAngle(i)) * 100) / 100, y: Math.round(Math.sin(axisAngle(i)) * 100) / 100 });
    expect(at(0)).toEqual({ x: -0.5, y: -0.87 });
    expect(at(2)).toEqual({ x: 1, y: 0 });
    expect(at(4)).toEqual({ x: -0.5, y: 0.87 });
    expect(at(5)).toEqual({ x: -1, y: 0 });
  });
});

describe('筋トレの推移の部位のバランス（期間：2週・3か月・これまで）', () => {
  test('期間の並びと名前（切り替えのボタン）', () => {
    expect(BALANCE_RANGES).toEqual([{ key: '2w', label: '2週' }, { key: '3m', label: '3か月' }, { key: 'all', label: 'これまで' }]);
  });

  test('覚えていた値：知らない値・覚えていないときは 2週（ホームと同じ）', () => {
    expect(parseBalanceRange('3m')).toBe('3m');
    expect(parseBalanceRange('all')).toBe('all');
    expect(parseBalanceRange('2w')).toBe('2w');
    expect(parseBalanceRange(null)).toBe('2w');
    expect(parseBalanceRange('week')).toBe('2w');
  });

  test('期間の始まり：2週は今日を含む14日（ホームと同じ）、3か月は3か月前の同じ日（推移の折れ線と同じ）、これまでは最初から', () => {
    expect(balanceRangeFrom('2w', '2026-11-12')).toBe('2026-10-30');
    expect(balanceRangeFrom('3m', '2026-11-12')).toBe('2026-08-12');
    // 月末は、その月の最後の日に寄せる
    expect(balanceRangeFrom('3m', '2026-05-31')).toBe('2026-02-28');
    expect(balanceRangeFrom('all', '2026-11-12')).toBeNull();
  });

  const data = [
    ...rows('2026-11-12', 'chest', 3), // 今日
    row('2026-10-30', 'back'), // 2週の最初の日
    row('2026-10-29', 'legs'), // 2週の外、3か月の中
    row('2026-08-12', 'abs'), // 3か月の最初の日
    row('2026-08-11', 'shoulder'), // 3か月の外
    row('2026-11-13', 'chest'), // 明日：どの期間も数えない
  ];

  test('期間ごとのセット数。2週はホームの部位のバランスと同じ数。これまでのときだけ直近2週を重ねる', () => {
    const w = partBalanceForRange(data, nameOf, '2w', '2026-11-12');
    expect(w.balance).toEqual(partBalance(data, nameOf, '2026-11-12'));
    expect(w.balance.sets).toEqual([3, 0, 1, 0, 0, 0]);
    expect(w.recent).toBeNull();
    const m = partBalanceForRange(data, nameOf, '3m', '2026-11-12');
    expect(m.balance.sets).toEqual([3, 0, 1, 0, 1, 1]);
    expect(m.recent).toBeNull();
    const a = partBalanceForRange(data, nameOf, 'all', '2026-11-12');
    expect(a.balance.sets).toEqual([3, 1, 1, 0, 1, 1]);
    expect(a.recent?.sets).toEqual([3, 0, 1, 0, 0, 0]);
  });

  test('読み上げ：期間とセット数。これまでは直近2週も。その期間に記録がなければそのことを', () => {
    const w = partBalanceForRange(data, nameOf, '2w', '2026-11-12');
    expect(partBalanceRangeLabel('2w', w.balance, w.recent)).toBe('部位のバランス、直近2週のセット数。胸 3、肩 0、背中 1、腕 0、脚 0、腹 0');
    const m = partBalanceForRange(data, nameOf, '3m', '2026-11-12');
    expect(partBalanceRangeLabel('3m', m.balance, m.recent)).toBe('部位のバランス、直近3か月のセット数。胸 3、肩 0、背中 1、腕 0、脚 1、腹 1');
    const a = partBalanceForRange(data, nameOf, 'all', '2026-11-12');
    expect(partBalanceRangeLabel('all', a.balance, a.recent)).toBe(
      '部位のバランス、これまでのセット数。胸 3、肩 1、背中 1、腕 0、脚 1、腹 1。直近2週は 胸 3、肩 0、背中 1、腕 0、脚 0、腹 0',
    );
    // 直近2週に記録がない
    const old = partBalanceForRange([row('2026-09-01', 'chest')], nameOf, 'all', '2026-11-12');
    expect(partBalanceRangeLabel('all', old.balance, old.recent)).toBe('部位のバランス、これまでのセット数。胸 1、肩 0、背中 0、腕 0、脚 0、腹 0。直近2週は 記録なし');
    const empty = partBalanceForRange([row('2026-09-01', 'chest')], nameOf, '2w', '2026-11-12');
    expect(partBalanceRangeLabel('2w', empty.balance, empty.recent)).toBe('部位のバランス、直近2週のセット数。この期間の記録はありません');
  });
});

describe('レポートの期間の部位のバランス（期間・アンカー指定）', () => {
  const data = [
    ...rows('2026-11-02', 'chest', 2), // 週の初日
    ...rows('2026-11-08', 'back', 4), // 週の最終日
    row('2026-11-01', 'legs'), // 週の前日：数えない
    row('2026-11-09', 'abs'), // 週の翌日：数えない
    ...rows('2026-10-26', 'shoulder', 3), // アンカー（11/8）の直近14日の中、週の外
  ];

  test('期間（start〜end、両端を含む）のセット数。数え方と割合は partBalance と同じ', () => {
    const b = partBalanceForPeriod(data, nameOf, '2026-11-02', '2026-11-08');
    expect(b.sets).toEqual([2, 0, 4, 0, 0, 0]);
    expect(b.total).toBe(6);
    expect(b.ratios[2]).toBe(1);
    expect(b.ratios[0]).toBeCloseTo(Math.sqrt(2 / 4));
  });

  test('アンカー：終わりの日を含む直近14日。アンカーが今日なら partBalance と同じ（ホームの既定は変わらない）', () => {
    const anchored = partBalanceAnchored(data, nameOf, '2026-11-08');
    // 10/26（13日前）〜11/8：胸2・肩3・背中4・脚1。腹（11/9）はアンカーより後で数えない
    expect(anchored.sets).toEqual([2, 3, 4, 0, 1, 0]);
    expect(partBalance(data, nameOf, '2026-11-08')).toEqual(anchored);
    // 今日にアンカーした既定の partBalance も、今日を終わりにした14日と一致する
    expect(partBalanceAnchored(data, nameOf, '2026-11-12')).toEqual(partBalanceForPeriod(data, nameOf, '2026-10-30', '2026-11-12'));
  });

  test('アンカー：日数を変えられる（7日なら終わりの日を含む7日）', () => {
    const b = partBalanceAnchored(data, nameOf, '2026-11-08', 7);
    expect(b.sets).toEqual([2, 0, 4, 0, 0, 0]);
  });

  test('読み上げ（期間指定）：期間とセット数。記録がなければそのことを', () => {
    const b = partBalanceForPeriod(data, nameOf, '2026-11-02', '2026-11-08');
    expect(partBalancePeriodLabel(b, '2026-11-02', '2026-11-08')).toBe('部位のバランス、11月2日から11月8日のセット数。胸 2、肩 0、背中 4、腕 0、脚 0、腹 0');
    expect(partBalancePeriodLabel(partBalanceForPeriod([], nameOf, '2026-11-02', '2026-11-08'), '2026-11-02', '2026-11-08'))
      .toBe('部位のバランス、11月2日から11月8日のセット数。まだ記録がありません');
    expect(partBalancePeriodLabel(null, '2026-11-02', '2026-11-08')).toBe('部位のバランス');
  });
});
