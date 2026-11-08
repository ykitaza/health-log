import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, IconName } from '@/components/Icon';
import { MonthCalendar } from '@/components/MonthCalendar';
import { Screen } from '@/components/Screen';
import { T } from '@/components/Text';
import { Button, Card, IconButton, SetNo } from '@/components/ui';
import { useFocusData } from '@/hooks/data';
import { formatJpDate, MONTH_NAMES_EN, todayKey, yearMonth } from '@/lib/date';
import { formatSetLong, tonnes } from '@/lib/format';
import { bestSet, daysInMonth, periodTotals, trainingDates, Vehicle, vehicleRatio, weeklyVolumes } from '@/lib/training';
import { fmt1, kgToUnit } from '@/lib/units';
import { colors } from '@/theme';

const WEEK_LABELS = ['今週', '1週前', '2週前', '3週前', '4週前', '5週前'];
const VEHICLE_ICON: Record<Vehicle, IconName> = { car: 'car', bus: 'bus', jumbo: 'plane' };

export default function HomeScreen() {
  const today = todayKey();
  const { data } = useFocusData(async (r) => {
    const [rows, todays, settings] = await Promise.all([r.workouts.allSetRows(), r.workouts.getDay(today), r.settings.get()]);
    return { rows, todays, settings };
  }, [today]);

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
        <T bold size={18}>トレログ</T>
        <View style={{ width: 44 }} />
      </View>

      <Card style={{ flexDirection: 'row', gap: 10, padding: 12 }}>
        <View style={{ flex: 1.55 }}>
          <T num bold size={28} style={{ marginBottom: 8 }}>{MONTH_NAMES_EN[month - 1]} {year}</T>
          <MonthCalendar year={year} month={month} today={today} marked={new Set(dates)} cell={29} testID="home-calendar" />
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
      </Card>

      <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
        <Button label="本日のトレーニングを追加" icon="plus" onPress={() => router.push({ pathname: '/workout', params: { date: today } })} style={{ flex: 1 }} />
        <Button label="RM計算機" icon="calc" variant="outline" onPress={() => router.push('/rm')} />
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 22, marginBottom: 10 }}>
        <T bold size={17}>今日の記録</T>
        <T size={13} color={colors.sub}>{formatJpDate(today)}</T>
      </View>
      {data && data.todays.length === 0 && (
        <Card><T color={colors.sub} size={13}>まだ今日の記録はありません。「本日のトレーニングを追加」から始めましょう。</T></Card>
      )}
      <View style={{ gap: 10 }}>
        {data?.todays.map((e) => {
          const best = bestSet(e.sets);
          return (
            <Pressable key={e.id} onPress={() => router.push({ pathname: '/workout', params: { date: today } })}>
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
            </Pressable>
          );
        })}
      </View>
    </Screen>
  );
}

function VolumeCard({ testID, title, kg, vehicle, unit, children }: { testID: string; title: string; kg: number; vehicle: Vehicle; unit: 'kg' | 'lb'; children?: React.ReactNode }) {
  return (
    <View style={s.volume} testID={testID}>
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
