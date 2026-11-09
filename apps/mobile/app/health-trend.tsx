import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { LineChart, StackedBarChart, useCountUp } from '@/components/charts';
import { LoadError } from '@/components/LoadError';
import { Screen } from '@/components/Screen';
import { T } from '@/components/Text';
import { Button, Card, EmptyState, Header, SectionTitle, Segmented } from '@/components/ui';
import type { HeartRateDay, SleepDay } from '@/db/repositories/health';
import { useFocusData } from '@/hooks/data';
import { dateLabels, datePoints } from '@/lib/chart';
import { formatJpDate, formatShortDate, todayKey } from '@/lib/date';
import { average, averageClock, formatClock, formatHM } from '@/lib/health';
import { Period, PERIOD_LABELS, periodStart } from '@/lib/training';
import { colors, space } from '@/theme';

type Kind = 'sleep' | 'heart';
const PERIODS: Period[] = ['1m', '3m', '6m', '1y'];
const TITLES: Record<Kind, string> = { sleep: '睡眠の推移', heart: '安静時心拍の推移' };

/**
 * 睡眠・安静時心拍の推移（からだのタブの睡眠・心拍の行から開く）。体重の推移と同じ作り：期間の切り替え、大きな数字、グラフ、日ごとの一覧。
 * Health Connect から取り込んだ記録がないときは、つなぐ画面への導線を出す
 */
export default function HealthTrendScreen() {
  const params = useLocalSearchParams<{ kind?: string }>();
  const kind: Kind = params.kind === 'heart' ? 'heart' : 'sleep';
  const [period, setPeriod] = useState<Period>('1m');
  const today = todayKey();
  // いちばん長い期間（1年）を読んで、期間ごとに絞る
  const { data, error, reload } = useFocusData(async (r) => {
    const from = periodStart(today, '1y')!;
    const [sleep, heart] = await Promise.all([r.health.sleepDays(from, today), r.health.heartRateDays(from, today)]);
    return { sleep, heart };
  }, today);
  const from = periodStart(today, period)!;
  const title = TITLES[kind];

  if (error) return <Screen><Header title={title} onBack={() => router.back()} /><LoadError onRetry={reload} /></Screen>;

  const all = kind === 'sleep' ? data?.sleep ?? [] : (data?.heart ?? []).filter((h) => h.restingBpm != null);
  const inRange = all.filter((d) => d.date >= from);

  return (
    <Screen>
      <Header title={title} onBack={() => router.back()} />
      <View style={{ marginTop: space.s }}>
        <Segmented options={PERIODS.map((p) => ({ key: p, label: PERIOD_LABELS[p] }))} value={period} onChange={setPeriod} />
      </View>
      {data && all.length === 0 ? (
        <EmptyState
          icon={kind === 'sleep' ? 'moon' : 'heart'}
          title="まだ記録がありません"
          body={'Health Connect をつなぐと、ここに出ます。\n体重計や腕時計の睡眠・心拍を取り込みます'}
          action={
            <View style={{ gap: space.s }}>
              <Button label="Health Connect をつなぐ" onPress={() => router.push('/health-connect')} />
              <T variant="bodyS" color={colors.sub} align="center">設定 › Health Connect からもつなげます</T>
            </View>
          }
        />
      ) : data && inRange.length === 0 ? (
        <EmptyState icon="chart" title="この期間の記録がありません" body="期間を長くすると、前の記録を見られます" />
      ) : data && kind === 'sleep' ? (
        <SleepTrend days={inRange as SleepDay[]} period={period} />
      ) : data ? (
        <HeartTrend days={inRange as HeartRateDay[]} period={period} from={from} today={today} />
      ) : null}
    </Screen>
  );
}

/** 横の目盛り：始め・真ん中・終わりの日だけに日付を出す */
const barLabel = (i: number, n: number, date: string) => (i === 0 || i === n - 1 || i === Math.floor((n - 1) / 2) ? formatShortDate(date) : '');

