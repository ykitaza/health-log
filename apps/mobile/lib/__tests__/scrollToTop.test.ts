// 下のタブで今のタブをもう一度押すと、いちばん上へ戻る（expo-router の useScrollToTop ＋ lib/scrollToTop.ts）。
// 画面を描かずに、useScrollToTop をそのまま動かす：React の use（文脈）と useEffect だけを差し替え、偽のナビゲーションから tabPress を送る
import { scrollToTopTarget } from '../scrollToTop';

const mockContexts = new Map<unknown, unknown>();
jest.mock('react', () => {
  const actual = jest.requireActual('react');
  return { ...actual, use: (ctx: unknown) => mockContexts.get(ctx), useEffect: (fn: () => void) => { fn(); } };
});

/* eslint-disable @typescript-eslint/no-require-imports */
const { NavigationContext } = require('expo-router/build/react-navigation/core/NavigationContext');
const { NavigationRouteContext } = require('expo-router/build/react-navigation/core/NavigationProvider');
const { NavigatorStateContext } = require('expo-router/build/react-navigation/core/useNavigationState');
// expo-router が書き出している useScrollToTop と同じもの（expo-router 全体を読み込むと遅いので、直接読む）
const { useScrollToTop } = require('expo-router/build/react-navigation/native/useScrollToTop');
/* eslint-enable @typescript-eslint/no-require-imports */
// フックを React の外から直接呼ぶ（上で use と useEffect を差し替えてあるので、描画の外でも動く）。
// 名前を use〜 にしないのは、rules-of-hooks に「コンポーネントの外でフックを呼んでいる」と読まれないようにするため
const attachScrollToTop = useScrollToTop as (ref: { current: unknown }) => void;

type Event = { defaultPrevented: boolean };

/** タブの画面1つ。focused は今そのタブを開いているか */
function tabScreen(focused: boolean, reduced = false) {
  const listeners: ((e: Event) => void)[] = [];
  const navigation = {
    isFocused: () => focused,
    addListener: (name: string, fn: (e: Event) => void) => { if (name === 'tabPress') listeners.push(fn); return () => undefined; },
    getParent: () => undefined,
  };
  mockContexts.clear();
  mockContexts.set(NavigationContext, navigation);
  mockContexts.set(NavigationRouteContext, { key: 'index-1', name: 'index' });
  mockContexts.set(NavigatorStateContext, { type: 'tab', routes: [{ key: 'index-1' }] });
  const scrollView = { scrollTo: jest.fn() };
  attachScrollToTop({ current: scrollToTopTarget(() => scrollView, reduced) });
  return { press: () => listeners.forEach((fn) => fn({ defaultPrevented: false })), scrollTo: scrollView.scrollTo };
}

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

describe('今のタブをもう一度押すと、いちばん上へ戻る', () => {
  test('押したタブが今のタブなら、なめらかに上へ', () => {
    const s = tabScreen(true);
    s.press();
    jest.runAllTimers();
    expect(s.scrollTo).toHaveBeenCalledWith({ y: 0, animated: true });
  });

  test('ほかのタブから移ってきたとき（まだ今のタブでない）は、スクロールしない', () => {
    const s = tabScreen(false);
    s.press();
    jest.runAllTimers();
    expect(s.scrollTo).not.toHaveBeenCalled();
  });

  test('動きを減らす設定なら、一気に上へ', () => {
    const s = tabScreen(true, true);
    s.press();
    jest.runAllTimers();
    expect(s.scrollTo).toHaveBeenCalledWith({ y: 0, animated: false });
  });
});
