import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Sparkline } from '@/components/charts';
import { CalendarLegend, ReceivedNotice, RecordSheet, WeeklyGoalCard, WeeklyTodoCard } from '@/components/home';
import { Icon, IconName } from '@/components/Icon';
import { LoadError } from '@/components/LoadError';
import { MonthCalendar } from '@/components/MonthCalendar';
import { PressableScale, RollNumber } from '@/components/motion';
import { LatestReportCard } from '@/components/reports';
import { ReportSuggestion } from '@/components/ReportSuggestion';
import { Screen } from '@/components/Screen';
import { SyncAlertLine } from '@/components/SyncStatus';
import { T } from '@/components/Text';
import { Badge, Button, Fab, TabHeader } from '@/components/ui';
import type { HeartRateDay, SleepDay } from '@/db/repositories/health';
import { useBackToToday } from '@/hooks/backToToday';
import { useFocusData } from '@/hooks/data';
import { useToday } from '@/hooks/today';
import { datePoints } from '@/lib/chart';
import { DateKey, formatJpDate, formatMonthDay, MONTH_NAMES_EN, monthMatrix, pickedDayOrToday, yearMonth } from '@/lib/date';
import { big3Assignments } from '@/lib/exercises';
import { formatMinutes } from '@/lib/health';
import { goalLine, homeBig3, signedChange, sleepNote, thisWeekVolume } from '@/lib/home';
import { DAY_TYPE_LABELS, DaySummary } from '@/lib/meals';
import { tonnes } from '@/lib/format';
import { MISSING_BODYWEIGHT_NOTE, recentMissingBodyweight } from '@/lib/bodyweight';
import { daysInMonth, totalVolume, TrainingSetRow, trainingDates, Vehicle, vehicleRatio } from '@/lib/training';
import { fmt1, fmtInt, kgToUnit } from '@/lib/units';
import { colors, radius, size, space, toneColors } from '@/theme';

const VEHICLE_ICON: Record<Vehicle, IconName> = { car: 'car', bus: 'bus', jumbo: 'plane' };

