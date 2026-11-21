import { colors } from '@/theme';
import { contrastRatio } from '../contrast';

type Key = keyof typeof colors;

// 文字は背景に対して 4.5:1 以上（WCAG 1.4.3）。文字でないもの（枠・印）は 3:1 以上（WCAG 1.4.11）。
// #322：faint（#A29D93）は紙の上で 2.44:1 で、文字にも枠にも足りなかった。文字・プレースホルダーは sub、faint（#8A857C）は点線の枠・空いた枠だけ
describe('コントラスト比の計算', () => {
  test('白と黒は 21、同じ色は 1', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio(colors.accent, colors.accent)).toBe(1);
  });
  test('順番によらない', () => {
    expect(contrastRatio(colors.sub, colors.card)).toBe(contrastRatio(colors.card, colors.sub));
  });
});

describe('文字の色の組（画面で文字に使っているもの）は 4.5:1 以上', () => {
  const text: [Key, Key][] = [
    ...(['ink', 'sub', 'accent', 'seal'] as const).flatMap((fg) => (['paper', 'card'] as const).map((bg) => [fg, bg] as [Key, Key])),
    ['accent', 'wash'], // 選んだチップ
    ['ink', 'wash'],
    ['onAccent', 'accent'], // 主なボタン
    ['onAccent', 'seal'], // 落款の字
    ['paper', 'ink'], // 短い知らせ（墨の地に紙の文字）
  ];
  for (const [fg, bg] of text) {
    test(`${fg} の文字 on ${bg}`, () => {
      expect(contrastRatio(colors[fg], colors[bg])).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe('文字でないもの（枠・印）は 3:1 以上', () => {
  test.each([['faint', 'paper'], ['faint', 'card']] as [Key, Key][])('点線の枠・空いた枠（%s）on %s', (fg, bg) => {
    expect(contrastRatio(colors[fg], colors[bg])).toBeGreaterThanOrEqual(3);
  });
  test('提案のチップの点線の枠（sub）は紙の上で 3:1 以上', () => {
    expect(contrastRatio(colors.sub, colors.paper)).toBeGreaterThanOrEqual(3);
  });
});

describe('faint は文字に使わない', () => {
  test('faint は 4.5:1 に届かない（だから文字には sub を使う）', () => {
    expect(contrastRatio(colors.faint, colors.paper)).toBeLessThan(4.5);
  });
  test('sub と faint は見分けがつく（段が 2 つある）', () => {
    expect(contrastRatio(colors.sub, colors.faint)).toBeGreaterThan(1.3);
  });
});
