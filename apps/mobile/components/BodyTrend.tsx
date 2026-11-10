import { router } from 'expo-router';
import { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import type { HeartRateDay, SleepDay } from '@/db/repositories/health';
import type { Settings } from '@/db/repositories/settings';
import { DailyBody, movingAverage, weightOverview } from '@/lib/body';
import { dateLabels, datePoints } from '@/lib/chart';
import { addDays } from '@/lib/date';
import { formatSigned } from '@/lib/format';
import { average, formatHM, sleepWeek } from '@/lib/health';
import { fmt1, kgToUnit } from '@/lib/units';
import { colors, space } from '@/theme';
import { LineChart, StackedBarChart } from './charts';
import { Icon, IconName } from './Icon';
import { PressableScale } from './motion';
import { T } from './Text';
import { Badge, Card } from './ui';

/**
 * からだのタブの「推移」。体重の推移（1か月、7日の平均、目標）、目標体重まで、睡眠・安静時心拍の直近7日。
 * カードを押すと、それぞれの詳しい推移の画面（body-trend、health-trend）へ
 */
export function BodyTrend({ daily, settings, sleep, heart, today }: {
  daily: DailyBody[]; settings: Settings; sleep: SleepDay[]; heart: HeartRateDay[]; today: string;
}) {
  const unit = settings.weightUnit;
  const goal = settings.goalWeightKg ?? null;
  const { from, recent, pace, progress, monthChange } = weightOverview(daily, goal, today);
  // 7日の平均は、表示の範囲より前の記録も入れて出し、範囲の分だけ描く
  const avg = movingAverage(daily.filter((d) => d.weightKg != null && d.date <= today).map((d) => ({ date: d.date, value: d.weightKg! })))
    .filter((p) => p.date >= from);
  const goalLabel = goal == null ? null : `目標 ${fmt1(kgToUnit(goal, unit))} ${unit}`;

  return (
    <View style={{ marginTop: space.l, gap: space.m }}>
      <PressableScale accessibilityRole="button" scaleTo={0.98} onPress={() => router.push({ pathname: '/body-trend', params: { metric: 'weight' } })}
        accessibilityLabel={['体重の推移', monthChange != null ? `1か月で ${formatSigned(kgToUnit(monthChange, unit))}${unit}` : null, goalLabel, '詳しく見る'].filter(Boolean).join('。')}>
        <Card>
          <View style={s.head}>
            <T variant="titleM">体重の推移</T>
            {monthChange != null && <T variant="labelL" color={colors.accent}>1か月で {formatSigned(kgToUnit(monthChange, unit))} {unit}</T>}
          </View>
          {recent.length >= 2 ? (
            <>
              <View style={s.legend}>
                <View style={s.legendItem}><LineSwatch color={colors.accent} dot /><T variant="bodyS" color={colors.sub}>記録</T></View>
                <View style={s.legendItem}><LineSwatch color={colors.sub} /><T variant="bodyS" color={colors.sub}>7日の平均</T></View>
              </View>
              <LineChart
                points={datePoints(recent, (p) => kgToUnit(p.weightKg, unit), from, today)}
                avg={datePoints(avg, (p) => kgToUnit(p.value, unit), from, today)}
                goal={goal != null && goalLabel ? { y: kgToUnit(goal, unit), label: goalLabel } : undefined}
                xLabels={dateLabels(from, today, 3)}
                showYAxis={false}
                height={140}
              />
            </>
          ) : (
            <T variant="bodyM" color={colors.sub}>この1か月の体重の記録が2日以上になると、グラフが出ます</T>
          )}
        </Card>
      </PressableScale>

      {progress && goal != null && (
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <T variant="titleM">目標体重まで</T>
            <T variant="bodyM" color={colors.sub}>目標 {fmt1(kgToUnit(goal, unit))}{unit}</T>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 6 }}>
            {progress.direction === 'reached' ? (
              <T variant="titleM" size={18} color={colors.accent}>目標に届きました</T>
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
                <T variant="bodyM" color={colors.sub}>あと</T>
                <T variant="numL">{fmt1(kgToUnit(progress.remaining, unit))}</T>
                <T variant="bodyS" color={colors.sub}>{unit}</T>
              </View>
            )}
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              {progress.weeks != null && <Badge label={`このペースで約${progress.weeks}週`} />}
              <T variant="bodyS" color={colors.sub} align="right">
                {pace == null ? '直近28日の記録が2つ以上あるとペースが出ます' : `直近28日のペース ${formatSigned(kgToUnit(pace, unit))}${unit}／週`}
              </T>
            </View>
          </View>
        </Card>
      )}

      <SleepCard days={sleep} today={today} />
      <HeartCard days={heart} today={today} />
    </View>
  );
}