export default function HomeScreen() {
  // 開いたまま日をまたいでも、前の日を「今日」として出さない（前の日に記録を足してしまうため）
  const today = useToday();
  // カレンダーで選んだ日（過去の日の記録を見る・足す）。null なら今日。未来の日は選べない
  const [picked, setPicked] = useState<DateKey | null>(null);
  const selected = pickedDayOrToday(picked, today);
  const isToday = selected === today;
  const dayLabel = isToday ? '今日' : formatMonthDay(selected);
  // 過去の日を見ているときは、Android の戻るでまず今日に戻す
  useBackToToday(isToday, () => setPicked(null));
  const [recording, setRecording] = useState(false);
  const { year, month } = yearMonth(today);
  const { data, error, reload } = useFocusData(async (r) => {
    // カレンダーに出す月の、食事を記録した日（点を付ける）
    const cells = monthMatrix(year, month).flat().filter((d) => d.inMonth);
    const [rows, todays, settings, meals, daily, sleep, heart, monthMeals, exercises] = await Promise.all([
      r.workouts.allSetRows(), r.workouts.getDay(selected), r.settings.get(), r.meals.summaries(selected, selected),
      r.body.listDaily(), r.health.sleepDay(selected), r.health.heartRateDay(selected),
      r.meals.summaries(cells[0].key, cells[cells.length - 1].key),
      // BIG3 の割り当て（筋トレの推移のグラフと同じく、非表示の種目も）
      r.catalog.listExercises({ includeHidden: true }),
    ]);
    const weightKg = daily.find((d) => d.date === selected)?.weightKg ?? null;
    const mealDates = new Set(monthMeals.days.filter((d) => d.meals.length > 0).map((d) => d.date));
    return { rows, todays, settings, meal: meals.days[0] ?? null, weightKg, sleep, heart, day: selected, mealDates, big3: big3Assignments(exercises) };
  }, `${selected}|${today}`);
  // 日を選び直した直後は、読み終わるまで前の日の記録を出さない
  const dayEntries = data?.day === selected ? data.todays : null;
  const meal = data?.day === selected ? data.meal : null;

  const rows = data?.rows ?? [];
  const unit = data?.settings.weightUnit ?? 'kg';
  const dates = trainingDates(rows);
  const weekVolume = thisWeekVolume(rows, today);
  const condition = data?.day === selected ? data : null;
  // 寝不足の日のひとこと（今日だけ。今日の体調と同じ、その日に起きた睡眠）
  const sleepy = isToday ? sleepNote(condition?.sleep?.asleepMin) : null;

  if (error) return <Screen tab><LoadError onRetry={reload} /></Screen>;

  return (
    <View style={{ flex: 1 }}>
    <Screen tab fab bottomSpace={size.fab + space.l * 2}>
      <TabHeader title="hlog" titleNode={<T variant="headlineS" accessibilityLabel="hlog" accessibilityRole="header">hl<T variant="headlineS" color={colors.accent}>o</T>g</T>} />
      {/* 同期が続けて失敗しているときだけ、見出しの下に1行で知らせる（ふだんは出さない。時刻と未送信の件数はアカウントの画面） */}
      <SyncAlertLine />

      <View style={{ flexDirection: 'row', gap: 10, paddingTop: 12 }}>
        {/* 左右の列の下の端をそろえる：短いほうの列も下まで伸ばし、最後の要素を下に寄せる */}
        <View style={{ flex: 1.55 }}>
          {/* 大きさは Figma（ホーム 1. ホーム）に合わせる：見出し 30、日の丸 26、行の間 8、曜日の下に線 */}
          <T num bold size={30} style={{ marginBottom: 4 }}>{MONTH_NAMES_EN[month - 1]} {year}</T>
          <MonthCalendar
            year={year} month={month} today={today} marked={new Set(dates)} dotted={data?.mealDates} cell={26} rowGap={8} divider testID="home-calendar"
            selected={selected} maxDate={today} onPressDay={(d) => setPicked(d === today ? null : d)}
          />
          <CalendarLegend />
          <View style={{ flexGrow: 1 }} />
          <View style={s.archive} testID="archive">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <T num bold size={15} style={{ lineHeight: 14 }}>{'MONTHLY\nARCHIVE'}</T>
              <View style={{ width: 2, height: 30, backgroundColor: colors.text }} />
              <T num bold size={36}>{daysInMonth(dates, year, month)}</T>
              <T num size={15}>days</T>
            </View>
            <View style={{ alignItems: 'center' }}>
              <T num bold size={12}>TOTAL</T>
              <View style={{ backgroundColor: colors.accent, borderRadius: 6, paddingHorizontal: 6 }}>
                <T num bold size={18} color={colors.onAccent}>{dates.length} days</T>
              </View>
            </View>
          </View>
        </View>

        <View style={{ flex: 1, gap: 8, justifyContent: 'space-between' }}>
          {/* 今週は月曜始まり（lib/date.ts の weekStart） */}
          <VolumeCard testID="volume-week" title="合計負荷量／今週" kg={weekVolume} vehicle="car" unit={unit} ready={data != null} />
          <Big3Card rows={rows} assignments={data?.big3 ?? null} today={today} unit={unit} />
          <WeeklyGoalCard today={today} />
        </View>
      </View>
      <ReportSuggestion />

      {data != null && recentMissingBodyweight(rows, today) && (
        <T variant="bodyS" color={colors.sub} style={{ marginTop: space.s }} testID="missing-bodyweight">{MISSING_BODYWEIGHT_NOTE}</T>
      )}
      {!isToday && (
        <View style={s.pickedRow}>
          <T variant="bodyM" color={colors.sub}>{formatJpDate(selected)}を表示しています</T>
          <Button label="今日に戻る" icon="calendar" variant="text" small onPress={() => setPicked(null)} style={{ paddingLeft: 12, paddingRight: 12 }} />
        </View>
      )}
      <View style={{ gap: space.l, marginTop: isToday ? space.l : space.s }}>
        <SummaryCard
          testID="home-training"
          icon="dumbbell"
          title={`${dayLabel}のトレーニング`}
          body={dayEntries == null ? '' : dayEntries.length === 0
            ? 'まだ記録がありません'
            : `${dayEntries.length}種目 ・ ${dayEntries.reduce((n, e) => n + e.sets.length, 0)}セット ・ ${tonnes(dayEntries.reduce((n, e) => n + totalVolume(e.sets), 0), unit)} ${unit === 'kg' ? 't' : 'k lb'}`}
          note={sleepy ?? undefined}
          onPress={() => router.push({ pathname: '/workout', params: { date: selected } })}
        />
        <SummaryCard
          testID="home-meals"
          icon="meal"
          title={`${dayLabel}の食事`}
          badge={meal ? DAY_TYPE_LABELS[meal.dayType] : undefined}
          body={meal == null ? '' : mealLine(meal)}
          onPress={() => router.navigate({ pathname: '/meals', params: { date: selected } })}
        />
        <SummaryCard
          testID="home-condition"
          icon="scale"
          title={`${dayLabel}の体調`}
          body={condition ? conditionLine(condition.weightKg, condition.sleep, condition.heart, unit) : ''}
          sub={condition ? goalLine(condition.weightKg, condition.settings.goalWeightKg ?? null, unit) ?? undefined : undefined}
          onPress={() => router.navigate({ pathname: '/body', params: { date: selected } })}
        />
        <WeeklyTodoCard today={today} />
      </View>
      <LatestReportCard />
    </Screen>
    <Fab label="記録する" onPress={() => setRecording(true)} style={s.fab} testID="home-record" />
    <ReceivedNotice bottom={size.fab + space.l * 2} />
    <RecordSheet visible={recording} date={selected} today={today} onClose={() => setRecording(false)} />
    </View>
  );
}

