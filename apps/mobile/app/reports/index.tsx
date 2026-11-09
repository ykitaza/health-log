import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, View } from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';
import { REPORT_CHAT_LABEL, useChatChooser } from '@/components/ChatSheet';
import { LoadError } from '@/components/LoadError';
import { easeOut, useListMotion } from '@/components/motion';
import { ReportCard } from '@/components/reports';
import { Screen } from '@/components/Screen';
import { T } from '@/components/Text';
import { Button, Card, Chip, ChipRow, EmptyState, Header } from '@/components/ui';
import { useFocusData } from '@/hooks/data';
import { useToday } from '@/hooks/today';
import { emptyFilterText, filterReports, groupByMonth, KIND_LABELS, REPORT_FILTERS, ReportFilter } from '@/lib/reports';
import { colors, space } from '@/theme';
import { duration } from '@/theme/motion';

const EXAMPLES = ['「今週のまとめを作って」', '「10月の筋トレと食事をふり返って、レポートに残して」', '「ベンチプレスが伸びない理由を分析して保存して」'];

/**
 * レポートの一覧（ホームの「最新のレポート」の「すべて」から開く）。作った日の新しい順に、作った月の見出しで区切る。
 * 上の filter chip で種類（日・週・月）に絞る。「その他」は「すべて」でだけ出す
 */
export default function ReportsScreen() {
  const { data, error, reload } = useFocusData((r) => r.reports.list());
  const list = useListMotion(data != null);
  const chat = useChatChooser();
  const today = useToday();
  const [filter, setFilter] = useState<ReportFilter>('all');
  // 開いたときはカードを順に出す。チップで切り替えたあとは、一覧の全体を 150ms でふわっと入れ替える（カードは順に出さない）
  const [switched, setSwitched] = useState(false);
  const reduced = useReducedMotion();
  const swap = switched && !reduced && Platform.OS !== 'web' ? FadeIn.duration(duration.text).easing(easeOut) : undefined;
  const header = <Header title="レポート" onBack={() => router.back()} />;
  if (error) return <Screen>{header}<LoadError onRetry={reload} /></Screen>;
  if (data == null) return <Screen>{header}</Screen>;
  if (data.length === 0) {
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
      </Screen>
    );
  }
  const shown = filterReports(data, filter);
  const groups = groupByMonth(shown, today);
  const empty = filter === 'all' ? null : emptyFilterText(filter);
  return (
    <Screen>
      {header}
      <ChipRow>
        {REPORT_FILTERS.map((f) => (
          <Chip key={f.key} label={f.label} active={filter === f.key} onPress={() => { setFilter(f.key); setSwitched(true); }} />
        ))}
      </ChipRow>
      <Animated.View key={filter} entering={swap}>
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
                    <ReportCard report={r} onPress={() => router.push({ pathname: '/reports/[id]', params: { id: r.id } })} />
                  </Animated.View>
                ))}
              </View>
            ))}
            <T size={12} color={colors.sub} style={{ marginTop: 12 }}>
              {filter === 'all' ? 'チャット（Claude・ChatGPT）で作ったまとめです。' : `${KIND_LABELS[filter]}だけを出しています。`}新しい順に、作った月ごとに並びます。
            </T>
          </>
        )}
      </Animated.View>
      {chat.sheet}
    </Screen>
  );
}
