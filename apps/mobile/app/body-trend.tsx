import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { LineSwatch } from '@/components/BodyTrend';
import { CountUpText, LineChart } from '@/components/charts';
import { LoadError } from '@/components/LoadError';
import { Screen } from '@/components/Screen';
import { T } from '@/components/Text';
import { Card, Chip, ChipRow, EmptyState, Header, SectionTitle, Segmented } from '@/components/ui';
import { useFocusData } from '@/hooks/data';
import { BODY_METRICS, BodyMetric, goalProgress, metricValue, movingAverage } from '@/lib/body';
import { dateLabels, datePoints } from '@/lib/chart';
import { formatJpDate, todayKey } from '@/lib/date';
import { filterSince, Period, PERIOD_LABELS, periodStart } from '@/lib/training';
import { fmt1, kgToUnit } from '@/lib/units';
import { colors, space } from '@/theme';

const METRICS = Object.keys(BODY_METRICS) as BodyMetric[];
const WEIGHT_METRICS = new Set<BodyMetric>(['weight', 'fatMass', 'leanMass']);
const PERIODS: Period[] = ['1m', '3m', '6m', '1y'];

/** 体組成の項目の推移 */
export default function BodyTrendScreen() {
  const params = useLocalSearchParams<{ metric?: string }>();
  const [metric, setMetric] = useState<BodyMetric>(METRICS.includes(params.metric as BodyMetric) ? (params.metric as BodyMetric) : 'weight');
  const [period, setPeriod] = useState<Period>('1m');
  const today = todayKey();
  const { data, error, reload } = useFocusData(async (r) => {
    const [daily, settings] = await Promise.all([r.body.listDaily(), r.settings.get()]);
    return { daily, settings };
  });
  const unit = data?.settings.weightUnit ?? 'kg';
  const height = data?.settings.heightCm ?? null;
  const isWeight = WEIGHT_METRICS.has(metric);
  const conv = (v: number) => (isWeight ? kgToUnit(v, unit) : v);
  const unitLabel = isWeight ? unit : BODY_METRICS[metric].unit;

  const points = (data?.daily ?? [])
    .filter((d) => d.date <= today)
    .map((d) => ({ date: d.date, memo: d.memo, value: metricValue(d, metric, height) }))
    .filter((p): p is { date: string; memo: string; value: number } => p.value != null);
  const from = periodStart(today, period)!;
  const inRange = filterSince(points, from);
  const last = inRange[inRange.length - 1];
  const change = inRange.length >= 2 ? inRange[inRange.length - 1].value - inRange[0].value : null;
  // 体重だけ：7日の平均の線（範囲より前の記録も入れて出す）と、目標までの残り（いちばん新しい記録から）
  const weight = metric === 'weight';
  const avg = weight ? filterSince(movingAverage(points), from) : [];
  const goal = data?.settings.goalWeightKg ?? null;
  const progress = weight && last && goal != null ? goalProgress(last.value, goal, null) : null;

  if (error) return <Screen><Header title={BODY_METRICS[metric].trendTitle} onBack={() => router.back()} /><LoadError onRetry={reload} /></Screen>;

  return (
    <Screen>
      <Header title={BODY_METRICS[metric].trendTitle} onBack={() => router.back()} />
      <View style={{ marginTop: space.xs }}>
        <ChipRow>
          {METRICS.map((m) => <Chip key={m} label={BODY_METRICS[m].label} active={m === metric} onPress={() => setMetric(m)} />)}
        </ChipRow>
      </View>
      <View style={{ marginTop: space.s }}>
        <Segmented options={PERIODS.map((p) => ({ key: p, label: PERIOD_LABELS[p] }))} value={period} onChange={setPeriod} />
      </View>
      {metric === 'bmi' && height == null && <T variant="bodyS" color={colors.sub} style={{ marginTop: space.s }}>BMI は、設定で身長を入れると出ます</T>}
      {!last ? (
        <EmptyState icon="chart" title="この期間の記録がありません" body="からだのタブで記録すると、ここに推移が出ます" />
      ) : (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.xs, marginTop: space.l }}>
            <CountUpText variant="numDisplay" value={conv(last.value)} format={fmt1} animKey={`${metric}-${period}`} />
            <T variant="bodyL" color={colors.sub}>{unitLabel}</T>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.s, flexWrap: 'wrap' }}>
            {change != null && (
              <CountUpText
                variant="labelL" color={colors.accent} value={Math.abs(conv(change))} animKey={`${metric}-${period}`}
                format={(v) => `${PERIOD_LABELS[period]}で ${change >= 0 ? '+' : '−'}${fmt1(v)}${unitLabel}`}
              />
            )}
            <T variant="bodyS" color={colors.sub}>{formatJpDate(last.date)} 時点</T>
          </View>
          {progress && (
            <T variant="bodyM" color={colors.sub} testID="trend-goal">
              {progress.direction === 'reached' ? '目標に届きました' : `目標まで あと ${fmt1(conv(progress.remaining))} ${unitLabel}`}
            </T>
          )}
          <Card style={{ marginTop: space.l }}>
            {inRange.length >= 2 ? (
              <>
                {weight && (
                  <View style={s.legend}>
                    <View style={s.legendItem}><LineSwatch color={colors.accent} dot /><T variant="bodyS" color={colors.sub}>記録</T></View>
                    <View style={s.legendItem}><LineSwatch color={colors.sub} /><T variant="bodyS" color={colors.sub}>7日の平均</T></View>
                  </View>
                )}
                <LineChart
                  points={datePoints(inRange, (p) => conv(p.value), from, today)}
                  avg={weight ? datePoints(avg, (p) => conv(p.value), from, today) : undefined}
                  xLabels={dateLabels(from, today, 4)} formatY={(v) => fmt1(v)} animKey={`${metric}-${period}`}
                />
              </>
            ) : (
              <T variant="bodyM" color={colors.sub}>記録が2日以上になると、グラフが出ます</T>
            )}
          </Card>
          <SectionTitle title="記録" />
          <Card style={{ padding: 0 }}>
            {[...inRange].reverse().map((p, i) => (
              <View key={p.date} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: space.l, paddingVertical: space.s, borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderTopColor: colors.line }}>
                <View style={{ flex: 1 }}>
                  <T variant="bodyL">{formatJpDate(p.date)}</T>
                  {p.memo !== '' && <T variant="bodyS" color={colors.sub}>{p.memo}</T>}
                </View>
                <T variant="numM" bold>{fmt1(conv(p.value))}</T>
                <T variant="bodyS" color={colors.sub} style={{ marginLeft: space.xs }}>{unitLabel}</T>
              </View>
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  legend: { flexDirection: 'row', gap: space.l, marginBottom: space.s },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: space.s },
});