/** 食事のカードの1行：目標があれば kcal とたんぱく質の残り、なければ食べた kcal */
function mealLine(d: DaySummary): string {
  const r = d.remaining;
  if (r?.kcal == null) return `${fmtInt(d.total.kcal)} kcal${d.meals.length === 0 ? ' ・ まだ記録がありません' : ''}`;
  const left = (n: number, u: string) => (n >= 0 ? `残り ${fmtInt(n)} ${u}` : `${fmtInt(-n)} ${u} 超え`);
  return [left(r.kcal, 'kcal'), r.protein_g != null ? `たんぱく質 ${left(r.protein_g, 'g')}` : null].filter(Boolean).join(' ・ ');
}

/** 体調のカードの1行：体重・睡眠・安静時心拍（ない値は出さない） */
function conditionLine(weightKg: number | null, sleep: SleepDay | null, heart: HeartRateDay | null, unit: 'kg' | 'lb'): string {
  const parts = [
    weightKg != null ? `体重 ${fmt1(kgToUnit(weightKg, unit))} ${unit}` : null,
    sleep ? `睡眠 ${formatMinutes(sleep.asleepMin)}` : null,
    heart?.restingBpm != null ? `安静時 ${Math.round(heart.restingBpm)} 拍/分` : null,
  ].filter(Boolean);
  return parts.length === 0 ? 'まだ記録がありません' : parts.join(' ・ ');
}

/**
 * ホームの小さなカード（今日のトレーニング・食事・体調）。押すとそれぞれの画面へ。
 * sub は2行目（体調の目標体重まで）、note は注意の色のひとこと（寝不足の日。月のアイコン付き）
 */
function SummaryCard({ testID, icon, title, badge, body, sub, note, onPress }: {
  testID: string; icon: IconName; title: string; badge?: string; body: string; sub?: string; note?: string; onPress: () => void;
}) {
  return (
    <PressableScale testID={testID} accessibilityRole="button" accessibilityLabel={`${title}を開く。${badge ? `${badge}。` : ''}${[body, sub, note].filter(Boolean).join('。')}`} scaleTo={0.98} onPress={onPress} style={s.summary}>
      <View style={s.summaryIcon}><Icon name={icon} size={24} color={colors.onAccentDark} /></View>
      <View style={{ flex: 1, gap: space.xs }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
          <T variant="titleM" style={{ flexShrink: 1 }} numberOfLines={1}>{title}</T>
          {badge && <Badge label={badge} />}
        </View>
        <T variant="bodyM" color={colors.sub}>{body}</T>
        {sub && <T variant="bodyM" color={colors.sub}>{sub}</T>}
        {note && (
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.xs }} testID={`${testID}-note`}>
            {/* 1行目の文字の高さ（20）のまん中に置く */}
            <View style={{ height: 20, justifyContent: 'center' }}><Icon name="moon" size={16} color={toneColors.caution.accent} /></View>
            <T variant="bodyM" bold color={toneColors.caution.accent} style={{ flexShrink: 1 }}>{note}</T>
          </View>
        )}
      </View>
      <Icon name="chevron" size={24} color={colors.sub} />
    </PressableScale>
  );
}

/**
 * BIG3 推定1RM 合計（筋トレの推移の「BIG3 の推定1RM（合計）」と同じ計算）。大きな数字、3か月の折れ線、先月との差。
 * 押すと筋トレの推移。3種目がそろうまでは「—」と、記録がまだないこと
 */
