import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { CountUpText, LineChart, StackedBarChart } from './charts';
import { Icon } from './Icon';
import { LoadError } from './LoadError';
import { MonthCalendar } from './MonthCalendar';
import { T } from './Text';
import { SlidingMark } from './motion';
import { Button, Card, Chip, ChipRow, EmptyState, IconButton, ListRow, Segmented, SetNo, useLayouts } from './ui';
import type { VolumeRange } from '@/db/repositories/settings';
import type { Entry } from '@/db/repositories/workouts';
import { useFocusData, useRepos } from '@/hooks/data';
import { dateLabels, datePoints } from '@/lib/chart';
import { addMonths, formatJpDate, formatMonthDay, formatShortDate, MONTH_NAMES_EN, todayKey, yearMonth } from '@/lib/date';
import { formatSetLong } from '@/lib/format';
import {
  bestSet, changeOver, dailySummary, dailyVolumeByBodyPart, exerciseDailySeries, filterSince, Period, PERIOD_LABELS, periodStart,
  personalBests, totalVolume, trainingDates, weeklySummary, weeklyVolumeByBodyPart,
} from '@/lib/training';
import { fmt1, fmtInt, kgToUnit } from '@/lib/units';
import { touchRoom } from '@/lib/touch';
import { colors, partColor } from '@/theme';

const ALL = 'all';
const PERIODS: Period[] = ['1m', '3m', '6m', '1y', 'all'];

