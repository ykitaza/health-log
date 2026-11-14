import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { CountUpText, LineChart, StackedBarChart } from './charts';
import { PartBadge } from './ExerciseFields';
import { Big3Panel, LoadPanel } from './homeHud';
import { Icon } from './Icon';
import { LoadError } from './LoadError';
import { PressableScale } from './motion';
import { PartStackRadar } from './PartBalance';
import { ScrollTarget } from './Screen';
import { T } from './Text';
import { Button, Card, Chip, ChipRow, EmptyState, ListRow, Segmented, SetNo } from './ui';
import type { Exercise } from '@/db/repositories/catalog';
import type { VolumeRange } from '@/db/repositories/settings';
import type { Entry } from '@/db/repositories/workouts';
import { useFocusData, useRepos } from '@/hooks/data';
import { useEntrance } from '@/hooks/entrance';
import { dateLabels, datePoints } from '@/lib/chart';
import { addDays, addMonths, formatJpDate, formatMonthDay, formatShortDate, todayKey, weekStart } from '@/lib/date';
import { BIG3_LABELS, big3Assignments, Big3Role } from '@/lib/exercises';
import { formatSetLong } from '@/lib/format';
import { partsNote, topPart } from '@/lib/growthRecords';
import { heroPhase, normalPhaseOf } from '@/lib/homeHero';
import { big3Gauge, loadGauge } from '@/lib/homeHud';
import { BALANCE_RANGES, BalanceRange, BalanceView, partBalanceForRange, partBalanceRangeLabel, recentLabel } from '@/lib/partBalance';
import type { Phase } from '@/lib/phases';
import {
  bestSet, big3PartialNote, big3Trend, DailyPoint, dailySummary, dailyVolumeByBodyPart, exerciseTrend, personalBests, totalVolume, TrainingSetRow, trendDays,
  weeklySummary, weeklyVolumeByBodyPart,
} from '@/lib/training';
import { fmt1, fmtInt, kgToUnit } from '@/lib/units';
import { colors, partColor, space } from '@/theme';

const ALL = 'all';
/** 種目の記録のカードを一度に出す日数（下の「もっと見る」で読み足す） */
const PAGE_DAYS = 10;
/** 種目を選んだときの折れ線の期間（BIG3 の合計と同じ） */
const EXERCISE_MONTHS = 3;

/** ホームから推移へ来たときに見せるグラフ（BIG3・総負荷量の日・部位のバランスの 28日・自己ベスト） */
export type TrendTarget = 'big3' | 'load' | 'parts' | 'best';
/** ホームから推移へ来たときに見せるもの。exercise があればその種目、なければ「すべて」の target。n は来るたびに変える */
export type TrendFocus = { target: TrendTarget | null; exercise: string | null; n: number };

const TREND_TARGETS: readonly TrendTarget[] = ['big3', 'load', 'parts', 'best'];

/** 画面の引数（focus・exercise）から。どちらもなければ null */
export function parseTrendFocus(focus: string | undefined, exercise: string | undefined, n: number): TrendFocus | null {
  const target = TREND_TARGETS.find((t) => t === focus) ?? null;
  return target || exercise ? { target, exercise: exercise || null, n } : null;
}

/**
 * 筋トレの推移（筋トレのタブの「推移」）。種目のチップ1列（先頭に「すべて」、あとは部位の順）とグラフ。
 * すべてなら BIG3 の推定1RM の合計、部位のバランス（2週・3か月・これまで）、総負荷量（週・日）、種目ごとの自己ベスト。
 * BIG3 と総負荷量の上には、ホームの計器と同じカード（BIG3・LOAD）を置く。
 * 種目を選ぶと、その種目の推定1RM の折れ線（回数だけの種目は総負荷量）と、その種目の記録（新しい順。押すと記録のタブのその日）。
 * focus があれば（ホームから来たとき）、その種目か「すべて」にして、そのグラフまでスクロールする（BIG3・総負荷量は上のホームと同じカードから）。総負荷量（load）は日ごと、部位のバランス（parts）は
 * ホームのレーダーと同じ 28日（前の28日を点線で）で見せる。覚えた期間は書き換えず、期間を選んだら onRangeChosen（focus を外す）
 */
