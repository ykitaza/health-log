// レポートの中身の、種類ごとのブロック（Figma の report-daily・report-weekly・report-monthly）。
// 達成（今日の達成・今週の目標・体の変化・BIG3）は、レポートに保存された数字ではなく、アプリが自分の記録から出す（lib/reports.ts）。
// つながりと目標の見直しは、AI が書いた文を文字のまま出す
import { router } from 'expo-router';
import { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useDailyAchievement, useFocusData, useGoalStreak, useWeeklyAchievement } from '@/hooks/data';
import { weekAverage, weeklyPace } from '@/lib/body';
import { dateLabels, datePoints } from '@/lib/chart';
import { addDays, DateKey, formatMonthDay, todayKey } from '@/lib/date';
import { formatSigned } from '@/lib/format';
import { allGoalsReached, weekOf } from '@/lib/goals';
import { formatClock, formatMinutes, formatSteps } from '@/lib/health';
import { WEEKLY_GOALS_SECTION } from '@/lib/home';
import { DAY_TYPE_LABELS, SLOT_LABELS, targetFor } from '@/lib/meals';
import {
  AchievementRow, achievementRowLabel, AREA_LABELS, Big3Lifts, big3Total, bodyChange, dailyAchievementRows, Highlight, linkCaption, MARK_LABELS, Metric,
  ReportLink, ReportReview, settingGoalRows, weeklyAchievementRows, weeklyGoalCardLabel, weekStreakText,
} from '@/lib/reports';
import { fmt1, fmtInt, kgToUnit } from '@/lib/units';
import { colors, radius, space } from '@/theme';
import { GoalRings, LineChart } from './charts';
import { Icon } from './Icon';
import { GrowBar, PressableScale } from './motion';
import { AREA_ICON, Delta, MetricTile, useEntering } from './reports';
import { T } from './Text';
import { Button } from './ui';

/** 達成のカードの枠：題と右の補足、行、下の段（footer。なければ出さない） */
function AchievementCard({ title, right, index, testID, children, footer }: {
  title: string; right: string; index: number; testID: string; children: ReactNode; footer?: ReactNode;
}) {
  const enter = useEntering();
  return (
    <Animated.View entering={enter(index)} style={{ backgroundColor: colors.card, borderRadius: radius.card, padding: 16, gap: 14 }} testID={testID}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <T bold size={17} accessibilityRole="header">{title}</T>
        <T size={13} color={colors.sub}>{right}</T>
      </View>
      {children}
      {footer}
    </Animated.View>
  );
}

/** 設定の今週の目標の欄を開く（settings?section=weekly-goals。欄までスクロールする） */
const openGoalSettings = () => router.push({ pathname: '/settings', params: { section: WEEKLY_GOALS_SECTION } });

/**
 * 達成の1行：印（チェック・注意。色だけでなく形と言葉でも）、名前、値と目標、棒。
 * 棒は届いた分をミント色で（届いていない行も同じ色。状態は印と言葉で伝え、琥珀色などの別の色は使わない）
 */
function AchievementLine({ row }: { row: AchievementRow }) {
  const empty = row.value === '記録なし';
  return (
    <View accessible accessibilityLabel={achievementRowLabel(row)} style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ width: 20, alignItems: 'center' }}>
          {row.mark !== 'none' && <Icon name={row.mark === 'reached' ? 'check' : 'caution'} size={20} color={row.mark === 'reached' ? colors.text : colors.sub} />}
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
          <GrowBar ratio={row.ratio} style={{ height: 8, borderRadius: 4, backgroundColor: colors.accent }} />
        </View>
      )}
    </View>
  );
}

/**
 * 日のまとめの「今日の達成」（過去の日は「この日の達成」）：いちばん上にゴールリング（kcal・たんぱく質・睡眠。
 * useDailyAchievement の値と ratio から。components/charts.tsx の GoalRings）、その下に筋トレを含む行の一覧
 */
export function DailyAchievementBlock({ date, index }: { date: string; index: number }) {
  const { data: a } = useDailyAchievement(date);
  const { data: extra } = useFocusData(async (r) => {
    const [list, s] = await Promise.all([r.catalog.listExercises({ includeHidden: true }), r.settings.get()]);
    return { names: new Map(list.map((e) => [e.id, e.name])), unit: s.weightUnit };
  });
  if (!a || !extra) return null;
  const rows = dailyAchievementRows(a, extra.names, extra.unit);
  const ringLabel: Record<string, string> = { kcal: 'kcal', protein: 'たんぱく質', sleep: '睡眠（昨夜）' };
  const rings = rows
    .filter((r) => r.key in ringLabel)
    .map((r) => ({ key: r.key, label: ringLabel[r.key], value: r.value, goal: r.goal, unit: r.unit, ratio: r.ratio, state: MARK_LABELS[r.mark] }));
  return (
    <AchievementCard title={date === todayKey() ? '今日の達成' : 'この日の達成'} right={formatMonthDay(date)} index={index} testID="report-achievement">
      <GoalRings items={rings} animKey={date} />
      {rows.map((r) => <AchievementLine key={r.key} row={r} />)}
    </AchievementCard>
  );
}

