import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, IconName } from '@/components/Icon';
import { LoadError } from '@/components/LoadError';
import { MonthCalendar } from '@/components/MonthCalendar';
import { PressableScale, RollNumber } from '@/components/motion';
import { LatestReportCard } from '@/components/reports';
import { Screen } from '@/components/Screen';
import { T } from '@/components/Text';
import { Badge, Button, Fab, TabHeader } from '@/components/ui';
import type { HeartRateDay, SleepDay } from '@/db/repositories/health';
import { useBackToToday } from '@/hooks/backToToday';
import { useFocusData } from '@/hooks/data';
import { useToday } from '@/hooks/today';
import { DateKey, formatJpDate, formatMonthDay, MONTH_NAMES_EN, pickedDayOrToday, yearMonth } from '@/lib/date';
import { formatMinutes } from '@/lib/health';
import { DAY_TYPE_LABELS, DaySummary } from '@/lib/meals';
import { tonnes } from '@/lib/format';
import { daysInMonth, periodTotals, totalVolume, trainingDates, Vehicle, vehicleRatio, weeklyVolumes } from '@/lib/training';
import { fmt1, fmtInt, kgToUnit } from '@/lib/units';
import { colors, radius, size, space } from '@/theme';

const WEEK_LABELS = ['今週', '1週前', '2週前', '3週前', '4週前', '5週前'];
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
  const { data, error, reload } = useFocusData(async (r) => {
    const [rows, todays, settings, meals, daily, sleep, heart] = await Promise.all([
      r.workouts.allSetRows(), r.workouts.getDay(selected), r.settings.get(), r.meals.summaries(selected, selected),
      r.body.listDaily(), r.health.sleepDay(selected), r.health.heartRateDay(selected),
    ]);
    const weightKg = daily.find((d) => d.date === selected)?.weightKg ?? null;
    return { rows, todays, settings, meal: meals.days[0] ?? null, weightKg, sleep, heart, day: selected };
  }, selected);
  // 日を選び直した直後は、読み終わるまで前の日の記録を出さない
  const dayEntries = data?.day === selected ? data.todays : null;
  const meal = data?.day === selected ? data.meal : null;

  const { year, month } = yearMonth(today);
  const rows = data?.rows ?? [];
  const unit = data?.settings.weightUnit ?? 'kg';
  const dates = trainingDates(rows);
  const totals = periodTotals(rows, today);
  const weekly = weeklyVolumes(rows, today, 6);
  const maxWeek = Math.max(1, ...weekly);

  if (error) return <Screen tab><LoadError onRetry={reload} /></Screen>;

  return (
    <View style={{ flex: 1 }}>
    <Screen tab bottomSpace={size.fab + space.l * 2}>
      <TabHeader title="hlog" titleNode={<T variant="headlineS" accessibilityLabel="hlog" accessibilityRole="header">hl<T variant="headlineS" color={colors.accent}>o</T>g</T>} actions={<Button label="RM計算機" icon="calc" variant="text" small onPress={() => router.push('/rm')} />} />

      <View style={{ flexDirection: 'row', gap: 10, paddingTop: 12 }}>
        {/* 左右の列の下の端をそろえる：短いほうの列も下まで伸ばし、最後の要素を下に寄せる */}
        <View style={{ flex: 1.55 }}>
          <T num bold size={28} style={{ marginBottom: 8 }}>{MONTH_NAMES_EN[month - 1]} {year}</T>
          <MonthCalendar
            year={year} month={month} today={today} marked={new Set(dates)} cell={29} testID="home-calendar"
            selected={selected} maxDate={today} onPressDay={(d) => setPicked(d === today ? null : d)}
          />
          <View style={{ flexGrow: 1 }} />
          <View style={s.archive} testID="archive">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <T num bold size={14} style={{ lineHeight: 15 }}>{'MONTHLY\nARCHIVE'}</T>
              <View style={{ width: 2, height: 30, backgroundColor: colors.text }} />
              <T num bold size={36}>{daysInMonth(dates, year, month)}</T>
              <T num size={14}>days</T>
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
          <VolumeCard testID="volume-7d" title="合計負荷量／7日間" kg={totals.last7} vehicle="car" unit={unit} ready={data != null}>
            <View style={{ gap: 3, marginTop: 8 }}>
              {weekly.map((v, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <T variant="labelS" bold={i === 0} color={i === 0 ? colors.text : colors.sub} style={{ width: 34 }}>{WEEK_LABELS[i]}</T>
                  <View style={{ flex: 1, height: 6 }}>
                    <View testID={`week-bar-${i}`} style={{ width: `${(v / maxWeek) * 100}%`, height: 6, borderRadius: 3, backgroundColor: i === 0 ? colors.accent : colors.accentMuted }} />
                  </View>
                </View>
              ))}
            </View>
          </VolumeCard>
          <VolumeCard testID="volume-28d" title="合計負荷量／28日間" kg={totals.last28} vehicle="bus" unit={unit} ready={data != null} />
          <VolumeCard testID="volume-total" title="総合計負荷量" kg={totals.total} vehicle="jumbo" unit={unit} ready={data != null} />
        </View>
      </View>

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
          body={data?.day === selected ? conditionLine(data.weightKg, data.sleep, data.heart, unit) : ''}
          onPress={() => router.navigate({ pathname: '/body', params: { date: selected } })}
        />
      </View>
      <LatestReportCard />
    </Screen>
    <Fab
      label={isToday ? '今日のトレーニングを追加' : `${dayLabel}のトレーニングを追加`}
      onPress={() => router.push({ pathname: '/workout', params: { date: selected } })}
      style={s.fab}
    />
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

/** ホームの小さなカード（今日のトレーニング・食事・体調）。押すとそれぞれの画面へ */
function SummaryCard({ testID, icon, title, badge, body, onPress }: {
  testID: string; icon: IconName; title: string; badge?: string; body: string; onPress: () => void;
}) {
  return (
    <PressableScale testID={testID} accessibilityRole="button" accessibilityLabel={`${title}を開く。${badge ? `${badge}。` : ''}${body}`} scaleTo={0.98} onPress={onPress} style={s.summary}>
      <View style={s.summaryIcon}><Icon name={icon} size={24} color={colors.onAccentDark} /></View>
      <View style={{ flex: 1, gap: space.xs }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
          <T variant="titleM" style={{ flexShrink: 1 }} numberOfLines={1}>{title}</T>
          {badge && <Badge label={badge} />}
        </View>
        <T variant="bodyM" color={colors.sub}>{body}</T>
      </View>
      <Icon name="chevron" size={24} color={colors.sub} />
    </PressableScale>
  );
}

function VolumeCard({ testID, title, kg, vehicle, unit, ready, children }: {
  testID: string; title: string; kg: number; vehicle: Vehicle; unit: 'kg' | 'lb'; ready: boolean; children?: React.ReactNode;
}) {
  return (
    <View style={s.volume} testID={testID} accessible accessibilityLabel={`${title} ${tonnes(kg, unit)}${unit === 'kg' ? 'トン' : '千ポンド'}`}>
      <T variant="labelS" color={colors.sub}>{title}</T>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
        {/* 読み込みが終わる前の 0 から変わるときは動かさない（ready） */}
        <RollNumber num bold size={26} value={tonnes(kg, unit)} ready={ready} />
        <T variant="labelS" color={colors.sub}>{unit === 'kg' ? 't' : 'k lb'}</T>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 4 }}>
        <Icon name={VEHICLE_ICON[vehicle]} size={18} color={colors.accent} />
        <RollNumber num bold size={15} color={colors.accent} prefix="× " value={vehicleRatio(kg, vehicle).toFixed(1)} ready={ready} />
      </View>
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  pickedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.s },
  summary: { flexDirection: 'row', alignItems: 'center', gap: space.l, backgroundColor: colors.card, borderRadius: radius.l, padding: space.l, minHeight: 80 },
  summaryIcon: { width: 40, height: 40, borderRadius: radius.m, backgroundColor: colors.accentDark, alignItems: 'center', justifyContent: 'center' },
  fab: { position: 'absolute', right: space.l, bottom: space.l },
  archive: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', borderTopWidth: 1, borderTopColor: colors.line, borderStyle: 'dashed', marginTop: 10, paddingTop: 10 },
  volume: { backgroundColor: colors.input, borderRadius: 12, padding: 10 },
});
