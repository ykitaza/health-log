import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { CountUpText, LineChart, StackedBarChart } from './charts';
import { Big3Badge } from './ExerciseFields';
import { Icon } from './Icon';
import { LoadError } from './LoadError';
import { MonthCalendar } from './MonthCalendar';
import { T } from './Text';
import { SlidingMark } from './motion';
import { Badge, Button, Card, Chip, ChipRow, EmptyState, IconButton, ListRow, Segmented, SetNo, useLayouts } from './ui';
import type { Exercise } from '@/db/repositories/catalog';
import type { VolumeRange } from '@/db/repositories/settings';
import type { Entry } from '@/db/repositories/workouts';
import { useFocusData, useRepos } from '@/hooks/data';
import { dateLabels, datePoints } from '@/lib/chart';
import { addMonths, formatJpDate, formatMonthDay, formatShortDate, MONTH_NAMES_EN, todayKey, yearMonth } from '@/lib/date';
import { BIG3_LABELS, big3Assignments, big3RoleById, Big3Role } from '@/lib/exercises';
import { formatSetLong, tonnes } from '@/lib/format';
import {
  big3Trend, changeOver, dailySummary, dailyVolumeByBodyPart, dayCardSummary, exerciseDailySeries, filterSince, Period, PERIOD_LABELS, periodStart,
  personalBests, summarizeSets, trainingDates, trendDays, weeklySummary, weeklyVolumeByBodyPart,
} from '@/lib/training';
import { fmt1, fmtInt, kgToUnit } from '@/lib/units';
import { touchRoom } from '@/lib/touch';
import { colors, partColor, space } from '@/theme';

const ALL = 'all';
const PERIODS: Period[] = ['1m', '3m', '6m', '1y', 'all'];
/** 記録のカードを一度に出す日数（下の「もっと見る」で読み足す） */
const PAGE_DAYS = 10;

/**
 * 筋トレの推移（筋トレのタブの「推移」）。種目のチップ1列（先頭に「すべて」、あとは部位の順）と「記録／グラフ」。
 * 記録は、カレンダーと日ごとのカード（新しい順。カレンダーの日を押すと、その日だけに絞る）。
 * グラフは、すべてなら BIG3 の推定1RM の合計と総負荷量（週・日）、種目を選ぶとその種目の推移
 */
