// 月のまとめの中身（モックの「今月」のタブ）：成長スコア → 目標への進捗（節目つき） → BIG3＋スパークライン。
// 色はミント（colors.accent）＋モノクロだけ（tone の琥珀色は使わない）。数字はアプリの記録から計算し、レポートの文章には頼らない。
// 並びは app/reports/[id].tsx で決める（このファイルは部品だけ。Issue #192・#203）
import { View } from 'react-native';
import { useFocusData, useGrowthData } from '@/hooks/data';
import type { DateKey } from '@/lib/date';
import { big3Assignments, completeBig3 } from '@/lib/exercises';
import { formatSigned } from '@/lib/format';
import { growthScoreAsOf } from '@/lib/growth';
import { big3Total, bodyChange } from '@/lib/reports';
import { weightGoalProgress } from '@/lib/reportView';
import { big3Trend } from '@/lib/training';
import { fmt1, kgToUnit } from '@/lib/units';
import { T } from '../Text';
import { GoalTrack, hud, kgLabel, Micro, Mono, NotchChip, Panel, Spark } from './hud';

const arrow = (n: number) => (n > 0 ? '↑' : n < 0 ? '↓' : '→');

/**
 * 成長スコア：asOf（月のまとめでは期間の終わり＝月末。月の途中なら今日）で終わる7日のスコアと、先週との差。
 * 計算は lib/growth.ts の growthScoreAsOf。記録が1日もなければ出さない
 */
export function GrowthScoreBlock({ asOf }: { asOf: DateKey }) {
  const { data } = useGrowthData(asOf);
  if (!data || data.days.length === 0) return null;
  const score = growthScoreAsOf(data.days, asOf, data.weeklyTrainingGoal);
  const d = score.diffFromLastWeek;
  const label = `成長スコア ${score.total}点${d == null ? '' : `。先週より ${formatSigned(d)}点`}`;
  return (
    <Panel style={{ paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 16 }} testID="report-growth-score" accessibilityLabel={label}>
      <Mono size={48} color={hud.white} style={{ lineHeight: 52 }}>{String(score.total)}</Mono>
      <View style={{ gap: 3, flex: 1 }}>
        <Micro green>Growth Score</Micro>
        <T bold size={13} color={hud.label}>成長スコア</T>
        {d != null
          ? <Mono size={15} color={d < 0 ? hud.muted : hud.green}>{`${arrow(d)} ${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d)}`}</Mono>
          : null}
        <T size={11} color={hud.muted} style={{ lineHeight: 16 }}>{d == null ? '直近7日のスコア。先週と比べる記録はまだありません' : '直近7日のスコア・先週より'}</T>
      </View>
    </Panel>
  );
}

/**
 * 目標への進捗（モックの .month-card）：現在（体重の7日移動平均の最後の点。bodyChange の last）›› 目標、太い棒と節目の目盛り、
 * 棒の両端の値、節目と目標の一覧。棒は lib/reportView.ts の weightGoalProgress（増量は 0kg から、減量は期間の初めの体重から目標まで）、
 * 残り・節目は lib/goalBar.ts（節目は10kg刻みで自動）。
 * 目標体重が未設定、または体重の記録が足りなければ出さない
 */
