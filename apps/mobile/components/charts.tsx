import { ComponentProps, useEffect, useRef, useState } from 'react';
import { Easing, LayoutChangeEvent, View } from 'react-native';
import Animated, { SharedValue, useAnimatedProps, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle, G, Line, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import { niceTicks } from '@/lib/chart';
import { colors, fonts } from '@/theme';
import { barDelay, duration, EASE_OUT } from '@/theme/motion';
import { easeOut } from './motion';
import { T } from './Text';

/** 数え上げる数字の文字。format で、数え上げの途中の値も文字にする */
export function CountUpText({ value, format, animKey, ...text }: Omit<ComponentProps<typeof T>, 'children'> & {
  value: number; format: (v: number) => string; animKey?: string;
}) {
  const shown = useCountUp(value, animKey);
  return <T {...text}>{format(shown)}</T>;
}

const AnimatedPolyline = Animated.createAnimatedComponent(Polyline);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedRect = Animated.createAnimatedComponent(Rect);

/**
 * グラフを描く動きの進み（0〜1）。開いたときと animKey（期間など）が変わったときに 0 から描き直す。
 * データの読み直しやスクロールでは描き直さない。動きを減らす設定なら、はじめから描き終わった形
 */
function useDrawProgress(animKey: string | undefined, total: number) {
  const reduced = useReducedMotion();
  const progress = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) { progress.set(1); return; }
    progress.set(0);
    progress.set(withTiming(1, { duration: total, easing: easeOut }));
  }, [animKey, reduced, total, progress]);
  return { progress, reduced };
}

/** 大きな数字を、開いたときと animKey が変わったときに 0 から数え上げる（600ms、ease-out。はね返らない） */
export function useCountUp(value: number, animKey?: string): number {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? value : 0);
  const [from, setFrom] = useState({ key: animKey, value });
  // 数え上げの途中で値が変わっても、最後は今の値で止める
  const target = useRef(value);
  useEffect(() => { target.current = value; });
  // 同じ animKey のまま値だけ変わったら（読み直しなど）、数え上げずにその値を出す
  if (from.key === animKey && from.value !== value) {
    setFrom({ key: animKey, value });
    setShown(value);
  }
  useEffect(() => {
    if (reduced) { setShown(value); return; }
    const ease = Easing.bezier(...EASE_OUT);
    // 時刻は requestAnimationFrame の時刻で測る（端末の時計の変更や、E2E で固定した時計に左右されない）
    let start: number | null = null;
    let frame = 0;
    const tick = (now: number) => {
      start ??= now;
      const t = Math.min(1, (now - start) / duration.draw);
      setShown(target.current * ease(t));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    setFrom({ key: animKey, value });
    return () => cancelAnimationFrame(frame);
    // 値の変化では数え上げ直さない（上で値を出す）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animKey, reduced]);
  return shown;
}

function useWidth(initial = 300) {
  const [w, setW] = useState(initial);
  const onLayout = (e: LayoutChangeEvent) => setW(Math.max(100, e.nativeEvent.layout.width));
  return [w, onLayout] as const;
}

type Point = { x: number; y: number };

/** 折れ線グラフ。points の x は 0〜1 に正規化した位置 */
export function LineChart({ points, xLabels, height = 160, showYAxis = true, formatY = (v: number) => String(v), animKey }: {
  points: Point[];
  xLabels: { x: number; label: string }[];
  height?: number;
  showYAxis?: boolean;
  formatY?: (v: number) => string;
  /** これが変わったら描き直す（期間・項目など） */
  animKey?: string;
}) {
  const { progress, reduced } = useDrawProgress(animKey, duration.draw);
  const [width, onLayout] = useWidth();
  const left = showYAxis ? 40 : 4;
  const right = 8, top = 8, bottom = 22;
  const ys = points.map((p) => p.y);
  const ticks = niceTicks(Math.min(...ys), Math.max(...ys));
  const lo = ticks[0] ?? 0, hi = ticks[ticks.length - 1] ?? 1;
  const px = (x: number) => left + x * (width - left - right);
  const py = (y: number) => top + (1 - (y - lo) / (hi - lo || 1)) * (height - top - bottom);
  const last = points[points.length - 1];
  // 線の長さと、各点までの長さの割合（線が通ったあとに点を出す）
  const xy = points.map((p) => ({ x: px(p.x), y: py(p.y) }));
  const along = [0];
  for (let i = 1; i < xy.length; i++) along.push(along[i - 1] + Math.hypot(xy[i].x - xy[i - 1].x, xy[i].y - xy[i - 1].y));
  const length = along[along.length - 1] || 1;
  const at = (i: number) => (xy.length > 1 ? along[i] / length : 1);
  return (
    <View onLayout={onLayout}>
      <Svg width={width} height={height}>
        {ticks.map((t) => (
          <Line key={`g${t}`} x1={left} x2={width - right} y1={py(t)} y2={py(t)} stroke={colors.line} strokeWidth={1} />
        ))}
        {showYAxis && ticks.map((t) => (
          <SvgText key={`t${t}`} x={left - 6} y={py(t) + 4} fill={colors.sub} fontSize={10} fontFamily={fonts.num} textAnchor="end">{formatY(t)}</SvgText>
        ))}
        {points.length > 1 && (reduced ? (
          <Polyline points={xy.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={colors.accent} strokeWidth={2.5} strokeLinejoin="round" />
        ) : (
          <DrawnLine points={xy.map((p) => `${p.x},${p.y}`).join(' ')} length={length} progress={progress} />
        ))}
        {points.length <= 31 && xy.map((p, i) => (reduced
          ? <Circle key={i} cx={p.x} cy={p.y} r={2.5} fill={colors.accent} />
          : <Dot key={i} x={p.x} y={p.y} r={2.5} at={at(i)} progress={progress} />))}
        {last && (reduced
          ? <Circle cx={px(last.x)} cy={py(last.y)} r={5} fill={colors.accent} />
          : <Dot x={px(last.x)} y={py(last.y)} r={5} at={1} progress={progress} />)}
        {xLabels.map((l, i) => (
          <SvgText key={`x${i}`} x={px(l.x)} y={height - 6} fill={colors.sub} fontSize={10} fontFamily={fonts.num}
            textAnchor={l.x < 0.05 ? 'start' : l.x > 0.95 ? 'end' : 'middle'}>{l.label}</SvgText>
        ))}
      </Svg>
    </View>
  );
}

/** 積み上げの棒グラフ */
export function StackedBarChart({ bars, height = 180, animKey }: {
  bars: { label: string; segments: { value: number; color: string }[] }[];
  height?: number;
  animKey?: string;
}) {
  const reducedMotion = useReducedMotion();
  const total = barDelay(bars.length - 1, bars.length, reducedMotion) + duration.barGrow;
  const { progress, reduced } = useDrawProgress(animKey, total);
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
          const base = top + plotH;
          let y = base;
          const x = i * slot + (slot - barW) / 2;
          // この棒が伸びる区間（全体の進みのうち、始まりと終わり）
          const from = barDelay(i, bars.length, reduced) / total;
          const to = from + duration.barGrow / total;
          return (
            <G key={i}>
              {b.segments.filter((s) => s.value > 0).map((s, j) => {
                const h = (s.value / max) * plotH;
                y -= h;
                const rect = { x, y, width: barW, height: Math.max(1, h - 1.5), rx: 3, fill: s.color };
                return reduced
                  ? <Rect key={j} {...rect} />
                  : <GrowingRect key={j} {...rect} base={base} from={from} to={to} progress={progress} />;
              })}
              <SvgText x={x + barW / 2} y={height - 6} fill={colors.sub} fontSize={10} fontFamily={fonts.num} textAnchor="middle">{b.label}</SvgText>
            </G>
          );
        })}
      </Svg>
    </View>
  );
}

