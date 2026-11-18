import {
  FORM_VIDEO_URL_MAX_LENGTH, LIMITS, MEMO_MAX_LENGTH, memoLengthError, NAME_MAX_LENGTH, nameLengthError, parseFormVideoUrl, parseInRange, rangeMessage, REPS_MAX,
} from '../limits';
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

  test('体重・目標体重・身長・体脂肪率（両端を含む）', () => {
    const cases = [
      [LIMITS.bodyWeight, '30', '300', '29.9', '300.1', '体重は 30〜300kg で入れてください'],
      [LIMITS.goalWeight, '30', '300', '29.9', '300.1', '目標体重は 30〜300kg で入れてください'],
      [LIMITS.height, '100', '250', '99.9', '250.1', '身長は 100〜250cm で入れてください'],
      [LIMITS.bodyFat, '0', '100', 'abc', '100.1', '体脂肪率は 0〜100% で入れてください'],
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

describe('回数とメモの上限（同期のサーバーと同じ）', () => {
  const d = (key: string, reps: string, memo = ''): SetDraft => ({ key, weight: '', reps, memo, done: false });
  test(`回数は ${REPS_MAX} 回まで`, () => {
    expect(validateSets([d('a', String(REPS_MAX))], 'reps_only', 'kg').size).toBe(0);
    expect(validateSets([d('a', String(REPS_MAX + 1))], 'reps_only', 'kg').get('a'))
      .toEqual({ reps: `回数は ${REPS_MAX} 回までで入れてください` });
  });
  test(`セットのメモは ${MEMO_MAX_LENGTH} 文字まで（コードポイントで数える）`, () => {
    expect(validateSets([d('a', '1', 'あ'.repeat(MEMO_MAX_LENGTH))], 'reps_only', 'kg').size).toBe(0);
    expect(validateSets([d('a', '1', '💪'.repeat(MEMO_MAX_LENGTH))], 'reps_only', 'kg').size).toBe(0);
    expect(validateSets([d('a', '1', 'あ'.repeat(MEMO_MAX_LENGTH + 1))], 'reps_only', 'kg').get('a'))
      .toEqual({ memo: `メモは ${MEMO_MAX_LENGTH} 文字以内で入れてください（今は${MEMO_MAX_LENGTH + 1}文字）` });
    // 前後の空白は保存しないので数えない
    expect(validateSets([d('a', '1', ` ${'あ'.repeat(MEMO_MAX_LENGTH)} `)], 'reps_only', 'kg').size).toBe(0);
  });
  test('体組成のメモ', () => {
    expect(memoLengthError('あ'.repeat(MEMO_MAX_LENGTH))).toBeNull();
    expect(memoLengthError('あ'.repeat(MEMO_MAX_LENGTH + 1))).toMatch(/1000 文字以内/);
  });
});

describe('名前の長さはコードポイントで数える（書記素ではない）', () => {
  test('サロゲートペアの絵文字は1つ、ZWJ でつないだ絵文字は、つないだ数だけ数える', () => {
    expect(nameLengthError('種目', '💪'.repeat(NAME_MAX_LENGTH))).toBeNull();
    // 👨‍👩‍👧 は 👨・ZWJ・👩・ZWJ・👧 の5つと数える。見た目は9文字でも45
    expect(nameLengthError('種目', '👨‍👩‍👧'.repeat(9))).toBe('種目の名前は40文字以内で入れてください（今は45文字）');
  });
});

describe('フォームの動画のリンク', () => {
  test('https:// で始まるものだけ。前後の空白は取り、空はリンクなし', () => {
    expect(parseFormVideoUrl(' https://youtu.be/abc ')).toEqual({ value: 'https://youtu.be/abc' });
    expect(parseFormVideoUrl('  ')).toEqual({ value: null });
    for (const bad of ['http://youtu.be/abc', 'youtu.be/abc', 'https://', 'https://youtu.be/a b', 'javascript:alert(1)', 'HTTPS://youtu.be/abc']) {
      expect(parseFormVideoUrl(bad)).toEqual({ error: 'リンクは https:// で始まるものを入れてください（空白は入れられません）' });
    }
  });
  test('長さはサーバーと同じ上限まで', () => {
    const head = 'https://youtu.be/';
    expect(parseFormVideoUrl(head + 'a'.repeat(FORM_VIDEO_URL_MAX_LENGTH - head.length))).toHaveProperty('value');
    expect(parseFormVideoUrl(head + 'a'.repeat(FORM_VIDEO_URL_MAX_LENGTH - head.length + 1)))
      .toEqual({ error: `リンクは ${FORM_VIDEO_URL_MAX_LENGTH} 文字以内で入れてください（今は${FORM_VIDEO_URL_MAX_LENGTH + 1}文字）` });
  });
});