export function TrainingTrend({ onOpenDay, focus, onRangeChosen }: {
  onOpenDay: (date: string) => void; focus?: TrendFocus | null; onRangeChosen?: () => void;
}) {
  const today = todayKey();
  const [exerciseId, setExerciseId] = useState<string>(ALL);
  // ホームから来たら、その種目か「すべて」に（前に選んだ種目のままだと、見せたグラフがない）
  const focusN = focus?.n ?? null;
  const focusExercise = focus?.exercise ?? null;
  useEffect(() => {
    if (focusN != null) setExerciseId(focusExercise ?? ALL);
  }, [focusN, focusExercise]);
  const target = focus && !focus.exercise ? focus.target : null;

  const { data, error, reload } = useFocusData(async (r) => {
    const [parts, exercises, rows, settings, volumeRange, balanceRange, phases] = await Promise.all([
      r.catalog.listBodyParts({ includeHidden: true }), r.catalog.listExercises({ includeHidden: true }), r.workouts.allSetRows(), r.settings.get(),
      r.settings.volumeRange().catch((): VolumeRange => 'week'),
      r.settings.balanceRange().catch((): BalanceRange => '2w'),
      // ホームと同じ BIG3 のカードの差（フェーズ実施中は開始から）
      r.phases.list(),
    ]);
    return { parts, exercises, rows, settings, volumeRange, balanceRange, phases };
  });
  // 部位のバランスの期間。選んだら端末に覚える。種目を選んで「すべて」に戻ったときも選んだままにするため、ここに置く
  const repos = useRepos();
  const [pickedBalance, setPickedBalance] = useState<BalanceRange | null>(null);
  const balanceRange: BalanceView = target === 'parts' ? '28d' : pickedBalance ?? data?.balanceRange ?? '2w';
  const chooseBalance = (k: BalanceRange) => {
    setPickedBalance(k);
    // 28日を外す（総負荷量の「日」で来たときは、そちらはそのまま）
    if (target === 'parts') onRangeChosen?.();
    repos.settings.setBalanceRange(k).catch(() => {});
  };
  const unit = data?.settings.weightUnit ?? 'kg';
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const exercises = useMemo(() => data?.exercises ?? [], [data]);

  // チップに出す種目：記録のある種目（非表示の種目も）。並びは部位の順、その中は種目の順
  const chipExercises = useMemo(() => {
    const withRecords = new Set(rows.map((r) => r.exerciseId));
    return exercises.filter((e) => withRecords.has(e.id));
  }, [rows, exercises]);
  const exercise = exercises.find((e) => e.id === exerciseId);

  if (error) return <LoadError onRetry={reload} />;
  if (data && rows.length === 0) {
    return <EmptyState title="まだ記録がありません" body={'「記録」の「種目を追加」から記録すると、\nここにグラフが出ます'} />;
  }

  return (
    <>
      <View style={{ marginTop: 14 }}>
        <ChipRow>
          <Chip label="すべて" active={exerciseId === ALL} onPress={() => setExerciseId(ALL)} />
          {chipExercises.map((e) => <Chip key={e.id} label={e.name} active={exerciseId === e.id} onPress={() => setExerciseId(e.id)} />)}
        </ChipRow>
      </View>
      {!data ? null : exercise ? (
        <ExerciseTrendView key={exercise.id} rows={rows} exercise={exercise} today={today} unit={unit} reloadKey={data} onOpenDay={onOpenDay} onError={reload}
          scrollRequest={focus?.exercise === exercise.id ? focus.n : null} />
      ) : (
        <AllGraph data={data} today={today} unit={unit} onPick={setExerciseId} balanceRange={balanceRange} onBalanceRange={chooseBalance}
          target={target} scrollRequest={focus?.n ?? null} onRangeChosen={onRangeChosen} />
      )}
    </>
  );
}

/**
 * 種目を選んだときの推移：推定1RM の折れ線（3か月。回数だけの種目は総負荷量）と、その種目の記録の一覧（新しい順に10日ずつ）。
 * カードを押すと、記録のタブのその日へ
 */
