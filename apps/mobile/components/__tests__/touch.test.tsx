import { StyleSheet } from 'react-native';
import { MIN_TOUCH } from '@/lib/touch';
import { Button, Chip, CHIP_HEIGHT, IconButton } from '../ui';

// 動きの部品（Reanimated）は、ここでは要らない。props だけを見る
jest.mock('../motion', () => ({ PressableScale: 'PressableScale', Sheet: 'Sheet' }));

// 部品の押せる範囲（見た目＋hitSlop）が 48dp 以上か。web（E2E）では hitSlop を確かめられないので、値で確かめる
const slop = (v: unknown, side: 'top' | 'bottom' | 'left' | 'right') => (typeof v === 'number' ? v : ((v as Record<string, number> | undefined)?.[side] ?? 0));

describe('押せる部品の最小の大きさ', () => {
  test.each([32, 34, 36, 40, 44])('IconButton（size %i）は縦横 48 以上', (size) => {
    const el = IconButton({ name: 'close', label: '消す', onPress: () => {}, size });
    const { width, height } = StyleSheet.flatten(el.props.style);
    expect(width + slop(el.props.hitSlop, 'left') + slop(el.props.hitSlop, 'right')).toBeGreaterThanOrEqual(MIN_TOUCH);
    expect(height + slop(el.props.hitSlop, 'top') + slop(el.props.hitSlop, 'bottom')).toBeGreaterThanOrEqual(MIN_TOUCH);
  });

  test('IconButton の disabled は押せなくする', () => {
    expect(IconButton({ name: 'next', label: '次の日', onPress: () => {}, disabled: true }).props.disabled).toBe(true);
  });

  test('Chip は縦 48 以上', () => {
    const el = Chip({ label: '胸', onPress: () => {} });
    expect(CHIP_HEIGHT + slop(el.props.hitSlop, 'top') + slop(el.props.hitSlop, 'bottom')).toBeGreaterThanOrEqual(MIN_TOUCH);
  });

  test('小さいボタン（small）は縦 48 以上', () => {
    const el = Button({ label: '保存', onPress: () => {}, small: true });
    const { minHeight } = StyleSheet.flatten(el.props.style);
    expect(minHeight + slop(el.props.hitSlop, 'top') + slop(el.props.hitSlop, 'bottom')).toBeGreaterThanOrEqual(MIN_TOUCH);
  });
});
