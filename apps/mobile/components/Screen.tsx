import { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, space } from '@/theme';

/** 画面の枠。footer は下に固定する（「今日のトレーニングに追加」など） */
export function Screen({ children, footer, scroll = true, tab }: { children: ReactNode; footer?: ReactNode; scroll?: boolean; tab?: boolean }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={tab ? ['top'] : ['top', 'bottom']}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: space.screen, paddingBottom: 24 }}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={{ flex: 1, paddingHorizontal: space.screen }}>{children}</View>
      )}
      {footer && <View style={{ paddingHorizontal: space.screen, paddingTop: space.s, paddingBottom: space.l, gap: space.s }}>{footer}</View>}
    </SafeAreaView>
  );
}
