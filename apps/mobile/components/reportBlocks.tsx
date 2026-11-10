// レポートの中身の、種類ごとのブロック（Figma の report-daily・report-weekly・report-monthly）。
// 達成（今日の達成・今週の目標・体の変化・BIG3）は、レポートに保存された数字ではなく、アプリが自分の記録から出す（lib/reports.ts）。
// つながりと目標の見直しは、AI が書いた文を文字のまま出す
import { router } from 'expo-router';
import { ReactNode } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useDailyAchievement, useFocusData, useWeeklyAchievement } from '@/hooks/data';
import { dateLabels, datePoints } from '@/lib/chart';
import { formatMonthDay, todayKey } from '@/lib/date';
import { formatSigned } from '@/lib/format';
import { weekOf } from '@/lib/goals';
import {
  AchievementRow, achievementRowLabel, AREA_LABELS, Big3Lifts, big3Total, bodyChange, dailyAchievementRows, Highlight, linkCaption, Metric,
  ReportLink, ReportReview, weeklyAchievementRows,
} from '@/lib/reports';
import { fmt1, kgToUnit } from '@/lib/units';
import { colors, radius, toneColors } from '@/theme';
import { LineChart } from './charts';
import { Icon } from './Icon';
import { GrowBar } from './motion';
import { AREA_ICON, Delta, MetricTile, useEntering } from './reports';
import { T } from './Text';
import { Button } from './ui';

/** 達成のカードの枠：題と右の補足、行 */
function AchievementCard({ title, right, index, testID, children }: { title: string; right: string; index: number; testID: string; children: ReactNode }) {
  const enter = useEntering();
  return (
    <Animated.View entering={enter(index)} style={{ backgroundColor: colors.card, borderRadius: radius.card, padding: 16, gap: 14 }} testID={testID}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <T bold size={17} accessibilityRole="header">{title}</T>
        <T size={13} color={colors.sub}>{right}</T>
      </View>
      {children}
    </Animated.View>
  );
}

/** 達成の1行：印（チェック・注意。色だけでなく形でも）、名前、値と目標、棒（届いたら緑、届かなければ琥珀色） */
function AchievementLine({ row }: { row: AchievementRow }) {
  const color = row.mark === 'reached' ? toneColors.good.accent : toneColors.caution.accent;
  const empty = row.value === '記録なし';
  return (
    <View accessible accessibilityLabel={achievementRowLabel(row)} style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ width: 20, alignItems: 'center' }}>
          {row.mark !== 'none' && <Icon name={row.mark === 'reached' ? 'check' : 'caution'} size={20} color={row.mark === 'reached' ? colors.text : color} />}
        </View>
        <T size={15} style={{ flex: 1 }}>{row.label}</T>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
          {empty ? <T size={14} color={colors.sub}>{row.value}</T> : <T num bold size={24}>{row.value}</T>}
          {row.goal != null && <T size={13} color={colors.sub}>／{row.goal}</T>}
          {!empty && row.unit !== '' && <T size={12} color={colors.sub}>{row.unit}</T>}
        </View>
      </View>
      {row.ratio != null && (
        <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.input, overflow: 'hidden' }}>
          <GrowBar ratio={row.ratio} style={{ height: 8, borderRadius: 4, backgroundColor: color }} />
        </View>
      )}
    </View>
  );
}

/** 日のまとめの「今日の達成」（過去の日は「この日の達成」）：筋トレ・kcal・たんぱく質・睡眠（昨夜） */
export function DailyAchievementBlock({ date, index }: { date: string; index: number }) {
  const { data: a } = useDailyAchievement(date);
  const { data: extra } = useFocusData(async (r) => {
    const [list, s] = await Promise.all([r.catalog.listExercises({ includeHidden: true }), r.settings.get()]);
    return { names: new Map(list.map((e) => [e.id, e.name])), unit: s.weightUnit };
  });
  if (!a || !extra) return null;
  const rows = dailyAchievementRows(a, extra.names, extra.unit);
  return (
    <AchievementCard title={date === todayKey() ? '今日の達成' : 'この日の達成'} right={formatMonthDay(date)} index={index} testID="report-achievement">
      {rows.map((r) => <AchievementLine key={r.key} row={r} />)}
    </AchievementCard>
  );
}

/** 週のまとめの「今週の目標」（過去の週は「この週の目標」）。目標は設定の今の値 */
export function WeeklyGoalsBlock({ date, index }: { date: string; index: number }) {
  const { data: w } = useWeeklyAchievement(date);
  if (!w) return null;
  const { rows, summary } = weeklyAchievementRows(w);
  if (rows.length === 0) return null;
  return (
    <AchievementCard title={weekOf(todayKey()).start === w.start ? '今週の目標' : 'この週の目標'} right={summary} index={index} testID="report-achievement">
      {rows.map((r) => <AchievementLine key={r.key} row={r} />)}
    </AchievementCard>
  );
}

