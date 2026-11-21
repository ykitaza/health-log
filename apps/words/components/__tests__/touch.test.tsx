import { StyleSheet } from 'react-native';
import { MIN_TOUCH } from '@/lib/touch';
import { AddChip, Button, Chip, IconButton, Toggle } from '../ui';

// 動き（Reanimated）は、ここでは要らない。props だけを見る
jest.mock('react-native-reanimated', () => ({ __esModule: true, default: { View: 'AnimatedView' }, FadeIn: {}, FadeOut: {}, SlideInDown: {}, SlideOutDown: {}, useReducedMotion: () => false }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

// 部品の押せる範囲（見た目＋hitSlop）が 48dp 以上か。web（E2E）では hitSlop を確かめられないので、値で確かめる
type Side = 'top' | 'bottom' | 'left' | 'right';
const slop = (v: unknown, side: Side) => (typeof v === 'number' ? v : ((v as Record<string, number> | undefined)?.[side] ?? 0));
type El = { props: { style?: unknown; hitSlop?: unknown } };
// style は ({ pressed }) => [...] の関数のことがある
const flat = (el: El) => {
  const st = typeof el.props.style === 'function' ? (el.props.style as (s: { pressed: boolean }) => unknown)({ pressed: false }) : el.props.style;
  return StyleSheet.flatten(st as never) as { width?: number; height?: number; minHeight?: number };
};
const height = (el: El) => {
  const st = flat(el);
  return (st.minHeight ?? st.height ?? 0) + slop(el.props.hitSlop, 'top') + slop(el.props.hitSlop, 'bottom');
};
const width = (el: El) => (flat(el).width ?? 0) + slop(el.props.hitSlop, 'left') + slop(el.props.hitSlop, 'right');

describe('押せる部品の最小の大きさ', () => {
  test('IconButton は縦横 48 以上', () => {
    const el = IconButton({ name: 'close', label: '消す', onPress: () => {} });
    expect(width(el)).toBeGreaterThanOrEqual(MIN_TOUCH);
    expect(height(el)).toBeGreaterThanOrEqual(MIN_TOUCH);
  });

  test('Chip は縦 48 以上（見た目は 40 のまま）', () => {
    const el = Chip({ label: '胸', onPress: () => {} });
    expect(flat(el).minHeight).toBe(40);
    expect(height(el)).toBeGreaterThanOrEqual(MIN_TOUCH);
  });

  test('AddChip（＋）は縦横 48 以上', () => {
    const el = AddChip({ label: '足す', onPress: () => {} });
    expect(width(el)).toBeGreaterThanOrEqual(MIN_TOUCH);
    expect(height(el)).toBeGreaterThanOrEqual(MIN_TOUCH);
  });

  test('Toggle は外側が縦横 48 以上', () => {
    const el = Toggle({ value: false, onChange: () => {}, label: '知らせる' });
    expect(width(el)).toBeGreaterThanOrEqual(MIN_TOUCH);
    expect(height(el)).toBeGreaterThanOrEqual(MIN_TOUCH);
  });

  test('小さいボタン（small）は縦 48 以上', () => {
    const el = Button({ label: '保存', onPress: () => {}, small: true });
    expect(height(el)).toBeGreaterThanOrEqual(MIN_TOUCH);
  });
});
