import { useState } from 'react';
import { LayoutChangeEvent, View } from 'react-native';
import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg';
import { LoadError } from '@/components/LoadError';
import { T } from '@/components/Text';
import { Badge, Card, IconButton } from '@/components/ui';
import { useFocusData } from '@/hooks/data';
import { niceTicks } from '@/lib/chart';
import { addDays, formatShortDate, todayKey, weekday } from '@/lib/date';
import { DaySummary, Gap, pfcRatio, weekDates, weeklyReview } from '@/lib/meals';
import { fmt1, fmtInt } from '@/lib/units';
import { colors, fonts } from '@/theme';

const WEEKDAY = ['日', '月', '火', '水', '木', '金', '土'];
const PFC_COLORS = { p: colors.accent, f: colors.star, c: '#6FA8FF' };

/** 食事の週のふり返り（MCP の weekly_review と同じ：最後の日までの7日。平均は記録した日だけ） */
export function MealWeekly() {
  const today = todayKey();
  const [lastDay, setLastDay] = useState(today);
  const { data, error, reload } = useFocusData((r) => r.meals.summaries(addDays(lastDay, -6), lastDay), lastDay);
  const days = data?.days ?? [];
  const review = weeklyReview(days);
  const avg = review.average;
  const ratio = avg ? pfcRatio(avg) : null;
  const targetRatio = review.averageTarget ? pfcRatio(review.averageTarget) : null;
  const includesToday = weekDates(lastDay).includes(today);

  if (error) return <View style={{ marginTop: 14 }}><LoadError onRetry={reload} /></View>;

  return (
    <View style={{ gap: 12, marginTop: 14 }}>
      <Card style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4, paddingHorizontal: 4 }}>
        <IconButton name="prev" label="前の週" bg="transparent" onPress={() => setLastDay(addDays(lastDay, -7))} />
        <T bold size={16}>{formatShortDate(addDays(lastDay, -6))}〜{formatShortDate(lastDay)}</T>
        <IconButton name="next" label="次の週" bg="transparent" disabled={lastDay >= today} color={lastDay >= today ? colors.line : colors.text}
          onPress={() => lastDay < today && setLastDay(addDays(lastDay, 7) > today ? today : addDays(lastDay, 7))} />
      </Card>

      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
          <T bold size={16}>1日の kcal</T>
          <T size={12} color={colors.sub}>線：とった kcal　点線：目標</T>
        </View>
        {days.length === 7 && <KcalChart days={days} />}
      </Card>

      <Card style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <T bold size={16}>PFC の割合（kcal）</T>
          {targetRatio && <T size={12} color={colors.sub}>目標 P{Math.round(targetRatio.p)}・F{Math.round(targetRatio.f)}・C{Math.round(targetRatio.c)}%</T>}
        </View>
        {ratio && avg ? (
          <>
            <View style={{ flexDirection: 'row', height: 12, borderRadius: 6, overflow: 'hidden', gap: 2 }}>
              <View style={{ flex: ratio.p, backgroundColor: PFC_COLORS.p }} />
              <View style={{ flex: ratio.f, backgroundColor: PFC_COLORS.f }} />
              <View style={{ flex: ratio.c, backgroundColor: PFC_COLORS.c }} />
            </View>
            <View style={{ flexDirection: 'row' }}>
              {([['p', 'P', avg.protein_g], ['f', 'F', avg.fat_g], ['c', 'C', avg.carbs_g]] as const).map(([k, letter, g]) => (
                <View key={k} style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: PFC_COLORS[k] }} />
                    <T num bold size={18}>{letter} {Math.round(ratio[k])}%</T>
                  </View>
                  <T size={11} color={colors.sub}>平均 {fmt1(g)}g／日</T>
                </View>
              ))}
            </View>
          </>
        ) : (
          <T size={13} color={colors.sub}>この週はまだ記録がありません</T>
        )}
      </Card>

      <Card style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <T bold size={16}>週の平均</T>
            <T size={12} color={colors.sub}>記録した日の平均です。{includesToday ? '今日の分は途中の値です。' : ''}</T>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }} testID="weekly-average-kcal">
              <T num bold size={30}>{avg ? fmtInt(avg.kcal) : '—'}</T>
              <T size={12} color={colors.sub}>kcal</T>
            </View>
            <Badge label={`記録 ${review.recordedDays}／7日`} color={colors.text} bg={colors.input} />
          </View>
        </View>
        {review.gap && <GapRow gap={review.gap} />}
      </Card>
    </View>
  );
}

