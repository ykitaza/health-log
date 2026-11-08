import { toCsv } from '../csv';
import { copyOf, hasChanges, lastFilledSet, SetDraft, toSetInputs, validateSets } from '../sets';
import { fmt1, kgToUnit, parseNumber, trimNumber, unitToKg } from '../units';

test('数の読み取り', () => {
  expect(parseNumber('80')).toBe(80);
  expect(parseNumber(' 80.5 ')).toBe(80.5);
  expect(parseNumber('８０，５')).toBe(80.5);
  expect(parseNumber('')).toBeNull();
  expect(parseNumber('abc')).toBeNull();
  expect(parseNumber('-5')).toBeNull();
});

test('kg と lb', () => {
  expect(kgToUnit(100, 'lb')).toBeCloseTo(220.462, 3);
  expect(unitToKg(kgToUnit(80, 'lb'), 'lb')).toBeCloseTo(80, 10);
  expect(kgToUnit(80, 'kg')).toBe(80);
  expect(fmt1(101.333)).toBe('101.3');
  expect(fmt1(80)).toBe('80.0');
  expect(trimNumber(80)).toBe('80');
});

const d = (key: string, weight: string, reps: string, memo = ''): SetDraft => ({ key, weight, reps, memo, done: false });

describe('セットの入力の確認', () => {
  test('重量が空ならエラー', () => {
    const e = validateSets([d('a', '80', '8'), d('b', '', '8')], 'weight_reps', 'kg');
    expect(e.size).toBe(1);
    expect(e.get('b')).toEqual({ weight: '重量を入れてください' });
  });
  test('回数がないか、整数でなければエラー。小数のときは空のときと文言を分ける', () => {
    const e = validateSets([d('a', '80', ''), d('b', '80', '2.5'), d('c', '80', '0'), d('d', '', '0.5')], 'weight_reps', 'kg');
    expect(e.get('a')?.reps).toBe('回数を入れてください');
    expect(e.get('b')?.reps).toBe('回数は整数で入れてください');
    expect(e.get('c')?.reps).toBe('回数を入れてください');
    expect(e.get('d')).toEqual({ weight: '重量を入れてください', reps: '回数は整数で入れてください' });
    expect(validateSets([d('a', '', '8.5')], 'reps_only', 'kg').get('a')).toEqual({ reps: '回数は整数で入れてください' });
  });
  test('空の行は無視し、回数だけの種目は重量を見ない', () => {
    expect(validateSets([d('a', '', '')], 'weight_reps', 'kg').size).toBe(0);
    expect(validateSets([d('a', '', '20')], 'reps_only', 'kg').size).toBe(0);
  });
  test('保存用に変換（空の行を落とし、lb は kg に）', () => {
    const out = toSetInputs([d('a', '100', '5', ' 良し '), d('b', '', '')], 'weight_reps', 'lb');
    expect(out).toHaveLength(1);
    expect(out[0].weightKg).toBeCloseTo(45.359, 3);
    expect(out[0]).toMatchObject({ reps: 5, memo: '良し', done: false });
    expect(toSetInputs([d('a', '10', '20')], 'reps_only', 'kg')[0].weightKg).toBeNull();
  });
  test('保存済みの重量を lb で出したときは、変えなければ kg の値をそのまま使う', () => {
    // 80kg は 176.37lb と出る。176.37lb を kg に戻すと 80.00009kg になり、開いて保存しただけで値が変わってしまう
    const draft: SetDraft = { ...d('a', trimNumber(kgToUnit(80, 'lb')), '8'), weightKg: 80 };
    expect(draft.weight).toBe('176.37');
    expect(toSetInputs([draft], 'weight_reps', 'lb')[0].weightKg).toBe(80);
    expect(toSetInputs([copyOf(draft, 'b')], 'weight_reps', 'lb')[0].weightKg).toBe(80);
    // 変えたら、入れた値から換算する
    expect(toSetInputs([{ ...draft, weight: '180' }], 'weight_reps', 'lb')[0].weightKg).toBeCloseTo(81.647, 3);
  });
  test('写すのは、重量か回数が入っている最後のセット。なければ null', () => {
    expect(lastFilledSet([d('a', '80', '8'), d('b', '', ''), d('c', ' ', '')])?.key).toBe('a');
    expect(lastFilledSet([d('a', '80', '8'), d('b', '', '6'), d('c', '', '', 'メモだけ')])?.key).toBe('b');
    expect(lastFilledSet([d('a', '70', ''), d('b', '', '')])?.key).toBe('a');
    expect(lastFilledSet([d('a', '', ''), d('b', '', '', 'メモだけ')])).toBeNull();
    expect(lastFilledSet([])).toBeNull();
  });
  test('保存していない変更があるか（空の行の増減と、画面の key の違いは変更にしない）', () => {
    const blank3 = [d('a', '', ''), d('b', '', ''), d('c', '', '')];
    expect(hasChanges(blank3, [d('x', '', ''), d('y', '', '')])).toBe(false);
    expect(hasChanges(blank3, [...blank3, d('z', '', '')])).toBe(false);
    expect(hasChanges(blank3, [d('a', '80', ''), d('b', '', ''), d('c', '', '')])).toBe(true);
    expect(hasChanges(blank3, [d('a', '', '', 'メモ'), d('b', '', ''), d('c', '', '')])).toBe(true);

    const saved = [{ ...d('a', '80', '8'), id: 's1' }, { ...d('b', '80', '6'), id: 's2', done: true }];
    expect(hasChanges(saved, saved.map((x) => ({ ...x, key: x.key + '2' })))).toBe(false);
    expect(hasChanges(saved, [saved[0], { ...saved[1], done: false }])).toBe(true);
    expect(hasChanges(saved, [saved[0], { ...saved[1], reps: '7' }])).toBe(true);
    expect(hasChanges(saved, [saved[0]])).toBe(true); // セットを消した
    expect(hasChanges(saved, [saved[1], saved[0]])).toBe(true); // 並びが変わった
    expect(hasChanges(saved, [...saved, d('c', '', '')])).toBe(false);
  });
  test('上のセットを写す', () => {
    expect(copyOf({ ...d('a', '80', '8', 'メモ'), done: true, id: 'x' }, 'b')).toEqual(d('b', '80', '8'));
  });
});

test('CSV は必要なときだけ引用符で囲む', () => {
  expect(toCsv(['a', 'b'], [['x,y', 'say "hi"'], [1, null]])).toBe('a,b\r\n"x,y","say ""hi"""\r\n1,\r\n');
});

import { formatSetLong, formatSetShort, tonnes } from '../format';

test('セットの表示', () => {
  expect(formatSetLong(80, 8, 'kg')).toBe('80.0 kg × 8 回');
  expect(formatSetLong(null, 20, 'kg')).toBe('20 回');
  expect(formatSetShort(82.5, 8, 'kg')).toBe('82.5kg × 8');
  expect(tonnes(12450)).toBe('12.45');
});
