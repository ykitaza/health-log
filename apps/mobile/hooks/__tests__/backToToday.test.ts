// useBackToToday が、画面が前に出ている間だけ Android の戻るを受けるか。描かずに確かめるため、React のフックと
// expo-router の useFocusEffect（前に出たときに呼び、離れたときに片づける）を、そのまま呼ぶものに置きかえる
const listeners: (() => boolean)[] = [];
let cleanup: (() => void) | void;

jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useRef: (v: unknown) => ({ current: v }),
  useLayoutEffect: (f: () => void) => f(),
  useCallback: (f: unknown) => f,
}));
jest.mock('expo-router', () => ({ useFocusEffect: (f: () => (() => void) | void) => { cleanup = f(); } }));
jest.mock('react-native', () => ({
  BackHandler: {
    addEventListener: (_: string, l: () => boolean) => {
      listeners.push(l);
      return { remove: () => listeners.splice(listeners.indexOf(l), 1) };
    },
  },
}));

// 上の jest.mock を先に定義してから読み込む順序にしたいので、ここに置く
// eslint-disable-next-line import/first
import { useBackToToday } from '../backToToday';

beforeEach(() => { listeners.length = 0; cleanup = undefined; });

test('前の日を見ているとき、戻るで今日に戻し、アプリを閉じない', () => {
  const goToday = jest.fn();
  useBackToToday(false, goToday);
  expect(listeners).toHaveLength(1);
  expect(listeners[0]()).toBe(true);
  expect(goToday).toHaveBeenCalledTimes(1);
});

test('今日を見ているときは、戻るを受けない（いつもの戻る）', () => {
  useBackToToday(true, jest.fn());
  expect(listeners).toHaveLength(0);
});

test('画面を離れたら、戻るを受けるのをやめる', () => {
  useBackToToday(false, jest.fn());
  expect(listeners).toHaveLength(1);
  cleanup?.();
  expect(listeners).toHaveLength(0);
});