/** 平均と目標の差（正なら目標より多い） */
function GapRow({ gap }: { gap: Gap }) {
  const f = (v: number | null, unit: string, fmt = fmt1) => (v == null ? '—' : `${v >= 0 ? '+' : '−'}${fmt(Math.abs(v))}${unit}`);
  return (
    <T size={12} color={colors.sub}>
      目標との差（平均）：{f(gap.kcal, 'kcal', fmtInt)}・P {f(gap.protein_g, 'g')}・F {f(gap.fat_g, 'g')}・C {f(gap.carbs_g, 'g')}
    </T>
  );
}

/** 日ごとの kcal（記録した日だけを結ぶ）と目標（点線） */
function KcalChart({ days }: { days: DaySummary[] }) {
  const [width, setWidth] = useState(300);
  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.max(100, e.nativeEvent.layout.width));
  const height = 170, left = 40, right = 10, top = 8, bottom = 36;
  const values = [...days.filter((d) => d.meals.length).map((d) => d.total.kcal), ...days.flatMap((d) => (d.target?.kcal != null ? [d.target.kcal] : []))];
  const ticks = values.length ? niceTicks(Math.min(...values), Math.max(...values)) : [0, 1000, 2000];
  const lo = ticks[0] ?? 0, hi = ticks[ticks.length - 1] ?? 1;
  const px = (i: number) => left + ((i + 0.5) / 7) * (width - left - right);
  const py = (v: number) => top + (1 - (v - lo) / (hi - lo || 1)) * (height - top - bottom);
  const recorded = days.map((d, i) => ({ d, i })).filter(({ d }) => d.meals.length > 0);
  const targetPoints = days.flatMap((d, i) => (d.target?.kcal != null ? [`${px(i) - 18},${py(d.target.kcal)}`, `${px(i) + 18},${py(d.target.kcal)}`] : []));
  return (
    <View onLayout={onLayout}>
      <Svg width={width} height={height}>
        {ticks.map((t) => <Line key={`g${t}`} x1={left} x2={width - right} y1={py(t)} y2={py(t)} stroke={colors.line} strokeWidth={1} />)}
        {ticks.map((t) => (
          <SvgText key={`t${t}`} x={left - 6} y={py(t) + 4} fill={colors.sub} fontSize={11} fontFamily={fonts.num} textAnchor="end">{fmtInt(t)}</SvgText>
        ))}
        {targetPoints.length > 1 && <Polyline points={targetPoints.join(' ')} fill="none" stroke={colors.sub} strokeWidth={1.5} strokeDasharray="4 4" />}
        {recorded.length > 1 && (
          <Polyline points={recorded.map(({ d, i }) => `${px(i)},${py(d.total.kcal)}`).join(' ')} fill="none" stroke={colors.accent} strokeWidth={2.5} />
        )}
        {recorded.map(({ d, i }) => <Circle key={i} cx={px(i)} cy={py(d.total.kcal)} r={4} fill={colors.accent} />)}
        {days.map((d, i) => (
          <SvgText key={`w${i}`} x={px(i)} y={height - 20} fill={colors.text} fontSize={11} fontFamily={fonts.regular} textAnchor="middle">{WEEKDAY[weekday(d.date)]}</SvgText>
        ))}
        {days.map((d, i) => (
          <SvgText key={`v${i}`} x={px(i)} y={height - 6} fill={colors.sub} fontSize={11} fontFamily={fonts.num} textAnchor="middle">
            {d.meals.length ? fmtInt(d.total.kcal) : '—'}
          </SvgText>
        ))}
      </Svg>
    </View>
  );
}