export function TrainingTrend() {
  const today = todayKey();
  const [exerciseId, setExerciseId] = useState<string>(ALL);
  const [view, setView] = useState<'records' | 'graph'>('records');
  const [month, setMonth] = useState(today.slice(0, 7) + '-01');
  const [day, setDay] = useState<string | null>(null);
  const [pages, setPages] = useState(1);
  const [period, setPeriod] = useState<Period>('3m');

  const { data, error, reload } = useFocusData(async (r) => {
    const [parts, exercises, rows, settings, volumeRange] = await Promise.all([
      r.catalog.listBodyParts({ includeHidden: true }), r.catalog.listExercises({ includeHidden: true }), r.workouts.allSetRows(), r.settings.get(),
      r.settings.volumeRange().catch((): VolumeRange => 'week'),
    ]);
    return { parts, exercises, rows, settings, volumeRange };
  });
  const unit = data?.settings.weightUnit ?? 'kg';
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const exercises = useMemo(() => data?.exercises ?? [], [data]);
  const roles = useMemo(() => big3RoleById(exercises), [exercises]);

  // チップに出す種目：記録のある種目（非表示の種目も）。並びは部位の順、その中は種目の順
  const chipExercises = useMemo(() => {
    const withRecords = new Set(rows.map((r) => r.exerciseId));
    return exercises.filter((e) => withRecords.has(e.id));
  }, [rows, exercises]);
  const exercise = exercises.find((e) => e.id === exerciseId);
  const selectedId = exerciseId === ALL ? null : exerciseId;

  const marked = useMemo(
    () => new Set(trainingDates(rows.filter((r) => selectedId == null || r.exerciseId === selectedId))),
    [rows, selectedId],
  );
  const { year, month: m } = yearMonth(month);
  const monthCount = [...marked].filter((d) => d.startsWith(month.slice(0, 7))).length;

  const chooseExercise = (id: string) => {
    setExerciseId(id);
    setPages(1);
    // 選んだ種目をしていない日で絞っていたら、絞りを外す
    if (day && id !== ALL && !rows.some((r) => r.date === day && r.exerciseId === id)) setDay(null);
  };

  const allDays = useMemo(() => trendDays(rows, selectedId), [rows, selectedId]);
  const shownDays = day ? [day] : allDays.slice(0, PAGE_DAYS * pages);
  const shownKey = shownDays.join(',');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [daysFailed, setDaysFailed] = useState(false);
  const repos = useRepos();
  useEffect(() => {
    let alive = true;
    // 読めなかったときは、読み直し（reload で data が変わる）でもう一度読む
    repos.workouts.getDays(shownKey === '' ? [] : shownKey.split(',')).then(
      (es) => { if (alive) { setEntries(es); setDaysFailed(false); } },
      () => { if (alive) setDaysFailed(true); },
    );
    return () => { alive = false; };
  }, [repos, shownKey, data]);

  const cards = shownDays.map((d) => ({
    date: d,
    entries: entries.filter((e) => e.date === d && (selectedId == null || e.exerciseId === selectedId)),
  })).filter((c) => c.entries.length > 0);

  if (error || daysFailed) return <LoadError onRetry={reload} />;
  if (data && rows.length === 0) {
    return <EmptyState title="まだ記録がありません" body={'「今日」の「種目を追加」から記録すると、\nここに記録とグラフが出ます'} />;
  }

  return (
    <>
      <View style={{ marginTop: 14 }}>
        <ChipRow>
          <Chip label="すべて" active={exerciseId === ALL} onPress={() => chooseExercise(ALL)} />
          {chipExercises.map((e) => <Chip key={e.id} label={e.name} active={exerciseId === e.id} onPress={() => chooseExercise(e.id)} />)}
        </ChipRow>
      </View>
      <View style={{ marginTop: 12 }}>
        <Segmented options={[{ key: 'records', label: '記録' }, { key: 'graph', label: 'グラフ' }]} value={view} onChange={setView} />
      </View>

      {view === 'records' ? (
        <>
          <Card style={{ marginTop: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', ...touchRoom(6, { bottom: 10 }) }}>
              <IconButton name="prev" label="前の月" bg="transparent" onPress={() => setMonth(addMonths(month, -1))} />
              <T num bold size={24}>{MONTH_NAMES_EN[m - 1]} {year}</T>
              <IconButton name="next" label="次の月" bg="transparent" onPress={() => setMonth(addMonths(month, 1))} />
            </View>
            <MonthCalendar
              year={year} month={m} today={today} marked={marked} selected={day}
              onPressDay={(d) => { if (marked.has(d)) setDay(d === day ? null : d); }}
              cell={38} testID="history-calendar"
            />
            <T size={12} color={colors.sub} style={{ marginTop: 10 }}>
              {exercise ? `${exercise.name}をした日` : '筋トレをした日'}：今月 {monthCount}回
            </T>
          </Card>
          {day && (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.m }}>
              <T variant="bodyM" color={colors.sub}>{formatJpDate(day)}だけを表示中</T>
              <Button label="すべて表示" variant="text" small onPress={() => setDay(null)} style={{ paddingLeft: 12, paddingRight: 12, marginRight: -12 }} />
            </View>
          )}
          {cards.map((c) => (
            <DayCard key={c.date} date={c.date} entries={c.entries} exercise={exercise ?? null} roles={roles} unit={unit} />
          ))}
          {!day && allDays.length > shownDays.length && (
            <Button
              label={`もっと見る（あと ${allDays.length - shownDays.length}日）`}
              variant="outline" small style={{ marginTop: space.m }}
              onPress={() => setPages((n) => n + 1)}
            />
          )}
        </>
      ) : exerciseId === ALL ? (
        <AllGraph data={data!} today={today} unit={unit} onPick={chooseExercise} />
      ) : (
        <ExerciseGraph rows={rows} exerciseId={exerciseId} recordType={exercise?.recordType ?? 'weight_reps'} today={today} period={period} setPeriod={setPeriod} unit={unit} />
      )}
    </>
  );
}

