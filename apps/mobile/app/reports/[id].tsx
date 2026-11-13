import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { LoadError } from '@/components/LoadError';
import { BodyChangeBlock, DailyAchievementBlock, DailyStatTableBlock, LinkCard, ReviewCard, WeeklyGoalsBlock } from '@/components/reportBlocks';
import { Big3Block, GoalBarBlock, GrowthScoreBlock } from '@/components/report/MonthlyReportBlocks';
import { InjuryReviewBlock, WeeklyRadarBlock } from '@/components/report/WeeklyReportBlocks';
import { HighlightCard, MarkdownBody, MetricTile, NextStepCard, ReportSection, ToneBand } from '@/components/reports';
import { Screen } from '@/components/Screen';
import { T } from '@/components/Text';
import { ConfirmDialog, EmptyState, Header, IconButton, Segmented } from '@/components/ui';
import { PreviousTodoCard, TodoList, useTodoChecks } from '@/components/WeeklyTodo';
import { useBusy } from '@/hooks/busy';
import { useFocusData } from '@/hooks/data';
import { useToday } from '@/hooks/today';
import { previousTodo } from '@/lib/home';
import {
  achievementScope, formatCreated, formatPeriod, Highlight, KIND_LABELS, Metric, NEXT_TITLES, Report, reportDate, ReportKind,
} from '@/lib/reports';
import { dailyReportStreak, dailyStreakText } from '@/lib/reportStreak';
import { colors, radius } from '@/theme';

const VS: Record<ReportKind, string> = { daily: '前の日より', weekly: '先週より', monthly: '先月より', other: '前より' };

type PeriodKind = Exclude<ReportKind, 'other'>;
const PERIOD_TABS: { key: PeriodKind; label: string }[] = [
  { key: 'daily', label: '日' }, { key: 'weekly', label: '週' }, { key: 'monthly', label: '月' },
];

/**
 * レポートの中身。上の期間タブ（日／週／月）で、その種類の最新のレポートに切り替える（開いた1件に固定しない）。
 * タブを押していないときは、開いたレポート（id）そのものを出す。ただし kind が 'other'（分析レポート）のものは
 * アプリのどこにも出さないので、開かれても最新の（other でない）レポートに替えて出す（データ自体は消さない）。
 * いちばん上に「最新の生成済み」の状態行：出すレポートの期間と、今日のレポートでないときは最新の生成済みレポートを
 * 出していることを書く（新しいものが作られるまで、前のものが残るため）。
 * 種類ごとの並び（Figma の report-daily・report-weekly・report-monthly）：
 * - 日：調子の帯 → 今日の達成（ゴールリング＋行） → 分野ごと → この日の数字（ステータス表） → 明日の一歩（チェックできる。
 *   連続達成は lib/reportStreak.ts） → つながり → 目標の見直し → くわしく
 * - 週：調子の帯 → 今週の目標 → 部位バランスのレーダー（レポートの週にアンカー） → 先週やることの振り返り（前の週のまとめの次の一歩と済んだか。見るだけ。前の週のまとめがなければ出さない）
 *   → 指標のタイル → ケガの振り返り（INJURY REVIEW。端末のケガ記録から3分類） → 分野ごと → 来週の焦点（チェックできる。ホームの「今週やること」と同じ next_steps_done を共有する） → つながり → くわしく
 * - 月：調子の帯 → 体の変化 → 成長スコア → 目標バー → BIG3（スパークライン付き） → 指標のタイル → 分野ごと → 今月の課題 → つながり → 目標の見直し → くわしく
 * 達成（今日の達成・今週の目標・体の変化）はアプリが記録から出す。前の形のレポート（達成の期間に合わない・つながりがない）は、ある分だけ出す。
 * レポートのタブ（最新の詳細へ直行）・ホーム・各タブの日のまとめのカードから開く。消せる（確認のダイアログ）。
 * 開いたら「見た」にする（新しいレポートのお知らせと「新着」の札を消す。端末だけ。期間タブで切り替えた先も同じ）
 */
