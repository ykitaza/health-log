import { StyleSheet } from 'react-native';
import { MIN_TOUCH } from '@/lib/touch';
import { syncAlert } from '@/lib/sync/status';
import { colors } from '@/theme';
import { duration } from '@/theme/motion';
import { SyncAlertView } from '../SyncStatus';
import { Snackbar } from '../ui';

// 動きの部品（Reanimated）は、ここでは要らない。props だけを見る
jest.mock('../motion', () => ({ PressableScale: 'PressableScale', easeOut: 'easeOut' }));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: 'Animated.View' },
  FadeIn: { duration: (ms: number) => ({ easing: () => ({ fadeInMs: ms }) }) },
  useReducedMotion: () => false,
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/hooks/auth', () => ({ useAuth: jest.fn() }));
jest.mock('@/hooks/sync', () => ({ useSync: jest.fn() }));

type El = { type: unknown; props: Record<string, unknown> & { children?: unknown } };
const alert = (s: Partial<Parameters<typeof syncAlert>[0]>) => syncAlert({ auth: 'signedIn', error: 'network', failures: 2, ...s })!;
const inner = (el: El) => el.props.children as El;
const texts = (el: El) => (inner(el).props.children as El[]).slice(1).map((c) => c.props.children);

describe('同期の失敗の知らせの見た目', () => {
  test('続けて失敗：押すとやり直す。押せる高さは 48 以上、読み上げはボタンで、文と操作の名前。出たら読み上げる', () => {
    const onPress = jest.fn();
    const el = SyncAlertView({ alert: alert({}), reduced: false, onPress }) as El;
    expect(el.type).toBe('PressableScale');
    expect(el.props.accessibilityRole).toBe('button');
    expect(el.props.accessibilityLabel).toBe('同期できませんでした。やり直す');
    expect(el.props.accessibilityLiveRegion).toBe('polite');
    expect(StyleSheet.flatten(el.props.style as never).minHeight).toBeGreaterThanOrEqual(MIN_TOUCH);
    expect(el.props.onPress).toBe(onPress);
    // 色だけで伝えない：アイコンと文
    expect(texts(el)).toEqual(['同期できませんでした', 'やり直す']);
    expect((inner(el).props.children as El[])[0].props).toMatchObject({ name: 'caution', color: colors.danger });
    expect(inner(el).props.entering).toEqual({ fadeInMs: duration.text });
  });

  test('別のアカウントでログインしたとき：押すとアカウントの画面で確かめる', () => {
    const el = SyncAlertView({ alert: alert({ error: 'accountChanged', failures: 1 }), reduced: false, onPress: () => {} }) as El;
    expect(el.props.accessibilityLabel).toBe('同期できませんでした。確かめる');
  });

  test('動きを減らす設定なら、ふわっと出さない', () => {
    const el = SyncAlertView({ alert: alert({}), reduced: true, onPress: () => {} }) as El;
    expect(inner(el).props.entering).toBeUndefined();
  });
});

describe('スナックバー', () => {
  test('高さ 48 以上、明るい地に暗い文字。読み上げで知らせる', () => {
    const el = Snackbar({ message: 'ログインすると同期できます' }) as El;
    const style = StyleSheet.flatten(el.props.style as never);
    expect(style.minHeight).toBeGreaterThanOrEqual(MIN_TOUCH);
    expect(style.backgroundColor).toBe(colors.text);
    expect((el.props.children as El[])[0].props.color).toBe(colors.card);
    expect(el.props.accessibilityLiveRegion).toBe('polite');
  });

  test('引っぱって失敗したとき：「やり直す」を添える。押せる高さは 48 以上、緑の文字（明るい地で 4.5:1 以上）', () => {
    const onPress = jest.fn();
    const el = Snackbar({ message: '同期できませんでした', action: { label: 'やり直す', onPress } }) as El;
    const [message, action] = el.props.children as El[];
    expect(message.props.children).toBe('同期できませんでした');
    expect(action.props.accessibilityRole).toBe('button');
    expect(action.props.accessibilityLabel).toBe('同期できませんでした。やり直す');
    expect(action.props.onPress).toBe(onPress);
    expect(StyleSheet.flatten(action.props.style as never).minHeight).toBeGreaterThanOrEqual(MIN_TOUCH);
    expect((action.props.children as El).props).toMatchObject({ children: 'やり直す', color: colors.inverseAccent });
  });
});
