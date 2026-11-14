import { router, useLocalSearchParams } from 'expo-router';
import { ReactNode, useEffect, useState } from 'react';
import { Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LoadError } from '@/components/LoadError';
import { CheckSteps, MonthlyTaskBlock, MoreFold } from '@/components/report/ClosingBlocks';
import { ByFieldPanel, DailyChipsBlock, DailyDetailsBlock, DailyRingsBlock, WeekRhythmBlock } from '@/components/report/DailyReportBlocks';
import { dotDate, dotMonthDay, hud, HudFonts, Insight, Micro, Mono, Panel, SlantFill } from '@/components/report/hud';
import { Big3Block, GoalBarBlock, GrowthScoreBlock } from '@/components/report/MonthlyReportBlocks';
import { ReportHero } from '@/components/report/ReportHero';
import { InjuryReviewBlock, MetricTilesBlock, PrevTodoBlock, WeeklyGoalsBlock, WeeklyRadarBlock, WeeklyStatusBlock } from '@/components/report/WeeklyReportBlocks';
import { T } from '@/components/Text';
import { ConfirmDialog, IconButton } from '@/components/ui';
import { useTodoChecks } from '@/components/WeeklyTodo';
import { useBusy } from '@/hooks/busy';
import { useFocusData } from '@/hooks/data';
import { addDays, todayKey } from '@/lib/date';
import { previousTodo } from '@/lib/home';
import {
  achievementScope, formatCreated, formatPeriod, Highlight, isPeriodReportKind, KIND_LABELS, Metric, NEXT_TITLES, PeriodReportKind, Report,
  ReportKind,
} from '@/lib/reports';
import { dailyReportStreak, dailyStreakText } from '@/lib/reportStreak';
import { colors } from '@/theme';

type PeriodKind = PeriodReportKind;
const PERIOD_TABS: { key: PeriodKind; label: string }[] = [
  { key: 'daily', label: '日' }, { key: 'weekly', label: '週' }, { key: 'monthly', label: '月' },
];

/** 画面の枠：モックの近黒の地（この画面だけ。共通の Screen は colors.bg なので使わない）。上の段はモックの KARADA // REPORT の行に、左端に小さな戻る、右端に「…」のメニュー（menu） */
function Frame({ sys, onBack, menu, children }: { sys: string | null; onBack: () => void; menu?: ReactNode; children: ReactNode }) {
  // 中身の幅はモックと同じく 400 まで（広い画面では左右に余白）。左右の余白は 12
  const { width } = useWindowDimensions();
  const side = 12 + Math.max(0, (width - 400) / 2);
  return (
    <HudFonts>
      <SafeAreaView style={{ flex: 1, backgroundColor: hud.bg }} edges={['top', 'bottom']}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: side - 12, minHeight: 44, zIndex: 2 }}>
          <IconButton name="back" label="戻る" onPress={onBack} bg="transparent" color={hud.muted} size={20} />
          <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 2 }}>
            <Micro>KARADA // REPORT</Micro>
            {sys && <Micro>{sys}</Micro>}
          </View>
          {menu ?? <View style={{ width: 44 }} />}
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: side, paddingBottom: 20, gap: 6 }}>{children}</ScrollView>
      </SafeAreaView>
    </HudFonts>
  );
}

/** 右上の「…」のメニュー。いまは「このレポートを消す」だけ（押すと確かめのダイアログ） */
function ReportMenu({ onDelete, disabled }: { onDelete: () => void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Pressable accessibilityRole="button" accessibilityLabel="メニュー" accessibilityState={{ expanded: open }} onPress={() => setOpen((o) => !o)}
        style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }} testID="report-menu">
        <Mono size={16} color={hud.muted} spacing={1}>…</Mono>
      </Pressable>
      {open && (
        <Panel bg={hud.panel2} cut={6} style={{ position: 'absolute', top: 42, right: 4, minWidth: 180 }}>
          <Pressable accessibilityRole="button" accessibilityLabel="このレポートを消す" disabled={disabled}
            onPress={() => { setOpen(false); onDelete(); }} style={{ minHeight: 44, paddingHorizontal: 14, justifyContent: 'center' }}>
            <T bold size={13} color={colors.danger}>このレポートを消す</T>
          </Pressable>
        </Panel>
      )}
    </View>
  );
}