export default function ReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const today = useToday();
  // 期間タブで選んだ種類（null なら、開いたレポートの種類）
  const [pickedKind, setPickedKind] = useState<PeriodKind | null>(null);
  useEffect(() => { setPickedKind(null); }, [id]);
  // 読み込み中（null）と、ないレポート（report が null）を分ける
  const { data, error, reload, repos } = useFocusData(async (r) => {
    const [report, reports, dailyLatest, weeklyLatest, monthlyLatest, latest] = await Promise.all([
      r.reports.get(id), r.reports.list(),
      r.reports.latestOfKind('daily'), r.reports.latestOfKind('weekly'), r.reports.latestOfKind('monthly'), r.reports.latest(),
    ]);
    const latestByKind: Record<PeriodKind, Report | null> = { daily: dailyLatest, weekly: weeklyLatest, monthly: monthlyLatest };
    return { report, reports, latestByKind, latest };
  }, id);
  const [confirm, setConfirm] = useState(false);
  const { busy, run } = useBusy();
  // 出すレポート：期間タブを選んでいれば、その種類の最新のもの。選んだ種類にまだなければ null（空の状態を出す）。
  // 開いたレポートが 'other'（分析レポート）のときは出さず、最新の（other でない）レポートに替える（アプリのどこにも表示しない決まり）
  const openedRaw = data?.report ?? null;
  const opened = openedRaw?.kind === 'other' ? (data?.latest ?? null) : openedRaw;
  const report: Report | null = data == null ? null : pickedKind ? data.latestByKind[pickedKind] : opened;
  // 次の一歩のチェック（日次＝明日の一歩、週次＝来週の焦点。月次は見るだけ。既存の next_steps_done の仕組み：components/WeeklyTodo の useTodoChecks）
  const { done, toggle } = useTodoChecks(report?.id, report?.nextStepsDone ?? []);
  const openedId = report?.id;
  useEffect(() => {
    if (openedId) repos.reports.markSeen([openedId]).catch(() => {});
  }, [openedId, repos]);

  // URL で直接開いたとき（戻る先がない）は、ホームへ移る（レポートのタブは最新の詳細へ直行するので、戻り先にすると同じ詳細に戻ってしまう）
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));
  if (error) return <Screen><Header title="レポート" onBack={back} /><LoadError onRetry={reload} /></Screen>;
  if (data == null) return <Screen><Header title="レポート" onBack={back} /></Screen>;
  if (opened == null) {
    return <Screen><Header title="レポートが見つかりません" onBack={back} /><T color={colors.sub}>消されたか、まだ届いていないレポートです。</T></Screen>;
  }

  const activeKind: ReportKind = pickedKind ?? opened.kind;
  const periodTabs = (
    <View testID="report-period-tabs">
      <Segmented<ReportKind> options={PERIOD_TABS} value={activeKind} onChange={(k) => setPickedKind(k as PeriodKind)} check={false} />
    </View>
  );
  if (report == null) {
    // 期間タブで選んだ種類のレポートが、まだ1件もない
    return (
      <Screen>
        <Header title="レポート" onBack={back} />
        <View style={{ gap: 12, marginTop: 4 }}>
          {periodTabs}
          <EmptyState icon="chart" title={`${KIND_LABELS[pickedKind!]}はまだありません`} body="チャット（Claude・ChatGPT）で作ると、ここに出ます。" />
        </View>
      </Screen>
    );
  }

  const daily = report.kind === 'daily';
  const weekly = report.kind === 'weekly';
  const scope = achievementScope(report);
  const tiles = daily ? [] : report.highlights.filter((h): h is Highlight & { metric: Metric } => h.metric != null);
  const prevTodo = previousTodo(data.reports, report);
  // 明日の一歩の連続（表示中のまとめのチェック状態で数える。チェックした直後にも反映する）
  const streakReports = data.reports.map((r) => (r.id === report.id ? { ...r, nextStepsDone: done } : r));
  const streakText = daily ? dailyStreakText(dailyReportStreak(streakReports, report.id)) : null;
  const remove = () => run(async (stayBusy) => {
    setConfirm(false);
    await repos.reports.remove(report.id);
    stayBusy();
    back();
  });
  // 開いたときに順に出す番号（帯が 0）
  let n = 1;
  const next = () => n++;
  const period = formatPeriod(report);
  const isToday = reportDate(report) === today;

  return (
    <Screen>
      <Header
        title="レポート"
        onBack={back}
        right={<IconButton name="trash" label="このレポートを消す" color={colors.danger} bg="transparent" disabled={busy} onPress={() => setConfirm(true)} />}
      />
      <View style={{ gap: 12, marginTop: 4 }}>
        {periodTabs}
        <T size={12} color={colors.sub} testID="report-latest-line">
          {period ? `${period}のレポート` : `${formatCreated(report.createdAt)}に作成したレポート`}
          {!isToday && ' ・ 最新の生成済みレポートを表示しています'}
        </T>
        <ToneBand report={report} />
        {scope?.type === 'day' && <DailyAchievementBlock date={scope.date} index={next()} />}
        {scope?.type === 'week' && <WeeklyGoalsBlock date={scope.date} index={next()} />}
        {scope?.type === 'week' && report.periodStart && report.periodEnd && (
          <WeeklyRadarBlock start={report.periodStart} end={report.periodEnd} index={next()} />
        )}
        {scope?.type === 'month' && <BodyChangeBlock start={scope.start} end={scope.end} index={next()} />}
        {scope?.type === 'month' && (
          <>
            <GrowthScoreBlock asOf={scope.end} index={next()} />
            <GoalBarBlock start={scope.start} end={scope.end} index={next()} />
            <Big3Block start={scope.start} end={scope.end} index={next()} />
          </>
        )}
        {prevTodo && (
          <ReportSection title="先週やることの振り返り">
            <PreviousTodoCard week={prevTodo} />
          </ReportSection>
        )}
        {tiles.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} testID="report-tiles">
            {tiles.map((h, i) => <MetricTile key={i} highlight={h} index={next()} vs={VS[report.kind]} animKey={report.id} />)}
          </View>
        )}
        {scope?.type === 'week' && report.periodStart && report.periodEnd && (
          <InjuryReviewBlock start={report.periodStart} end={report.periodEnd} index={next()} />
        )}
        {report.highlights.length > 0 && (
          <ReportSection title="分野ごと">
            {report.highlights.map((h, i) => <HighlightCard key={i} highlight={h} index={next()} metricVs={daily ? VS.daily : undefined} />)}
          </ReportSection>
        )}
        {scope?.type === 'day' && <DailyStatTableBlock date={scope.date} index={next()} />}
        {report.nextSteps.length > 0 && (daily || weekly ? (
          <View style={{ gap: 8, marginTop: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
              <T bold size={14} color={colors.sub} accessibilityRole="header">{NEXT_TITLES[report.kind]}</T>
              {streakText && <T size={12} color={colors.sub} testID="report-daily-streak">{streakText}</T>}
            </View>
            <View style={{ backgroundColor: colors.card, borderRadius: radius.card, paddingHorizontal: 12, paddingVertical: 4 }} testID={daily ? 'report-daily-steps' : 'report-weekly-steps'}>
              <TodoList steps={report.nextSteps} done={done} onToggle={toggle} />
            </View>
          </View>
        ) : (
          <ReportSection title={NEXT_TITLES[report.kind]}>
            {report.nextSteps.map((s, i) => <NextStepCard key={i} n={i + 1} text={s} index={next()} />)}
          </ReportSection>
        ))}
        {report.links.length > 0 && (
          <ReportSection title="つながり">
            {report.links.map((l, i) => <LinkCard key={i} link={l} index={next()} />)}
          </ReportSection>
        )}
        {report.review && <ReviewCard review={report.review} index={next()} />}
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
