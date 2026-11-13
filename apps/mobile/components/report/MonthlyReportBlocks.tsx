// 月のまとめの第一画面のブロック（成長スコア → 目標バー → BIG3＋スパークライン）。
// 色はミント（colors.accent）＋モノクロだけ（tone の琥珀色は使わない）。数字はアプリの記録から計算し、レポートの文章には頼らない。
// 並びは coordinator が app/reports/[id].tsx 側で決める（このファイルは部品だけ。Issue #192）
import { ReactNode } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Sparkline } from '@/components/charts';
import { GrowBar } from '@/components/motion';
import { useEntering } from '@/components/reports';
import { T } from '@/components/Text';
import { useFocusData, useGrowthData } from '@/hooks/data';
import { datePoints } from '@/lib/chart';
import type { DateKey } from '@/lib/date';
import { BIG3_LABELS, Big3Role, big3Assignments, completeBig3 } from '@/lib/exercises';
import { formatSigned } from '@/lib/format';
import { goalProgress } from '@/lib/goalBar';
import { growthScoreAsOf } from '@/lib/growth';
import { big3Total, bodyChange } from '@/lib/reports';
import { big3Trend, estimated1RM } from '@/lib/training';
import { fmt1, fmtInt, kgToUnit } from '@/lib/units';
import { colors } from '@/theme';
import { REPORT_TRACK_BG, ReportPanelHead, reportPanelStyle } from './panel';

function MonthlyCard({ en, title, right, index, testID, children }: {
  en: string; title: string; right?: string; index: number; testID: string; children: ReactNode;
}) {
  const enter = useEntering();
  return (
    <Animated.View entering={enter(index)} style={[reportPanelStyle, { padding: 12, gap: 10 }]} testID={testID}>
      <ReportPanelHead en={en} title={title} right={right} />
      {children}
    </Animated.View>
  );
}

const diffText = (diff: number | null, unit = ''): string | null => {
  if (diff == null) return null;
  if (diff > 0) return `↑ +${fmt1(diff)}${unit}`;
  if (diff < 0) return `↓ ${fmt1(diff)}${unit}`;
  return `→ ±0${unit}`;
};

/**
 * (a) 成長スコア：asOf（月のまとめでは期間の終わり＝月末）で終わる7日のスコアと、先週との差。
 * 計算は lib/growth.ts の growthScoreAsOf（growthScore の as-of 版）。記録が1日もなければ出さない
 */
export function GrowthScoreBlock({ asOf, index = 0 }: { asOf: DateKey; index?: number }) {
  const { data } = useGrowthData(asOf);
  if (!data || data.days.length === 0) return null;
  const score = growthScoreAsOf(data.days, asOf, data.weeklyTrainingGoal);
  const diff = diffText(score.diffFromLastWeek);
  const label = `成長スコア ${score.total}点${score.diffFromLastWeek == null ? '' : `。先週より ${formatSigned(score.diffFromLastWeek)}点`}`;
  return (
    <MonthlyCard en="GROWTH SCORE" title="成長スコア" right="直近7日" index={index} testID="report-growth-score">
      <View accessible accessibilityLabel={label} style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <T num bold size={44} color={colors.accent}>{score.total}</T>
        <T size={13} color={colors.sub}>点</T>
        {diff
          ? <T num size={15} color={score.diffFromLastWeek! < 0 ? colors.sub : colors.accent}>{diff}</T>
          : <T size={13} color={colors.sub}>先週と比べる記録はまだありません</T>}
        {score.diffFromLastWeek != null && <T size={12} color={colors.sub}>先週より</T>}
      </View>
    </MonthlyCard>
  );
}

/**
 * (b) 目標バー：現在（体重の7日移動平均の最後の点。BodyChangeBlock と同じ bodyChange の last）→目標の横棒。
 * 進み具合・残り・節目は lib/goalBar.ts。節目は10kg刻みで自動（例：69.8kg→80kg なら 70kg まであと 0.2kg）。
 * 目標体重が未設定、または体重の記録が足りなければ出さない
 */