/** 期間タブ（日／週／月）：暗い面に1px の枠、選んだタブはミントの塗り（モックの .tabs）。共用の Segmented は使わない */
function PeriodTabs({ value, onChange }: { value: ReportKind; onChange: (k: PeriodKind) => void }) {
  return (
    <Panel bg={hud.panel2} border={hud.line} cut={6} style={{ flexDirection: 'row', gap: 4, padding: 3 }} testID="report-period-tabs">
      {PERIOD_TABS.map((t) => {
        const on = t.key === value;
        return (
          <Pressable key={t.key} accessibilityRole="button" aria-selected={on} accessibilityState={{ selected: on }} accessibilityLabel={t.label}
            onPress={() => onChange(t.key)} style={{ flex: 1 }}>
            <SlantFill on={on} style={{ paddingVertical: 7, minHeight: 34 }}>
              <T bold size={13} color={on ? hud.onGreen : hud.muted}>{t.label}</T>
            </SlantFill>
          </Pressable>
        );
      })}
    </Panel>
  );
}

/**
 * レポートの中身。上の期間タブ（日／週／月）で、その種類の最新のレポートに切り替える（開いた1件に固定しない）。
 * タブを押していないときは、開いたレポート（id）そのものを出す。ただし kind が 'other'（分析レポート）のものは
 * アプリのどこにも出さないので、開かれても最新の（other でない）レポートに替えて出す（データ自体は消さない）。
 * いちばん上に「最新の生成済み」の状態行：出すレポートの期間と、それがその種類の最新のときは最新の生成済みレポートを
 * 出していることを書く（新しいものが作られるまで、前のものが残るため。古いレポートを開いたときは書かない）。
 * 見た目と並びは承認済みのモック（ブランチ docs/report-mock の docs/report-mock/index.html。Issue #203）。部品は components/report/：
 * - 日：ヒーロー（体重のリング・28日の傾向・目標の棒） → リング（kcal・たんぱく質・睡眠） → 解釈（要約） → 今週のリズム →
 *   明日の一歩（チェックできる。連続達成は lib/reportStreak.ts） → 安静時心拍・体脂肪率 → くわしく（ステータス表と分野ごとの解釈）
 * - 週：ヒーロー（週の平均の体重・要約・目標の棒） → 部位のバランス（レポートの週にアンカー） → WEEKLY STATUS（平均・筋トレの日数・負荷量・最近の部位）
 *   → 今週の目標（達成・連続・目標を変える） → 先週やることの振り返り（前の週のまとめがあるときだけ。見るだけ） → ケガの振り返り（端末のケガ記録から3分類） → 来週の焦点（チェックできる。
 *   ホームの「今週やること」と同じ next_steps_done を共有する） → 今週のリズム → 指標のタイル → 分野ごと
 * - 月：ヒーロー（目標への進捗） → 成長スコア → 目標への進捗（節目つき） → BIG3（スパークライン付き） → 解釈（要約） → 今月の課題 → 分野ごと
 * どの種類も、そのあとに つながり・目標の見直し・本文があれば、たたんで出す（モックにないため）。消すのは右上の「…」のメニューから。
 * 達成（リング・今週の目標）と体重・BIG3 はアプリが記録から出す。前の形のレポート（達成の期間に合わない・つながりがない）は、ある分だけ出す。
 * レポートのタブ（最新の詳細へ直行）・ホーム・各タブの日のまとめのカードから開く。消せる（確認のダイアログ）。
 * 開いたら「見た」にする（新しいレポートのお知らせと「新着」の札を消す。端末だけ。期間タブで切り替えた先も同じ）
 */