/** 月のまとめの「体の変化」：体重の7日の平均の推移と目標の破線、初めと終わりの値、目標までの残りとペース。体重の記録が足りなければ出さない */
export function BodyChangeBlock({ start, end, index }: { start: string; end: string; index: number }) {
  const enter = useEntering();
  const { data } = useFocusData(async (r) => {
    const [daily, s] = await Promise.all([r.body.listDaily(), r.settings.get()]);
    return { daily, unit: s.weightUnit, goal: s.goalWeightKg ?? null };
  }, `${start}:${end}`);
  if (!data) return null;
  const c = bodyChange(data.daily, data.goal, start, end);
  if (!c) return null;
  const { unit } = data;
  const u = (kg: number) => fmt1(kgToUnit(kg, unit));
  // 目標に近づく向きなら良い変化（目標がなければ色を付けない）
  const toward = c.goalKg == null || Math.abs(c.change) < 0.05 ? null : Math.sign(c.change) === Math.sign(c.goalKg - c.first.value);
  const delta: Metric = { label: '体重', value: kgToUnit(c.last.value, unit), unit, delta: kgToUnit(c.change, unit), deltaGood: toward };
  const goalText = c.goalKg == null ? null
    : c.reached ? '目標に届いています'
      : `目標まで あと ${u(c.remaining!)} ${unit}${c.eta ? ` ・ このペースで${c.eta}` : ''}`;
  const label = [`体の変化。体重の7日の平均 ${u(c.first.value)} から ${u(c.last.value)} ${unit}、この期間で ${formatSigned(kgToUnit(c.change, unit))} ${unit}`, goalText]
    .filter(Boolean).join('。');
  return (
    <Animated.View entering={enter(index)} style={{ backgroundColor: colors.card, borderRadius: radius.card, padding: 16, gap: 8 }} testID="report-body-change">
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <T bold size={17} accessibilityRole="header">体の変化</T>
        <T size={13} color={colors.sub}>体重・7日の平均</T>
      </View>
      <View accessible accessibilityLabel={label} style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
          <T num size={22} color={colors.sub}>{u(c.first.value)} →</T>
          <T num bold size={36}>{u(c.last.value)}</T>
          <T size={12} color={colors.sub}>{unit}</T>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 8 }}>
            <Delta metric={delta} size={14} suffix={` ${unit}`} />
            <T size={12} color={colors.sub}>この期間</T>
          </View>
        </View>
        <LineChart
          points={datePoints(c.points, (p) => kgToUnit(p.value, unit), start, end)}
          goal={c.goalKg != null ? { y: kgToUnit(c.goalKg, unit), label: `目標 ${u(c.goalKg)} ${unit}` } : undefined}
          xLabels={dateLabels(start, end, 3)}
          showYAxis={false}
          height={120}
          animKey={`${start}:${end}`}
        />
        {goalText && <T size={14}>{goalText}</T>}
      </View>
    </Animated.View>
  );
}

/**
 * 月のまとめの BIG3（合計）のタイル。lifts は BIG3 に割り当てた種目（割り当てがなければ null で、タイルを出さない）。
 * 値は期間の推定1RMのいちばん高い値の合計、変化は前の同じ長さの期間から
 */
export function Big3Tile({ lifts, start, end, index, animKey }: { lifts: Big3Lifts | null; start: string; end: string; index: number; animKey: string }) {
  const { data } = useFocusData(async (r) => (lifts ? { sets: await r.workouts.allSetRows(), unit: (await r.settings.get()).weightUnit } : null), `${start}:${end}`);
  const total = data ? big3Total(data.sets, lifts, start, end) : null;
  if (!data || !total) return null;
  const highlight: Highlight & { metric: Metric } = {
    area: 'training', tone: 'steady', text: '',
    metric: {
      label: 'BIG3（合計）', value: Math.round(kgToUnit(total.totalKg, data.unit)), unit: data.unit,
      delta: total.deltaKg == null ? null : Math.round(kgToUnit(total.deltaKg, data.unit)), deltaGood: total.deltaKg == null ? null : total.deltaKg >= 0,
    },
  };
  return <MetricTile highlight={highlight} index={index} vs="前の月より" animKey={animKey} />;
}

/** つながりのカード：from と to の分野のアイコンを矢印でつなぎ、文と「睡眠 → 筋トレ・2日」の補足 */
export function LinkCard({ link, index }: { link: ReportLink; index: number }) {
  const enter = useEntering();
  return (
    <Animated.View
      entering={enter(index)}
      accessible
      accessibilityLabel={`${AREA_LABELS[link.from]}から${AREA_LABELS[link.to]}へ${link.basis ? `（${link.basis}）` : ''}。${link.text}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.card, borderRadius: radius.card, padding: 12 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.input, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 8 }}>
        <Icon name={AREA_ICON[link.from]} size={20} color={colors.text} />
        <Icon name="chevron" size={14} color={colors.sub} />
        <Icon name={AREA_ICON[link.to]} size={20} color={colors.text} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <T size={16} style={{ lineHeight: 24 }}>{link.text}</T>
        <T size={12} color={colors.sub}>{linkCaption(link)}</T>
      </View>
    </Animated.View>
  );
}

/** 目標の見直し：文と、食事の目標のときだけ「食事の目標を開く」 */
export function ReviewCard({ review, index }: { review: ReportReview; index: number }) {
  const enter = useEntering();
  return (
    <Animated.View entering={enter(index)} style={{ backgroundColor: colors.card, borderRadius: radius.card, padding: 16, gap: 8, marginTop: 8 }} testID="report-review">
      <T bold size={17} accessibilityRole="header">目標の見直し</T>
      <T size={16} style={{ lineHeight: 24 }}>{review.text}</T>
      {review.target === 'meals_goal' && (
        <Button label="食事の目標を開く" variant="text" small onPress={() => router.push('/meals/goal')}
          style={{ alignSelf: 'flex-start', paddingLeft: 12, paddingRight: 12, marginLeft: -12 }} />
      )}
    </Animated.View>
  );
}
