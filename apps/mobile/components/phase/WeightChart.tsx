// 進捗の詳細の体重のグラフ（react-native-svg）：週平均の点と線（判定しない週は白抜き）、予定の破線（目標を変える前の線は薄く）、
// 今の予定の線の ±0.3kg の帯、目標を変えた所の縦の点線。横軸はフェーズの時計（止まった日を除いた日数）で、目盛りは週
import { useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Line, Path, Polygon, Text as SvgText } from 'react-native-svg';
import { PACE_BAND_CENTS } from '@/lib/phases';
import type { WeightChart as Chart } from '@/lib/phaseView';
import { fmt1, kgToUnit, WeightUnit } from '@/lib/units';
import { hud, Micro, useMono } from '../report/hud';

const H = 180;
const PAD = { l: 30, r: 8, t: 18, b: 22 };

/** 縦軸の目盛り（整数の 3〜4 本） */
function ticks(min: number, max: number): number[] {
  const span = Math.max(1, max - min);
  const step = span <= 4 ? 1 : span <= 8 ? 2 : span <= 20 ? 5 : 10;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(v);
  return out;
}

/** 横軸の目盛り（週）。5 本までになるよう間を空ける */
function weekTicks(weeks: number): number[] {
  const step = weeks <= 8 ? 2 : weeks <= 16 ? 4 : weeks <= 32 ? 8 : 16;
  const out = [0];
  for (let w = step; w < weeks; w += step) out.push(w);
  if (weeks - out[out.length - 1] >= step / 2) out.push(weeks);
  else out[out.length - 1] = weeks;
  return out;
}

export function WeightChart({ chart, unit, accessibilityLabel }: { chart: Chart; unit: WeightUnit; accessibilityLabel: string }) {
  const [w, setW] = useState(0);
  const mono = useMono();
  const u = (kg: number) => kgToUnit(kg, unit);
  const band = u(PACE_BAND_CENTS / 100);
  const current = chart.lines.find((l) => l.current) ?? null;
  const values = [
    ...chart.points.map((p) => u(p.kg)), ...chart.lines.flatMap((l) => l.points.map((p) => u(p.kg))),
    ...(current ? current.points.flatMap((p) => [u(p.kg) - band, u(p.kg) + band]) : []),
  ];
  const lo = values.length ? Math.floor(Math.min(...values) - 0.3) : 0;
  const hi = values.length ? Math.ceil(Math.max(...values) + 0.3) : 1;
  const iw = Math.max(1, w - PAD.l - PAD.r);
  const ih = H - PAD.t - PAD.b;
  const x = (d: number) => PAD.l + (Math.min(chart.xMax, Math.max(0, d)) / chart.xMax) * iw;
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo || 1)) * ih;
  const path = (pts: { x: number; v: number }[]) => pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.x).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const judgedRun = chart.points.map((p) => ({ x: p.x, v: u(p.kg) }));

  return (
    <View accessible accessibilityLabel={accessibilityLabel} testID="phase-chart">
      <View style={{ height: H }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
        {w > 0 && (
          <Svg width={w} height={H}>
            {ticks(lo, hi).map((v) => (
              <Line key={`g${v}`} x1={PAD.l} x2={w - PAD.r} y1={y(v)} y2={y(v)} stroke={hud.line2} strokeWidth={1} />
            ))}
            {ticks(lo, hi).map((v) => (
              <SvgText key={`t${v}`} x={PAD.l - 6} y={y(v) + 3} fontSize={9} fill={hud.faint} textAnchor="end" fontFamily={mono}>{String(v)}</SvgText>
            ))}
            {weekTicks(chart.weeks).map((wk) => (
              <SvgText key={`w${wk}`} x={x(wk * 7)} y={H - 6} fontSize={9} fill={hud.faint} fontFamily={mono}
                textAnchor={wk === 0 ? 'start' : wk === chart.weeks ? 'end' : 'middle'}>{wk === 0 ? 'START' : `W${wk}`}</SvgText>
            ))}
            {current && current.points.length >= 2 && (
              <Polygon
                testID="phase-chart-band"
                points={[
                  ...current.points.map((p) => `${x(p.x)},${y(u(p.kg) + band)}`),
                  ...[...current.points].reverse().map((p) => `${x(p.x)},${y(u(p.kg) - band)}`),
                ].join(' ')}
                fill={hud.green} fillOpacity={0.12}
              />
            )}
            {chart.changes.map((c, i) => (
              <Line key={`c${i}`} x1={x(c.x)} x2={x(c.x)} y1={PAD.t - 4} y2={PAD.t + ih} stroke={hud.muted} strokeWidth={1} strokeDasharray="2 3" />
            ))}
            {chart.changes.map((c, i) => (
              <SvgText key={`cl${i}`} x={x(c.x) + 4} y={PAD.t - 6} fontSize={9} fill={hud.muted} fontFamily={mono}>
                {`GOAL ${fmt1(u(c.from)).replace(/\.0$/, '')}→${fmt1(u(c.to)).replace(/\.0$/, '')}`}
              </SvgText>
            ))}
            {chart.lines.map((l, i) => l.points.length >= 2 && (
              <Path key={`l${i}`} testID={l.current ? 'phase-chart-plan' : 'phase-chart-plan-old'}
                d={path(l.points.map((p) => ({ x: p.x, v: u(p.kg) })))} fill="none"
                stroke={l.current ? hud.white : hud.faint} strokeWidth={l.current ? 1.5 : 1} strokeDasharray={l.current ? '5 4' : '3 4'} />
            ))}
            {judgedRun.length >= 2 && <Path d={path(judgedRun)} fill="none" stroke={hud.green} strokeWidth={2} />}
            {chart.points.map((p) => (
              <Circle key={`p${p.week}`} testID={p.judged ? 'phase-chart-point' : 'phase-chart-point-open'}
                cx={x(p.x)} cy={y(u(p.kg))} r={3.5} fill={p.judged ? hud.green : hud.bg} stroke={hud.green} strokeWidth={1.5} />
            ))}
          </Svg>
        )}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 4, marginTop: 4 }}>
        <Legend kind="actual" label="実績" />
        <Legend kind="plan" label="予定" />
        {chart.lines.length > 1 && <Legend kind="old" label="前の予定" />}
        <Legend kind="open" label="判定なしの週" />
      </View>
    </View>
  );
}

function Legend({ kind, label }: { kind: 'actual' | 'plan' | 'old' | 'open'; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <Svg width={18} height={8}>
        {kind === 'open'
          ? <Circle cx={9} cy={4} r={3} fill={hud.bg} stroke={hud.green} strokeWidth={1.5} />
          : <Line x1={0} x2={18} y1={4} y2={4} stroke={kind === 'actual' ? hud.green : kind === 'plan' ? hud.white : hud.faint}
            strokeWidth={kind === 'actual' ? 2 : 1.5} strokeDasharray={kind === 'actual' ? undefined : '4 3'} />}
      </Svg>
      <Micro>{label}</Micro>
    </View>
  );
}
