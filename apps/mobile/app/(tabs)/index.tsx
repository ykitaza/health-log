import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { HomeHeader, ReceivedNotice, RecordSheet } from '@/components/home';
import { HomeHero, HeroLatest } from '@/components/HomeHero';
import { Big3Panel, FuelPanel, LoadPanel, LogPanel, PartsPanel, SleepPanel } from '@/components/homeHud';
import { WeeklyTodoCard } from '@/components/WeeklyTodo';
import { Icon } from '@/components/Icon';
import { LoadError } from '@/components/LoadError';
import { loadPartDays, todaySuggestion } from '@/components/partDay';
import { PressableScale } from '@/components/motion';
import { LatestReportCard } from '@/components/reports';
import { ReportSuggestion } from '@/components/ReportSuggestion';
import { Screen } from '@/components/Screen';
import { SyncAlertLine } from '@/components/SyncStatus';
import { T } from '@/components/Text';
import { Button, Fab } from '@/components/ui';
import type { HeartRateDay, SleepDay } from '@/db/repositories/health';
import { useBackToToday } from '@/hooks/backToToday';
import { useFocusData } from '@/hooks/data';
import { useToday } from '@/hooks/today';
import { addDays, DateKey, formatJpDate, formatMonthDay, pickedDayOrToday, weekStart, yearMonth } from '@/lib/date';
import { calloutSet } from '@/lib/dayCallouts';
import { big3Assignments } from '@/lib/exercises';
import { formatMinutes } from '@/lib/health';
import { goalLine } from '@/lib/home';
import {
  big3Gauge, fuelGauge, latestSession, loadGauge, logFrom, logGrid, monthSummary, partsRadar, partStates, sleepGauge,
} from '@/lib/homeHud';
import { MISSING_BODYWEIGHT_NOTE, recentMissingBodyweight } from '@/lib/bodyweight';
import { fixingOn, injuriesForPart, partRecoveries } from '@/lib/recoveryMap';
import { dayFocus } from '@/lib/training';
import { fmt1, kgToUnit } from '@/lib/units';
import { colors, radius, size, space } from '@/theme';

/**
 * ホーム（刷新 A「計器の盤」）：見出しの行、ヒーロー（LATEST・GROWTH）、計器の段（BIG3・LOAD・SLEEP）、LOG（直近 4 週の方眼）、
 * PARTS と FUEL、レポートのおすすめ、体調、今週やること、最新のレポート。集計は lib/homeHud.ts
 */