/** 凡例の線の見本（記録は点つき、平均は線だけ。色だけで分けない） */
export function LineSwatch({ color, dot }: { color: string; dot?: boolean }) {
  return (
    <View style={{ width: 16, height: 8, justifyContent: 'center' }}>
      <View style={{ height: 2, borderRadius: 1, backgroundColor: color }} />
      {dot && <View style={{ position: 'absolute', left: 5, width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />}
    </View>
  );
}

/** 睡眠・心拍のカードの上の段：アイコンと題、右に「7日の平均」と値、› */
function TrendCard({ icon, title, average: avg, unit, label, onPress, testID, children }: {
  icon: IconName; title: string; average: string; unit?: string; label: string; onPress: () => void; testID: string; children: ReactNode;
}) {
  return (
    <PressableScale accessibilityRole="button" accessibilityLabel={label} scaleTo={0.98} onPress={onPress} testID={testID}>
      <Card>
        <View style={s.head}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, flexShrink: 1 }}>
            <Icon name={icon} size={24} color={colors.text} />
            <T variant="titleM" numberOfLines={1} style={{ flexShrink: 1 }}>{title}</T>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
            <T variant="bodyS" color={colors.sub}>7日の平均</T>
            <T variant="numM" bold>{avg}</T>
            {unit && <T variant="bodyS" color={colors.sub}>{unit}</T>}
            <Icon name="chevron" size={24} color={colors.sub} />
          </View>
        </View>
        {children}
      </Card>
    </PressableScale>
  );
}

/** 睡眠の直近7日の棒。7時間以上の日は明るい緑（どの日かは下の文でも出す） */
function SleepCard({ days, today }: { days: SleepDay[]; today: string }) {
  const week = sleepWeek(days, today);
  const open = () => router.push({ pathname: '/health-trend', params: { kind: 'sleep' } });
  const longText = week.longDays.length > 0 ? `7時間以上は ${week.longDays.length} 日（${week.longDays.join('・')}）` : '7時間以上の日はありません';
  if (week.average == null) {
    return (
      <TrendCard icon="moon" title="睡眠" average="—" label="睡眠。この7日の記録はありません。睡眠の推移を見る" onPress={open} testID="sleep-week">
        <T variant="bodyM" color={colors.sub} style={{ marginTop: space.s }}>この7日の記録はありません</T>
      </TrendCard>
    );
  }
  const max = Math.max(9 * 60, ...days.map((d) => d.asleepMin));
  return (
    <TrendCard icon="moon" title="睡眠" average={formatHM(week.average)} label={`睡眠。7日の平均 ${formatHM(week.average)}。${longText}。睡眠の推移を見る`} onPress={open} testID="sleep-week">
      <View style={{ marginTop: space.m }}>
        <StackedBarChart
          height={110}
          max={max}
          bars={week.days.map((d) => ({
            label: d.weekday,
            segments: d.asleepMin == null ? [] : [{ value: d.asleepMin, color: d.long ? colors.accent : colors.accentMuted }],
          }))}
        />
      </View>
      <T variant="bodyS" color={colors.sub} style={{ marginTop: space.s }}>{longText}</T>
    </TrendCard>
  );
}

/** 安静時心拍の直近7日の折れ線と平均 */
function HeartCard({ days, today }: { days: HeartRateDay[]; today: string }) {
  const from = addDays(today, -6);
  const rest = days.filter((d) => d.restingBpm != null && d.date >= from);
  const avg = average(rest.map((d) => d.restingBpm!));
  const open = () => router.push({ pathname: '/health-trend', params: { kind: 'heart' } });
  const r = (n: number) => String(Math.round(n));
  return (
    <TrendCard
      icon="heart" title="心拍（安静時）" average={avg == null ? '—' : r(avg)} unit={avg == null ? undefined : 'bpm'}
      label={avg == null ? '安静時心拍。この7日の記録はありません。安静時心拍の推移を見る' : `安静時心拍。7日の平均 ${r(avg)} 拍/分。安静時心拍の推移を見る`}
      onPress={open} testID="heart-week"
    >
      {rest.length >= 2 ? (
        <View style={{ marginTop: space.s }}>
          <LineChart points={datePoints(rest, (d) => d.restingBpm!, from, today)} xLabels={[]} showYAxis={false} height={72} />
        </View>
      ) : (
        <T variant="bodyM" color={colors.sub} style={{ marginTop: space.s }}>
          {rest.length === 0 ? 'この7日の記録はありません' : '記録が2日以上になると、グラフが出ます'}
        </T>
      )}
    </TrendCard>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.s, minHeight: 28 },
  legend: { flexDirection: 'row', gap: space.l, marginTop: space.xs, marginBottom: space.s },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: space.s },
});
