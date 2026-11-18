import { LoadError, RETRY_LABEL } from '../LoadError';
import { Button } from '../ui';

// 読み直しの途中かどうか（useBusy）は、ここでは決めた値にする
let mockBusy = false;
jest.mock('@/hooks/busy', () => ({ useBusy: () => ({ busy: mockBusy, run: (task: () => unknown) => task() }) }));
jest.mock('../motion', () => ({ PressableScale: 'PressableScale' }));

type Node = { type?: unknown; props?: Record<string, unknown> & { children?: unknown } };
const find = (n: unknown, pred: (x: Node) => boolean): Node[] => {
  if (!n || typeof n !== 'object') return [];
  const node = n as Node;
  const c = node.props?.children;
  return [...(pred(node) ? [node] : []), ...(Array.isArray(c) ? c : [c]).flatMap((x) => find(x, pred))];
};

describe('読み込みの失敗の表示', () => {
  test('「もう一度読み込む」を押すと読み直す', () => {
    mockBusy = false;
    const onRetry = jest.fn(async () => {});
    const [button] = find(LoadError({ onRetry }), (x) => x.type === Button);
    expect(button.props?.label).toBe(RETRY_LABEL);
    expect(button.props?.busy).toBe(false);
    (button.props?.onPress as () => void)();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test('読み直している間は押せず、何をしているかを出す', () => {
    mockBusy = true;
    const [button] = find(LoadError({ onRetry: async () => {} }), (x) => x.type === Button);
    expect(button.props?.busy).toBe(true);
    expect(button.props?.label).toBe('読み込んでいます…');
  });

  test('説明は TalkBack が読み上げる', () => {
    mockBusy = false;
    expect(find(LoadError({ onRetry: async () => {} }), (x) => x.props?.accessibilityLiveRegion === 'polite')).toHaveLength(1);
  });
});
