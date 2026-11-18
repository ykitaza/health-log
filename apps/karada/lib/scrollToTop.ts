/**
 * 下のタブで、今のタブをもう一度押したときにいちばん上へ戻すための入れ物（expo-router の useScrollToTop に渡す ref の中身）。
 * useScrollToTop は scrollToTop があればそれを呼ぶ。なめらかに戻し、動きを減らす設定なら一気に戻す。同期はしない（同期は引っぱる操作だけ）
 */
type Scrollable = { scrollTo: (o: { x?: number; y?: number; animated?: boolean }) => void };

export type ScrollToTopTarget = { scrollToTop: () => void };

export function scrollToTopTarget(get: () => Scrollable | null, reduced: boolean): ScrollToTopTarget {
  return { scrollToTop: () => get()?.scrollTo({ y: 0, animated: !reduced }) };
}
