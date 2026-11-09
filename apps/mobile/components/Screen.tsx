import { useScrollToTop } from 'expo-router';
import { ReactNode, useLayoutEffect, useRef } from 'react';
import { RefreshControl, ScrollView, ScrollViewInstance, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePullToSync } from '@/hooks/sync';
import { ScrollToTopTarget, scrollToTopTarget } from '@/lib/scrollToTop';
import { colors, size, space } from '@/theme';
import { Snackbar } from './ui';

/**
 * 画面の枠。footer は下に固定する（「今日のトレーニングに追加」など）。bottomSpace はスクロールの下の余白（FAB に隠れないように）。
 * タブの画面（tab）は、下に引っぱると同期し、下のタブで今のタブをもう一度押すといちばん上へ戻る。fab は右下に FAB があるとき（知らせをその上に出す）
 */
export function Screen({ children, footer, scroll = true, tab, bottomSpace = 24, fab }: { children: ReactNode; footer?: ReactNode; scroll?: boolean; tab?: boolean; bottomSpace?: number; fab?: boolean }) {
  const contentContainerStyle = { paddingHorizontal: space.screen, paddingBottom: bottomSpace };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={tab ? ['top'] : ['top', 'bottom']}>
      {scroll && tab ? (
        <PullToSyncScroll contentContainerStyle={contentContainerStyle} fab={fab}>{children}</PullToSyncScroll>
      ) : scroll ? (
        <ScrollView contentContainerStyle={contentContainerStyle} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={{ flex: 1, paddingHorizontal: space.screen }}>{children}</View>
      )}
      {footer && <View style={{ paddingHorizontal: space.screen, paddingTop: space.s, paddingBottom: space.l, gap: space.s }}>{footer}</View>}
    </SafeAreaView>
  );
}

/**
 * タブの画面のスクロール。下に引っぱって同期する（回る印は RefreshControl の標準。色はアクセント、地はカード）。
 * 今のタブをもう一度押すと、いちばん上へなめらかに戻る（動きを減らす設定なら一気に）。中で切り替える画面（今日／履歴など）も、
 * 同じスクロールの中なので、表示中のほうが上に戻る
 */
function PullToSyncScroll({ children, contentContainerStyle, fab }: { children: ReactNode; contentContainerStyle: object; fab?: boolean }) {
  const { refreshing, onRefresh, notice } = usePullToSync();
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
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.accent]} progressBackgroundColor={colors.card} tintColor={colors.accent} />
        }
      >
        {children}
      </ScrollView>
      {notice && (
        <View style={{ position: 'absolute', left: space.screen, right: space.screen, bottom: fab ? size.fab + space.l * 2 : space.s }}>
          <Snackbar message={notice} testID="pull-notice" />
        </View>
      )}
    </View>
  );
}