export function GoalBarBlock({ start, end }: { start: DateKey; end: DateKey }) {
  const { data } = useFocusData(async (r) => {
    const [daily, s] = await Promise.all([r.body.listDaily(), r.settings.get()]);
    return { daily, unit: s.weightUnit, goal: s.goalWeightKg ?? null };
  }, `${start}:${end}`);
  if (!data || data.goal == null) return null;
  const c = bodyChange(data.daily, data.goal, start, end);
  if (!c) return null;
  const { unit } = data;
  const goal = data.goal;
  const u = (kg: number) => fmt1(kgToUnit(kg, unit));
  const p = weightGoalProgress(c.last.value, goal, c.first.value);
  const showMilestone = !p.reached && p.milestoneKg !== goal;
  const label = `目標への進捗。現在 ${u(c.last.value)} ${unit}、目標 ${u(goal)} ${unit}。${p.reached ? '目標に届いています' : `あと ${u(p.remainingKg)} ${unit}`}${showMilestone ? `。節目 ${u(p.milestoneKg)} ${unit} まで あと ${u(p.toMilestoneKg)} ${unit}` : ''}`;
  const pct = `${Math.round(p.milestoneRatio * 1000) / 10}%` as const;
  return (
    <Panel style={{ paddingHorizontal: 14, paddingVertical: 10 }} testID="report-goal-bar">
      <View accessible accessibilityLabel={label}>
        <Micro style={{ marginBottom: 4 }}>Goal Progress</Micro>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <T bold size={13} color={hud.ink} accessibilityRole="header">目標への進捗</T>
          <T size={12} color={hud.muted}>{p.reached ? '届いています' : 'あと '}{!p.reached && <Mono size={12} color={hud.green}>{`${u(p.remainingKg)}${unit}`}</Mono>}</T>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 6 }}>
          <View>
            <Micro>Current</Micro>
            <T><Mono size={32} color={hud.white} style={{ lineHeight: 36 }}>{u(c.last.value)}</Mono><Mono size={14} color={hud.muted}>{unit}</Mono></T>
          </View>
          <T bold size={14} color={hud.green} style={{ paddingBottom: 6 }}>››</T>
          <View style={{ alignItems: 'flex-end' }}>
            <Micro>Target</Micro>
            <T><Mono size={26} color={hud.label} style={{ lineHeight: 30 }}>{kgLabel(kgToUnit(goal, unit))}</Mono><Mono size={14} color={hud.muted}>{unit}</Mono></T>
          </View>
        </View>
        <View style={{ marginTop: 8 }}>
          <GoalTrack ratio={p.ratio} tick={showMilestone ? p.milestoneRatio : null} big testIDTick="report-goal-milestone" />
          {showMilestone && (
            <View style={{ position: 'absolute', top: 16, left: pct, width: 120, marginLeft: -60, alignItems: 'center' }}>
              <T bold size={11} color={hud.ink}>{`${kgLabel(kgToUnit(p.milestoneKg, unit))}${unit}`}</T>
              <T bold size={10} color={hud.green}>{`あと${u(p.toMilestoneKg)}${unit}`}</T>
            </View>
          )}
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: showMilestone ? 34 : 8 }}>
          <Mono size={10} color={hud.faint}>{`${kgLabel(kgToUnit(p.scaleStartKg, unit))}${unit}`}</Mono>
          <Mono size={10} color={hud.faint}>{`${kgLabel(kgToUnit(goal, unit))}${unit}`}</Mono>
        </View>
        <View style={{ marginTop: 6, borderTopWidth: 1, borderTopColor: hud.line2 }}>
          {showMilestone && (
            <MileRow mark={String(Math.round(kgToUnit(p.milestoneKg, unit)))} title={`次の節目：${kgLabel(kgToUnit(p.milestoneKg, unit))}${unit}`} sub="10kg刻みの節目" remain={`あと${u(p.toMilestoneKg)}${unit}`} />
          )}
          <MileRow goal mark={String(Math.round(kgToUnit(goal, unit)))} title={`目標：${kgLabel(kgToUnit(goal, unit))}${unit}`} sub={goal >= c.last.value ? '増量の目標' : '減量の目標'} remain={p.reached ? '届いています' : `あと${u(p.remainingKg)}${unit}`} last />
        </View>
      </View>
    </Panel>
  );
}

/** 節目と目標の一覧の1行（モックの .mile-row）：四角の札、題と補足、右に残り */
function MileRow({ mark, title, sub, remain, goal = false, last = false }: { mark: string; title: string; sub: string; remain: string; goal?: boolean; last?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5, borderBottomWidth: last ? 0 : 1, borderBottomColor: hud.line2 }}>
      <NotchChip fill={goal ? hud.green : undefined} border={goal ? undefined : hud.line} style={{ width: 32, height: 32 }}>
        <Mono size={11} color={goal ? hud.onGreen : hud.ink}>{mark}</Mono>
      </NotchChip>
      <View style={{ flex: 1 }}>
        <T bold size={13} color={hud.ink}>{title}</T>
        <T size={11} color={hud.muted}>{sub}</T>
      </View>
      <Mono size={12} color={hud.green}>{remain}</Mono>
    </View>
  );
}

/**
 * BIG3：期間の推定1RMベストの合計（lib/reports.ts の big3Total）＋期間に切り取った big3Trend のスパークライン。
 * 期間の初めの点との差（↑ +◯kg）が取れるときだけ出す。割り当てが3種目そろわない、または期間に記録がなければ出さない（Big3Tile と同じ決まり）
 */
export function Big3Block({ start, end }: { start: DateKey; end: DateKey }) {
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
  const spark = clipped.map((pt) => kgToUnit(pt.total, unit));
  const since = clipped.length >= 2 ? Math.round(kgToUnit(clipped[clipped.length - 1].total - clipped[0].total, unit) * 10) / 10 : null;
  const label = `BIG3 推定1RM 合計 ${fmt1(kgToUnit(total.totalKg, unit))} ${unit}${since != null ? `。期間の初めより ${formatSigned(since)} ${unit}` : ''}`;
  return (
    <Panel style={{ paddingHorizontal: 14, paddingVertical: 10 }} testID="report-big3" accessibilityLabel={label}>
      <Micro green>BIG3 // Estimated 1RM Total</Micro>
      <T bold size={13} color={hud.ink} style={{ marginTop: 4 }} accessibilityRole="header">BIG3 推定1RM 合計</T>
      <T style={{ marginTop: 4 }}>
        <Mono size={36} color={hud.white} style={{ lineHeight: 40 }}>{fmt1(kgToUnit(total.totalKg, unit))}</Mono>
        <Mono size={16} color={hud.muted}>{` ${unit}`}</Mono>
      </T>
      {spark.length >= 2 && <View style={{ marginTop: 6 }}><Spark values={spark} height={38} strokeWidth={1.6} /></View>}
      {since != null && (
        <View style={{ marginTop: 8 }}>
          <Mono size={13} color={since < 0 ? hud.muted : hud.green} style={{ fontWeight: '700' }}>{`${arrow(since)} ${formatSigned(since)} ${unit.toUpperCase()}`}</Mono>
          <T size={11} color={hud.muted} style={{ marginTop: 2 }}>期間の初めより</T>
        </View>
      )}
    </Panel>
  );
}