function ExerciseTrendView({ rows, exercise, today, unit, reloadKey, onOpenDay, onError, scrollRequest }: {
  rows: TrainingSetRow[]; exercise: Exercise; today: string; unit: 'kg' | 'lb'; reloadKey: unknown;
  onOpenDay: (date: string) => void; onError: () => Promise<unknown>; scrollRequest: number | null;
}) {
  const [pages, setPages] = useState(1);
  const allDays = useMemo(() => trendDays(rows, exercise.id), [rows, exercise.id]);
  const shownDays = allDays.slice(0, PAGE_DAYS * pages);
  const shownKey = shownDays.join(',');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [failed, setFailed] = useState(false);
  const repos = useRepos();
  useEffect(() => {
    let alive = true;
    // 読めなかったときは、読み直し（reload で reloadKey が変わる）でもう一度読む
    repos.workouts.getDays(shownKey === '' ? [] : shownKey.split(',')).then(
      (es) => { if (alive) { setEntries(es); setFailed(false); } },
      () => { if (alive) setFailed(true); },
    );
    return () => { alive = false; };
  }, [repos, shownKey, reloadKey]);
  const cards = shownDays.map((d) => ({ date: d, entry: entries.find((e) => e.date === d && e.exerciseId === exercise.id) }))
    .filter((c): c is { date: string; entry: Entry } => c.entry != null);

  if (failed) return <LoadError onRetry={onError} />;
  return (
    <>
      <ScrollTarget request={scrollRequest}><ExerciseLineCard rows={rows} exercise={exercise} today={today} unit={unit} /></ScrollTarget>
      <T variant="titleS" color={colors.sub} accessibilityRole="header" style={{ marginTop: space.xl }}>{exercise.name}の記録（新しい順）</T>
      {cards.map((c) => <ExerciseDayCard key={c.date} date={c.date} entry={c.entry} name={exercise.name} unit={unit} onPress={() => onOpenDay(c.date)} />)}
      {allDays.length > shownDays.length && (
        <Button
          label={`もっと見る（あと ${allDays.length - shownDays.length}日）`}
          variant="outline" small style={{ marginTop: space.m }}
          onPress={() => setPages((n) => n + 1)}
        />
      )}
    </>
  );
}

/** 種目の推定1RM（回数だけの種目は総負荷量）の、今の値と先月との差、3か月の折れ線 */
function ExerciseLineCard({ rows, exercise, today, unit }: { rows: TrainingSetRow[]; exercise: Exercise; today: string; unit: 'kg' | 'lb' }) {
  const from = addMonths(today, -EXERCISE_MONTHS);
  const weighted = exercise.recordType === 'weight_reps';
  const value = weighted ? (p: DailyPoint) => p.max1RM : (p: DailyPoint) => p.volume;
  const trend = exerciseTrend(rows, exercise.id, today, from, value);
  const conv = (kg: number) => kgToUnit(kg, unit);
  const fmt = weighted ? fmt1 : fmtInt;
  const title = `${exercise.name}の${weighted ? '推定1RM' : '総負荷量'}`;
  const diff = trend.current != null && trend.monthAgo != null ? conv(trend.current) - conv(trend.monthAgo) : null;
  const flat = (v: number) => Math.abs(v) < (weighted ? 0.05 : 0.5);
  const signed = (v: number) => (flat(v) ? '±0' : `${v > 0 ? '+' : '−'}${fmt(Math.abs(v))}`);
  return (
    <Card style={{ marginTop: 14 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: space.s }}>
        <T variant="titleM" accessibilityRole="header" style={{ flexShrink: 1 }}>{title}</T>
        <T variant="bodyS" color={colors.sub}>{EXERCISE_MONTHS}か月</T>
      </View>
      {trend.current == null ? (
        <T variant="bodyM" color={colors.sub} style={{ marginTop: space.s }} testID="exercise-trend-empty">
          {weighted ? '重量 × 回数の記録があると、推定1RM が出ます' : '体重の記録があると、自重の総負荷量が出ます'}
        </T>
      ) : (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.s, marginTop: space.s, flexWrap: 'wrap' }} testID="exercise-trend-value">
            <CountUpText num bold size={40} value={conv(trend.current)} format={fmt} animKey={exercise.id} />
            <T variant="bodyM" color={colors.sub}>{unit}</T>
            {diff != null && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, marginLeft: space.s }}>
                <Icon name={flat(diff) ? 'arrowFlat' : diff > 0 ? 'arrowUp' : 'arrowDown'} size={16} color={!flat(diff) && diff < 0 ? colors.danger : colors.accent} />
                <T variant="labelL" color={!flat(diff) && diff < 0 ? colors.danger : colors.accent}>{signed(diff)} {unit}</T>
                <T variant="bodyS" color={colors.sub}>先月より</T>
              </View>
            )}
          </View>
          {trend.points.length >= 2 ? (
            <View accessible accessibilityLabel={`${title}のグラフ。${EXERCISE_MONTHS}か月。今 ${fmt(conv(trend.current))}${unit}`}>
              <LineChart
                points={datePoints(trend.points, (p) => conv(value(p)), from, today)}
                xLabels={dateLabels(from, today, 4)}
                formatY={(v) => fmtInt(v)}
                animKey={exercise.id}
              />
            </View>
          ) : (
            <T variant="bodyS" color={colors.sub} style={{ marginTop: space.s }}>{EXERCISE_MONTHS}か月の記録が2日以上になると、折れ線が出ます</T>
          )}
        </>
      )}
    </Card>
  );
}

