import { StyleSheet } from 'react-native';
import { MIN_TOUCH } from '@/lib/touch';
import { colors } from '@/theme';
import { T } from '../Text';
import { Icon } from '../Icon';
import { INDICATOR, TabButton, TabIndicator } from '../TabItem';

// 動きの部品（Reanimated）は、ここでは要らない。props だけを見る
jest.mock('../motion', () => ({ easeIn: 'easeIn', easeOut: 'easeOut' }));
jest.mock('react-native-reanimated', () => ({ __esModule: true, default: { View: 'Animated.View' } }));

type Node = { type?: unknown; props?: Record<string, unknown> & { children?: unknown } };
const find = (n: unknown, pred: (x: Node) => boolean): Node[] => {
  if (!n || typeof n !== 'object') return [];
  const node = n as Node;
  const c = node.props?.children;
  return [...(pred(node) ? [node] : []), ...(Array.isArray(c) ? c : [c]).flatMap((x) => find(x, pred))];
};

const button = (selected: boolean) =>
  TabButton({ icon: 'home', label: 'ホーム', 'aria-selected': selected, onPress: () => {}, children: null, style: { flex: 1 } }) as unknown as Node;

describe('下のタブの項目', () => {
  test('読み上げは、役割が tab、名前がタブの名前、選んだ状態を伝える', () => {
    for (const selected of [true, false]) {
      const el = button(selected);
      expect(el.props?.role).toBe('tab');
      expect(el.props?.['aria-label']).toBe('ホーム');
      expect(el.props?.['aria-selected']).toBe(selected);
    }
  });

  test('Android の波紋は出さない', () => {
    expect(button(true).props?.android_ripple).toBeUndefined();
  });

  test('押せる範囲は縦 48 以上で、横はタブのバーの幅を分ける', () => {
    const style = StyleSheet.flatten(button(false).props?.style as never) as { minHeight: number; flex: number };
    expect(style.minHeight).toBeGreaterThanOrEqual(MIN_TOUCH);
    expect(style.flex).toBe(1);
  });

  test('選んだタブは印を出し、アイコンの色とラベルの太字を同時に切り替える', () => {
    const on = button(true);
    const off = button(false);
    expect(find(on, (x) => x.type === TabIndicator)[0].props?.selected).toBe(true);
    expect(find(off, (x) => x.type === TabIndicator)[0].props?.selected).toBe(false);
    expect(find(on, (x) => x.type === Icon)[0].props?.color).toBe(colors.onAccentDark);
    expect(find(off, (x) => x.type === Icon)[0].props?.color).toBe(colors.sub);
    expect(find(on, (x) => x.type === T)[0].props?.bold).toBe(true);
    expect(find(off, (x) => x.type === T)[0].props?.bold).toBe(false);
  });

  test('印は M3 の大きさ（64×32、角丸 16）', () => {
    expect(INDICATOR).toEqual({ width: 64, height: 32, radius: 16 });
  });
});
