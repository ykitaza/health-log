import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { LineChart } from '@/components/charts';
import { Screen } from '@/components/Screen';
import { T } from '@/components/Text';
import { Card, Chip, ChipRow, EmptyState, Header, Segmented } from '@/components/ui';
import { useFocusData } from '@/hooks/data';
import { BODY_METRICS, BodyMetric, metricValue } from '@/lib/body';
import { dateLabels, datePoints } from '@/lib/chart';
import { formatJpDate, todayKey } from '@/lib/date';
import { filterSince, Period, PERIOD_LABELS, periodStart } from '@/lib/training';
import { fmt1, kgToUnit } from '@/lib/units';
import { colors } from '@/theme';

const METRICS = Object.keys(BODY_METRICS) as BodyMetric[];
const WEIGHT_METRICS = new Set<BodyMetric>(['weight', 'fatMass', 'leanMass', 'muscleMass']);
const PERIODS: Period[] = ['1m', '3m', '6m', '1y'];

/** 体組成の項目の推移 */
export default function BodyTrendScreen() {
  const params = useLocalSearchParams<{ metric?: string }>();
  const [metric, setMetric] = useState<BodyMetric>(METRICS.includes(params.metric as BodyMetric) ? (params.metric as BodyMetric) : 'weight');
  const [period, setPeriod] = useState<Period>('1m');
  const today = todayKey();
  const { data } = useFocusData(async (r) => {
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

  return (
    <Screen>
      <Header title={BODY_METRICS[metric].trendTitle} onBack={() => router.back()} />
      <View style={{ marginTop: 6 }}>
        <ChipRow>
          {METRICS.map((m) => <Chip key={m} label={BODY_METRICS[m].label} active={m === metric} onPress={() => setMetric(m)} />)}
        </ChipRow>
      </View>
      <View style={{ marginTop: 12 }}>
        <Segmented options={PERIODS.map((p) => ({ key: p, label: PERIOD_LABELS[p] }))} value={period} onChange={setPeriod} />
      </View>
      {metric === 'bmi' && height == null && <T size={12} color={colors.sub} style={{ marginTop: 10 }}>BMI は、設定で身長を入れると出ます</T>}
      {!last ? (
        <EmptyState icon="chart" title="この期間の記録がありません" body="体組成の画面で記録すると、ここに推移が出ます" />
      ) : (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 18 }}>
            <T num bold size={60}>{fmt1(conv(last.value))}</T>
            <T size={16} color={colors.sub}>{unitLabel}</T>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {change != null && (
              <T bold size={13} color={colors.accent}>{PERIOD_LABELS[period]}で {change >= 0 ? '+' : '−'}{fmt1(Math.abs(conv(change)))}{unitLabel}</T>
            )}
            <T size={12} color={colors.sub}>{formatJpDate(last.date)} 時点</T>
          </View>
          <Card style={{ marginTop: 14 }}>
            {inRange.length >= 2 ? (
              <LineChart points={datePoints(inRange, (p) => conv(p.value), from, today)} xLabels={dateLabels(from, today, 4)} formatY={(v) => fmt1(v)} />
            ) : (
              <T size={13} color={colors.sub}>記録が2日以上になると、グラフが出ます</T>
            )}
          </Card>
          <T bold size={13} color={colors.sub} style={{ marginTop: 18, marginBottom: 8 }}>記録</T>
          <Card style={{ padding: 0 }}>
            {[...inRange].reverse().map((p, i) => (
              <View key={p.date} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderTopColor: colors.line }}>
                <View style={{ flex: 1 }}>
                  <T size={15}>{formatJpDate(p.date)}</T>
                  {p.memo !== '' && <T size={12} color={colors.sub}>{p.memo}</T>}
                </View>
                <T num bold size={22}>{fmt1(conv(p.value))}</T>
                <T size={11} color={colors.sub} style={{ marginLeft: 4 }}>{unitLabel}</T>
              </View>
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}