/**
 * 日のまとめの構造化ステータス表：その日の記録から組み立てる数値表（ラベル左／値右、行のあいだに細い線）。
 * 値は既存の材料から出す（体重・体脂肪率は body.listDaily、週の平均と28日の傾向は lib/body.ts、kcal・たんぱく質と
 * 食事の内訳・休みの日の目標は meals.summaries と lib/meals.ts の targetFor、睡眠・安静時心拍・歩数は health の日ごとのまとめ）。
 * 記録のない項目は「記録なし」か「—」で、行自体は消さない（並びを固定する）
 */
export function DailyStatTableBlock({ date, index }: { date: string; index: number }) {
  const enter = useEntering();
  const { data } = useFocusData(async (r) => {
    const [daily, settings, summaries, sleep, heart, steps] = await Promise.all([
      r.body.listDaily(), r.settings.get(), r.meals.summaries(date, date), r.health.sleepDay(date), r.health.heartRateDay(date), r.health.stepDay(date),
    ]);
    return { daily, unit: settings.weightUnit, day: summaries.days[0] ?? null, goal: summaries.goal, sleep, heart, steps };
  }, date);
  if (!data) return null;
  const { unit } = data;
  const dayBody = data.daily.find((d) => d.date === date) ?? null;
  const prevBody = data.daily.find((d) => d.date === addDays(date, -1)) ?? null;
  const weights = data.daily.filter((d) => d.weightKg != null).map((d) => ({ date: d.date, value: d.weightKg! }));
  const weekAvg = weekAverage(weights, date);
  const pace = weeklyPace(data.daily.filter((d) => d.weightKg != null).map((d) => ({ date: d.date, weightKg: d.weightKg! })), date);
  const prevDelta = dayBody?.weightKg != null && prevBody?.weightKg != null ? kgToUnit(dayBody.weightKg - prevBody.weightKg, unit) : null;
  const mealDay = data.day;
  const recorded = mealDay != null && mealDay.meals.length > 0;
  const slots = mealDay ? [...new Set(mealDay.meals.map((m) => SLOT_LABELS[m.slot]))].join('・') : '';
  const restTarget = data.goal ? targetFor(data.goal, 'rest') : null;
  const w = (kg: number) => `${fmt1(kgToUnit(kg, unit))} ${unit}`;
  const rows: { label: string; value: string }[] = [
    { label: '体重', value: dayBody?.weightKg != null ? w(dayBody.weightKg) : '記録なし' },
    { label: '体脂肪率', value: dayBody?.bodyFatPct != null ? `${fmt1(dayBody.bodyFatPct)} %` : '記録なし' },
    { label: '週の平均（体重）', value: weekAvg != null ? w(weekAvg) : '—' },
    { label: '前日比（体重）', value: prevDelta != null ? `${formatSigned(prevDelta)} ${unit}` : '—' },
    { label: 'kcal', value: recorded ? `${fmtInt(mealDay.total.kcal)} kcal` : '記録なし' },
    { label: 'たんぱく質', value: recorded ? `${fmtInt(mealDay.total.protein_g)} g` : '記録なし' },
    { label: '睡眠', value: data.sleep ? formatMinutes(data.sleep.asleepMin) : '記録なし' },
    { label: '寝た時刻', value: data.sleep ? formatClock(data.sleep.mainStartAt) : '—' },
    { label: '起きた時刻', value: data.sleep ? formatClock(data.sleep.mainEndAt) : '—' },
    { label: '安静時心拍', value: data.heart?.restingBpm != null ? `${Math.round(data.heart.restingBpm)} 拍/分` : '記録なし' },
    { label: '歩数', value: data.steps ? `${formatSteps(data.steps.steps)} 歩` : '記録なし' },
    { label: '体重の傾向（28日）', value: pace != null ? `${formatSigned(kgToUnit(pace, unit))} ${unit}／週` : '—' },
    { label: '食事', value: recorded ? `${mealDay.meals.length}食（${slots}）・${DAY_TYPE_LABELS[mealDay.dayType]}` : '記録なし' },
    { label: '休みの日の目標', value: restTarget?.kcal != null ? `${fmtInt(restTarget.kcal)} kcal` : '—' },
  ];
  return (
    <Animated.View entering={enter(index)} style={{ backgroundColor: colors.card, borderRadius: radius.card, padding: 16 }} testID="report-daily-stats">
      <T bold size={17} accessibilityRole="header" style={{ marginBottom: 4 }}>この日の数字</T>
      {rows.map((row, i) => (
        <View
          key={row.label}
          accessible
          accessibilityLabel={`${row.label}、${row.value}`}
          style={[{ flexDirection: 'row', alignItems: 'baseline', gap: 12, paddingVertical: 9 }, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line }]}
        >
          <T size={14} color={colors.sub} style={{ flex: 1 }}>{row.label}</T>
          <T num bold size={15} numberOfLines={1}>{row.value}</T>
        </View>
      ))}
    </Animated.View>
  );
}

