// ホームのレポートのお知らせ（カレンダーと負荷量の横並びのすぐ下に、1つだけ出す）。
// - 新しいレポート（Figma の home-new-report-banner）：まだ開いていないレポートがあれば先に出す。「見る」で、1件ならそのレポート、
//   2件以上ならレポートのタブの一覧（新しい順）。「×」で今出ている分を全部見たことにする（端末だけに覚える）
// - まだ作っていないまとめのおすすめ（Figma の home-report-banner）：新しいレポートがないときに出す。
//   「作る」で、「チャットで作る」と同じシート（ChatGPT か Claude を選ぶ）を、まとめて作る頼みの文で開く。
//   「×」で、出ている分を全部閉じる（もう出さない。端末だけに覚える）
// レポートのタブの一覧の上にも同じ部品を出す（both：2つとも、新着を上に）。見たこと・閉じたことは同じ DB に覚えるので、
// 片方で閉じるともう片方にも出ない（タブに戻ったときに読み直す）
import { router } from 'expo-router';
import { Platform, View } from 'react-native';
import Animated, { FadeInDown, FadeOut, useReducedMotion } from 'react-native-reanimated';
import { useFocusData, usePendingReports } from '@/hooks/data';
import { useToday } from '@/hooks/today';
import { newReportsSummary, pendingSummary, suggestionItems } from '@/lib/reports';
import { colors, radius } from '@/theme';
import { duration } from '@/theme/motion';
import { useChatChooser } from './ChatSheet';
import { Icon } from './Icon';
import { easeOut } from './motion';
import { T } from './Text';
import { Button, IconButton } from './ui';

const BANNER = { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.accentDark, borderRadius: radius.card, paddingLeft: 16, paddingVertical: 8, marginTop: 16 } as const;

export function ReportSuggestion({ both = false, onSeen }: {
  /** 新しいレポートとおすすめを、2つとも出す（レポートのタブ）。false なら1つだけ（ホーム） */
  both?: boolean;
  /** 「×」で見たことにしたあと（一覧の「新着」の札を読み直す） */
  onSeen?: () => void;
} = {}) {
  const unread = useFocusData((r) => r.reports.unread());
  const { data, repos, reload } = usePendingReports();
  const chat = useChatChooser();
  const today = useToday();
  const reduced = useReducedMotion();
  const still = reduced || Platform.OS === 'web';
  const fresh = unread.data ?? [];
  const items = suggestionItems(unread.data, data, both);
  const closeAll = async () => {
    for (const p of items) await repos.reports.dismissPending(p.key);
    await reload();
  };
  const seeAll = async () => {
    await repos.reports.markSeen(fresh.map((r) => r.id));
    await unread.reload();
    onSeen?.();
  };
  const open = () => {
    if (fresh.length === 1) router.push({ pathname: '/reports/[id]', params: { id: fresh[0].id } });
    else router.navigate({ pathname: '/reports', params: { order: 'newest' } });
  };
  // レポートのタブでは見出しのすぐ下に並べ、下（絞り込みのチップ）との間を空ける
  const style = both ? [BANNER, { marginTop: 0, marginBottom: 16 }] : BANNER;
  const entering = still ? undefined : FadeInDown.duration(duration.enter).easing(easeOut);
  const exiting = still ? undefined : FadeOut.duration(duration.exit);
  const newTitle = `新しいレポートが ${fresh.length} 件`;
  const newDetail = newReportsSummary(fresh, today);
  const title = `まとめがまだ ${items.length} 件あります`;
  const detail = pendingSummary(items, today);
  return (
    <>
      {fresh.length > 0 && (
        <Animated.View key="new" entering={entering} exiting={exiting} style={style} testID="new-report-banner">
          <Icon name="trendUp" size={22} color={colors.onAccentDark} />
          <View style={{ flex: 1, gap: 2 }} accessible accessibilityLabel={`${newTitle}。${newDetail}`}>
            <T bold size={16}>{newTitle}</T>
            <T size={13} color={colors.onAccentDark} numberOfLines={2}>{newDetail}</T>
          </View>
          <Button label="見る" variant="text" small accessibilityLabel={fresh.length === 1 ? '新しいレポートを見る' : '新しいレポートを一覧で見る'} onPress={open}
            style={{ paddingLeft: 12, paddingRight: 12 }} testID="new-report-open" />
          <IconButton name="close" label="お知らせを閉じる。今出ている分は、見たことにします" color={colors.text} bg="transparent" onPress={seeAll} testID="new-report-close" />
        </Animated.View>
      )}
      {items.length > 0 && (
        <Animated.View key="pending" entering={entering} exiting={exiting} style={style} testID="report-suggestion">
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
