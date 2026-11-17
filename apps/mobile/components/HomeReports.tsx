// ホームの「レポート」：1 枚のカードにまとめる（最新のレポート、新しいレポートのお知らせ、まだ作っていないまとめのおすすめ、今週やること）。
// 今までは別々の帯・カードだった。上から：
// - 見出し「レポート」と「すべて」（レポートのタブへ。日・週・月は詳細の期間タブで切り替える）
// - いちばん新しい 1 件（押すとその詳細 /reports/[id]。戻るでホームへ戻る）と、小さな「チャットで作る」。まだなければ、頼む方法と「チャットで作る」
// - 新しいレポートのお知らせの行（まだ開いていないレポートがあれば。「見る」でいちばん新しいレポート、「×」で今出ている分を見たことにする。端末だけに覚える）
// - まだ作っていないまとめのおすすめの行（新しいレポートがないとき。「作る」で「チャットで作る」と同じシートを、まとめて作る頼みの文で開く。「×」でもう出さない。端末だけに覚える）
// - 今週やること（最新の週のまとめの次の一歩。多くても 3 つ。WeeklyTodo.tsx）
import { router } from 'expo-router';
import { Platform, View } from 'react-native';
import Animated, { FadeInDown, FadeOut, useReducedMotion } from 'react-native-reanimated';
import { useFocusData, usePendingReports } from '@/hooks/data';
import { useToday } from '@/hooks/today';
import { newReportsSummary, pendingSummary, suggestionItems } from '@/lib/reports';
import { colors, isHud, radius, space } from '@/theme';
import { duration } from '@/theme/motion';
import { REPORT_CHAT_LABEL, useChatChooser } from './ChatSheet';
import { Icon } from './Icon';
import { easeOut, PressableScale } from './motion';
import { ReportCard } from './reports';
import { T } from './Text';
import { Button, IconButton } from './ui';
import { WeeklyTodoSection } from './WeeklyTodo';

/** お知らせの行：カードの横いっぱいの、濃いミントの帯。クラシックは紙の一段上の面（「クラシックの決まり」のお知らせ。角 10） */
const NOTICE = isHud
  ? { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.accentDark, paddingLeft: 16, paddingVertical: 8 } as const
  : { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.input, borderRadius: 10, paddingLeft: 16, paddingVertical: 8 } as const;
/** お知らせの行のアイコンと補足の色 */
const NOTICE_FG = isHud ? colors.onAccentDark : colors.sub;
/** カードの枠：クラシックは塗らず、上に墨の罫（段の見出し） */
const FRAME = isHud
  ? { backgroundColor: colors.card, borderRadius: radius.l, overflow: 'hidden', paddingBottom: space.s } as const
  : { borderTopWidth: 1, borderTopColor: colors.text, paddingBottom: space.s } as const;
/** 見出しの行の左の余白（クラシックは紙の端にそろえる） */
const HEAD_PAD = isHud ? space.l : 0;