/** 種目の記録の、1日のカード（日付と種目と部位の札、セット、総負荷量と推定1RM）。押すと記録のタブのその日 */
function ExerciseDayCard({ date, entry, name, unit, onPress }: { date: string; entry: Entry; name: string; unit: 'kg' | 'lb'; onPress: () => void }) {
  const best = bestSet(entry.sets);
  return (
    <Card style={{ marginTop: space.m }}>
      <PressableScale accessibilityRole="button" scaleTo={0.98} onPress={onPress} testID={`trend-day-${date}`}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: 24 }}>
          <T variant="titleM" style={{ flexShrink: 1 }}>{formatJpDate(date)} {name}</T>
          <PartBadge name={entry.bodyPartName} />
          <View style={{ flex: 1 }} />
          <Icon name="chevron" size={20} color={colors.sub} />
        </View>
        <View style={{ gap: space.s, marginTop: space.m }}>
          {entry.sets.map((st, i) => (
            <View key={st.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <SetNo n={i + 1} />
              <T variant="titleM">{formatSetLong(st.weightKg, st.reps, unit)}</T>
              {st.memo !== '' && <T variant="bodyS" color={colors.sub} numberOfLines={1} style={{ flexShrink: 1 }}>{st.memo}</T>}
            </View>
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: space.s, marginTop: space.m }}>
          <Tile label="総負荷量" value={`${fmtInt(kgToUnit(totalVolume(entry.sets), unit))} ${unit}`} />
          {best && <Tile label="推定1RM" value={`${fmt1(kgToUnit(best.e1rm, unit))} ${unit}`} />}
        </View>
      </PressableScale>
    </Card>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.input, borderRadius: 10, padding: 10, gap: 2 }}>
      <T variant="labelM" color={colors.sub}>{label}</T>
      <T num bold size={20}>{value}</T>
    </View>
  );
}

/** 日ごとの総負荷量に出す週の数（週ごとと同じ月曜始まりの 28 日） */
const DAILY_WEEKS = 4;
const WEEKLY_WEEKS = 8;

