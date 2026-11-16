import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { HomeHeader, ReceivedNotice, RecordSheet } from '@/components/home';
import { HeroData, HomeHero, HeroLatest } from '@/components/HomeHero';
import { BodyPanel, Big3Panel, FuelPanel, LoadPanel, LogPanel, SleepPanel } from '@/components/homeHud';
import { HomeReportsCard } from '@/components/HomeReports';
import { LoadError } from '@/components/LoadError';
import { loadPartDays, todaySuggestion } from '@/components/partDay';
import { Screen } from '@/components/Screen';
import { SyncAlertLine } from '@/components/SyncStatus';
import { T } from '@/components/Text';
import { Button, Fab } from '@/components/ui';
import { useBackToToday } from '@/hooks/backToToday';
import { useFocusData } from '@/hooks/data';
import { useToday } from '@/hooks/today';
import { addDays, DateKey, formatJpDate, formatMonthDay, pickedDayOrToday, weekStart, yearMonth } from '@/lib/date';
import { dayBodyEntries } from '@/lib/dayBody';
import { big3Assignments } from '@/lib/exercises';
import {
  heroPages, heroPhase, injuryCorners, normalPhaseOf, phaseRing,
} from '@/lib/homeHero';
import { goalLine } from '@/lib/home';
import {
  big3Gauge, fuelGauge, latestSession, loadGauge, logFrom, logGrid, monthSummary, sleepGauge,
} from '@/lib/homeHud';
import { MISSING_BODYWEIGHT_NOTE, recentMissingBodyweight } from '@/lib/bodyweight';
import { injuryNumbers } from '@/lib/injuries';
import { phasePartVolume, volumeWindow } from '@/lib/partVolume';
import { fixingOn, idleMeshes, partRecoveries, recoveryLevels } from '@/lib/recoveryMap';
import { colors, size, space } from '@/theme';

/**
 * ホーム（刷新 A「計器の盤」）：見出しの行、ヒーロー（フェーズの 1 行と輪、LATEST・INJURY の横スライド。体の色は回復／部位の量）、
 * FUEL、計器の段（BIG3・LOAD・SLEEP）とその下の BODY の 1 行、LOG（直近 4 週の方眼）、
 * レポートのカード（最新のレポート・お知らせ・今週やること）。集計は lib/homeHud.ts と lib/homeHero.ts
 */