export function HomeReportsCard() {
  const latest = useFocusData((r) => r.reports.latest());
  const unread = useFocusData((r) => r.reports.unread());
  const { data: pending, repos, reload } = usePendingReports();
  const chat = useChatChooser();
  const today = useToday();
  const reduced = useReducedMotion();
  const still = reduced || Platform.OS === 'web';
  const entering = still ? undefined : FadeInDown.duration(duration.enter).easing(easeOut);
  const exiting = still ? undefined : FadeOut.duration(duration.exit);

  const report = latest.data;
  const fresh = unread.data ?? [];
  const items = suggestionItems(unread.data, pending);
  const closeAll = async () => {
    for (const p of items) await repos.reports.dismissPending(p.key);
    await reload();
  };
  const seeAll = async () => {
    await repos.reports.markSeen(fresh.map((r) => r.id));
    await unread.reload();
  };
  // unread は新しい順（作った時刻）なので、先頭がいちばん新しいもの。1 件ならそのレポート（戻るでホームへ）、2 件以上はレポートのタブ（最新の詳細）
  const openFresh = () => (fresh.length === 1 ? router.push({ pathname: '/reports/[id]', params: { id: fresh[0].id } }) : router.navigate('/reports'));
  const newTitle = `新しいレポートが ${fresh.length} 件`;
  const newDetail = newReportsSummary(fresh, today);
  const pendingTitle = `まとめがまだ ${items.length} 件あります`;
  const pendingDetail = pendingSummary(items, today);

  return (
    <View style={FRAME} testID="home-reports">
      <View testID="latest-report">
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48, paddingLeft: HEAD_PAD, paddingRight: isHud ? space.s : 0 }}>
          <T bold size={isHud ? 17 : 13} accessibilityRole="header">レポート</T>
          {report && (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="すべてのレポート。最新のレポートを開き、日・週・月のタブで切り替えます"
              onPress={() => router.navigate('/reports')}
              style={{ minHeight: 48, minWidth: 48, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' }}
            >
              <T bold={isHud} size={isHud ? 14 : 12} color={isHud ? colors.accent : colors.text}>すべて</T>
            </PressableScale>
          )}
        </View>
        {report ? (
          <>
            <ReportCard dense report={report} onPress={() => router.push({ pathname: '/reports/[id]', params: { id: report.id } })} />
            <Button label="チャットで作る" icon="chat" variant="text" small accessibilityLabel={REPORT_CHAT_LABEL} onPress={chat.report}
              style={{ alignSelf: 'flex-end', paddingLeft: 12, paddingRight: 12, marginRight: space.s }} testID="report-chat" />
          </>
        ) : (
          <View style={{ paddingHorizontal: space.l, paddingBottom: space.s, gap: 12 }}>
            <T size={14} color={colors.sub}>まだありません。チャット（Claude・ChatGPT）で「今週のまとめを作って」と頼むと、ここに出ます。</T>
            <Button label="チャットで作る" icon="chat" variant="tonal" small accessibilityLabel={REPORT_CHAT_LABEL} onPress={chat.report} testID="report-chat" />
          </View>
        )}
      </View>
      {fresh.length > 0 && (
        <Animated.View key="new" entering={entering} exiting={exiting} style={[NOTICE, { marginTop: space.s }]} testID="home-report-new">
          <Icon name="trendUp" size={22} color={NOTICE_FG} />
          <View style={{ flex: 1, gap: 2 }} accessible accessibilityLabel={`${newTitle}。${newDetail}`}>
            <T bold size={16}>{newTitle}</T>
            <T size={13} color={NOTICE_FG} numberOfLines={2}>{newDetail}</T>
          </View>
          <Button label="見る" variant="text" small accessibilityLabel={fresh.length === 1 ? '新しいレポートを見る' : 'いちばん新しいレポートを見る'} onPress={openFresh}
            style={{ paddingLeft: 12, paddingRight: 12 }} testID="new-report-open" />
          <IconButton name="close" label="お知らせを閉じる。今出ている分は、見たことにします" color={colors.text} bg="transparent" onPress={seeAll} testID="new-report-close" />
        </Animated.View>
      )}
      {items.length > 0 && (
        <Animated.View key="pending" entering={entering} exiting={exiting} style={[NOTICE, { marginTop: space.s }]} testID="home-report-pending">
          <Icon name="chat" size={22} color={NOTICE_FG} />
          <View style={{ flex: 1, gap: 2 }} accessible accessibilityLabel={`${pendingTitle}。${pendingDetail}`}>
            <T bold size={16}>{pendingTitle}</T>
            <T size={13} color={NOTICE_FG}>{pendingDetail}</T>
          </View>
          <Button label="作る" variant="text" small accessibilityLabel="まとめを作る。ChatGPT か Claude を開きます" onPress={() => chat.pending(items)}
            style={{ paddingLeft: 12, paddingRight: 12 }} testID="report-suggestion-make" />
          <IconButton name="close" label="おすすめを閉じる。今出ている分は、もう出しません" color={colors.text} bg="transparent" onPress={closeAll} testID="report-suggestion-close" />
        </Animated.View>
      )}
      <WeeklyTodoSection today={today} />
      {chat.sheet}
    </View>
  );
}