function AllGraph({ data, today, unit, onPick, balanceRange, onBalanceRange, target, scrollRequest, onRangeChosen }: {
  data: {
    parts: { id: string; name: string }[]; exercises: Exercise[];
    rows: Parameters<typeof weeklyVolumeByBodyPart>[0]; volumeRange: VolumeRange; phases: Phase[];
  };
  today: string; unit: 'kg' | 'lb'; onPick: (exerciseId: string) => void;
  balanceRange: BalanceView; onBalanceRange: (k: BalanceRange) => void;
  /** ホームから来たときに見せるグラフ（スクロールする）。load なら総負荷量を日ごとで（ホームの LOAD の今週と先週の日ごとの棒がある） */
  target: TrendTarget | null; scrollRequest: number | null; onRangeChosen?: () => void;
}) {
  const repos = useRepos();
  const [pickedRange, setRange] = useState<VolumeRange>(data.volumeRange);
  const range: VolumeRange = target === 'load' ? 'day' : pickedRange;
  const chooseRange = (k: VolumeRange) => {
    setRange(k);
    // 「日」を外す（部位のバランスの 28日で来たときは、そちらはそのまま）
    if (target === 'load') onRangeChosen?.();
    repos.settings.setVolumeRange(k).catch(() => {});
  };
  const scrollTo = (t: TrendTarget) => (target === t ? scrollRequest : null);
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
  // ホームの計器と同じカード（BIG3・LOAD）。集計もホームと同じ（lib/homeHud.ts）。BIG3 の差の基準は、実施中か療養で止めている通常のフェーズの開始時
  const phaseStart = normalPhaseOf(heroPhase(data.phases, [], today))?.phase.snapshot?.big3 ?? null;
  const big3 = big3Gauge(data.rows, big3Assignments(data.exercises), today, phaseStart);
  const load = loadGauge(data.rows, today);
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart(today), i));

  return (
    <>
      <ScrollTarget request={scrollTo('big3')} testID="trend-big3">
        <View style={s.gaugeRow}><Big3Panel gauge={big3} unit={unit} ready link={false} testID="trend-big3-gauge" /></View>
        <Big3Card rows={data.rows} exercises={data.exercises} today={today} unit={unit} />
      </ScrollTarget>
      <ScrollTarget request={scrollTo('parts')}>
        <PartBalanceCard rows={data.rows} parts={data.parts} today={today} range={balanceRange} onRange={onBalanceRange} />
      </ScrollTarget>
      <ScrollTarget request={scrollTo('load')} testID="trend-volume">
      <View style={s.gaugeRow}><LoadPanel gauge={load} dates={weekDates} today={today} unit={unit} ready link={false} testID="trend-load-gauge" /></View>
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
      </ScrollTarget>
      <ScrollTarget request={scrollTo('best')} testID="trend-best">
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
      </ScrollTarget>
    </>
  );
}

/** 推移のグラフの期間（BIG3 の合計） */
const BIG3_MONTHS = 3;

/**
 * BIG3 の推定1RM の合計（3か月の折れ線）、今の合計と先月との差、3種目それぞれの値と差。
 * 3種目がそろわないあいだは、記録がある種目だけの合計に、入っている種目の添え書きと、何を割り当てる（記録する）と合計に加わるかを添える。
 * 1種目も記録がなければ、合計とグラフは出さず、案内だけ
 */
