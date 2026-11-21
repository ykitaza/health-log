import { StyleSheet, TextStyle } from 'react-native';
import { CLASSIC_MIN_JA, sizeText, WEB_FONT_SCALE } from '../textSize';

// 文字の大きさの決まり（#323）：クラシックの和文は 12px を下回らない（数字・英字と HUD はそのまま）、web の E2E は端末の文字の大きさをまねる
const JA = ['NotoSansJP_400Regular', 'NotoSansJP_700Bold'];
const ja = (fontSize: number, lineHeight?: number): TextStyle => ({ fontFamily: JA[0], fontSize, ...(lineHeight ? { lineHeight } : null) });
const flat = (s: unknown): TextStyle => StyleSheet.flatten(s as TextStyle) ?? {};

describe('クラシックの和文の最小', () => {
  const classic = { minJa: CLASSIC_MIN_JA, jaFamilies: JA };

  test('10・11px の和文（size でも style の fontSize でも）は 12px に。行の高さも同じ割合で広げる', () => {
    expect(flat(sizeText(ja(10), classic)).fontSize).toBe(12);
    expect(flat(sizeText([ja(14), { fontSize: 11 }], classic)).fontSize).toBe(12);
    expect(flat(sizeText(ja(10, 15), classic)).lineHeight).toBe(18);
    expect(flat(sizeText({ fontFamily: JA[1], fontSize: 11.5 }, classic)).fontSize).toBe(12);
  });

  test('12px 以上の和文、数字・英字（Barlow Condensed）の小さい文字は変えない', () => {
    const big = ja(13);
    expect(sizeText(big, classic)).toBe(big);
    const num = { fontFamily: 'BarlowCondensed_600SemiBold', fontSize: 10 };
    expect(sizeText(num, classic)).toBe(num);
  });

  test('HUD（minJa なし・倍率 1）は style をそのまま返す（何も変えない）', () => {
    const s = ja(9);
    expect(sizeText(s, { jaFamilies: JA })).toBe(s);
  });
});

describe('web の E2E の文字の大きさ', () => {
  test('ふだん（jest・ネイティブ）は 1', () => {
    expect(WEB_FONT_SCALE).toBe(1);
  });

  test('倍率を掛ける（クラシックの最小を当ててから）。行の高さも掛ける', () => {
    expect(flat(sizeText(ja(14, 20), { scale: 2, jaFamilies: JA }))).toMatchObject({ fontSize: 28, lineHeight: 40 });
    expect(flat(sizeText(ja(10), { minJa: CLASSIC_MIN_JA, scale: 1.3, jaFamilies: JA })).fontSize).toBeCloseTo(15.6);
    expect(flat(sizeText({ fontFamily: 'BarlowCondensed_600SemiBold', fontSize: 10 }, { scale: 2, jaFamilies: JA })).fontSize).toBe(20);
  });
});
