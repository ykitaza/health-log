import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { LoadError } from '@/components/LoadError';
import { Big3Tile, BodyChangeBlock, DailyAchievementBlock, LinkCard, ReviewCard, WeeklyGoalsBlock } from '@/components/reportBlocks';
import { HighlightCard, MarkdownBody, MetricTile, NextStepCard, ReportSection, ToneBand } from '@/components/reports';
import { Screen } from '@/components/Screen';
import { T } from '@/components/Text';
import { ConfirmDialog, Header, IconButton } from '@/components/ui';
import { useBusy } from '@/hooks/busy';
import { useFocusData } from '@/hooks/data';
import { big3Assignments, completeBig3 } from '@/lib/exercises';
import { achievementScope, Big3Lifts, Highlight, Metric, NEXT_TITLES, ReportKind } from '@/lib/reports';
import { colors } from '@/theme';

const VS: Record<ReportKind, string> = { daily: '前の日より', weekly: '先週より', monthly: '先月より', other: '前より' };

/**
 * レポートの中身。種類ごとに並びを変える（Figma の report-daily・report-weekly・report-monthly）。
 * - 日：調子の帯 → 今日の達成 → 分野ごと → 明日の一歩 → くわしく（指標のタイルは出さず、指標は分野のカードに小さく）
 * - 週：調子の帯 → 今週の目標 → 指標のタイル → つながり → 分野ごと → 来週の一歩 → くわしく
 * - 月：調子の帯 → 体の変化 → 指標のタイル（BIG3 を含む） → つながり → 分野ごと → 目標の見直し → 来月の一歩 → くわしく
 * 達成（今日の達成・今週の目標・体の変化）はアプリが記録から出す。前の形のレポート（達成の期間に合わない・つながりがない）は、ある分だけ出す。
 * 消せる（確認のダイアログ）。開いたら「見た」にする（新しいレポートのお知らせと「新着」の札を消す。端末だけ）
 */
export default function ReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // 読み込み中（null）と、ないレポート（report が null）を分ける
  // BIG3 に割り当てた種目（種目の BIG3 の役。割り当てる前は名前で決めたもの）。3つそろわなければ BIG3 のタイルを出さない
  const { data, error, reload, repos } = useFocusData(async (r) => {
    const [report, exercises] = await Promise.all([r.reports.get(id), r.catalog.listExercises({ includeHidden: true })]);
    const lifts: Big3Lifts | null = completeBig3(big3Assignments(exercises));
    return { report, lifts };
  }, id);
  const [confirm, setConfirm] = useState(false);
  const { busy, run } = useBusy();
  const openedId = data?.report?.id;
  useEffect(() => {
    if (openedId) repos.reports.markSeen([openedId]).catch(() => {});
  }, [openedId, repos]);

  const back = () => router.back();
  if (error) return <Screen><Header title="レポート" onBack={back} /><LoadError onRetry={reload} /></Screen>;
  if (data == null) return <Screen><Header title="レポート" onBack={back} /></Screen>;
  const report = data.report;
  if (report == null) {
    return <Screen><Header title="レポートが見つかりません" onBack={back} /><T color={colors.sub}>消されたか、まだ届いていないレポートです。</T></Screen>;
  }

  const daily = report.kind === 'daily';
  const scope = achievementScope(report);
  const tiles = daily ? [] : report.highlights.filter((h): h is Highlight & { metric: Metric } => h.metric != null);
  const big3 = scope?.type === 'month' && data.lifts != null;
  const remove = () => run(async (stayBusy) => {
    setConfirm(false);
    await repos.reports.remove(report.id);
    stayBusy();
    router.back();
  });
  // 開いたときに順に出す番号（帯が 0）
  let n = 1;
  const next = () => n++;

  return (
    <Screen>
      <Header
        title="レポート"
        onBack={back}
        right={<IconButton name="trash" label="このレポートを消す" color={colors.danger} bg="transparent" disabled={busy} onPress={() => setConfirm(true)} />}
      />
      <View style={{ gap: 12, marginTop: 4 }}>
        <ToneBand report={report} />
        {scope?.type === 'day' && <DailyAchievementBlock date={scope.date} index={next()} />}
        {scope?.type === 'week' && <WeeklyGoalsBlock date={scope.date} index={next()} />}
        {scope?.type === 'month' && <BodyChangeBlock start={scope.start} end={scope.end} index={next()} />}
        {(tiles.length > 0 || big3) && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} testID="report-tiles">
            {tiles.map((h, i) => <MetricTile key={i} highlight={h} index={next()} vs={VS[report.kind]} animKey={report.id} />)}
            {big3 && scope?.type === 'month' && <Big3Tile lifts={data.lifts} start={scope.start} end={scope.end} index={next()} animKey={report.id} />}
          </View>
        )}
        {report.links.length > 0 && (
          <ReportSection title="つながり">
            {report.links.map((l, i) => <LinkCard key={i} link={l} index={next()} />)}
          </ReportSection>
        )}
        {report.highlights.length > 0 && (
          <ReportSection title="分野ごと">
            {report.highlights.map((h, i) => <HighlightCard key={i} highlight={h} index={next()} metricVs={daily ? VS.daily : undefined} />)}
          </ReportSection>
        )}
        {report.review && <ReviewCard review={report.review} index={next()} />}
        {report.nextSteps.length > 0 && (
          <ReportSection title={NEXT_TITLES[report.kind]}>
            {report.nextSteps.map((s, i) => <NextStepCard key={i} n={i + 1} text={s} index={next()} />)}
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
