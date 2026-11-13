import { useScrollToTop } from 'expo-router';
import { ReactNode, Ref, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { RefreshControl, ScrollView, ScrollViewInstance, View } from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';
import { Edge, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePullToSync } from '@/hooks/sync';
import { ScrollWatchProvider, useScrollWatch } from '@/hooks/useOnScreen';
import { ScrollToTopTarget, scrollToTopTarget } from '@/lib/scrollToTop';
import { colors, size, space } from '@/theme';
import { PullMark, usePullMark } from './PullMark';
import { Snackbar } from './ui';

/**
 * 画面の枠。footer は下に固定する（「今日のトレーニングに追加」など）。bottomSpace はスクロールの下の余白（FAB に隠れないように）。
 * タブの画面（tab）は、下に引っぱると同期し、下のタブで今のタブをもう一度押すといちばん上へ戻る。fab は右下に FAB があるとき（知らせをその上に出す）。
 * scrollRef はタブでない画面のスクロール（設定で、開いたときに欄までスクロールするため）。
 * underStatusBar は、中身をステータスバーの下（画面のいちばん上）から描く（ホームの形の段。上の余白は中身の側で取る）
 * スクロールする画面は、スクロールの位置を中身に配る（hooks/useOnScreen.ts。見えていない絵を止める）
 */
export function Screen({ children, footer, scroll = true, tab, bottomSpace = 24, fab, scrollRef, underStatusBar }: {
  children: ReactNode; footer?: ReactNode; scroll?: boolean; tab?: boolean; bottomSpace?: number; fab?: boolean; scrollRef?: Ref<ScrollViewInstance>;
  underStatusBar?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const contentContainerStyle = { paddingHorizontal: space.screen, paddingBottom: bottomSpace };
  const edges: Edge[] = tab ? ['top'] : ['top', 'bottom'];
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={underStatusBar ? edges.filter((e) => e !== 'top') : edges}>
      {scroll && tab ? (
        // 同期のマークは、ステータスバーに重ねず、その下に出す
        <PullToSyncScroll contentContainerStyle={contentContainerStyle} fab={fab} markTop={underStatusBar ? insets.top : 0}>{children}</PullToSyncScroll>
      ) : scroll ? (
        <PlainScroll contentContainerStyle={contentContainerStyle} scrollRef={scrollRef}>{children}</PlainScroll>
      ) : (
        <View style={{ flex: 1, paddingHorizontal: space.screen }}>{children}</View>
      )}
      {footer && <View style={{ paddingHorizontal: space.screen, paddingTop: space.s, paddingBottom: space.l, gap: space.s }}>{footer}</View>}
    </SafeAreaView>
  );
}

/** タブでない画面のスクロール。scrollRef は画面に渡す（設定で欄までスクロールする） */
function PlainScroll({ children, contentContainerStyle, scrollRef }: { children: ReactNode; contentContainerStyle: object; scrollRef?: Ref<ScrollViewInstance> }) {
  const scroll = useRef<ScrollViewInstance>(null);
  useImperativeHandle(scrollRef, () => scroll.current!, []);
  const { watch, props } = useScrollWatch(scroll);
  return (
    <ScrollView ref={scroll} contentContainerStyle={contentContainerStyle} keyboardShouldPersistTaps="handled" {...props}>
      <ScrollWatchProvider value={watch}>{children}</ScrollWatchProvider>
    </ScrollView>
  );
}

/** RefreshControl の丸い印を、画面の上の外へ出して見えなくする（dp）。色も透明にする。引っぱる操作と、同期すると決まる長さは標準のまま */
const HIDDEN_SPINNER_OFFSET = -200;

/**
 * タブの画面のスクロール。下に引っぱって同期する。引っぱる操作は Android 標準（RefreshControl）を使い、丸い印は見せずに、
 * 同期のあいだ hlog のマーク（PullMark）を上に出して、中身をその分下げる。
 * （ScrollView は上にはみ出してスクロールせず、引っぱり始めると Android の側が指の動きを取るので、引っぱっている途中の量は JS で取れない。
 * そのため、放したあとにマークが下りてきて線が描かれる）
 * 今のタブをもう一度押すと、いちばん上へなめらかに戻る（動きを減らす設定なら一気に）。中で切り替える画面（今日／履歴など）も、
 * 同じスクロールの中なので、表示中のほうが上に戻る
 */
function PullToSyncScroll({ children, contentContainerStyle, fab, markTop }: { children: ReactNode; contentContainerStyle: object; fab?: boolean; markTop: number }) {
  const { refreshing, onRefresh, notice } = usePullToSync();
  const mark = usePullMark(refreshing);
  const scroll = useRef<ScrollViewInstance>(null);
  const reduced = useReducedMotion();
  const toTop = useRef<ScrollToTopTarget>(null);
  useLayoutEffect(() => { toTop.current = scrollToTopTarget(() => scroll.current, reduced); });
  useScrollToTop(toTop);
  const { watch, props } = useScrollWatch(scroll);
  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        ref={scroll}
        contentContainerStyle={contentContainerStyle}
        keyboardShouldPersistTaps="handled"
        {...props}
        refreshControl={
          <RefreshControl
            refreshing={refreshing} onRefresh={onRefresh}
            colors={['transparent']} progressBackgroundColor="transparent" tintColor="transparent" progressViewOffset={HIDDEN_SPINNER_OFFSET}
          />
        }
      >
        <Animated.View style={mark.shift}><ScrollWatchProvider value={watch}>{children}</ScrollWatchProvider></Animated.View>
      </ScrollView>
      <View style={{ position: 'absolute', top: markTop, left: 0, right: 0 }} pointerEvents="none">
        <PullMark values={mark.values} />
      </View>
      {notice && (
        <View style={{ position: 'absolute', left: space.screen, right: space.screen, bottom: fab ? size.fab + space.l * 2 : space.s }}>
          <Snackbar message={notice.message} action={notice.retry ? { label: 'やり直す', onPress: onRefresh } : undefined} testID="pull-notice" />
        </View>
      )}
    </View>
  );
}
