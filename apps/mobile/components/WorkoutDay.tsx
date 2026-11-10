import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { AiRecordButton } from './ChatSheet';
import { Big3Badge } from './ExerciseFields';
import { Icon } from './Icon';
import { PressableScale, useListMotion } from './motion';
import { LoadError } from './LoadError';
import { DailyHighlights } from './reports';
import { RestTimerBar } from './RestTimer';
import { T } from './Text';
import { Button, Card, ConfirmDialog, EmptyState, IconButton, SetNo } from './ui';
import type { Entry } from '@/db/repositories/workouts';
import { useBusy } from '@/hooks/busy';
import { useFocusData } from '@/hooks/data';
import { formatJpDate, todayKey } from '@/lib/date';
import { big3RoleById } from '@/lib/exercises';
import { formatSetLong, tonnes } from '@/lib/format';
import { TAB_AREAS } from '@/lib/reports';
import { entriesMissingBodyweight, MISSING_BODYWEIGHT_NOTE } from '@/lib/bodyweight';
import { bestSet, totalVolume } from '@/lib/training';
import { fmt1, kgToUnit } from '@/lib/units';
import { colors, space } from '@/theme';

/** 「種目を追加」のボタン（画面の下に固定する）。未来の日は押せない */
export function AddExerciseButton({ date }: { date: string }) {
  return <Button label="種目を追加" icon="plus" disabled={date > todayKey()} onPress={() => router.push({ pathname: '/workout/select', params: { date } })} style={{ flex: 1 }} />;
}

/**
 * 記録の画面の下：「AI で記録」（チャットを開く）と「種目を追加」を横に並べる。未来の日はどちらも押せない。
 * 休憩のタイマーが動いていれば、その上に帯を出す（記録の入力の画面と同じ1つのタイマー）
 */
export function WorkoutFooter({ date }: { date: string }) {
  const today = todayKey();
  return (
    <>
      <RestTimerBar />
      <View style={{ flexDirection: 'row', gap: space.s }}>
        <AiRecordButton prompt={{ kind: 'training', date, today }} disabled={date > today} style={{ flex: 1 }} />
        <AddExerciseButton date={date} />
      </View>
    </>
  );
}

/**
 * その日のトレーニングの中身（まとめ、種目の一覧、並べ替え、外す確認）。種目は実施した順に並ぶ。
 * 筋トレのタブの「記録」で使う
 */
export function WorkoutDayContent({ date }: { date: string }) {
  const today = todayKey();
  const { data, error, reload, repos } = useFocusData(async (r) => {
    const [entries, settings, exercises] = await Promise.all([
      r.workouts.getDay(date), r.settings.get(), r.catalog.listExercises({ includeHidden: true }),
    ]);
    // 今日が空なら「前回のメニュー」（直近のトレーニングの日）を出す
    const previous = entries.length === 0 && date === todayKey() ? await r.workouts.previousDay(date) : null;
    return { entries, settings, big3: big3RoleById(exercises), previous };
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
  // 前回のメニューを写す（2回押しても二重にしない：useBusy とリポジトリの確かめ）
  const [copyError, setCopyError] = useState<string | null>(null);
  const copyPrevious = () => run(async () => {
    if (!data?.previous) return;
    try {
      await repos.workouts.copyDay(data.previous.date, date);
      setCopyError(null);
    } catch (e) {
      setCopyError(e instanceof Error ? e.message : String(e));
    }
    await reload();
  });
  const previous = data?.previous;

  if (error) return <LoadError onRetry={reload} />;

  return (
    <>
      {data && entries.length === 0 && date <= today && (
        <View style={{ marginTop: previous ? space.xxl : space.xxl * 2 }}>
          <EmptyState title="まだ種目がありません" body={previous ? '下の「種目を追加」か、前回のメニューから始めましょう' : '下の「種目を追加」から始めましょう'} />
        </View>
      )}
      {data && entries.length === 0 && previous && (
        <View testID="previous-menu"><Card style={{ gap: space.xs }}>
          <T variant="labelM" color={colors.sub}>前回のメニュー</T>
          <T variant="titleM">{formatJpDate(previous.date)} ・ {[...new Set(previous.entries.map((e) => e.bodyPartName))].join('・')}</T>
          <T variant="bodyM" color={colors.sub}>{previous.entries.map((e) => e.exerciseName).join(' ・ ')}</T>
          <Button
            label={busy ? '写しています…' : '同じメニューで始める'} variant="text" small busy={busy} onPress={copyPrevious}
            accessibilityLabel={`${formatJpDate(previous.date)}と同じメニューで始める`}
            style={{ alignSelf: 'flex-start', paddingLeft: 12, paddingRight: 12, marginLeft: -12, marginTop: space.xs }}
          />
          {copyError && <T variant="bodyS" color={colors.danger}>{copyError}</T>}
        </Card></View>
      )}
      {data && entries.length === 0 && <DailyHighlights date={date} areas={TAB_AREAS.training} />}
      {entries.length > 0 && (
        <>
          <Card style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: space.m, marginTop: space.s }}>
            <Stat label="種目" value={String(entries.length)} />
            <Stat label="セット" value={String(setCount)} center />
            <Stat label="合計負荷量" value={`${tonnes(volume, unit)} ${unit === 'kg' ? 't' : 'k lb'}`} right />
          </Card>
          {entriesMissingBodyweight(entries) && (
            <T variant="bodyS" color={colors.sub} style={{ marginTop: space.xs }} testID="missing-bodyweight">{MISSING_BODYWEIGHT_NOTE}</T>
          )}
          <DailyHighlights date={date} areas={TAB_AREAS.training} />
          {/* 上の「レポートから」のカード（抜き出し）と分けて、ここからが記録そのものだと分かるように見出しを付ける */}
          <T variant="titleS" color={colors.sub} accessibilityRole="header" style={{ marginTop: space.l }}>記録した種目</T>
          <View style={{ gap: space.m, marginTop: space.s }}>
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
                        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.s, flexWrap: 'wrap' }}>
                          <T variant="titleM" style={{ flexShrink: 1 }} numberOfLines={2}>{e.exerciseName}</T>
                          {data?.big3.has(e.exerciseId) && <Big3Badge />}
                        </View>
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