/** 筋トレの履歴（部位と種目のチップ、カレンダー、グラフ）。筋トレのタブの「履歴」 */
export function TrainingHistory() {
  const today = todayKey();
  const [partId, setPartId] = useState<string>(ALL);
  const [exerciseId, setExerciseId] = useState<string>(ALL);
  const [view, setView] = useState<'calendar' | 'graph'>('calendar');
  const [month, setMonth] = useState(today.slice(0, 7) + '-01');
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>('3m');
  const [dayEntries, setDayEntries] = useState<Entry[]>([]);
  const [dayFailed, setDayFailed] = useState(false);
  const repos = useRepos();

  const { data, error, reload } = useFocusData(async (r) => {
    const [parts, exercises, rows, settings, volumeRange] = await Promise.all([
      r.catalog.listBodyParts(), r.catalog.listExercises({ includeHidden: true }), r.workouts.allSetRows(), r.settings.get(),
      r.settings.volumeRange().catch((): VolumeRange => 'week'),
    ]);
    return { parts, exercises, rows, settings, volumeRange };
  });
  const unit = data?.settings.weightUnit ?? 'kg';
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const exercisesWithRecords = useMemo(() => new Set(rows.map((r) => r.exerciseId)), [rows]);

  // チップに出す種目：「すべて」なら記録のある種目、部位なら表示中の種目（と、その部位で記録のある非表示の種目）
  const chipExercises = (data?.exercises ?? []).filter((e) =>
    partId === ALL ? exercisesWithRecords.has(e.id) : e.bodyPartId === partId && (!e.hidden || exercisesWithRecords.has(e.id)),
  );

  const choosePart = (id: string) => {
    setPartId(id);
    if (id === ALL) { setExerciseId(ALL); return; }
    const inPart = (data?.exercises ?? []).filter((e) => e.bodyPartId === id && !e.hidden);
    setExerciseId((inPart.find((e) => exercisesWithRecords.has(e.id)) ?? inPart[0])?.id ?? '');
  };

  const marked = useMemo(
    () => new Set(trainingDates(rows.filter((r) => exerciseId === ALL || r.exerciseId === exerciseId))),
    [rows, exerciseId],
  );
  const { year, month: m } = yearMonth(month);
  const monthCount = [...marked].filter((d) => d.startsWith(month.slice(0, 7))).length;
  const exercise = data?.exercises.find((e) => e.id === exerciseId);

  // 選んだ日：その月で最後にした日を初めに選ぶ
  useEffect(() => {
    const inMonth = [...marked].filter((d) => d.startsWith(month.slice(0, 7))).sort();
    setSelectedDay((cur) => (cur && marked.has(cur) && cur.startsWith(month.slice(0, 7)) ? cur : inMonth[inMonth.length - 1] ?? null));
  }, [marked, month]);

  useEffect(() => {
    if (!selectedDay) { setDayEntries([]); setDayFailed(false); return; }
    let alive = true;
    // 読めなかったときは、読み直し（reload で data が変わる）でもう一度読む
    repos.workouts.getDay(selectedDay).then(
      (es) => { if (alive) { setDayEntries(es); setDayFailed(false); } },
      () => { if (alive) setDayFailed(true); },
    );
    return () => { alive = false; };
  }, [repos, selectedDay, data]);

  const shownEntries = dayEntries.filter((e) => exerciseId === ALL || e.exerciseId === exerciseId);

  return (
    <>
      {error || dayFailed ? (
        <LoadError onRetry={reload} />
      ) : data && rows.length === 0 ? (
        <EmptyState title="まだ記録がありません" body={'「今日」の「種目を追加」から記録すると、\nここに履歴とグラフが出ます'} />
      ) : (
        <>
          <View style={{ marginTop: 14 }}>
            <ChipRow>
              <Chip label="すべて" active={partId === ALL} onPress={() => choosePart(ALL)} />
              {data?.parts.map((p) => <Chip key={p.id} label={p.name} active={partId === p.id} onPress={() => choosePart(p.id)} />)}
            </ChipRow>
          </View>
          <View style={{ marginTop: 10 }}>
            <ChipRow>
              {partId === ALL && <Chip label="すべての種目" active={exerciseId === ALL} onPress={() => setExerciseId(ALL)} />}
              {chipExercises.map((e) => <Chip key={e.id} label={e.name} active={exerciseId === e.id} onPress={() => setExerciseId(e.id)} />)}
            </ChipRow>
          </View>
          <View style={{ marginTop: 12 }}>
            <Segmented options={[{ key: 'calendar', label: 'カレンダー' }, { key: 'graph', label: 'グラフ' }]} value={view} onChange={setView} />
          </View>

          {partId !== ALL && chipExercises.length === 0 ? (
            <EmptyState title="この部位の種目がありません" body="設定の「種目と部位の管理」で種目を足せます" />
          ) : view === 'calendar' ? (
            <>
              <Card style={{ marginTop: 14 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', ...touchRoom(6, { bottom: 10 }) }}>
                  <IconButton name="prev" label="前の月" bg="transparent" onPress={() => setMonth(addMonths(month, -1))} />
                  <T num bold size={24}>{MONTH_NAMES_EN[m - 1]} {year}</T>
                  <IconButton name="next" label="次の月" bg="transparent" onPress={() => setMonth(addMonths(month, 1))} />
                </View>
                <MonthCalendar year={year} month={m} today={today} marked={marked} selected={selectedDay} onPressDay={(d) => marked.has(d) && setSelectedDay(d)} cell={38} testID="history-calendar" />
                <T size={12} color={colors.sub} style={{ marginTop: 10 }}>
                  {exercise ? `${exercise.name}をした日` : 'トレーニングした日'}：今月 {monthCount}回
                </T>
              </Card>
              {selectedDay && shownEntries.map((e) => {
                const best = bestSet(e.sets);
                return (
                  <Card key={e.id} style={{ marginTop: 12, gap: 6 }}>
                    <Pressable accessibilityRole="button" hitSlop={{ top: 13, bottom: 13 }} onPress={() => router.push({ pathname: '/workout', params: { date: selectedDay } })} style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <T bold size={16} style={{ flex: 1 }}>{formatJpDate(selectedDay)} {e.exerciseName}</T>
                      <Icon name="chevron" size={16} color={colors.sub} />
                    </Pressable>
                    {e.sets.map((st, i) => (
                      <View key={st.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <SetNo n={i + 1} />
                        <T num bold size={16}>{formatSetLong(st.weightKg, st.reps, unit)}</T>
                        {st.memo !== '' && <T size={12} color={colors.sub}>{st.memo}</T>}
                      </View>
                    ))}
                    {/* 回数だけの種目は、自重の負荷量（体重 × 割合 × 回数）だけ。推定1RM は出さない */}
                    <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
                      <MiniStat label="総負荷量" value={`${fmtInt(kgToUnit(totalVolume(e.sets), unit))} ${unit}`} />
                      {e.recordType === 'weight_reps' && <MiniStat label="推定1RM" value={best ? `${fmt1(kgToUnit(best.e1rm, unit))} ${unit}` : '—'} />}
                    </View>
                  </Card>
                );
              })}
              {selectedDay && (
                <Button
                  label={`${formatMonthDay(selectedDay)}に種目を追加`}
                  icon="plus"
                  variant="secondary"
                  small
                  style={{ marginTop: 12 }}
                  onPress={() => router.push({ pathname: '/workout/select', params: { date: selectedDay } })}
                />
              )}
              {!selectedDay && <T size={13} color={colors.sub} style={{ marginTop: 12 }}>この月の記録はありません</T>}
            </>
          ) : exerciseId === ALL ? (
            <AllGraph data={data!} today={today} unit={unit} onPick={(id) => {
              const ex = data?.exercises.find((e) => e.id === id);
              if (ex) { setPartId(ex.bodyPartId); setExerciseId(id); }
            }} />
          ) : (
            <ExerciseGraph rows={rows} exerciseId={exerciseId} recordType={exercise?.recordType ?? 'weight_reps'} today={today} period={period} setPeriod={setPeriod} unit={unit} />
          )}
        </>
      )}
    </>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.input, borderRadius: 10, padding: 10 }}>
      <T size={11} color={colors.sub}>{label}</T>
      <T num bold size={20}>{value}</T>
    </View>
  );
}

function ExerciseGraph({ rows, exerciseId, recordType, today, period, setPeriod, unit }: {
  rows: Parameters<typeof exerciseDailySeries>[0]; exerciseId: string; recordType: 'weight_reps' | 'reps_only';
  today: string; period: Period; setPeriod: (p: Period) => void; unit: 'kg' | 'lb';
}) {
  const all = exerciseDailySeries(rows, exerciseId);
  const from = periodStart(today, period);
  const series = filterSince(all, from);
  const start = from ?? series[0]?.date ?? today;
  const labels = dateLabels(start, today, 4);
  const conv = (kg: number) => kgToUnit(kg, unit);
  const [layouts, setLayouts] = useLayouts();
  const mark = layouts[period];

  return (
    <>
      <View style={{ flexDirection: 'row', gap: 6, marginTop: 12 }}>
        <SlidingMark layout={mark} style={{ top: 0, bottom: 0, borderRadius: 8, backgroundColor: colors.input }} />
        {PERIODS.map((p) => (
          <Pressable
            key={p}
            accessibilityRole="button"
            aria-selected={period === p}
            hitSlop={{ top: 9, bottom: 9, left: 3, right: 3 }}
            onPress={() => setPeriod(p)}
            onLayout={(e) => setLayouts(p, e.nativeEvent.layout)}
            style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: period === p && !mark ? colors.input : 'transparent' }}
          >
            <T size={13} bold={period === p} color={period === p ? colors.text : colors.sub}>{PERIOD_LABELS[p]}</T>
          </Pressable>
        ))}
      </View>
      {series.length < 2 ? (
        <EmptyState icon="chart" title="グラフにするには記録が足りません" body={`この期間の記録は ${series.length} 日です。2日以上になるとグラフが出ます`} />
      ) : (
        // 回数だけの種目は、自重の総負荷量（体重 × 割合 × 回数）だけ。推定1RM は出さない
        [
          { title: '総負荷量', value: (p: (typeof series)[number]) => conv(p.volume), fmt: (v: number) => fmtInt(v) },
          ...(recordType === 'weight_reps'
            ? [{ title: '最大RM（推定）', value: (p: (typeof series)[number]) => conv(p.max1RM), fmt: (v: number) => fmt1(v) }] : []),
        ].map((c) => {
          const last = c.value(series[series.length - 1]);
          const diff = changeOver(series, c.value) ?? 0;
          return (
            <Card key={c.title} style={{ marginTop: 14 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <T bold size={16}>{c.title}</T>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
                  <CountUpText num bold size={28} value={last} format={c.fmt} animKey={`${exerciseId}-${period}`} />
                  <T size={12} color={colors.sub}>{unit}</T>
                </View>
              </View>
              <CountUpText
                size={12} bold color={diff >= 0 ? colors.accent : colors.danger} style={{ marginBottom: 8 }}
                value={Math.abs(diff)} animKey={`${exerciseId}-${period}`}
                format={(v) => `${PERIOD_LABELS[period]}${period === 'all' ? 'の期間' : ''}で ${diff >= 0 ? '+' : '−'}${c.fmt(v)}${unit}`}
              />
              <LineChart points={datePoints(series, c.value, start, today)} xLabels={labels} formatY={(v) => fmtInt(v)} animKey={`${exerciseId}-${period}`} />
            </Card>
          );
        })
      )}
    </>
  );
}

/** 日ごとの総負荷量に出す週の数（週ごとと同じ日曜始まりの 28 日） */
const DAILY_WEEKS = 4;
const WEEKLY_WEEKS = 8;

function AllGraph({ data, today, unit, onPick }: {
  data: {
    parts: { id: string; name: string }[]; exercises: { id: string; name: string; bodyPartName: string }[];
    rows: Parameters<typeof weeklyVolumeByBodyPart>[0]; volumeRange: VolumeRange;
  };
  today: string; unit: 'kg' | 'lb'; onPick: (exerciseId: string) => void;
}) {
  const repos = useRepos();
  const [range, setRange] = useState<VolumeRange>(data.volumeRange);
  const chooseRange = (k: VolumeRange) => {
    setRange(k);
    repos.settings.setVolumeRange(k).catch(() => {});
  };
  const weeks = weeklyVolumeByBodyPart(data.rows, today, WEEKLY_WEEKS);
  const days = dailyVolumeByBodyPart(data.rows, today, DAILY_WEEKS);
  const shown = range === 'week' ? weeks : days;
  const partIndex = new Map(data.parts.map((p, i) => [p.id, i]));
  const usedParts = data.parts.filter((p) => shown.some((w) => (w.byPart[p.id] ?? 0) > 0));
  const t = (kg: number) => kgToUnit(kg, unit) / 1000;
  const tUnit = unit === 'kg' ? 't' : 'k lb';
  const tSpoken = unit === 'kg' ? 'トン' : '千ポンド';
  const { thisWeek, lastWeek, avg } = weeklySummary(weeks);
  const daily = dailySummary(days);
  const peakWeek = weeks.reduce<(typeof weeks)[number] | null>((a, w) => (w.total > 0 && (!a || w.total > a.total) ? w : a), null);
  const segments = (byPart: Record<string, number>) =>
    data.parts.map((p) => ({ value: byPart[p.id] ?? 0, color: partColor(partIndex.get(p.id) ?? 0) }));
  const peakIndex = daily.peak ? days.indexOf(daily.peak) : -1;
  const pbs = [...personalBests(data.rows).values()].sort((a, b) => b.e1rm - a.e1rm);
  const exName = new Map(data.exercises.map((e) => [e.id, e]));

  return (
    <>
      <Card style={{ marginTop: 14 }}>
        <View style={{ marginBottom: 8 }}>
          <Segmented options={[{ key: 'week', label: '週' }, { key: 'day', label: '日' }]} value={range} onChange={chooseRange} />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <T bold size={16}>{range === 'week' ? '週ごとの総負荷量' : '日ごとの総負荷量'}</T>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 2 }}>
            <CountUpText num bold size={28} value={t(range === 'week' ? thisWeek : daily.total)} format={(v) => v.toFixed(1)} animKey={range} />
            <T size={12} color={colors.sub}>{tUnit}／{range === 'week' ? '今週' : `${DAILY_WEEKS}週間`}</T>
          </View>
        </View>
        {range === 'week' ? (
          <T size={12} bold color={colors.accent} style={{ marginBottom: 10 }}>
            週の平均 {t(avg).toFixed(1)}{tUnit} ・ 先週より {thisWeek >= lastWeek ? '+' : '−'}{Math.abs(t(thisWeek - lastWeek)).toFixed(1)}{tUnit}
          </T>
        ) : (
          <T size={12} bold color={colors.accent} style={{ marginBottom: 10 }}>
            {daily.peak
              ? `いちばん多い日 ${formatShortDate(daily.peak.date)} ${t(daily.peak.total).toFixed(1)}${tUnit} ・ ${daily.activeDays}日`
              : `この${DAILY_WEEKS}週間の記録はありません`}
          </T>
        )}
        {range === 'week' ? (
          <StackedBarChart
            animKey={range}
            testID="volume-chart-week"
            accessibilityLabel={`週ごとの総負荷量のグラフ。${WEEKLY_WEEKS}週間の合計 ${t(weeks.reduce((a, w) => a + w.total, 0)).toFixed(1)}${tSpoken}。${
              peakWeek ? `いちばん多い週は${formatMonthDay(peakWeek.weekStart)}からの週で ${t(peakWeek.total).toFixed(1)}${tSpoken}` : '記録はありません'}`}
            bars={weeks.map((w, i) => ({
              label: i === weeks.length - 1 ? '今週' : i % 2 === 0 ? formatShortDate(w.weekStart) : '',
              segments: segments(w.byPart),
            }))}
          />
        ) : (
          // 棒が 28 本と細いので、日付は週の始まり（日曜）だけ、棒の左から書く。値はいちばん多い日だけ棒の上に出す
          <StackedBarChart
            animKey={range}
            testID="volume-chart-day"
            labelAnchor="start"
            peak={daily.peak ? { index: peakIndex, label: `${t(daily.peak.total).toFixed(1)}${tUnit}` } : undefined}
            accessibilityLabel={`日ごとの総負荷量のグラフ。${formatMonthDay(days[0].date)}から今日までの合計 ${t(daily.total).toFixed(1)}${tSpoken}、${daily.activeDays}日。${
              daily.peak ? `いちばん多い日は${formatMonthDay(daily.peak.date)}で ${t(daily.peak.total).toFixed(1)}${tSpoken}` : '記録はありません'}`}
            bars={days.map((d, i) => ({ label: i % 7 === 0 ? formatShortDate(d.date) : '', segments: segments(d.byPart) }))}
          />
        )}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 }}>
          {usedParts.map((p) => (
            <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: partColor(partIndex.get(p.id) ?? 0) }} />
              <T size={12} color={colors.sub}>{p.name}</T>
            </View>
          ))}
        </View>
      </Card>
      <Card style={{ marginTop: 14, padding: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, padding: 16, paddingBottom: 4 }}>
          <Icon name="star" size={16} color={colors.star} />
          <T bold size={15}>種目ごとの自己ベスト（推定1RM）</T>
        </View>
        {pbs.length === 0 && <View style={{ padding: 16 }}><T size={13} color={colors.sub}>重量のある種目の記録がまだありません</T></View>}
        {pbs.map((pb, i) => {
          const ex = exName.get(pb.exerciseId);
          return (
            <ListRow
              key={pb.exerciseId}
              first={i === 0}
              title={ex?.name ?? ''}
              subtitle={ex?.bodyPartName}
              onPress={() => onPick(pb.exerciseId)}
              right={<View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}><T num bold size={20}>{fmt1(kgToUnit(pb.e1rm, unit))}</T><T size={11} color={colors.sub}>{unit}</T></View>}
            />
          );
        })}
      </Card>
    </>
  );
}