export default function HomeScreen() {
  // 開いたまま日をまたいでも、前の日を「今日」として出さない（前の日に記録を足してしまうため）
  const today = useToday();
  // LOG で選んだ日（過去の日の記録を足す・体調を見る）。null なら今日。未来の日は選べない
  const [picked, setPicked] = useState<DateKey | null>(null);
  const selected = pickedDayOrToday(picked, today);
  const isToday = selected === today;
  const dayLabel = isToday ? '今日' : formatMonthDay(selected);
  // 過去の日を見ているときは、Android の戻るでまず今日に戻す
  useBackToToday(isToday, () => setPicked(null));
  const [recording, setRecording] = useState(false);
  const { year, month } = yearMonth(today);
  const { data, error, reload } = useFocusData(async (r) => {
    const from = logFrom(today);
    const [rows, settings, meals, daily, sleep, sleepSel, heart, exercises, injuries] = await Promise.all([
      r.workouts.allSetRows(), r.settings.get(), r.meals.summaries(from, today), r.body.listDaily(),
      r.health.sleepDays(addDays(today, -6), today), r.health.sleepDay(selected), r.health.heartRateDay(selected),
      // BIG3 の割り当て（筋トレの推移のグラフと同じく、非表示の種目も）
      r.catalog.listExercises({ includeHidden: true }),
      r.injuries.list(),
    ]);
    const partDays = await loadPartDays(r, rows);
    // 直近のトレーニングの日の種目（ヒーローの札）
    const latest = latestSession(rows, today);
    const entries = latest ? (await r.workouts.getDays([latest.date])).filter((e) => e.sets.length > 0) : [];
    const weightKg = daily.find((d) => d.date === selected)?.weightKg ?? null;
    return {
      rows, settings, meals: meals.days, daily, sleep, partDays, latest, entries, injuries, big3: big3Assignments(exercises),
      day: selected, weightKg, sleepSel, heart,
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
      entries: data.entries.map((e, i) => ({ key: e.id, no: i + 1, name: e.exerciseName, set: calloutSet(e.sets, unit), part: e.bodyPartName })),
      parts: dayFocus(data.entries).names,
      prNames: data.latest.prs.map((p) => names.get(p.exerciseId) ?? ''),
    };
  }, [data, unit]);
  const big3 = useMemo(() => (data ? big3Gauge(rows, data.big3, today) : null), [data, rows, today]);
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
    }, today);
  }, [data, rows, partName, today]);
  const monthSum = useMemo(() => (data ? monthSummary(rows, today) : null), [data, rows, today]);
  const radar = useMemo(() => (data ? partsRadar(rows, partName, today) : null), [data, rows, partName, today]);
  const states = useMemo(() => {
    if (!data) return [];
    const list = partRecoveries(rows, partName, data.partDays.names, today);
    const fixing = fixingOn(data.injuries, today);
    return partStates(list, (p) => injuriesForPart(p, fixing).length > 0);
  }, [data, rows, partName, today]);
  const todayMeal = data?.meals.find((d) => d.date === today) ?? null;
  const fuel = todayMeal ? fuelGauge(todayMeal) : null;
  const condition = data?.day === selected ? data : null;

  if (error) return <Screen tab><LoadError onRetry={reload} /></Screen>;

  return (
    <View style={{ flex: 1 }}>
    <Screen tab fab bottomSpace={size.fab + space.l * 2} underStatusBar>
      <HomeHeader year={year} month={month} />
      {/* 同期が続けて失敗しているときだけ、見出しの下に1行で知らせる（ふだんは出さない。時刻と未送信の件数はアカウントの画面） */}
      <SyncAlertLine />
      <HomeHero today={today} unit={unit} latest={hero} ready={ready} />

      <View style={s.row}>
        <Big3Panel gauge={big3} unit={unit} ready={ready} />
        <LoadPanel gauge={load} dates={weekDates} today={today} unit={unit} ready={ready} />
        <SleepPanel gauge={sleep} today={today} />
      </View>
      {log && (
        <View style={{ marginTop: space.s }}>
          <LogPanel weeks={log} month={monthSum} selected={selected} unit={unit} onPressDay={(d) => setPicked(d === today ? null : d)} />
        </View>
      )}
      <View style={s.row}>
        <PartsPanel radar={radar} states={states} />
        <FuelPanel fuel={fuel} date={today} />
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
        <ConditionCard
          title={`${dayLabel}の体調`}
          body={condition ? conditionLine(condition.weightKg, condition.sleepSel, condition.heart, unit) : ''}
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

/** 体調のカードの1行：体重・睡眠・安静時心拍（ない値は出さない） */
function conditionLine(weightKg: number | null, sleep: SleepDay | null, heart: HeartRateDay | null, unit: 'kg' | 'lb'): string {
  const parts = [
    weightKg != null ? `体重 ${fmt1(kgToUnit(weightKg, unit))} ${unit}` : null,
    sleep ? `睡眠 ${formatMinutes(sleep.asleepMin)}` : null,
    heart?.restingBpm != null ? `安静時 ${Math.round(heart.restingBpm)} 拍/分` : null,
  ].filter(Boolean);
  return parts.length === 0 ? 'まだ記録がありません' : parts.join(' ・ ');
}

/** 体調のカード（その日の体重・睡眠・安静時心拍と、目標体重まで）。押すとからだのタブ */
function ConditionCard({ title, body, sub, onPress }: { title: string; body: string; sub?: string; onPress: () => void }) {
  return (
    <PressableScale testID="home-condition" accessibilityRole="button" accessibilityLabel={`${title}を開く。${[body, sub].filter(Boolean).join('。')}`} scaleTo={0.98} onPress={onPress} style={s.summary}>
      <View style={s.summaryIcon}><Icon name="scale" size={24} color={colors.onAccentDark} /></View>
      <View style={{ flex: 1, gap: space.xs }}>
        <T variant="titleM" numberOfLines={1}>{title}</T>
        <T variant="bodyM" color={colors.sub}>{body}</T>
        {sub && <T variant="bodyM" color={colors.sub}>{sub}</T>}
      </View>
      <Icon name="chevron" size={24} color={colors.sub} />
    </PressableScale>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.s, marginTop: space.s },
  pickedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.s },
  summary: { flexDirection: 'row', alignItems: 'center', gap: space.l, backgroundColor: colors.card, borderRadius: radius.l, padding: space.l, minHeight: 80 },
  summaryIcon: { width: 40, height: 40, borderRadius: radius.m, backgroundColor: colors.accentDark, alignItems: 'center', justifyContent: 'center' },
  fab: { position: 'absolute', right: space.l, bottom: space.l },
});
