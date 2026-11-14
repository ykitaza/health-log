// 画面（components/Screen.tsx）のスクロールの中で、ビューが見えているかを知る。見えていない絵（3D の体・育つ形・脈打ち）を止めて軽くする。
// 作り方：ビューの位置は、置いたとき・中身の大きさが変わったとき・スクロールが止まったとき・画面に戻ったときにだけ measureInWindow で測る。
// スクロールの度には、測った位置をスクロールした分ずらして計算するだけ（lib/onScreen.ts）。止まったときにだけ測る作り方だと、
// 速くスクロールして入ってきたとき、止まるまで絵が止まって見えるので、こちらにした。state を変えるのは入った・出たのときだけ
import { useFocusEffect } from 'expo-router';
import { createContext, RefObject, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent, ScrollViewInstance, ViewInstance } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { createOnScreenTracker, createScrollWatch, ScrollWatch } from '@/lib/onScreen';
import { space } from '@/theme';

/** 見えている範囲の上下に足す余白（dp）。止めた絵が動き出すまでの1〜2コマのあいだに、はしが止まって見えないように */
const MARGIN = 64;

const ScrollWatchContext = createContext<ScrollWatch | null>(null);
export const ScrollWatchProvider = ScrollWatchContext.Provider;

/** Screen の ScrollView に付ける：スクロールの位置と見えている範囲を配る（props を ScrollView に渡し、watch を ScrollWatchProvider で配る） */
export function useScrollWatch(scrollRef: RefObject<ScrollViewInstance | null>) {
  const [watch] = useState(() => {
    const w = createScrollWatch();
    w.scrollTo = (y, animated) => scrollRef.current?.scrollTo({ y, animated });
    return w;
  });
  const measure = useCallback(() => {
    scrollRef.current?.measureInWindow((_x, y, _w, h) => watch.measured({ top: y, height: h }));
  }, [scrollRef, watch]);
  // ほかのタブや画面から戻ったときに測り直す（離れているあいだは測れない）
  useFocusEffect(measure);
  const props = useMemo(() => ({
    onLayout: measure,
    onContentSizeChange: () => watch.notify(true),
    onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => watch.scrolled(e.nativeEvent.contentOffset.y),
    onScrollBeginDrag: () => watch.dragged(),
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

/** 合わせ直す時間（ms）。ビューが初めて測れてから。読み込みで上のカードの高さが変わるあいだ、位置を追う */
const TARGET_SETTLE_MS = 1500;
/** ビューが出るのを待つ上限（ms）。読み込みが遅くても、出たらスクロールする */
const TARGET_GIVE_UP_MS = 10000;
/** 合わせ直す間隔（ms） */
const TARGET_RECHECK_MS = 200;

/**
 * ほかの画面から来たときに、このビューまでスクロールする（ホームのパネル・札から筋トレのタブのグラフや種目へ）。
 * request が新しい値になったら、ビューの上の端を画面の上に合わせる（下の端までスクロールしきれないときは、いちばん下まで）。
 * 上のカードが読み込みで伸びても追うよう、ビューが初めて測れてから 1.5 秒のあいだは、少しずつ間をあけて合わせ直す。
 * 指でスクロールしたら、ほかの request に変わったら（null も）やめる。
 * ref と、返す onLayout を、スクロールさせたいビューに付ける（Android で消されないよう collapsable={false} も）
 */
export function useScrollTarget(ref: RefObject<ViewInstance | null>, request: number | null) {
  const watch = useContext(ScrollWatchContext);
  const reduced = useReducedMotion();
  const pending = useRef<{ start: number; until: number | null; drags: number } | null>(null);
  const handled = useRef<number | null>(null);
  const align = useCallback(() => {
    const p = pending.current;
    if (!p || !watch?.scrollTo) return;
    const now = performance.now();
    const over = p.until != null ? now > p.until : now - p.start > TARGET_GIVE_UP_MS;
    if (over || watch.drags !== p.drags) { pending.current = null; return; }
    ref.current?.measureInWindow((_x, y, _w, h) => {
      if (h === 0 || !watch.viewport || pending.current !== p) return;
      p.until ??= performance.now() + TARGET_SETTLE_MS;
      const to = Math.max(0, watch.offset + y - watch.viewport.top - space.s);
      if (Math.abs(to - watch.offset) > 4) watch.scrollTo!(to, !reduced);
    });
  }, [watch, reduced, ref]);
  // 合わせ直す間隔の中では、いちばん新しい align を呼ぶ（align が変わっても、合わせ直すのを止めない）
  const latest = useRef(align);
  useLayoutEffect(() => { latest.current = align; });
  useEffect(() => {
    // 頼まれなくなったら（ほかのグラフへ来た・画面を離れた）、合わせ直すのをやめる
    if (request == null) { pending.current = null; return; }
    if (handled.current === request) return;
    handled.current = request;
    pending.current = { start: performance.now(), until: null, drags: watch?.drags ?? 0 };
    requestAnimationFrame(() => latest.current());
    const id = setInterval(() => {
      if (pending.current) latest.current(); else clearInterval(id);
    }, TARGET_RECHECK_MS);
    return () => clearInterval(id);
  }, [request, watch]);
  useEffect(() => watch?.subscribe((remeasure) => { if (remeasure) align(); }), [watch, align]);
  return align;
}