/**
 * 推移の記録の、1日のカード（押すとその日のトレーニングの画面へ）。
 * すべてのときは、日付・部位・その日の合計負荷量と、種目ごとのセットの要約。種目を選んだときは、その種目のセット
 */
function DayCard({ date, entries, exercise, roles, unit }: {
  date: string; entries: Entry[]; exercise: Exercise | null; roles: Map<string, Big3Role>; unit: 'kg' | 'lb';
}) {
  const { parts, volume } = dayCardSummary(entries);
  const open = () => router.push({ pathname: '/workout', params: { date } });
  return (
    <Card style={{ marginTop: space.m, gap: space.s }}>
      <Pressable accessibilityRole="button" onPress={open} hitSlop={{ top: 12, bottom: 12 }} testID={`trend-day-${date}`}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: 24 }}>
          <T variant="titleM" style={{ flexShrink: 1 }}>{formatJpDate(date)}{exercise ? ` ${exercise.name}` : ''}</T>
          {!exercise && parts.map((p) => <Badge key={p} label={p} tone="neutral" />)}
          <View style={{ flex: 1 }} />
          {!exercise && <T num bold size={20}>{tonnes(volume, unit)} {unit === 'kg' ? 't' : 'k lb'}</T>}
          <Icon name="chevron" size={20} color={colors.sub} />
        </View>
        {exercise ? (
          <View style={{ gap: space.s, marginTop: space.m }}>
            {entries.flatMap((e) => e.sets).map((st, i) => (
              <View key={st.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <SetNo n={i + 1} />
                <T variant="titleM">{formatSetLong(st.weightKg, st.reps, unit)}</T>
                {st.memo !== '' && <T variant="bodyS" color={colors.sub} numberOfLines={1} style={{ flexShrink: 1 }}>{st.memo}</T>}
              </View>
            ))}
          </View>
        ) : (
          <View style={{ gap: space.s, marginTop: space.m }}>
            {entries.map((e) => (
              <View key={e.id}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
                  <T variant="titleS" style={{ flexShrink: 1 }}>{e.exerciseName}</T>
                  {roles.has(e.exerciseId) && <Big3Badge />}
                </View>
                <T num size={14} color={colors.sub}>{summarizeSets(e.sets, unit)}</T>
              </View>
            ))}
          </View>
        )}
      </Pressable>
    </Card>
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

/** 日ごとの総負荷量に出す週の数（週ごとと同じ月曜始まりの 28 日） */
const DAILY_WEEKS = 4;
const WEEKLY_WEEKS = 8;

function AllGraph({ data, today, unit, onPick }: {
  data: {
    parts: { id: string; name: string }[]; exercises: Exercise[];
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
      <Big3Card rows={data.rows} exercises={data.exercises} today={today} unit={unit} />
      <Card style={{ marginTop: 14 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.m, marginBottom: 8 }}>
          <T variant="titleM" accessibilityRole="header">総負荷量</T>
          <View style={{ width: 168 }}>
            <Segmented options={[{ key: 'week', label: '週' }, { key: 'day', label: '日' }]} value={range} onChange={chooseRange} />
          </View>
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
          // 棒が 28 本と細いので、日付は週の始まり（月曜）だけ、棒の左から書く。値はいちばん多い日だけ棒の上に出す
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

/** 推移のグラフの期間（BIG3 の合計） */
const BIG3_MONTHS = 3;

/**
 * BIG3 の推定1RM の合計（3か月の折れ線）、今の合計と先月との差、3種目それぞれの値と差。
 * 3種目がそろわないあいだは、そろっている分と、何を割り当てる（記録する）と合計が出るかを出す
 */
function Big3Card({ rows, exercises, today, unit }: {
  rows: Parameters<typeof big3Trend>[0]; exercises: Exercise[]; today: string; unit: 'kg' | 'lb';
}) {
  const from = addMonths(today, -BIG3_MONTHS);
  const trend = big3Trend(rows, big3Assignments(exercises), today, from);
  const conv = (kg: number) => kgToUnit(kg, unit);
  const names = (rs: Big3Role[]) => rs.map((r) => BIG3_LABELS[r]).join('・');
  const diff = trend.total != null && trend.totalMonthAgo != null ? conv(trend.total) - conv(trend.totalMonthAgo) : null;
  const signed = (v: number) => (Math.abs(v) < 0.05 ? '±0' : `${v > 0 ? '+' : '−'}${fmt1(Math.abs(v))}`);
  return (
    <Card style={{ marginTop: 14 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <T variant="titleM" accessibilityRole="header">BIG3 の推定1RM（合計）</T>
        <T variant="bodyS" color={colors.sub}>{BIG3_MONTHS}か月</T>
      </View>
      {trend.total != null ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.s, marginTop: space.s, flexWrap: 'wrap' }} testID="big3-total">
            <CountUpText num bold size={40} value={conv(trend.total)} format={fmt1} animKey="big3" />
            <T variant="bodyM" color={colors.sub}>{unit}</T>
            {diff != null && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, marginLeft: space.s }}>
                <Icon name={diff > 0.05 ? 'arrowUp' : diff < -0.05 ? 'arrowDown' : 'arrowFlat'} size={16} color={diff < -0.05 ? colors.danger : colors.accent} />
                <T variant="labelL" color={diff < -0.05 ? colors.danger : colors.accent}>{signed(diff)} {unit}</T>
                <T variant="bodyS" color={colors.sub}>先月より</T>
              </View>
            )}
          </View>
          {trend.points.length >= 2 && (
            <View accessible accessibilityLabel={`BIG3 の推定1RM の合計のグラフ。${BIG3_MONTHS}か月。今 ${fmt1(conv(trend.total))}${unit}`}>
              <LineChart
                points={datePoints(trend.points, (p) => conv(p.total), from, today)}
                xLabels={dateLabels(from, today, 4)}
                formatY={(v) => fmtInt(v)}
                animKey="big3"
              />
            </View>
          )}
        </>
      ) : (
        <View style={{ marginTop: space.s, gap: space.xs }} testID="big3-missing">
          {trend.unassigned.length > 0 && (
            <T variant="bodyM" color={colors.sub}>あと {names(trend.unassigned)} を割り当てると合計が出ます</T>
          )}
          {trend.noRecord.length > 0 && (
            <T variant="bodyM" color={colors.sub}>{names(trend.noRecord)}の記録（重量 × 回数）がそろうと合計が出ます</T>
          )}
          {trend.unassigned.length > 0 && (
            <Button
              label="種目と部位の管理で割り当てる" variant="text" small onPress={() => router.push('/exercises/manage')}
              style={{ alignSelf: 'flex-start', paddingLeft: 12, paddingRight: 12, marginLeft: -12 }}
            />
          )}
        </View>
      )}
      <View style={{ flexDirection: 'row', gap: space.s, marginTop: space.m }}>
        {trend.lifts.map((l) => {
          const name = exercises.find((e) => e.id === l.exerciseId)?.name;
          const d = l.current != null && l.monthAgo != null ? conv(l.current) - conv(l.monthAgo) : null;
          return (
            <View
              key={l.role} style={{ flex: 1, backgroundColor: colors.input, borderRadius: 10, padding: 10, gap: 2 }}
              accessible accessibilityLabel={`${BIG3_LABELS[l.role]}${name && name !== BIG3_LABELS[l.role] ? `（${name}）` : ''} ${
                l.exerciseId == null ? '未割り当て' : l.current == null ? '記録なし' : `${fmt1(conv(l.current))}${unit}${d != null ? `、先月より${signed(d)}` : ''}`}`}
              testID={`big3-${l.role}`}
            >
              <T variant="labelM" color={colors.sub} numberOfLines={1}>{BIG3_LABELS[l.role]}</T>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 2 }}>
                <T num bold size={22}>{l.current != null ? fmt1(conv(l.current)) : '—'}</T>
                {l.current != null && <T variant="bodyS" color={colors.sub}>{unit}</T>}
              </View>
              <T variant="labelM" color={d != null && d < -0.05 ? colors.danger : d != null && d > 0.05 ? colors.accent : colors.sub}>
                {l.exerciseId == null ? '未割り当て' : d != null ? signed(d) : l.current != null ? '先月の記録なし' : '記録なし'}
              </T>
            </View>
          );
        })}
      </View>
    </Card>
  );
}
