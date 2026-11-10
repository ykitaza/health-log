// ホームの「まだ作っていないまとめ」のおすすめ（Figma の home-report-banner）。1件以上あるときだけ出す。
// 「作る」で、「チャットで作る」と同じシート（ChatGPT か Claude を選ぶ）を、まとめて作る頼みの文で開く。
// 「×」で、出ている分を全部閉じる（もう出さない。端末だけに覚える）
import { Platform, View } from 'react-native';
import Animated, { FadeInDown, FadeOut, useReducedMotion } from 'react-native-reanimated';
import { usePendingReports } from '@/hooks/data';
import { useToday } from '@/hooks/today';
import { pendingSummary } from '@/lib/reports';
import { colors, radius } from '@/theme';
import { duration } from '@/theme/motion';
import { useChatChooser } from './ChatSheet';
import { Icon } from './Icon';
import { easeOut } from './motion';
import { T } from './Text';
import { Button, IconButton } from './ui';

export function ReportSuggestion() {
  const { data, repos, reload } = usePendingReports();
  const chat = useChatChooser();
  const today = useToday();
  const reduced = useReducedMotion();
  const still = reduced || Platform.OS === 'web';
  const items = data ?? [];
  const closeAll = async () => {
    for (const p of items) await repos.reports.dismissPending(p.key);
    await reload();
  };
  const title = `まとめがまだ ${items.length} 件あります`;
  const detail = pendingSummary(items, today);
  return (
    <>
      {items.length > 0 && (
        <Animated.View
          entering={still ? undefined : FadeInDown.duration(duration.enter).easing(easeOut)}
          exiting={still ? undefined : FadeOut.duration(duration.exit)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.accentDark, borderRadius: radius.card, paddingLeft: 16, paddingVertical: 8, marginTop: 16 }}
          testID="report-suggestion"
        >
          <Icon name="chat" size={22} color={colors.onAccentDark} />
          <View style={{ flex: 1, gap: 2 }} accessible accessibilityLabel={`${title}。${detail}`}>
            <T bold size={16}>{title}</T>
            <T size={13} color={colors.onAccentDark}>{detail}</T>
          </View>
          <Button label="作る" variant="text" small accessibilityLabel="まとめを作る。ChatGPT か Claude を開きます" onPress={() => chat.pending(items)}
            style={{ paddingLeft: 12, paddingRight: 12 }} testID="report-suggestion-make" />
          <IconButton name="close" label="おすすめを閉じる。今出ている分は、もう出しません" color={colors.text} bg="transparent" onPress={closeAll} testID="report-suggestion-close" />
        </Animated.View>
      )}
      {chat.sheet}
    </>
  );
}
