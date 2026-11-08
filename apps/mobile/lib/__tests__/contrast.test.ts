import { contrastRatio } from '../contrast';
import { colors, PART_COLORS } from '@/theme';

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
  ];
  test.each(text)('%s の文字 on %s は 4.5:1 以上', (fg, bg) => {
    expect(contrastRatio(colors[fg], colors[bg])).toBeGreaterThanOrEqual(4.5);
  });

  test('部位の色（グラフ）はカードの上で 3:1 以上', () => {
    for (const c of PART_COLORS) expect(contrastRatio(c, colors.card)).toBeGreaterThanOrEqual(3);
  });
});