function SleepTrend({ days, period }: { days: SleepDay[]; period: Period }) {
  const animKey = `sleep-${period}`;
  const avg = average(days.map((d) => d.asleepMin)) ?? 0;
  const shown = Math.round(useCountUp(avg, animKey));
  const bed = averageClock(days.map((d) => d.mainStartAt), true);
  const wake = averageClock(days.map((d) => d.mainEndAt), false);
  const last = days[days.length - 1];
  const max = Math.max(9 * 60, ...days.map((d) => d.asleepMin));
  return (
    <>
      <T variant="bodyS" color={colors.sub} style={{ marginTop: space.l }}>{PERIOD_LABELS[period]}の平均（眠っていた時間）</T>
      <View style={s.big} testID="sleep-average" accessible accessibilityLabel={`${PERIOD_LABELS[period]}の平均 ${Math.floor(avg / 60)}時間${Math.round(avg % 60)}分`}>
        <T variant="numDisplay">{Math.floor(shown / 60)}</T>
        <T variant="bodyL" color={colors.sub}>時間</T>
        <T variant="numDisplay">{shown % 60}</T>
        <T variant="bodyL" color={colors.sub}>分</T>
      </View>
      <View style={s.meta}>
        <T variant="titleS">{days.length} 晩の記録</T>
        <T variant="bodyS" color={colors.sub}>{formatJpDate(last.date)}の朝まで</T>
      </View>
      <Card style={{ marginTop: space.l }}>
        <StackedBarChart
          animKey={animKey}
          max={max}
          refLine={avg}
          formatY={(v) => `${Math.round((v / 60) * 10) / 10}h`}
          bars={days.map((d, i) => ({
            label: barLabel(i, days.length, d.date),
            // 最新の晩だけ明るい緑、ほかは 3:1 以上の濃い緑
            segments: [{ value: d.asleepMin, color: i === days.length - 1 ? colors.accent : colors.accentMuted }],
          }))}
        />
        <View style={s.legend}>
          <View style={[s.swatch, { backgroundColor: colors.accent }]} />
          <T variant="bodyS" color={colors.sub}>最新の晩</T>
          <View style={s.dash} />
          <T variant="bodyS" color={colors.sub}>平均</T>
        </View>
      </Card>
      <View style={{ flexDirection: 'row', gap: space.m, marginTop: space.m }}>
        <Card style={{ flex: 1 }}>
          <T variant="bodyS" color={colors.sub}>寝た時刻の平均</T>
          <T variant="numM" bold>{bed == null ? '—' : formatHM(bed)}</T>
        </Card>
        <Card style={{ flex: 1 }}>
          <T variant="bodyS" color={colors.sub}>起きた時刻の平均</T>
          <T variant="numM" bold>{wake == null ? '—' : formatHM(wake)}</T>
        </Card>
      </View>
      <SectionTitle title="日ごと" />
      <Card style={{ padding: 0 }}>
        {[...days].reverse().map((d, i) => (
          <View key={d.date} style={[s.row, i > 0 && s.rowLine]} testID={`sleep-${d.date}`}>
            <View style={{ flex: 1 }}>
              <T variant="bodyL">{formatJpDate(d.date)}</T>
              <T variant="bodyS" color={colors.sub}>
                {formatClock(d.mainStartAt)}〜{formatClock(d.mainEndAt)}{d.sessions > 1 ? `（ほか ${d.sessions - 1} 回）` : ''}
              </T>
            </View>
            <T variant="numM" bold>{formatHM(d.asleepMin)}</T>
          </View>
        ))}
      </Card>
    </>
  );
}

function HeartTrend({ days, period, from, today }: { days: HeartRateDay[]; period: Period; from: string; today: string }) {
  const animKey = `heart-${period}`;
  const last = days[days.length - 1];
  const shown = Math.round(useCountUp(last.restingBpm ?? 0, animKey));
  const avg = average(days.map((d) => d.restingBpm!));
  const r = (n: number) => String(Math.round(n));
  return (
    <>
      <T variant="bodyS" color={colors.sub} style={{ marginTop: space.l }}>直近の安静時心拍（{formatJpDate(last.date)}）</T>
      <View style={s.big} testID="heart-latest" accessible accessibilityLabel={`直近の安静時心拍 ${r(last.restingBpm ?? 0)} 拍/分`}>
        <T variant="numDisplay">{shown}</T>
        <T variant="bodyL" color={colors.sub}>bpm</T>
      </View>
      <View style={s.meta}>
        <T variant="titleS">{PERIOD_LABELS[period]}の平均 {avg == null ? '—' : r(avg)} bpm</T>
        <T variant="bodyS" color={colors.sub}>{days.length} 日の記録</T>
      </View>
      <Card style={{ marginTop: space.l }}>
        {days.length >= 2 ? (
          <LineChart points={datePoints(days, (d) => d.restingBpm!, from, today)} xLabels={dateLabels(from, today, 3)} formatY={r} animKey={animKey} />
        ) : (
          <T variant="bodyM" color={colors.sub}>記録が2日以上になると、グラフが出ます</T>
        )}
      </Card>
      <SectionTitle title="日ごと" />
      <Card style={{ padding: 0 }}>
        {[...days].reverse().map((d, i) => (
          <View key={d.date} style={[s.row, i > 0 && s.rowLine]} testID={`heart-${d.date}`}>
            <View style={{ flex: 1 }}>
              <T variant="bodyL">{formatJpDate(d.date)}</T>
              {d.avgBpm != null && (
                <T variant="bodyS" color={colors.sub}>
                  平均 {r(d.avgBpm)}{d.minBpm != null && d.maxBpm != null ? `（${r(d.minBpm)}〜${r(d.maxBpm)}）` : ''}
                </T>
              )}
            </View>
            <T variant="numM" bold>{d.restingBpm == null ? '—' : r(d.restingBpm)}</T>
            <T variant="bodyS" color={colors.sub} style={{ marginLeft: space.xs }}>bpm</T>
          </View>
        ))}
      </Card>
      <T variant="bodyS" color={colors.sub} style={{ marginTop: space.m }}>
        Health Connect から取り込んだ値です。一覧の補足は、その日の平均と最小〜最大です
      </T>
    </>
  );
}

const s = StyleSheet.create({
  big: { flexDirection: 'row', alignItems: 'baseline', gap: space.xs },
  meta: { flexDirection: 'row', alignItems: 'baseline', gap: space.s, flexWrap: 'wrap' },
  legend: { flexDirection: 'row', alignItems: 'center', gap: space.s, marginTop: space.s },
  swatch: { width: 12, height: 12, borderRadius: 2 },
  dash: { width: 16, height: 0, borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: colors.text, marginLeft: space.s },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: space.l, paddingVertical: space.s },
  rowLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
});