export default function HomeScreen() {
  // 開いたまま日をまたいでも、前の日を「今日」として出さない（前の日に記録を足してしまうため）
  const today = useToday();
  // LOG で選んだ日（過去の日の記録を足す・体調を見る）。null なら今日。未来の日は選べない
  const [picked, setPicked] = useState<DateKey | null>(null);
  const selected = pickedDayOrToday(picked, today);
  const isToday = selected === today;
  // 過去の日を見ているときは、Android の戻るでまず今日に戻す
  useBackToToday(isToday, () => setPicked(null));
  const [recording, setRecording] = useState(false);
  const { year, month } = yearMonth(today);
  const { data, error, reload } = useFocusData(async (r) => {
    const from = logFrom(today);
    const [rows, settings, meals, daily, sleep, exercises, injuries, phases, heroBodyMode] = await Promise.all([
      r.workouts.allSetRows(), r.settings.get(), r.meals.summaries(from, today), r.body.listDaily(),
      r.health.sleepDays(addDays(today, -6), today),
      // BIG3 の割り当て（筋トレの推移のグラフと同じく、非表示の種目も）
      r.catalog.listExercises({ includeHidden: true }),
      r.injuries.list(),
      r.phases.list(), r.settings.heroBodyMode(),
    ]);
    const partDays = await loadPartDays(r, rows);
    // 直近のトレーニングの日の種目（ヒーローの札）
    const latest = latestSession(rows, today);
    const entries = latest ? await r.workouts.getDays([latest.date]) : [];
    const weightKg = daily.find((d) => d.date === selected)?.weightKg ?? null;
    return {
      rows, settings, meals: meals.days, daily, sleep, partDays, latest, entries, injuries, phases, big3: big3Assignments(exercises),
      day: selected, weightKg, heroBodyMode,
    };
  }, `${selected}|${today}`);

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const unit = data?.settings.weightUnit ?? 'kg';
  const ready = data != null;
  const partName = useMemo(() => {
    const m = data?.partDays.nameById;
    return (id: string) => m?.get(id) ?? '';
  }, [data]);

  const hero = useMemo<HeroLatest | null>(() => {
    if (!data?.latest) return null;
    const names = new Map(data.entries.map((e) => [e.exerciseId, e.exerciseName]));
    return {
      session: data.latest,
      ...dayBodyEntries(data.entries, unit),
      prNames: data.latest.prs.map((p) => names.get(p.exerciseId) ?? ''),
    };
  }, [data, unit]);
  // フェーズ（今のフェーズ・療養・止めたフェーズ）。体重は日ごとの値
  const weights = useMemo(() => (data?.daily ?? []).flatMap((d) => (d.weightKg != null ? [{ date: d.date, kg: d.weightKg }] : [])), [data]);
  const phase = useMemo(() => (data ? heroPhase(data.phases, weights, today) : null), [data, weights, today]);
  const normal = phase ? normalPhaseOf(phase) : null;
  const big3 = useMemo(() => (data ? big3Gauge(rows, data.big3, today, normal?.phase.snapshot?.big3 ?? null) : null), [data, rows, today, normal]);
  const load = useMemo(() => loadGauge(rows, today), [rows, today]);
  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart(today), i)), [today]);
  const sleep = useMemo(() => sleepGauge(data?.sleep ?? [], today), [data, today]);
  const log = useMemo(() => {
    if (!data) return null;
    const suggest = todaySuggestion(data.partDays, today).suggest?.name ?? null;
    return logGrid({
      rows, partName, meals: data.meals, suggest,
      weighed: new Set(data.daily.filter((d) => d.weightKg != null).map((d) => d.date)),
      injured: new Set(data.injuries.map((i) => i.occurredOn)),
      phaseWeek: normal?.progress.week ?? null,
    }, today);
  }, [data, rows, partName, today, normal]);
  const monthSum = useMemo(() => (data ? monthSummary(rows, today) : null), [data, rows, today]);
  // 部位の量：今のフェーズ（なければ直近 4 週）の、部位ごとのセット数と 1 週間あたり（カードと体の色・札で同じ数字）
  const volume = useMemo(() => (data ? phasePartVolume(rows, partName, volumeWindow(data.phases, today)) : null), [data, rows, partName, today]);
  const recovery = useMemo(() => {
    if (!data) return null;
    const list = partRecoveries(rows, partName, data.partDays.names, today);
    return { list, fixing: fixingOn(data.injuries, today) };
  }, [data, rows, partName, today]);
  const heroData = useMemo<HeroData | null>(() => {
    if (!data || !phase || !recovery) return null;
    const { list, fixing } = recovery;
    const rehab = phase.kind === 'rehab' ? phase.rehab : null;
    return {
      phase,
      ring: phaseRing(phase, weights, today),
      pages: heroPages(fixing.length > 0),
      recovery: { list, levels: recoveryLevels(list), idle: idleMeshes(list) },
      injury: { fixing, numbers: injuryNumbers(data.injuries), corners: injuryCorners(fixing, rehab, today) },
      volume,
      bodyMode: data.heroBodyMode,
    };
  }, [data, phase, recovery, weights, today, volume]);
  const todayMeal = data?.meals.find((d) => d.date === today) ?? null;
  const fuel = todayMeal ? fuelGauge(todayMeal) : null;
  const body = data?.day === selected ? data : null;

  if (error) return <Screen tab><LoadError onRetry={reload} /></Screen>;

  return (
    <View style={{ flex: 1 }}>
    <Screen tab fab bottomSpace={size.fab + space.l * 2} underStatusBar>
      <HomeHeader year={year} month={month} />
      {/* 同期が続けて失敗しているときだけ、見出しの下に1行で知らせる（ふだんは出さない。時刻と未送信の件数はアカウントの画面） */}
      <SyncAlertLine />
      <HomeHero today={today} unit={unit} latest={hero} ready={ready} data={heroData} />

      <View style={s.row}>
        <FuelPanel fuel={fuel} date={today} />
      </View>
      <View style={s.row}>
        <Big3Panel gauge={big3} unit={unit} ready={ready} />
        <LoadPanel gauge={load} dates={weekDates} today={today} unit={unit} ready={ready} />
        <SleepPanel gauge={sleep} today={today} />
      </View>
      {/* BODY：体重と目標まで（その日。LOG で選んだ日）。睡眠は SLEEP だけ、安静時心拍はホームに出さない */}
      <View style={{ marginTop: space.s }}>
        <BodyPanel
          label={isToday ? 'BODY' : `BODY // ${formatMonthDay(selected)}`}
          weightKg={body?.weightKg ?? null}
          goal={body ? goalLine(body.weightKg, body.settings.goalWeightKg ?? null, unit) : null}
          unit={unit}
          onPress={() => router.navigate({ pathname: '/body', params: { date: selected } })}
        />
      </View>
      {log && (
        <View style={{ marginTop: space.s }}>
          <LogPanel weeks={log} month={monthSum} selected={selected} unit={unit} onPressDay={(d) => setPicked(d === today ? null : d)} />
        </View>
      )}
      {/* LOG で選んだ日（BODY と「記録する」がその日になる）。押した所の近くに出す */}
      {!isToday && (
        <View style={s.pickedRow}>
          <T variant="bodyM" color={colors.sub}>{formatJpDate(selected)}を表示しています</T>
          <Button label="今日に戻る" icon="calendar" variant="text" small onPress={() => setPicked(null)} style={{ paddingLeft: 12, paddingRight: 12 }} />
        </View>
      )}

      {data != null && recentMissingBodyweight(rows, today) && (
        <T variant="bodyS" color={colors.sub} style={{ marginTop: space.s }} testID="missing-bodyweight">{MISSING_BODYWEIGHT_NOTE}</T>
      )}
      <View style={{ marginTop: space.l }}>
        <HomeReportsCard />
      </View>
    </Screen>
    <Fab label="記録する" onPress={() => setRecording(true)} style={s.fab} testID="home-record" />
    <ReceivedNotice bottom={size.fab + space.l * 2} />
    <RecordSheet visible={recording} date={selected} today={today} onClose={() => setRecording(false)} />
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.s, marginTop: space.s },
  pickedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.s },
  fab: { position: 'absolute', right: space.l, bottom: space.l },
});