export default function ReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // 期間タブで選んだ種類（null なら、開いたレポートの種類）
  const [pickedKind, setPickedKind] = useState<PeriodKind | null>(null);
  useEffect(() => { setPickedKind(null); }, [id]);
  // 読み込み中（null）と、ないレポート（report が null）を分ける
  const { data, error, reload, repos } = useFocusData(async (r) => {
    const [report, reports, dailyLatest, weeklyLatest, monthlyLatest, latest] = await Promise.all([
      r.reports.get(id), r.reports.listWithoutBody(),
      r.reports.latestOfKind('daily'), r.reports.latestOfKind('weekly'), r.reports.latestOfKind('monthly'), r.reports.latest(),
    ]);
    const latestByKind: Record<PeriodKind, Report | null> = { daily: dailyLatest, weekly: weeklyLatest, monthly: monthlyLatest };
    return { report, reports, latestByKind, latest };
  }, id);
  const [confirm, setConfirm] = useState(false);
  const { busy, run } = useBusy();
  // 出すレポート：期間タブを選んでいれば、その種類の最新のもの。選んだ種類にまだなければ null（空の状態を出す）。
  // 開いたレポートが 'other'（分析レポート）・'phase'（フェーズの振り返り。フェーズの画面で見せる）のときは出さず、
  // 最新の日・週・月のまとめに替える（この画面は日・週・月のタブだけ）
  const openedRaw = data?.report ?? null;
  // フェーズの振り返り（phase_id があるもの）は、フェーズの振り返りの画面へ移す（戻るでこの画面に戻らないよう置き換える）
  const phaseId = openedRaw?.kind === 'phase' ? openedRaw.phaseId : null;
  useEffect(() => { if (phaseId) router.replace(`/phase/review/${phaseId}`); }, [phaseId]);
  const opened = phaseId ? null : openedRaw && !isPeriodReportKind(openedRaw.kind) ? (data?.latest ?? null) : openedRaw;
  const report: Report | null = data == null ? null : pickedKind ? data.latestByKind[pickedKind] : opened;
  // 次の一歩のチェック（日次＝明日の一歩、週次＝来週の焦点。月次は見るだけ。既存の next_steps_done の仕組み：components/WeeklyTodo の useTodoChecks）
  const { done, toggle } = useTodoChecks(report?.id, report?.nextStepsDone ?? []);
  const openedId = report?.id;
  useEffect(() => {
    if (openedId) repos.reports.markSeen([openedId]).catch(() => {});
  }, [openedId, repos]);

  // URL で直接開いたとき（戻る先がない）は、ホームへ移る（レポートのタブは最新の詳細へ直行するので、戻り先にすると同じ詳細に戻ってしまう）
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));
  if (error) return <Frame sys={null} onBack={back}><LoadError onRetry={reload} /></Frame>;
  if (data == null) return <Frame sys={null} onBack={back}>{null}</Frame>;
  if (phaseId) return <Frame sys={null} onBack={back}>{null}</Frame>;
  if (opened == null) {
    return (
      <Frame sys={null} onBack={back}>
        <T bold size={20} color={hud.ink} accessibilityRole="header">レポートが見つかりません</T>
        <T color={hud.muted}>消されたか、まだ届いていないレポートです。</T>
      </Frame>
    );
  }

  const activeKind: ReportKind = pickedKind ?? opened.kind;
  const periodTabs = <PeriodTabs value={activeKind} onChange={setPickedKind} />;
  if (report == null) {
    // 期間タブで選んだ種類のレポートが、まだ1件もない
    return (
      <Frame sys={null} onBack={back}>
        {periodTabs}
        <Panel style={{ padding: 16, gap: 6, marginTop: 4 }}>
          <T bold size={15} color={hud.ink}>{`${KIND_LABELS[pickedKind!]}はまだありません`}</T>
          <T size={13} color={hud.muted}>チャット（Claude・ChatGPT）で作ると、ここに出ます。</T>
        </Panel>
      </Frame>
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
  const period = formatPeriod(report);
  // 出しているのがその種類の最新のときだけ「最新の生成済み」と書く（古いレポートを開いたときは書かない）
  const isLatest = isPeriodReportKind(report.kind) && report.id === data.latestByKind[report.kind]?.id;
  const periodDots = report.periodStart
    ? `${dotDate(report.periodStart)}${report.periodEnd && report.periodEnd !== report.periodStart ? `–${dotMonthDay(report.periodEnd)}` : ''}`
    : null;
  const today = todayKey();
  // 状態行：日のまとめが最新で、今日の分がまだないときはモックの形（「2026.11.13分は未生成のため…」）。ほかは期間と、最新ならその旨
  const missingToday = isLatest && report.kind === 'daily' && report.periodEnd != null && report.periodEnd < today;
  const latestNote = missingToday
    ? `${dotDate(today)}分は未生成のため、最新の生成済みレポート（${dotDate(report.periodEnd!)}分）を表示しています`
    : `${period ? `${period}のレポート` : `${formatCreated(report.createdAt)}に作成したレポート`}${isLatest ? ' ・ 最新の生成済みレポートを表示しています' : ''}`;
  // 週のリズムの基準の日：日のまとめはその日、週のまとめは今週なら今日（過ぎた週は基準なし）
  const weekAnchor = scope?.type === 'week' && report.periodEnd && report.periodStart && today >= report.periodStart && today <= report.periodEnd ? today : null;
  const fieldRight = periodDots ?? '';
  const hasSteps = report.nextSteps.length > 0;

  return (
    <Frame
      sys={periodDots ? `RPT-${periodDots}` : null}
      onBack={back}
      menu={<ReportMenu disabled={busy} onDelete={() => setConfirm(true)} />}
    >
      <View style={{ gap: 2, paddingHorizontal: 2, paddingTop: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {isLatest && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: hud.green }} />}
          <Micro green>{isLatest ? 'Latest Report' : 'Report'}</Micro>
          {periodDots && <Mono size={14} color={hud.white} spacing={0.8}>{periodDots}</Mono>}
        </View>
        <T size={11} color={hud.muted} style={{ lineHeight: 17, paddingLeft: isLatest ? 15 : 0 }} testID="report-latest-line">
          {latestNote}
        </T>
      </View>
      {periodTabs}
      <ReportHero report={report} scope={scope} />

      {/* 日 */}
      {scope?.type === 'day' && <DailyRingsBlock date={scope.date} />}
      {daily && report.headline !== '' && <Insight testID="report-insight">{report.headline}</Insight>}
      {scope?.type === 'day' && <WeekRhythmBlock date={scope.date} anchor={scope.date} />}
      {daily && hasSteps && (
        <CheckSteps
          en={scope?.type === 'day' ? `Next Step // For ${dotDate(addDays(scope.date, 1))}` : 'Next Step'}
          title={NEXT_TITLES.daily} steps={report.nextSteps} done={done} onToggle={toggle} streak={streakText} testID="report-daily-steps"
        />
      )}
      {scope?.type === 'day' && <DailyChipsBlock date={scope.date} />}
      {scope?.type === 'day' && <DailyDetailsBlock date={scope.date} highlights={report.highlights} />}
      {daily && scope?.type !== 'day' && <ByFieldPanel highlights={report.highlights} right={fieldRight} metricVs="前の日より" />}

      {/* 週 */}
      {scope?.type === 'week' && report.periodStart && report.periodEnd && (
        <>
          <WeeklyRadarBlock end={report.periodEnd} />
          <WeeklyStatusBlock start={report.periodStart} end={report.periodEnd} />
          <WeeklyGoalsBlock start={report.periodStart} end={report.periodEnd} />
        </>
      )}
      {prevTodo && <PrevTodoBlock week={prevTodo} />}
      {scope?.type === 'week' && report.periodStart && report.periodEnd && <InjuryReviewBlock start={report.periodStart} end={report.periodEnd} />}
      {weekly && hasSteps && (
        <CheckSteps en="Next Focus // Next Week" title={NEXT_TITLES.weekly} steps={report.nextSteps} done={done} onToggle={toggle} testID="report-weekly-steps" />
      )}
      {scope?.type === 'week' && <WeekRhythmBlock date={scope.date} anchor={weekAnchor} large />}
      {weekly && <MetricTilesBlock tiles={tiles} vs="先週より" />}
      {weekly && scope?.type !== 'week' && report.headline !== '' && <Insight>{report.headline}</Insight>}
      {weekly && <ByFieldPanel highlights={report.highlights} right={fieldRight} />}

      {/* 月 */}
      {scope?.type === 'month' && (
        <>
          {/* 月の途中は今日まで（月末の先の日で数えると、記録のない7日でいつも 0 になるため） */}
          <GrowthScoreBlock asOf={scope.end < today ? scope.end : today} />
          <GoalBarBlock start={scope.start} end={scope.end} />
          <Big3Block start={scope.start} end={scope.end} />
        </>
      )}
      {report.kind === 'monthly' && report.headline !== '' && <Insight testID="report-insight">{report.headline}</Insight>}
      {report.kind === 'monthly' && hasSteps && <MonthlyTaskBlock steps={report.nextSteps} />}
      {report.kind === 'monthly' && <ByFieldPanel highlights={report.highlights} right={fieldRight} metricVs="先月より" />}

      {/* どの種類も：つながり・目標の見直し・本文（モックにないので、たたんで下に置く） */}
      <MoreFold links={report.links} review={report.review} body={report.body} />

      <View style={{ alignItems: 'center', gap: 4, paddingTop: 4 }}>
        <Micro>Data from your records — End of Report</Micro>
        <T size={11} color={hud.muted} testID="report-created">{`${KIND_LABELS[report.kind]} ・ ${formatCreated(report.createdAt)}に作成`}</T>
        <T size={11} color={hud.muted} style={{ textAlign: 'center' }}>Claude・ChatGPT が書いたまとめです。数字はアプリの記録で確かめてください。</T>
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
    </Frame>
  );
}