/** 左から右へ描かれていく線（線の長さだけの破線を、ずらしを減らして見せていく） */
function DrawnLine({ points, length, progress }: { points: string; length: number; progress: SharedValue<number> }) {
  const props = useAnimatedProps(() => ({ strokeDashoffset: length * (1 - progress.get()) }));
  return (
    <AnimatedPolyline points={points} fill="none" stroke={colors.accent} strokeWidth={2.5} strokeLinejoin="round"
      strokeDasharray={[length, length]} animatedProps={props} />
  );
}

/** 線が通ったあとに出る点（at は線の長さのうち、その点までの割合）。はね返らずにすっと大きくなる */
function Dot({ x, y, r, at, progress }: { x: number; y: number; r: number; at: number; progress: SharedValue<number> }) {
  const props = useAnimatedProps(() => {
    const q = Math.min(1, Math.max(0, (progress.get() - Math.min(at, 0.92)) / 0.08));
    return { r: r * q };
  });
  return <AnimatedCircle cx={x} cy={y} fill={colors.accent} animatedProps={props} />;
}

/** 下から伸びる棒の一片。全体の進みのうち from〜to の区間で、下の線（base）から伸びる */
function GrowingRect({ x, y, width, height, rx, fill, base, from, to, progress }: {
  x: number; y: number; width: number; height: number; rx: number; fill: string; base: number; from: number; to: number; progress: SharedValue<number>;
}) {
  const props = useAnimatedProps(() => {
    const t = Math.min(1, Math.max(0, (progress.get() - from) / (to - from || 1)));
    const q = 1 - Math.pow(1 - t, 3);
    return { y: base - (base - y) * q, height: height * q };
  });
  return <AnimatedRect x={x} width={width} rx={rx} fill={fill} animatedProps={props} />;
}
