import { useScrollToTop } from 'expo-router';
import { ReactNode, Ref, useLayoutEffect, useRef } from 'react';
import { RefreshControl, ScrollView, ScrollViewInstance, View } from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePullToSync } from '@/hooks/sync';
import { ScrollToTopTarget, scrollToTopTarget } from '@/lib/scrollToTop';
import { colors, size, space } from '@/theme';
import { PullMark, usePullMark } from './PullMark';
import { Snackbar } from './ui';

/**
 * 画面の枠。footer は下に固定する（「今日のトレーニングに追加」など）。bottomSpace はスクロールの下の余白（FAB に隠れないように）。
 * タブの画面（tab）は、下に引っぱると同期し、下のタブで今のタブをもう一度押すといちばん上へ戻る。fab は右下に FAB があるとき（知らせをその上に出す）。
 * scrollRef はタブでない画面のスクロール（設定で、開いたときに欄までスクロールするため）
 */
export function Screen({ children, footer, scroll = true, tab, bottomSpace = 24, fab, scrollRef }: {
  children: ReactNode; footer?: ReactNode; scroll?: boolean; tab?: boolean; bottomSpace?: number; fab?: boolean; scrollRef?: Ref<ScrollViewInstance>;
}) {
  const contentContainerStyle = { paddingHorizontal: space.screen, paddingBottom: bottomSpace };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={tab ? ['top'] : ['top', 'bottom']}>
      {scroll && tab ? (
        <PullToSyncScroll contentContainerStyle={contentContainerStyle} fab={fab}>{children}</PullToSyncScroll>
      ) : scroll ? (
        <ScrollView ref={scrollRef} contentContainerStyle={contentContainerStyle} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={{ flex: 1, paddingHorizontal: space.screen }}>{children}</View>
      )}
      {footer && <View style={{ paddingHorizontal: space.screen, paddingTop: space.s, paddingBottom: space.l, gap: space.s }}>{footer}</View>}
    </SafeAreaView>
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
function PullToSyncScroll({ children, contentContainerStyle, fab }: { children: ReactNode; contentContainerStyle: object; fab?: boolean }) {
  const { refreshing, onRefresh, notice } = usePullToSync();
  const mark = usePullMark(refreshing);
  const scroll = useRef<ScrollViewInstance>(null);
  const reduced = useReducedMotion();
  const toTop = useRef<ScrollToTopTarget>(null);
  useLayoutEffect(() => { toTop.current = scrollToTopTarget(() => scroll.current, reduced); });
  useScrollToTop(toTop);
  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        ref={scroll}
        contentContainerStyle={contentContainerStyle}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing} onRefresh={onRefresh}
            colors={['transparent']} progressBackgroundColor="transparent" tintColor="transparent" progressViewOffset={HIDDEN_SPINNER_OFFSET}
          />
        }
      >
        <Animated.View style={mark.shift}>{children}</Animated.View>
      </ScrollView>
      <PullMark values={mark.values} />
      {notice && (
        <View style={{ position: 'absolute', left: space.screen, right: space.screen, bottom: fab ? size.fab + space.l * 2 : space.s }}>
          <Snackbar message={notice.message} action={notice.retry ? { label: 'やり直す', onPress: onRefresh } : undefined} testID="pull-notice" />
        </View>
      )}
    </View>
  );
}