export function GoalBarBlock({ start, end, index = 0 }: { start: DateKey; end: DateKey; index?: number }) {
  const { data } = useFocusData(async (r) => {
    const [daily, s] = await Promise.all([r.body.listDaily(), r.settings.get()]);
    return { daily, unit: s.weightUnit, goal: s.goalWeightKg ?? null };
  }, `${start}:${end}`);
  if (!data || data.goal == null) return null;
  const c = bodyChange(data.daily, data.goal, start, end);
  if (!c) return null;
  const { unit } = data;
  const u = (kg: number) => fmt1(kgToUnit(kg, unit));
  const p = goalProgress({ currentKg: c.last.value, goalKg: data.goal, startKg: c.first.value });
  const remaining = kgToUnit(p.remainingKg, unit);
  const toMilestone = kgToUnit(p.toMilestoneKg, unit);
  const milestoneText = p.reached
    ? '目標に届いています'
    : p.milestoneKg === data.goal
      ? `あと ${u(p.remainingKg)} ${unit} ・ 次の節目は目標です`
      : `あと ${u(p.remainingKg)} ${unit} ・ 節目 ${u(p.milestoneKg)} ${unit} まで あと ${fmt1(toMilestone)} ${unit}`;
  const label = `目標バー。現在 ${u(c.last.value)} ${unit}、目標 ${u(data.goal)} ${unit}。${milestoneText}`;
  return (
    <MonthlyCard en="GOAL PROGRESS" title="目標" right="体重" index={index} testID="report-goal-bar">
      <View accessible accessibilityLabel={label} style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
          <T num bold size={28}>{u(c.last.value)}</T>
          <T size={13} color={colors.sub}>{unit} → 目標</T>
          <T num bold size={28} color={colors.accent}>{u(data.goal)}</T>
          <T size={13} color={colors.sub}>{unit}</T>
        </View>
        <View style={{ position: 'relative', height: 10, backgroundColor: REPORT_TRACK_BG, borderWidth: 1, borderColor: colors.line }}>
          <GrowBar ratio={p.ratio} style={{ height: 8, backgroundColor: colors.accent }} />
          {!p.reached && (
            <View
              testID="report-goal-milestone"
              style={{ position: 'absolute', top: -3, left: `${Math.round(p.milestoneRatio * 1000) / 10}%`, width: 2, height: 16, backgroundColor: colors.text }}
            />
          )}
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
          <T size={12} color={colors.sub}>現在 {u(c.last.value)} {unit}</T>
          <T size={12} color={colors.sub}>目標 {u(data.goal)} {unit}</T>
        </View>
        <T size={14}>{p.reached ? milestoneText : `あと ${fmt1(remaining)} ${unit}`}</T>
        {!p.reached && p.milestoneKg !== data.goal && (
          <T size={13} color={colors.sub}>節目 {u(p.milestoneKg)} {unit} まで あと {fmt1(toMilestone)} {unit}</T>
        )}
      </View>
    </MonthlyCard>
  );
}

/**
 * (c) BIG3：期間の推定1RMベストの合計（lib/reports.ts の big3Total）＋期間に切り取った big3Trend のスパークライン。
 * 合計の下は種目ごとの期間ベストを label 左／value 右の表で。期間の初めの点との差（↑ +◯kg）が取れるときだけ出す。
 * 割り当てが3種目そろわない、または期間に記録がなければ出さない（Big3Tile と同じ決まり）
 */
export function Big3Block({ start, end, index = 0 }: { start: DateKey; end: DateKey; index?: number }) {
  const { data } = useFocusData(async (r) => {
    const [sets, exercises, s] = await Promise.all([
      r.workouts.allSetRows(), r.catalog.listExercises({ includeHidden: true }), r.settings.get(),
    ]);
    return { sets, assignments: big3Assignments(exercises), lifts: completeBig3(big3Assignments(exercises)), unit: s.weightUnit };
  }, `${start}:${end}`);
  if (!data || !data.lifts) return null;
  const total = big3Total(data.sets, data.lifts, start, end);
  if (!total) return null;
  const { unit } = data;
  const trend = big3Trend(data.sets, data.assignments, end, start);
  const clipped = trend.points.filter((pt) => pt.date >= start && pt.date <= end);
  const spark = datePoints(clipped, (pt) => kgToUnit(pt.total, unit), start, end);
  const sinceStart = clipped.length >= 2 ? clipped[clipped.length - 1].total - clipped[0].total : null;
  const sinceText = sinceStart == null ? null : diffText(Math.round(kgToUnit(sinceStart, unit) * 10) / 10, ` ${unit}`);
  const roles: Big3Role[] = ['bench', 'squat', 'deadlift'];
  const perLift = roles.map((role) => {
    const id = data.lifts![role];
    const best = Math.max(0, ...data.sets.filter((r) => r.exerciseId === id && r.date >= start && r.date <= end).map((r) => estimated1RM(r.weightKg, r.reps)));
    return { role, bestKg: best };
  });
  const label = `BIG3 推定1RM 合計 ${fmtInt(kgToUnit(total.totalKg, unit))} ${unit}${sinceText ? `。期間の初めより ${sinceText}` : ''}`;
  return (
    <MonthlyCard en="ESTIMATED 1RM" title="BIG3" right="推定1RM 合計" index={index} testID="report-big3">
      <View accessible accessibilityLabel={label} style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
          <T num bold size={36}>{fmtInt(kgToUnit(total.totalKg, unit))}</T>
          <T size={12} color={colors.sub}>{unit}</T>
          {sinceText && <T num size={15} color={sinceStart! < 0 ? colors.sub : colors.accent}>{sinceText}</T>}
          {sinceText && <T size={12} color={colors.sub}>期間の初めより</T>}
        </View>
        {spark.length >= 2 && <Sparkline points={spark} height={44} animKey={`${start}:${end}`} />}
        <View>
          {perLift.map(({ role, bestKg }, i) => (
            <View key={role} style={[{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, paddingVertical: 5 }, i > 0 && { borderTopWidth: 1, borderTopColor: colors.line }]}>
              <T size={14} color={colors.sub}>{BIG3_LABELS[role]}</T>
              <T num size={15}>{fmtInt(kgToUnit(bestKg, unit))} {unit}</T>
            </View>
          ))}
        </View>
      </View>
    </MonthlyCard>
  );
}
