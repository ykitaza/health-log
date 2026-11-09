import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, IconName } from '@/components/Icon';
import { MonthCalendar } from '@/components/MonthCalendar';
import { PressableScale } from '@/components/motion';
import { Screen } from '@/components/Screen';
import { T } from '@/components/Text';
import { Button, Card, IconButton, SetNo } from '@/components/ui';
import { useFocusData } from '@/hooks/data';
import { useToday } from '@/hooks/today';
import { DateKey, formatJpDate, formatMonthDay, MONTH_NAMES_EN, pickedDayOrToday, yearMonth } from '@/lib/date';
import { formatSetLong, tonnes } from '@/lib/format';
import { bestSet, daysInMonth, periodTotals, trainingDates, Vehicle, vehicleRatio, weeklyVolumes } from '@/lib/training';
import { fmt1, kgToUnit } from '@/lib/units';
import { touchRoom } from '@/lib/touch';
import { colors } from '@/theme';

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
  const { data } = useFocusData(async (r) => {
    const [rows, todays, settings] = await Promise.all([r.workouts.allSetRows(), r.workouts.getDay(selected), r.settings.get()]);
    return { rows, todays, settings, day: selected };
  }, selected);
  // 日を選び直した直後は、読み終わるまで前の日の記録を出さない
  const dayEntries = data?.day === selected ? data.todays : null;

  const { year, month } = yearMonth(today);
  const rows = data?.rows ?? [];
  const unit = data?.settings.weightUnit ?? 'kg';
  const dates = trainingDates(rows);
  const totals = periodTotals(rows, today);
  const weekly = weeklyVolumes(rows, today, 6);
  const maxWeek = Math.max(1, ...weekly);

  return (
    <Screen tab>
      <View style={s.topBar}>
        <IconButton name="gear" label="設定" onPress={() => router.push('/settings')} bg="transparent" />
        <T bold size={18} accessibilityLabel="hlog" accessibilityRole="header">hl<T bold size={18} color={colors.accent}>o</T>g</T>
        <View style={{ width: 44 }} />
      </View>

      <View style={{ flexDirection: 'row', gap: 10, paddingTop: 12 }}>
        <View style={{ flex: 1.55 }}>
          <T num bold size={28} style={{ marginBottom: 8 }}>{MONTH_NAMES_EN[month - 1]} {year}</T>
          <MonthCalendar
            year={year} month={month} today={today} marked={new Set(dates)} cell={29} testID="home-calendar"
            selected={selected} maxDate={today} onPressDay={(d) => setPicked(d === today ? null : d)}
          />
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

        <View style={{ flex: 1, gap: 8 }}>
          <VolumeCard testID="volume-7d" title="合計負荷量／7日間" kg={totals.last7} vehicle="car" unit={unit}>
            <View style={{ gap: 3, marginTop: 8 }}>
              {weekly.map((v, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <T size={9} color={i === 0 ? colors.text : colors.sub} style={{ width: 30 }}>{WEEK_LABELS[i]}</T>
                  <View style={{ flex: 1, height: 6 }}>
                    <View testID={`week-bar-${i}`} style={{ width: `${(v / maxWeek) * 100}%`, height: 6, borderRadius: 3, backgroundColor: i === 0 ? colors.accent : '#2F7A52' }} />
                  </View>
                </View>
              ))}
            </View>
          </VolumeCard>
          <VolumeCard testID="volume-28d" title="合計負荷量／28日間" kg={totals.last28} vehicle="bus" unit={unit} />
          <VolumeCard testID="volume-total" title="総合計負荷量" kg={totals.total} vehicle="jumbo" unit={unit} />
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
        <Button
          label={isToday ? '本日のトレーニングを追加' : `${dayLabel}のトレーニングを追加`}
          icon="plus"
          onPress={() => router.push({ pathname: '/workout', params: { date: selected } })}
          style={{ flex: 1 }}
        />
        <Button label="RM計算機" icon="calc" variant="outline" onPress={() => router.push('/rm')} />
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', ...touchRoom(15, { top: 22, bottom: 10 }) }}>
        <T bold size={17}>{dayLabel}の記録</T>
        {isToday ? (
          <T size={13} color={colors.sub}>{formatJpDate(today)}</T>
        ) : (
          <Pressable accessibilityRole="button" onPress={() => setPicked(null)} hitSlop={{ top: 15, bottom: 15, left: 8, right: 8 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Icon name="calendar" size={15} color={colors.accent} />
            <T bold size={13} color={colors.accent}>今日に戻る</T>
          </Pressable>
        )}
      </View>
      {dayEntries?.length === 0 && (
        <Card>
          <T color={colors.sub} size={13}>
            {isToday
              ? 'まだ今日の記録はありません。「本日のトレーニングを追加」から始めましょう。'
              : `${formatJpDate(selected)}の記録はありません。「${dayLabel}のトレーニングを追加」から記録できます。`}
          </T>
        </Card>
      )}
      <View style={{ gap: 10 }}>
        {dayEntries?.map((e) => {
          const best = bestSet(e.sets);
          return (
            <PressableScale key={e.id} accessibilityRole="button" accessibilityLabel={`${e.exerciseName}の記録を開く`} scaleTo={0.98} onPress={() => router.push({ pathname: '/workout', params: { date: selected } })}>
              <Card>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                  <T bold size={16} style={{ flex: 1 }}>{e.exerciseName}</T>
                  {best && <T bold size={13} color={colors.accent}>推定1RM {fmt1(kgToUnit(best.e1rm, unit))}{unit}</T>}
                </View>
                {e.sets.map((st, i) => (
                  <View key={st.id} style={{ marginTop: 4 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      <SetNo n={i + 1} />
                      <T num bold size={17}>{formatSetLong(st.weightKg, st.reps, unit)}</T>
                    </View>
                    {st.memo !== '' && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 34, marginTop: 2 }}>
                        <Icon name="pencil" size={13} color={colors.sub} />
                        <T size={12} color={colors.sub}>{st.memo}</T>
                      </View>
                    )}
                  </View>
                ))}
              </Card>
            </PressableScale>
          );
        })}
      </View>
    </Screen>
  );
}

function VolumeCard({ testID, title, kg, vehicle, unit, children }: { testID: string; title: string; kg: number; vehicle: Vehicle; unit: 'kg' | 'lb'; children?: React.ReactNode }) {
  return (
    <View style={s.volume} testID={testID} accessible accessibilityLabel={`${title} ${tonnes(kg, unit)}${unit === 'kg' ? 'トン' : '千ポンド'}`}>
      <T size={10} color={colors.sub}>{title}</T>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
        <T num bold size={26}>{tonnes(kg, unit)}</T>
        <T size={10} color={colors.sub}>{unit === 'kg' ? 't' : 'k lb'}</T>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 4 }}>
        <Icon name={VEHICLE_ICON[vehicle]} size={18} color={colors.accent} />
        <T num bold size={15} color={colors.accent}>× {vehicleRatio(kg, vehicle).toFixed(1)}</T>
      </View>
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
  archive: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', borderTopWidth: 1, borderTopColor: colors.line, borderStyle: 'dashed', marginTop: 10, paddingTop: 10 },
  volume: { backgroundColor: colors.input, borderRadius: 12, padding: 10 },
});
