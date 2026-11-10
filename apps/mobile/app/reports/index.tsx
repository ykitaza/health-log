import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform, View } from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';
import { REPORT_CHAT_LABEL, SCHEDULE_LABEL, useChatChooser, useScheduleSheet } from '@/components/ChatSheet';
import { LoadError } from '@/components/LoadError';
import { easeOut, useListMotion } from '@/components/motion';
import { ReportCard } from '@/components/reports';
import { Screen } from '@/components/Screen';
import { T } from '@/components/Text';
import { Button, Card, Chip, ChipRow, EmptyState, Header } from '@/components/ui';
import { useFocusData } from '@/hooks/data';
import { useToday } from '@/hooks/today';
import {
  emptyFilterText, filterReports, groupByMonth, isReportOrder, KIND_LABELS, orderToggleLabel, otherOrder, REPORT_FILTERS, REPORT_ORDER_LABELS, ReportFilter,
  ReportOrder, sortReports,
} from '@/lib/reports';
import { colors, space } from '@/theme';
import { duration } from '@/theme/motion';

const EXAMPLES = ['「今週のまとめを作って」', '「10月の筋トレと食事をふり返って、レポートに残して」', '「ベンチプレスが伸びない理由を分析して保存して」'];

/**
 * レポートの一覧（ホームの「最新のレポート」の「すべて」と、新しいレポートのお知らせから開く）。
 * 期間の日付（lib/reports.ts の reportDate）の新しい順（右の切り替えで古い順）に並べ、その月の見出しで区切る。
 * 上の filter chip で種類（日・週・月）に絞る。「その他」は「すべて」でだけ出す。まだ開いていないものに「新着」の札。
 * 並び順は端末に覚える。お知らせから開いたとき（order=newest）は、その回だけ新しい順にする。
 * 右上の「自動で作る」で、ChatGPT のスケジュールにまとめを作る予定を入れるシート
 */
export default function ReportsScreen() {
  const params = useLocalSearchParams<{ order?: string }>();
  const { data, error, reload, repos } = useFocusData(async (r) => {
    const [reports, seen, order] = await Promise.all([r.reports.list(), r.reports.seenIds(), r.reports.listOrder()]);
    return { reports, seen, order };
  });
  const list = useListMotion(data != null);
  const chat = useChatChooser();
  const schedule = useScheduleSheet();
  const today = useToday();
  const [filter, setFilter] = useState<ReportFilter>('all');
  // 選んだ順（null なら、お知らせから開いたときの順か、端末に覚えた順）
  const [picked, setPicked] = useState<ReportOrder | null>(null);
  // 開いたときはカードを順に出す。チップで切り替えたあとは、一覧の全体を 150ms でふわっと入れ替える（カードは順に出さない）
  const [switched, setSwitched] = useState(false);
  const reduced = useReducedMotion();
  const swap = switched && !reduced && Platform.OS !== 'web' ? FadeIn.duration(duration.text).easing(easeOut) : undefined;
  const header = (
    <Header title="レポート" onBack={() => router.back()}
      right={<Button label="自動で作る" icon="calendar" variant="text" small accessibilityLabel={SCHEDULE_LABEL} onPress={schedule.open}
        style={{ paddingLeft: 12, paddingRight: 12 }} testID="report-schedule" />} />
  );
  if (error) return <Screen>{header}<LoadError onRetry={reload} /></Screen>;
  if (data == null) return <Screen>{header}</Screen>;
  if (data.reports.length === 0) {
    return (
      <Screen>
        {header}
        <EmptyState icon="chart" title="レポートはまだありません" body="チャット（Claude・ChatGPT）で「今週のまとめを作って」と頼むと、ここに出ます。"
          action={<Button label="チャットで作る" icon="chat" variant="tonal" accessibilityLabel={REPORT_CHAT_LABEL} onPress={chat.report} />} />
        <Card style={{ gap: 8 }}>
          <T bold size={14} accessibilityRole="header">頼み方の例</T>
          {EXAMPLES.map((e) => <T key={e} size={14}>・{e}</T>)}
        </Card>
        {chat.sheet}
        {schedule.sheet}
      </Screen>
    );
  }
  const order: ReportOrder = picked ?? (isReportOrder(params.order) ? params.order : data.order);
  const toggleOrder = () => {
    const next = otherOrder(order);
    setPicked(next);
    setSwitched(true);
    repos.reports.setListOrder(next).catch(() => {});
  };
  const shown = sortReports(filterReports(data.reports, filter), order);
  const groups = groupByMonth(shown, today);
  const empty = filter === 'all' ? null : emptyFilterText(filter);
  return (
    <Screen>
      {header}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
        <View style={{ flex: 1 }}>
          <ChipRow>
            {REPORT_FILTERS.map((f) => (
              <Chip key={f.key} label={f.label} active={filter === f.key} onPress={() => { setFilter(f.key); setSwitched(true); }} />
            ))}
          </ChipRow>
        </View>
        <Button label={REPORT_ORDER_LABELS[order]} icon={order === 'newest' ? 'down' : 'up'} variant="text" small accessibilityLabel={orderToggleLabel(order)}
          onPress={toggleOrder} style={{ paddingLeft: 8, paddingRight: 8, marginRight: -8 }} testID="report-order" />
      </View>
      <Animated.View key={`${filter}|${order}`} entering={swap}>
        {empty && shown.length === 0 ? (
          <EmptyState icon="chart" title={empty.title} body={empty.body}
            action={<Button label="チャットで作る" icon="chat" variant="tonal" accessibilityLabel={REPORT_CHAT_LABEL} onPress={chat.report} />} />
        ) : (
          <>
            {groups.map((g) => (
              <View key={g.key} style={{ gap: space.m, marginTop: space.m }}>
                {g.title !== '' && <T variant="titleS" color={colors.sub} accessibilityRole="header">{g.title}</T>}
                {g.reports.map((r) => (
                  <Animated.View key={r.id} entering={switched ? undefined : list.entering(shown.indexOf(r))} exiting={list.exiting} layout={list.layout}>
                    <ReportCard report={r} unread={!data.seen.has(r.id)} onPress={() => router.push({ pathname: '/reports/[id]', params: { id: r.id } })} />
                  </Animated.View>
                ))}
              </View>
            ))}
            <T size={12} color={colors.sub} style={{ marginTop: 12 }}>
              {filter === 'all' ? 'チャット（Claude・ChatGPT）で作ったまとめです。' : `${KIND_LABELS[filter]}だけを出しています。`}
              期間の日付の{REPORT_ORDER_LABELS[order]}に、月ごとに並びます。
            </T>
          </>
        )}
      </Animated.View>
      {chat.sheet}
      {schedule.sheet}
    </Screen>
  );
}