function Big3Card({ rows, exercises, today, unit }: {
  rows: Parameters<typeof big3Trend>[0]; exercises: Exercise[]; today: string; unit: 'kg' | 'lb';
}) {
  const from = addMonths(today, -BIG3_MONTHS);
  const trend = big3Trend(rows, big3Assignments(exercises), today, from);
  const conv = (kg: number) => kgToUnit(kg, unit);
  const partialNote = big3PartialNote(trend);
  const names = (rs: Big3Role[]) => rs.map((r) => BIG3_LABELS[r]).join('・');
  const diff = trend.total != null && trend.totalMonthAgo != null ? conv(trend.total) - conv(trend.totalMonthAgo) : null;
  const signed = (v: number) => (Math.abs(v) < 0.05 ? '±0' : `${v > 0 ? '+' : '−'}${fmt1(Math.abs(v))}`);
  return (
    <Card style={{ marginTop: 14 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <T variant="titleM" accessibilityRole="header">BIG3 の推定1RM（合計）</T>
        <T variant="bodyS" color={colors.sub}>{BIG3_MONTHS}か月</T>
      </View>
      {trend.total != null && (
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
          {partialNote != null && <T variant="labelM" color={colors.sub} style={{ marginTop: space.xs }} testID="big3-partial">{partialNote}</T>}
          {trend.points.length >= 2 && (
            <View accessible accessibilityLabel={`BIG3 の推定1RM の合計のグラフ。${BIG3_MONTHS}か月。今 ${fmt1(conv(trend.total))}${unit}${partialNote ? `。${partialNote}` : ''}`}>
              <LineChart
                points={datePoints(trend.points, (p) => conv(p.total), from, today)}
                xLabels={dateLabels(from, today, 4)}
                formatY={(v) => fmtInt(v)}
                animKey="big3"
              />
            </View>
          )}
        </>
      )}
      {(trend.unassigned.length > 0 || trend.noRecord.length > 0) && (
        <View style={{ marginTop: space.s, gap: space.xs }} testID="big3-missing">
          {trend.unassigned.length > 0 && (
            <T variant="bodyM" color={colors.sub}>あと {names(trend.unassigned)} を割り当てると合計{trend.total != null ? 'に加わります' : 'が出ます'}</T>
          )}
          {trend.noRecord.length > 0 && (
            <T variant="bodyM" color={colors.sub}>{names(trend.noRecord)}の記録（重量 × 回数）が{trend.total != null ? 'あると合計に加わります' : 'そろうと合計が出ます'}</T>
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

/** 期間の切り替えにチェックの印を出せる幅（チェック付きの「これまで」が切れない 108dp × 3。360 の幅の画面では足りないので印を出さない） */
const CHECK_MIN_WIDTH = 324;

/**
 * 部位のバランス（Figma 筋トレ 1-4-2）。期間は 2週・3か月・これまで。ホームの PARTS から来たときだけ、ホームのレーダーと同じ 28日
 * （直近28日と、点線で前の28日。2 つの期間の大きさをそろえる。切り替えには出さない）。
 * 軸の名前の横に、その期間のセット数。これまでのときは直近2週を点線で重ねる（成長を見るの⑤と同じ部品）。
 * 画面に入ったとき・期間を変えたときに中心から広がる（1200ms、ease-out。動きを減らす設定ならすぐ）
 */
function PartBalanceCard({ rows, parts, today, range, onRange }: {
  rows: TrainingSetRow[]; parts: { id: string; name: string }[]; today: string; range: BalanceView; onRange: (k: BalanceRange) => void;
}) {
  const { balance, recent } = useMemo(() => {
    const names = new Map(parts.map((p) => [p.id, p.name]));
    return partBalanceForRange(rows, (id) => names.get(id) ?? '', range, today);
  }, [rows, parts, range, today]);
  // 期間を変えたら、形が同じでも中心から広げ直す（記録が直近2週だけなら、どの期間も同じ形になる）
  const sig = `${range}:${balance.sets.join(',')}:${recent?.sets.join(',') ?? ''}`;
  const { token } = useEntrance(balance, sig);
  const [width, setWidth] = useState(0);
  const top = topPart(balance);
  const names = range === '28d' ? { all: '直近28日', recent: recentLabel(range) } : undefined;
  const note = recent ? partsNote(balance, recent, names) : top && `外周は、この期間でいちばん多い部位（${top}）`;
  return (
    <Card style={{ marginTop: 14 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <T variant="titleM" accessibilityRole="header">部位のバランス</T>
        <T variant="bodyS" color={colors.sub}>セット数</T>
      </View>
      <View style={{ marginTop: space.s }}>
        {/* 28日（ホームから来たとき）は切り替えに出さないので、どれも選んでいない形になる */}
        <Segmented<BalanceView> options={BALANCE_RANGES} value={range} onChange={(k) => onRange(k as BalanceRange)} check={width === 0 || width >= CHECK_MIN_WIDTH} />
      </View>
      <View accessible accessibilityLabel={partBalanceRangeLabel(range, balance, recent)} testID="trend-part-balance" style={{ marginTop: space.s, gap: space.s }}>
        {recent && balance.total > 0 && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 20, height: 0, borderTopWidth: 2, borderColor: colors.accent }} />
            <T variant="labelS" bold={false}>{names?.all ?? 'これまで'}</T>
            <View style={{ width: 20, height: 0, borderTopWidth: 2, borderColor: colors.text, borderStyle: 'dashed', marginLeft: space.l }} />
            <T variant="labelS" bold={false}>{recentLabel(range)}</T>
          </View>
        )}
        <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
          {width > 0 && <PartStackRadar all={balance} recent={recent} width={width} token={token} fillId="trendPartFill" testID="trend-part-radar" />}
        </View>
        <T variant="labelS" bold={false} color={colors.sub}>
          {balance.total === 0 ? 'この期間の記録はありません（胸・肩・背中・腕・脚・腹のセット数を数えます）' : note}
        </T>
      </View>
    </Card>
  );
}

const s = StyleSheet.create({
  // ホームの計器の段と同じく横の並びに置く（計器は flex: 1 で、並びの幅いっぱい）
  gaugeRow: { flexDirection: 'row', marginTop: 14 },
});
