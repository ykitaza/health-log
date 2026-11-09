import { ReactElement } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { T } from '../Text';
import { Button } from '../ui';

jest.mock('../motion', () => ({ PressableScale: 'PressableScale', Sheet: 'Sheet' }));

// Button の中の文字（T）の props を取り出す。PressableScale > View > [Icon, T]
function label(el: ReactElement): Record<string, unknown> {
  const inner = (el.props as { children: ReactElement }).children;
  const kids = ([] as unknown[]).concat((inner.props as { children: unknown }).children);
  const t = kids.find((k): k is ReactElement => !!k && (k as ReactElement).type === T);
  if (!t) throw new Error('T がない');
  return t.props as Record<string, unknown>;
}

const flat = (style: unknown) => StyleSheet.flatten(style as never) as Record<string, unknown>;

describe('ボタンの文字（Android で最後の字が切れない形）', () => {
  afterEach(() => jest.restoreAllMocks());

  test.each([
    ['AI で記録', 'chat'],
    ['種目を追加', 'plus'],
  ] as const)('「%s」は1行、入らなければ小さくし、折り方は simple', (text, icon) => {
    const p = label(Button({ label: text, icon, variant: 'tonal', onPress: () => {} }));
    expect(p.children).toBe(text);
    expect(p.numberOfLines).toBe(1);
    expect(p.adjustsFontSizeToFit).toBe(true);
    expect(p.textBreakStrategy).toBe('simple');
    expect(flat(p.style).flexShrink).toBe(1);
  });

  // T が最後に RN の Text へ渡す style（T の段階の lineHeight に、Button の style を重ねたもの）
  const drawn = () => {
    const p = label(Button({ label: 'AI で記録', icon: 'chat', onPress: () => {} }));
    return flat((T(p as never) as ReactElement<{ style: unknown }>).props.style);
  };

  test('Android では行の高さを付けない（1行用の BoringLayout で測って描く）。文字の大きさは titleM の 16 のまま', () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const style = drawn();
    expect(style.lineHeight).toBeUndefined();
    expect(style.fontSize).toBe(16);
  });

  test('Android 以外は今のまま（titleM の行の高さ 24）', () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    expect(drawn().lineHeight).toBe(24);
  });
});