function Big3Card({ rows, assignments, today, unit }: {
  rows: TrainingSetRow[]; assignments: Parameters<typeof homeBig3>[1] | null; today: DateKey; unit: 'kg' | 'lb';
}) {
  const big3 = assignments ? homeBig3(rows, assignments, today) : null;
  const total = big3 ? fmt1(kgToUnit(big3.totalKg, unit)) : null;
  const change = big3?.diffKg != null ? signedChange(kgToUnit(big3.diffKg, unit)) : null;
  const changeColor = change?.dir === 'down' ? colors.danger : colors.accent;
  const label = assignments == null ? 'BIG3 推定1RM 合計'
    : total == null ? 'BIG3 推定1RM 合計。BIG3 の記録がまだありません'
    : `BIG3 推定1RM 合計 ${total}${unit}。${change ? `先月より ${change.text}${unit}` : '先月の記録なし'}`;
  return (
    <PressableScale
      testID="home-big3" accessibilityRole="button" accessibilityLabel={`${label}。筋トレの推移を開く`} scaleTo={0.98}
      onPress={() => router.navigate({ pathname: '/training', params: { view: 'trend' } })} style={[s.volume, { flexGrow: 1 }]}
    >
      <T variant="labelS" color={colors.sub} style={{ lineHeight: 13 }}>BIG3 推定1RM 合計</T>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
        {total != null ? (
          <>
            <RollNumber num bold size={22} value={total} ready={assignments != null} />
            <T variant="labelS" color={colors.sub}>{unit}</T>
          </>
        ) : <T num bold size={22}>—</T>}
      </View>
      {big3 ? (
        <>
          {/* 列の高さの余りはこのカードが受け、折れ線と差は下に寄せる */}
          <View style={{ flexGrow: 1, justifyContent: 'flex-end' }}>
            <Sparkline points={datePoints(big3.points, (p) => kgToUnit(p.total, unit), big3.from, today)} animKey="home-big3" />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 4, flexWrap: 'wrap' }} testID="home-big3-change">
            {change ? (
              <>
                <Icon name={change.dir === 'up' ? 'arrowUp' : change.dir === 'down' ? 'arrowDown' : 'arrowFlat'} size={14} color={changeColor} />
                <T variant="labelS" bold color={changeColor}>{change.text} {unit}</T>
                <T variant="labelS" bold={false} color={colors.sub}>先月より</T>
              </>
            ) : <T variant="labelS" bold={false} color={colors.sub}>先月の記録なし</T>}
          </View>
        </>
      ) : assignments != null && (
        <T variant="labelS" bold={false} color={colors.sub}>BIG3 の記録がまだありません</T>
      )}
    </PressableScale>
  );
}

function VolumeCard({ testID, title, kg, vehicle, unit, ready }: {
  testID: string; title: string; kg: number; vehicle: Vehicle; unit: 'kg' | 'lb'; ready: boolean;
}) {
  return (
    <View style={s.volume} testID={testID} accessible accessibilityLabel={`${title} ${tonnes(kg, unit)}${unit === 'kg' ? 'トン' : '千ポンド'}`}>
      <T variant="labelS" color={colors.sub} style={{ lineHeight: 13 }}>{title}</T>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
        {/* 読み込みが終わる前の 0 から変わるときは動かさない（ready） */}
        <RollNumber num bold size={22} value={tonnes(kg, unit)} ready={ready} />
        <T variant="labelS" color={colors.sub}>{unit === 'kg' ? 't' : 'k lb'}</T>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 4 }}>
        <Icon name={VEHICLE_ICON[vehicle]} size={18} color={colors.accent} />
        <RollNumber num bold size={13} color={colors.accent} prefix="× " value={vehicleRatio(kg, vehicle).toFixed(1)} ready={ready} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  pickedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.s },
  summary: { flexDirection: 'row', alignItems: 'center', gap: space.l, backgroundColor: colors.card, borderRadius: radius.l, padding: space.l, minHeight: 80 },
  summaryIcon: { width: 40, height: 40, borderRadius: radius.m, backgroundColor: colors.accentDark, alignItems: 'center', justifyContent: 'center' },
  fab: { position: 'absolute', right: space.l, bottom: space.l },
  archive: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', borderTopWidth: 1, borderTopColor: colors.line, borderStyle: 'dashed', marginTop: 10, paddingTop: 10 },
  volume: { backgroundColor: colors.input, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 10, gap: 2 },
});
