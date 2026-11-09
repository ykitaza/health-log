import { ReactNode } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePullToSync } from '@/hooks/sync';
import { colors, size, space } from '@/theme';
import { Snackbar } from './ui';

/**
 * 画面の枠。footer は下に固定する（「今日のトレーニングに追加」など）。bottomSpace はスクロールの下の余白（FAB に隠れないように）。
 * タブの画面（tab）は、下に引っぱると同期する。fab は右下に FAB があるとき（知らせをその上に出す）
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

/** 下に引っぱって同期するスクロール。回る印は RefreshControl の標準（色はアクセント、地はカード） */
function PullToSyncScroll({ children, contentContainerStyle, fab }: { children: ReactNode; contentContainerStyle: object; fab?: boolean }) {
  const { refreshing, onRefresh, notice } = usePullToSync();
  return (
    <View style={{ flex: 1 }}>
      <ScrollView
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