/**
 * 週のまとめの「今週の目標」（過去の週は「この週の目標」）。目標は設定の今の値。
 * 下の段：設定の目標（筋トレ・食事の記録・睡眠）がすべて届いたら「✓ 達成」（たんぱく質は設定の目標ではないので見ない。連続と同じ決まり）と、
 * その週の時点の連続（lib/reports.ts の weekStreakText）。右に「目標を変える ›」で設定の今週の目標の欄へ
 */
export function WeeklyGoalsBlock({ date, index }: { date: string; index: number }) {
  const { data: w } = useWeeklyAchievement(date);
  const { data: streak } = useGoalStreak(date);
  if (!w) return null;
  const { rows, summary } = weeklyAchievementRows(w);
  if (rows.length === 0) return null;
  const current = weekOf(todayKey()).start === w.start;
  const achieved = allGoalsReached(w);
  const streakText = streak ? weekStreakText(streak, current) : null;
  const status = [achieved && '設定の目標をすべて達成', streakText].filter(Boolean).join('。');
  const footer = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: -8 }}>
      <View accessible={status !== ''} accessibilityLabel={status || undefined} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: 8, rowGap: 2 }}>
        {achieved && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }} testID="report-goals-achieved">
            <Icon name="check" size={16} color={colors.accent} />
            <T bold size={14} color={colors.accent}>達成</T>
          </View>
        )}
        {streakText && <T size={13} color={colors.sub} testID="report-goal-streak">{streakText}</T>}
      </View>
      <Button label="目標を変える ›" accessibilityLabel="目標を変える" variant="text" small onPress={openGoalSettings}
        style={{ paddingLeft: 12, paddingRight: 12, marginRight: -12 }} testID="report-goals-edit" />
    </View>
  );
  return (
    <AchievementCard title={current ? '今週の目標' : 'この週の目標'} right={summary} index={index} testID="report-achievement" footer={footer}>
      {rows.map((r) => <AchievementLine key={r.key} row={r} />)}
    </AchievementCard>
  );
}

/**
 * レポートのタブの「やること」のいちばん上の「今週の目標」（今週の途中経過）。設定で決める目標（筋トレ・食事の記録・睡眠（切でなければ））だけを、
 * 数字と細い棒で（届いた行はチェックの印も）。すべて届いたら題の右に「✓ 達成」、下に連続。カード全体を押すと設定の今週の目標の欄へ
 */
export function WeeklyGoalsNowCard({ today }: { today: DateKey }) {
  const { data: w } = useWeeklyAchievement(today);
  const { data: streak } = useGoalStreak(today);
  if (!w) return null;
  const rows = settingGoalRows(w);
  const achieved = allGoalsReached(w);
  const streakText = streak ? weekStreakText(streak, true) : null;
  return (
    <PressableScale
      scaleTo={0.98} accessibilityRole="button" accessibilityLabel={weeklyGoalCardLabel(achieved, rows, streakText)} onPress={openGoalSettings}
      style={{ backgroundColor: colors.card, borderRadius: radius.card, padding: 16, gap: 10, marginTop: space.l }} testID="tab-weekly-goals"
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <T bold size={15} style={{ flex: 1 }}>今週の目標</T>
        {achieved && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }} testID="tab-goals-achieved">
            <Icon name="check" size={16} color={colors.accent} />
            <T bold size={13} color={colors.accent}>達成</T>
          </View>
        )}
        <Icon name="chevron" size={18} color={colors.sub} />
      </View>
      {rows.map((r) => (
        <View key={r.key} style={{ gap: 6 }} testID={`tab-goal-${r.key}`}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
            <View style={{ width: 16, alignSelf: 'center' }}>{r.mark === 'reached' && <Icon name="check" size={16} color={colors.text} />}</View>
            <T size={13} style={{ flex: 1 }} numberOfLines={1}>{r.label}</T>
            <T num bold size={16}>{r.value}</T>
            <T size={12} color={colors.sub}>／{r.goal} {r.unit}</T>
          </View>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.input, overflow: 'hidden' }}>
            <GrowBar ratio={r.ratio ?? 0} style={{ height: 6, borderRadius: 3, backgroundColor: colors.accent }} />
          </View>
        </View>
      ))}
      {streakText && <T size={12} color={colors.sub} testID="tab-goal-streak">{streakText}</T>}
    </PressableScale>
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
