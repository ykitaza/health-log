// 画面（components/Screen.tsx）のスクロールの中で、ビューが見えているかを知る。見えていない絵（3D の体・育つ形・脈打ち）を止めて軽くする。
// 作り方：ビューの位置は、置いたとき・中身の大きさが変わったとき・スクロールが止まったとき・画面に戻ったときにだけ measureInWindow で測る。
// スクロールの度には、測った位置をスクロールした分ずらして計算するだけ（lib/onScreen.ts）。止まったときにだけ測る作り方だと、
// 速くスクロールして入ってきたとき、止まるまで絵が止まって見えるので、こちらにした。state を変えるのは入った・出たのときだけ
import { useFocusEffect } from 'expo-router';
import { createContext, RefObject, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent, ScrollViewInstance, ViewInstance } from 'react-native';
import { createOnScreenTracker, createScrollWatch, ScrollWatch } from '@/lib/onScreen';

/** 見えている範囲の上下に足す余白（dp）。止めた絵が動き出すまでの1〜2コマのあいだに、はしが止まって見えないように */
const MARGIN = 64;

const ScrollWatchContext = createContext<ScrollWatch | null>(null);
export const ScrollWatchProvider = ScrollWatchContext.Provider;

/** Screen の ScrollView に付ける：スクロールの位置と見えている範囲を配る（props を ScrollView に渡し、watch を ScrollWatchProvider で配る） */
export function useScrollWatch(scrollRef: RefObject<ScrollViewInstance | null>) {
  const [watch] = useState(createScrollWatch);
  const measure = useCallback(() => {
    scrollRef.current?.measureInWindow((_x, y, _w, h) => watch.measured({ top: y, height: h }));
  }, [scrollRef, watch]);
  // ほかのタブや画面から戻ったときに測り直す（離れているあいだは測れない）
  useFocusEffect(measure);
  const props = useMemo(() => ({
    onLayout: measure,
    onContentSizeChange: () => watch.notify(true),
    onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => watch.scrolled(e.nativeEvent.contentOffset.y),
    onScrollEndDrag: () => watch.notify(true),
    onMomentumScrollEnd: () => watch.notify(true),
    scrollEventThrottle: 16,
  }), [measure, watch]);
  return { watch, props };
}

/**
 * ビューが見えているか（少しでも見えていれば true）。ref と onLayout を、測るビューに付ける（Android で消されないよう collapsable={false} も）。
 * Screen のスクロールの外（スクロールしない画面など）では、いつも true
 */
export function useOnScreen(ref: RefObject<ViewInstance | null>) {
  const watch = useContext(ScrollWatchContext);
  const [onScreen, setOnScreen] = useState(true);
  const [tracker] = useState(() => (watch ? createOnScreenTracker(watch, MARGIN, setOnScreen) : null));
  const measure = useCallback(() => {
    if (!watch || !tracker) return;
    // 高さ 0（隠れている画面など）は位置が分からないので、見えているとする
    ref.current?.measureInWindow((_x, y, _w, h) => tracker.setBox(h > 0 ? { top: y, height: h, offset: watch.offset } : null));
  }, [watch, tracker, ref]);
  useEffect(() => watch?.subscribe((remeasure) => (remeasure ? measure() : tracker?.update())), [watch, tracker, measure]);
  return { onLayout: measure, onScreen: watch ? onScreen : true };
}
