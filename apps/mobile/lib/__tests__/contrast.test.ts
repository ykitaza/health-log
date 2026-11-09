import { contrastRatio } from '../contrast';
import { colors, onToneSub, PART_COLORS, toneColors } from '@/theme';

// 文字は背景に対して 4.5:1 以上（Android のアクセシビリティの指針、WCAG 1.4.3）。
// 文字でないもの（アイコン、グラフの線）は 3:1 以上（WCAG 1.4.11）
describe('コントラスト比の計算', () => {
  test('白と黒は 21、同じ色は 1', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#5BE49B', '#5BE49B')).toBe(1);
  });
  test('順番によらない', () => {
    expect(contrastRatio(colors.sub, colors.card)).toBe(contrastRatio(colors.card, colors.sub));
  });
});

describe('theme の色の組み合わせ（画面で文字に使っているもの）', () => {
  const text: [keyof typeof colors, keyof typeof colors][] = [
    // 本文・補足・強調・エラー・注意の文字と、画面・カード・入力欄の背景
    ...(['text', 'sub', 'accent', 'danger', 'star'] as const).flatMap((fg) =>
      (['bg', 'card'] as const).map((bg) => [fg, bg] as [keyof typeof colors, keyof typeof colors])),
    ['text', 'input'], ['sub', 'input'], ['accent', 'input'], ['star', 'input'],
    ['accent', 'accentDark'], ['text', 'accentDark'], // 選んだチップ、記録のある日、バッジ
    ['danger', 'dangerDark'], // 消すボタン、未来の日の知らせ
    ['onAccent', 'accent'], // 主なボタン、選んだ日
    ['onAccentDark', 'accentDark'], // 選んだチップ・切り替え、バッジ
    ['onDangerDark', 'dangerDark'], // エラーのバッジ、未来の日の知らせ
    ['danger', 'input'], // ダイアログの「外す」「消す」
    ['inverseAccent', 'text'], // スナックバーの「元に戻す」
    ['card', 'text'], // スナックバーの文（引っぱって同期の知らせ）
  ];
  test.each(text)('%s の文字 on %s は 4.5:1 以上', (fg, bg) => {
    expect(contrastRatio(colors[fg], colors[bg])).toBeGreaterThanOrEqual(4.5);
  });

  // 文字でないもの：入力欄・チップの枠、使えないアイコン、前の週の棒
  test.each([
    ['outline', 'card'], ['outline', 'bg'], ['disabled', 'card'], ['accentMuted', 'input'],
  ] as [keyof typeof colors, keyof typeof colors][])('%s on %s は 3:1 以上', (fg, bg) => {
    expect(contrastRatio(colors[fg], colors[bg])).toBeGreaterThanOrEqual(3);
  });

  test('部位の色（グラフ）はカードの上で 3:1 以上', () => {
    for (const c of PART_COLORS) expect(contrastRatio(c, colors.card)).toBeGreaterThanOrEqual(3);
  });
});

describe('レポートの調子の色', () => {
  const tones = Object.entries(toneColors);
  test.each(tones)('%s：ラベル・本文・補足の文字は、調子の面の上で 4.5:1 以上', (_, t) => {
    for (const fg of [t.accent, colors.text, onToneSub]) expect(contrastRatio(fg, t.container)).toBeGreaterThanOrEqual(4.5);
  });
  test.each(tones)('%s：調子の色（帯・ラベル・変化の文字）は、カードと画面の上で 4.5:1 以上', (_, t) => {
    for (const bg of [colors.card, colors.bg, colors.input]) expect(contrastRatio(t.accent, bg)).toBeGreaterThanOrEqual(4.5);
  });
  test.each(tones)('%s：調子のアイコンの丸（accent）の上の暗い印は 3:1 以上', (_, t) => {
    expect(contrastRatio(colors.onAccent, t.accent)).toBeGreaterThanOrEqual(3);
  });
});
