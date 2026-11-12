import { axisAngle, BALANCE_PARTS, balanceAxisOf, partBalance, partBalanceLabel } from '../partBalance';
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

  test('1行が1セット。最大の軸を 1 にそろえる', () => {
    const b = partBalance([
      ...rows('2026-11-12', 'chest', 18), ...rows('2026-11-10', 'back', 9), ...rows('2026-11-05', 'shoulder', 12),
      ...rows('2026-11-01', 'biceps', 6), ...rows('2026-11-01', 'triceps', 4), ...rows('2026-11-03', 'abs', 3),
      ...rows('2026-11-08', 'legs', 14), ...rows('2026-11-08', 'calf', 5),
    ], nameOf, '2026-11-12');
    expect(b.sets).toEqual([18, 12, 9, 10, 14, 3]);
    expect(b.total).toBe(66);
    expect(b.ratios[0]).toBe(1);
    expect(b.ratios[2]).toBeCloseTo(0.5);
    expect(b.ratios[5]).toBeCloseTo(3 / 18);
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
