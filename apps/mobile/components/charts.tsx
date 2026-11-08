import { useState } from 'react';
import { LayoutChangeEvent, View } from 'react-native';
import Svg, { Circle, G, Line, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import { niceTicks } from '@/lib/chart';
import { colors, fonts } from '@/theme';

function useWidth(initial = 300) {
  const [w, setW] = useState(initial);
  const onLayout = (e: LayoutChangeEvent) => setW(Math.max(100, e.nativeEvent.layout.width));
  return [w, onLayout] as const;
}

type Point = { x: number; y: number };

/** 折れ線グラフ。points の x は 0〜1 に正規化した位置 */
export function LineChart({ points, xLabels, height = 160, showYAxis = true, formatY = (v: number) => String(v) }: {
  points: Point[];
  xLabels: { x: number; label: string }[];
  height?: number;
  showYAxis?: boolean;
  formatY?: (v: number) => string;
}) {
  const [width, onLayout] = useWidth();
  const left = showYAxis ? 40 : 4;
  const right = 8, top = 8, bottom = 22;
  const ys = points.map((p) => p.y);
  const ticks = niceTicks(Math.min(...ys), Math.max(...ys));
  const lo = ticks[0] ?? 0, hi = ticks[ticks.length - 1] ?? 1;
  const px = (x: number) => left + x * (width - left - right);
  const py = (y: number) => top + (1 - (y - lo) / (hi - lo || 1)) * (height - top - bottom);
  const last = points[points.length - 1];
  return (
    <View onLayout={onLayout}>
      <Svg width={width} height={height}>
        {ticks.map((t) => (
          <Line key={`g${t}`} x1={left} x2={width - right} y1={py(t)} y2={py(t)} stroke={colors.line} strokeWidth={1} />
        ))}
        {showYAxis && ticks.map((t) => (
          <SvgText key={`t${t}`} x={left - 6} y={py(t) + 4} fill={colors.sub} fontSize={10} fontFamily={fonts.num} textAnchor="end">{formatY(t)}</SvgText>
        ))}
        {points.length > 1 && (
          <Polyline points={points.map((p) => `${px(p.x)},${py(p.y)}`).join(' ')} fill="none" stroke={colors.accent} strokeWidth={2.5} strokeLinejoin="round" />
        )}
        {points.length <= 31 && points.map((p, i) => <Circle key={i} cx={px(p.x)} cy={py(p.y)} r={2.5} fill={colors.accent} />)}
        {last && <Circle cx={px(last.x)} cy={py(last.y)} r={5} fill={colors.accent} />}
        {xLabels.map((l, i) => (
          <SvgText key={`x${i}`} x={px(l.x)} y={height - 6} fill={colors.sub} fontSize={10} fontFamily={fonts.num}
            textAnchor={l.x < 0.05 ? 'start' : l.x > 0.95 ? 'end' : 'middle'}>{l.label}</SvgText>
        ))}
      </Svg>
    </View>
  );
}

/** 積み上げの棒グラフ */
export function StackedBarChart({ bars, height = 180 }: {
  bars: { label: string; segments: { value: number; color: string }[] }[];
  height?: number;
}) {
  const [width, onLayout] = useWidth();
  const top = 6, bottom = 22;
  const max = Math.max(1, ...bars.map((b) => b.segments.reduce((a, s) => a + s.value, 0)));
  const slot = width / Math.max(1, bars.length);
  const barW = Math.min(32, slot * 0.6);
  const plotH = height - top - bottom;
  return (
    <View onLayout={onLayout}>
      <Svg width={width} height={height}>
        <Line x1={0} x2={width} y1={top + plotH} y2={top + plotH} stroke={colors.line} strokeWidth={1} />
        {bars.map((b, i) => {
          let y = top + plotH;
          const x = i * slot + (slot - barW) / 2;
          return (
            <G key={i}>
              {b.segments.filter((s) => s.value > 0).map((s, j) => {
                const h = (s.value / max) * plotH;
                y -= h;
                return <Rect key={j} x={x} y={y} width={barW} height={Math.max(1, h - 1.5)} rx={3} fill={s.color} />;
              })}
              <SvgText x={x + barW / 2} y={height - 6} fill={colors.sub} fontSize={10} fontFamily={fonts.num} textAnchor="middle">{b.label}</SvgText>
            </G>
          );
        })}
      </Svg>
    </View>
  );
}
