import { LIMITS, parseInRange, rangeMessage } from '../limits';
import { SetDraft, validateSets } from '../sets';
import { kgToUnit, trimNumber } from '../units';

describe('入れられる範囲', () => {
  test('重量は 0 より大きく 500kg 以下', () => {
    expect(parseInRange('500', LIMITS.setWeight)).toEqual({ value: 500 });
    expect(parseInRange('0.5', LIMITS.setWeight)).toEqual({ value: 0.5 });
    for (const bad of ['0', '500.1', '-1', 'abc']) {
      expect(parseInRange(bad, LIMITS.setWeight)).toEqual({ error: '重量は 500kg までの正の数で入れてください' });
    }
  });

  test('lb は kg に直してから確かめ、文言は lb で出す', () => {
    // 500kg = 1102.31lb。出す上限は範囲の内側に丸める
    expect(rangeMessage(LIMITS.setWeight, 'lb')).toBe('重量は 1102.3lb までの正の数で入れてください');
    expect(parseInRange('1102.3', LIMITS.setWeight, 'lb')).toEqual({ value: expect.closeTo(499.99, 2) });
    expect(parseInRange('1102.4', LIMITS.setWeight, 'lb')).toEqual({ error: '重量は 1102.3lb までの正の数で入れてください' });
    // 体重 30〜300kg = 66.14〜661.39lb
    expect(rangeMessage(LIMITS.bodyWeight, 'lb')).toBe('体重は 66.2〜661.3lb で入れてください');
    expect(parseInRange('66.2', LIMITS.bodyWeight, 'lb')).toEqual({ value: expect.closeTo(30.03, 2) });
    expect(parseInRange('66.1', LIMITS.bodyWeight, 'lb')).toEqual({ error: '体重は 66.2〜661.3lb で入れてください' });
    expect(parseInRange('661.4', LIMITS.bodyWeight, 'lb')).toEqual({ error: '体重は 66.2〜661.3lb で入れてください' });
  });

  test('体重・目標体重・身長・体脂肪率・筋肉率・ウエスト（両端を含む）', () => {
    const cases = [
      [LIMITS.bodyWeight, '30', '300', '29.9', '300.1', '体重は 30〜300kg で入れてください'],
      [LIMITS.goalWeight, '30', '300', '29.9', '300.1', '目標体重は 30〜300kg で入れてください'],
      [LIMITS.height, '100', '250', '99.9', '250.1', '身長は 100〜250cm で入れてください'],
      [LIMITS.bodyFat, '0', '100', 'abc', '100.1', '体脂肪率は 0〜100% で入れてください'],
      [LIMITS.muscle, '0', '100', '-1', '100.1', '筋肉率は 0〜100% で入れてください'],
      [LIMITS.waist, '30', '200', '29.9', '200.1', 'ウエストは 30〜200cm で入れてください'],
    ] as const;
    for (const [limit, lo, hi, under, over, message] of cases) {
      expect(parseInRange(lo, limit)).toEqual({ value: Number(lo) });
      expect(parseInRange(hi, limit)).toEqual({ value: Number(hi) });
      expect(parseInRange(under, limit)).toEqual({ error: message });
      expect(parseInRange(over, limit)).toEqual({ error: message });
    }
  });

  test('空なら null（消す）', () => {
    expect(parseInRange('  ', LIMITS.bodyWeight)).toEqual({ value: null });
  });
});

describe('セットの重量の範囲', () => {
  const d = (key: string, weight: string, reps: string): SetDraft => ({ key, weight, reps, memo: '', done: false });
  test('500kg を超えるとエラー。lb は kg に直して比べる', () => {
    expect(validateSets([d('a', '500', '1'), d('b', '500.5', '1')], 'weight_reps', 'kg').get('b'))
      .toEqual({ weight: '重量は 500kg までの正の数で入れてください' });
    expect(validateSets([d('a', '1102.4', '1')], 'weight_reps', 'lb').get('a'))
      .toEqual({ weight: '重量は 1102.3lb までの正の数で入れてください' });
    expect(validateSets([d('a', '1102.3', '1')], 'weight_reps', 'lb').size).toBe(0);
  });
  test('保存済みの 500kg を lb で出して変えなければ、丸めで超えてもエラーにしない', () => {
    // 500kg は 1102.31lb と出る。これを kg に戻すと 500.00008kg になる
    const draft: SetDraft = { ...d('a', trimNumber(kgToUnit(500, 'lb')), '1'), weightKg: 500 };
    expect(validateSets([draft], 'weight_reps', 'lb').size).toBe(0);
  });
});
