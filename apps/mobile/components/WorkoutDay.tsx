import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Icon } from './Icon';
import { PressableScale, useListMotion } from './motion';
import { LoadError } from './LoadError';
import { T } from './Text';
import { Button, Card, ConfirmDialog, EmptyState, IconButton, SetNo } from './ui';
import type { Entry } from '@/db/repositories/workouts';
import { useBusy } from '@/hooks/busy';
import { useFocusData } from '@/hooks/data';
import { todayKey } from '@/lib/date';
import { formatSetLong, tonnes } from '@/lib/format';
import { bestSet, totalVolume } from '@/lib/training';
import { fmt1, kgToUnit } from '@/lib/units';
import { colors, space } from '@/theme';

/** 「種目を追加」のボタン（画面の下に固定する）。未来の日は押せない */
export function AddExerciseButton({ date }: { date: string }) {
  return <Button label="種目を追加" icon="plus" disabled={date > todayKey()} onPress={() => router.push({ pathname: '/workout/select', params: { date } })} />;
}

/**
 * その日のトレーニングの中身（まとめ、種目の一覧、並べ替え、外す確認）。種目は実施した順に並ぶ。
 * 記録の画面（/workout）と、筋トレのタブの「今日」で使う
 */
export function WorkoutDayContent({ date }: { date: string }) {
  const today = todayKey();
  const { data, error, reload, repos } = useFocusData(async (r) => {
    const [entries, settings] = await Promise.all([r.workouts.getDay(date), r.settings.get()]);
    return { entries, settings };
  }, date);
  const [removing, setRemoving] = useState<Entry | null>(null);
  const list = useListMotion(data != null);
  const unit = data?.settings.weightUnit ?? 'kg';
  const entries = data?.entries ?? [];
  const setCount = entries.reduce((a, e) => a + e.sets.length, 0);
  const volume = entries.reduce((a, e) => a + totalVolume(e.sets), 0);

  const move = async (id: string, d: -1 | 1) => { await repos.workouts.moveEntry(id, d); reload(); };
  // 外すは1つずつ（確認の「外す」を続けて押しても2回消さない）。並べ替えは、続けて押した分だけ動かす
  const { busy, run } = useBusy();
  const remove = () => run(async () => {
    if (!removing) return;
    await repos.workouts.deleteEntry(removing.id);
    setRemoving(null);
    await reload();
  });

  if (error) return <LoadError onRetry={reload} />;

  return (
    <>
      {data && entries.length === 0 && date <= today && (
        <View style={{ marginTop: space.xxl * 2 }}>
          <EmptyState title="まだ種目がありません" body="下の「種目を追加」から始めましょう" />
        </View>
      )}
      {entries.length > 0 && (
        <>
          <Card style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: space.m, marginTop: space.s }}>
            <Stat label="種目" value={String(entries.length)} />
            <Stat label="セット" value={String(setCount)} center />
            <Stat label="合計負荷量" value={`${tonnes(volume, unit)} ${unit === 'kg' ? 't' : 'k lb'}`} right />
          </Card>
          <View style={{ gap: space.m, marginTop: space.l }}>
            {entries.map((e, i) => {
              const best = bestSet(e.sets);
              return (
                <Animated.View key={e.id} entering={list.entering(i)} exiting={list.exiting} layout={list.layout}>
                  <Card style={{ paddingTop: space.l, paddingBottom: space.s }}>
                    <PressableScale
                      accessibilityRole="button"
                      scaleTo={0.98}
                      accessibilityLabel={`${e.exerciseName}を直す`}
                      onPress={() => router.push({ pathname: '/workout/entry', params: { date, entryId: e.id } })}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <SetNo n={i + 1} active />
                        <T variant="titleM" style={{ flex: 1 }} numberOfLines={2}>{e.exerciseName}</T>
                        {best && <T variant="labelL" color={colors.accent}>推定1RM {fmt1(kgToUnit(best.e1rm, unit))}{unit}</T>}
                        <Icon name="chevron" size={24} color={colors.sub} />
                      </View>
                      <View style={{ marginLeft: 32, marginTop: space.s, gap: space.s }}>
                        {e.sets.map((st, j) => (
                          <View key={st.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                            <SetNo n={j + 1} />
                            <T variant="titleM">{formatSetLong(st.weightKg, st.reps, unit)}</T>
                            {st.memo !== '' && (
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, flexShrink: 1 }}>
                                <Icon name="pencil" size={16} color={colors.sub} />
                                <T variant="bodyS" color={colors.sub} numberOfLines={1}>{st.memo}</T>
                              </View>
                            )}
                          </View>
                        ))}
                      </View>
                    </PressableScale>
                    {/* 上へ・下へは見た目 40・押せる範囲 48。端では使えない状態。外すは文字付きのボタン（押すと確認） */}
                    <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: space.s, marginTop: space.s }}>
                      <IconButton name="up" label="上へ" variant="tonal" onPress={() => move(e.id, -1)} disabled={i === 0} />
                      <IconButton name="down" label="下へ" variant="tonal" onPress={() => move(e.id, 1)} disabled={i === entries.length - 1} />
                      <Button label="外す" icon="trash" variant="danger" small accessibilityLabel={`${e.exerciseName}を外す`} onPress={() => setRemoving(e)} style={{ paddingLeft: 12, paddingRight: 12 }} />
                    </View>
                  </Card>
                </Animated.View>
              );
            })}
          </View>
          <T variant="bodyS" color={colors.sub} style={{ marginTop: space.m }}>並び順は ↑↓ で入れ替えられます。種目を押すと記録を直せます</T>
        </>
      )}
      <ConfirmDialog
        visible={removing != null}
        title="種目を外しますか？"
        body={`${removing?.exerciseName ?? ''}と、そのセット ${removing?.sets.length ?? 0} 件を${date === today ? '今日' : 'この日'}の記録から外します。メモも消えます。`}
        confirmLabel="外す"
        onCancel={() => setRemoving(null)}
        onConfirm={remove}
        busy={busy}
      />
    </>
  );
}

function Stat({ label, value, center, right }: { label: string; value: string; center?: boolean; right?: boolean }) {
  return (
    <View style={{ alignItems: center ? 'center' : right ? 'flex-end' : 'flex-start' }}>
      <T variant="labelM" color={colors.sub}>{label}</T>
      <T variant="numM" bold>{value}</T>
    </View>
  );
}
