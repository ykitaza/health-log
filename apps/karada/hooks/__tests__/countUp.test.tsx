// 推移の大きな数字（期間の平均）の数え上げ。動きを減らす設定では、期間を切り替えたあとの読み直しでも今の値を出す（#326）
import { act } from 'react';
import { createRoot } from 'test-renderer';
import { useCountUp } from '../countUp';

jest.mock('react-native-reanimated', () => ({ useReducedMotion: () => true }));

/** 出した数を文字にして描く（root.container の中身で読む） */
function Probe({ value, animKey }: { value: number; animKey: string }) {
  return String(useCountUp(value, animKey));
}

test('動きを減らす設定：期間を 3か月に切り替えたあと、同じ期間のまま値が変わっても（読み直し）、今の値を出す', async () => {
  const root = createRoot();
  const shown = () => Number(root.container.children[0]);
  await act(async () => root.render(<Probe value={416} animKey="sleep-1m" />));
  expect(shown()).toBe(416);
  // 期間を切り替える
  await act(async () => root.render(<Probe value={420} animKey="sleep-3m" />));
  expect(shown()).toBe(420);
  // 同じ期間のまま、同期のあとの読み直しで平均が変わる
  await act(async () => root.render(<Probe value={431} animKey="sleep-3m" />));
  expect(shown()).toBe(431);
  // 1か月に戻して、また読み直す
  await act(async () => root.render(<Probe value={416} animKey="sleep-1m" />));
  await act(async () => root.render(<Probe value={400} animKey="sleep-1m" />));
  expect(shown()).toBe(400);
});
