import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { LoadError } from '@/components/LoadError';
import { HighlightCard, MarkdownBody, MetricTile, NextStepCard, ReportSection, ToneBand } from '@/components/reports';
import { Screen } from '@/components/Screen';
import { T } from '@/components/Text';
import { ConfirmDialog, Header, IconButton } from '@/components/ui';
import { useBusy } from '@/hooks/busy';
import { useFocusData } from '@/hooks/data';
import { Highlight, Metric, NEXT_TITLES, ReportKind } from '@/lib/reports';
import { colors } from '@/theme';

const VS: Record<ReportKind, string> = { daily: '前の日より', weekly: '先週より', monthly: '先月より', other: '前より' };

/** レポートの中身。上に調子の帯、指標のタイル、分野ごとのカード、次の一歩、くわしい本文。消せる（確認のダイアログ） */
export default function ReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // 読み込み中（null）と、ないレポート（report が null）を分ける
  const { data, error, reload, repos } = useFocusData(async (r) => ({ report: await r.reports.get(id) }), id);
  const [confirm, setConfirm] = useState(false);
  const { busy, run } = useBusy();

  const back = () => router.back();
  if (error) return <Screen><Header title="レポート" onBack={back} /><LoadError onRetry={reload} /></Screen>;
  if (data == null) return <Screen><Header title="レポート" onBack={back} /></Screen>;
  const report = data.report;
  if (report == null) {
    return <Screen><Header title="レポートが見つかりません" onBack={back} /><T color={colors.sub}>消されたか、まだ届いていないレポートです。</T></Screen>;
  }

  const tiles = report.highlights.filter((h): h is Highlight & { metric: Metric } => h.metric != null);
  const remove = () => run(async (stayBusy) => {
    setConfirm(false);
    await repos.reports.remove(report.id);
    stayBusy();
    router.back();
  });

  return (
    <Screen>
      <Header
        title="レポート"
        onBack={back}
        right={<IconButton name="trash" label="このレポートを消す" color={colors.danger} bg="transparent" disabled={busy} onPress={() => setConfirm(true)} />}
      />
      <View style={{ gap: 12, marginTop: 4 }}>
        <ToneBand report={report} />
        {tiles.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} testID="report-tiles">
            {tiles.map((h, i) => <MetricTile key={i} highlight={h} index={i + 1} vs={VS[report.kind]} animKey={report.id} />)}
          </View>
        )}
        {report.highlights.length > 0 && (
          <ReportSection title="分野ごと">
            {report.highlights.map((h, i) => <HighlightCard key={i} highlight={h} index={tiles.length + i + 1} />)}
          </ReportSection>
        )}
        {report.nextSteps.length > 0 && (
          <ReportSection title={NEXT_TITLES[report.kind]}>
            {report.nextSteps.map((s, i) => <NextStepCard key={i} n={i + 1} text={s} index={tiles.length + report.highlights.length + i + 1} />)}
          </ReportSection>
        )}
        {report.body.trim() !== '' && (
          <ReportSection title="くわしく">
            <MarkdownBody body={report.body} />
          </ReportSection>
        )}
        <T size={12} color={colors.sub}>Claude・ChatGPT が書いたまとめです。数字はアプリの記録で確かめてください。</T>
      </View>
      <ConfirmDialog
        visible={confirm}
        title="レポートを消しますか？"
        body={`「${report.title}」を消します。元に戻せません。`}
        confirmLabel="消す"
        cancelLabel="やめる"
        busy={busy}
        onConfirm={remove}
        onCancel={() => setConfirm(false)}
      />
    </Screen>
  );
}
