import { StyleSheet } from 'react-native';
import { MIN_TOUCH } from '@/lib/touch';
import { syncStatusLine } from '@/lib/sync/status';
import { colors } from '@/theme';
import { duration } from '@/theme/motion';
import { SyncStatusView } from '../SyncStatus';
import { Snackbar } from '../ui';

// 動きの部品（Reanimated）は、ここでは要らない。props だけを見る
jest.mock('../motion', () => ({ PressableScale: 'PressableScale', easeOut: 'easeOut' }));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: 'Animated.View' },
  FadeIn: { duration: (ms: number) => ({ easing: () => ({ fadeInMs: ms }) }) },
  LayoutAnimationConfig: 'LayoutAnimationConfig',
  useReducedMotion: () => false,
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/hooks/auth', () => ({ useAuth: jest.fn() }));
jest.mock('@/hooks/sync', () => ({ useSync: jest.fn() }));

type El = { type: unknown; props: Record<string, unknown> & { children?: unknown } };
const NOW = Date.parse('2026-11-09T03:00:00.000Z');
const line = (s: Partial<Parameters<typeof syncStatusLine>[0]>) =>
  syncStatusLine({ auth: 'signedIn', syncing: false, error: null, pending: 0, lastSyncedAt: new Date(NOW).toISOString(), ...s }, NOW)!;
/** LayoutAnimationConfig の中の、押せるもの（またはただの View） */
const outer = (el: El) => el.props.children as El;
const inner = (el: El) => outer(el).props.children as El;
const texts = (el: El) => (inner(el).props.children as unknown[]).filter(Boolean).map((c) => (c as El).props.children).slice(1);

describe('同期の状態の1行の見た目', () => {
  test('失敗：押すとやり直す。押せる高さは 48 以上、読み上げはボタンで、文と操作の名前', () => {
    const onPress = jest.fn();
    const el = SyncStatusView({ line: line({ error: 'network' }), reduced: false, onPress }) as El;
    const press = outer(el);
    expect(press.type).toBe('PressableScale');
    expect(press.props.accessibilityRole).toBe('button');
    expect(press.props.accessibilityLabel).toBe('同期できませんでした。やり直す');
    expect(StyleSheet.flatten(press.props.style as never).minHeight).toBeGreaterThanOrEqual(MIN_TOUCH);
    expect(press.props.onPress).toBe(onPress);
    // 色だけで伝えない：アイコンと文
    expect(texts(el)).toEqual(['同期できませんでした', 'やり直す']);
    expect((inner(el).props.children as El[])[0].props).toMatchObject({ name: 'caution', color: colors.danger });
  });

  test('ふだんは押せない1行（補足の灰色）。文が変わったら 150ms でふわっと出す', () => {
    const el = SyncStatusView({ line: line({}), reduced: false, onPress: () => {} }) as El;
    expect(outer(el).type).not.toBe('PressableScale');
    expect(outer(el).props.accessibilityLabel).toBe('同期 たった今');
    expect(inner(el).props.entering).toEqual({ fadeInMs: duration.text });
    expect((inner(el).props.children as El[])[1].props.color).toBe(colors.sub);
    // 初めて出すときは動かさない
    expect(el.type).toBe('LayoutAnimationConfig');
    expect(el.props.skipEntering).toBe(true);
  });

  test('動きを減らす設定なら、ふわっと出さない', () => {
    const el = SyncStatusView({ line: line({ pending: 2 }), reduced: true, onPress: () => {} }) as El;
    expect(inner(el).props.entering).toBeUndefined();
    expect(texts(el)).toEqual(['未送信 2件']);
  });

  test('ログインしていない：押すとアカウントの画面（ボタン）', () => {
    const press = outer(SyncStatusView({ line: line({ auth: 'signedOut' }), reduced: false, onPress: () => {} }) as El);
    expect(press.type).toBe('PressableScale');
    expect(press.props.accessibilityLabel).toBe('ログインすると同期できます。ログイン');
  });
});

describe('スナックバー', () => {
  test('高さ 48 以上、明るい地に暗い文字。読み上げで知らせる', () => {
    const el = Snackbar({ message: 'ログインすると同期できます' }) as El;
    const style = StyleSheet.flatten(el.props.style as never);
    expect(style.minHeight).toBeGreaterThanOrEqual(MIN_TOUCH);
    expect(style.backgroundColor).toBe(colors.text);
    expect((el.props.children as El).props.color).toBe(colors.card);
    expect(el.props.accessibilityLiveRegion).toBe('polite');
  });
});
