import { StyleSheet } from 'react-native';
import { MIN_TOUCH } from '@/lib/touch';
import { colors } from '@/theme';
import { Button, Chip, CHIP_HEIGHT, ConfirmDialog, IconButton } from '../ui';

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

  test('Chip は見た目 32、押せる範囲は縦 48 以上', () => {
    const el = Chip({ label: '胸', onPress: () => {} });
    expect(CHIP_HEIGHT).toBe(32);
    expect(StyleSheet.flatten(el.props.style).minHeight).toBeGreaterThanOrEqual(MIN_TOUCH);
  });

  test('小さいボタン（small）は縦 48 以上', () => {
    const el = Button({ label: '保存', onPress: () => {}, small: true });
    const { minHeight } = StyleSheet.flatten(el.props.style);
    expect(minHeight + slop(el.props.hitSlop, 'top') + slop(el.props.hitSlop, 'bottom')).toBeGreaterThanOrEqual(MIN_TOUCH);
  });
});

describe('処理中のボタン（二重押しを止める）', () => {
  test('busy のボタンは押せず、読み上げで処理中と伝える', () => {
    const el = Button({ label: '保存しています…', onPress: () => {}, busy: true });
    expect(el.props.disabled).toBe(true);
    expect(el.props['aria-busy']).toBe(true);
    // 使えない見た目：灰色の地（M3 の disabled container）
    expect(StyleSheet.flatten(el.props.style).backgroundColor).toBe(colors.disabledContainer);
  });

  test('busy でないボタンは押せる', () => {
    const el = Button({ label: '保存', onPress: () => {} });
    expect(el.props.disabled).toBeFalsy();
    expect(el.props['aria-busy']).toBe(false);
  });

  test('確認のダイアログは、処理中ならどちらのボタンも押せない', () => {
    const el = ConfirmDialog({ visible: true, title: '消しますか？', confirmLabel: '消す', onConfirm: () => {}, onCancel: () => {}, busy: true });
    const buttons: { props: { disabled?: boolean; busy?: boolean } }[] = [];
    const walk = (n: unknown) => {
      if (!n || typeof n !== 'object') return;
      const node = n as { type?: unknown; props?: { children?: unknown } };
      if (node.type === Button) buttons.push(node as never);
      const c = node.props?.children;
      (Array.isArray(c) ? c : [c]).forEach(walk);
    };
    walk(el);
    expect(buttons).toHaveLength(2);
    expect(buttons[0].props.disabled).toBe(true);
    expect(buttons[1].props.busy).toBe(true);
  });
});
