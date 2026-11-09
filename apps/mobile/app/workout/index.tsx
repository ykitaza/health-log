import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Icon } from '@/components/Icon';
import { PressableScale } from '@/components/motion';
import { Screen } from '@/components/Screen';
import { T } from '@/components/Text';
import { Button, Card, ConfirmDialog, DayNote, EmptyState, Header, IconButton, SetNo } from '@/components/ui';
import type { Entry } from '@/db/repositories/workouts';
import { useFocusData } from '@/hooks/data';
import { formatJpDate, todayKey } from '@/lib/date';
import { formatSetLong, tonnes } from '@/lib/format';
import { bestSet, totalVolume } from '@/lib/training';
import { fmt1, kgToUnit } from '@/lib/units';
import { colors } from '@/theme';

/** 今日（またはその日）のトレーニング。種目は実施した順に並ぶ */
export default function WorkoutDayScreen() {
  const params = useLocalSearchParams<{ date?: string }>();
  const today = todayKey();
  const date = params.date ?? today;
  const isToday = date === today;
  const { data, reload, repos } = useFocusData(async (r) => {
    const [entries, settings] = await Promise.all([r.workouts.getDay(date), r.settings.get()]);
    return { entries, settings };
  }, date);
  const [removing, setRemoving] = useState<Entry | null>(null);
  const unit = data?.settings.weightUnit ?? 'kg';
  const entries = data?.entries ?? [];
  const setCount = entries.reduce((a, e) => a + e.sets.length, 0);
  const volume = entries.reduce((a, e) => a + totalVolume(e.sets), 0);

  const move = async (id: string, d: -1 | 1) => { await repos.workouts.moveEntry(id, d); reload(); };
  const remove = async () => {
    if (!removing) return;
    await repos.workouts.deleteEntry(removing.id);
    setRemoving(null);
    reload();
  };

  return (
    <Screen
      footer={<Button label="種目を追加" icon="plus" disabled={date > today} onPress={() => router.push({ pathname: '/workout/select', params: { date } })} />}
    >
      <Header overline={isToday ? '今日のトレーニング' : 'トレーニング'} title={formatJpDate(date)} onBack={() => router.back()} />
      <DayNote date={date} today={today} />
      {data && entries.length === 0 && date <= today && (
        <View style={{ marginTop: 140 }}>
          <EmptyState title="まだ種目がありません" body="下の「＋ 種目を追加」から始めましょう" />
        </View>
      )}
      {entries.length > 0 && (
        <>
          <Card style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, marginTop: 8 }}>
            <Stat label="種目" value={String(entries.length)} />
            <Stat label="セット" value={String(setCount)} center />
            <Stat label="合計負荷量" value={`${tonnes(volume, unit)} ${unit === 'kg' ? 't' : 'k lb'}`} right />
          </Card>
          <View style={{ gap: 12, marginTop: 14 }}>
            {entries.map((e, i) => {
              const best = bestSet(e.sets);
              return (
                <Card key={e.id} style={{ paddingVertical: 12 }}>
                  <PressableScale
                    accessibilityRole="button"
                    scaleTo={0.98}
                    accessibilityLabel={`${e.exerciseName}を直す`}
                    onPress={() => router.push({ pathname: '/workout/entry', params: { date, entryId: e.id } })}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <SetNo n={i + 1} active />
                      <T bold size={16} style={{ flex: 1 }} numberOfLines={1}>{e.exerciseName}</T>
                      {best && <T size={12} bold color={colors.accent}>推定1RM {fmt1(kgToUnit(best.e1rm, unit))}{unit}</T>}
                      <Icon name="chevron" size={16} color={colors.sub} />
                    </View>
                    <View style={{ marginLeft: 30, marginTop: 6, gap: 4 }}>
                      {e.sets.map((st, j) => (
                        <View key={st.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          <SetNo n={j + 1} />
                          <T num bold size={16}>{formatSetLong(st.weightKg, st.reps, unit)}</T>
                          {st.memo !== '' && (
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 1 }}>
                              <Icon name="pencil" size={12} color={colors.sub} />
                              <T size={12} color={colors.sub} numberOfLines={1}>{st.memo}</T>
                            </View>
                          )}
                        </View>
                      ))}
                    </View>
                  </PressableScale>
                  <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                    <IconButton name="up" label="上へ" size={34} bg={colors.input} onPress={() => move(e.id, -1)} color={i === 0 ? colors.line : colors.text} />
                    <IconButton name="down" label="下へ" size={34} bg={colors.input} onPress={() => move(e.id, 1)} color={i === entries.length - 1 ? colors.line : colors.text} />
                    <IconButton name="trash" label={`${e.exerciseName}を外す`} size={34} bg={colors.input} color={colors.danger} onPress={() => setRemoving(e)} />
                  </View>
                </Card>
              );
            })}
          </View>
          <T size={12} color={colors.sub} style={{ marginTop: 10 }}>並び順は ↑↓ で入れ替えられます。種目を押すと記録を直せます</T>
        </>
      )}
      <ConfirmDialog
        visible={removing != null}
        title={`${removing?.exerciseName ?? ''}を外しますか？`}
        body="この日のトレーニングから外します。入力したセットとメモも消えます。"
        confirmLabel="外す"
        onCancel={() => setRemoving(null)}
        onConfirm={remove}
      />
    </Screen>
  );
}

function Stat({ label, value, center, right }: { label: string; value: string; center?: boolean; right?: boolean }) {
  return (
    <View style={{ alignItems: center ? 'center' : right ? 'flex-end' : 'flex-start' }}>
      <T size={12} color={colors.sub}>{label}</T>
      <T num bold size={20}>{value}</T>
    </View>
  );
}
