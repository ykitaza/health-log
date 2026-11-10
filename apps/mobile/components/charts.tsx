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
const AnimatedSvgText = Animated.createAnimatedComponent(SvgText);

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

/**
 * 折れ線グラフ。points の x は 0〜1 に正規化した位置。
 * avg を渡すと、灰色の細い線（7日の平均など。点は打たない）を記録の線の下に重ねる。
 * goal を渡すと、目標の値が縦の範囲の中なら破線の横線と文字、範囲の外なら右下（下にあるとき）か右上（上にあるとき）に、向きの矢印を付けた文字を出す
 */
export function LineChart({ points, xLabels, height = 160, showYAxis = true, formatY = (v: number) => String(v), animKey, avg, goal }: {
  points: Point[];
  xLabels: { x: number; label: string }[];
  height?: number;
  showYAxis?: boolean;
  formatY?: (v: number) => string;
  /** これが変わったら描き直す（期間・項目など） */
  animKey?: string;
  avg?: Point[];
  goal?: { y: number; label: string };
}) {
  const { progress, reduced } = useDrawProgress(animKey, duration.draw);
  const [width, onLayout] = useWidth();
  const left = showYAxis ? 40 : 4;
  const right = 8, top = 8, bottom = 22;
  const ys = [...points, ...(avg ?? [])].map((p) => p.y);
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
  const avgXy = (avg ?? []).map((p) => ({ x: px(p.x), y: py(p.y) }));
  let avgLength = 0;
  for (let i = 1; i < avgXy.length; i++) avgLength += Math.hypot(avgXy[i].x - avgXy[i - 1].x, avgXy[i].y - avgXy[i - 1].y);
  const goalIn = goal != null && goal.y >= lo && goal.y <= hi;
  const goalText = goal && {
    x: width - right,
    y: goalIn ? py(goal.y) - 6 : goal.y < lo ? top + (height - top - bottom) - 6 : top + 12,
    label: goalIn ? goal.label : `${goal.label} ${goal.y < lo ? '↓' : '↑'}`,
  };
  return (
    <View onLayout={onLayout}>
      <Svg width={width} height={height}>
        {ticks.map((t) => (
          <Line key={`g${t}`} x1={left} x2={width - right} y1={py(t)} y2={py(t)} stroke={colors.line} strokeWidth={1} />
        ))}
        {showYAxis && ticks.map((t) => (
          <SvgText key={`t${t}`} x={left - 6} y={py(t) + 4} fill={colors.sub} fontSize={11} fontFamily={fonts.num} textAnchor="end">{formatY(t)}</SvgText>
        ))}
        {goal && goalIn && (
          <Line x1={left} x2={width - right} y1={py(goal.y)} y2={py(goal.y)} stroke={colors.sub} strokeWidth={1.5} strokeDasharray={[4, 4]} />
        )}
        {goalText && (
          <SvgText x={goalText.x} y={goalText.y} fill={colors.sub} fontSize={12} fontFamily={fonts.regular} textAnchor="end">{goalText.label}</SvgText>
        )}
        {avgXy.length > 1 && (reduced ? (
          <Polyline points={avgXy.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={colors.sub} strokeWidth={1.5} strokeLinejoin="round" />
        ) : (
          <DrawnLine points={avgXy.map((p) => `${p.x},${p.y}`).join(' ')} length={avgLength || 1} progress={progress} color={colors.sub} strokeWidth={1.5} />
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
          <SvgText key={`x${i}`} x={px(l.x)} y={height - 6} fill={colors.sub} fontSize={11} fontFamily={fonts.num}
            textAnchor={l.x < 0.05 ? 'start' : l.x > 0.95 ? 'end' : 'middle'}>{l.label}</SvgText>
        ))}
      </Svg>
    </View>
  );
}

/**
 * 目盛りのない小さな折れ線（ホームのカード）。points の x は 0〜1。最後の点に丸。
 * 描き方は LineChart と同じ（左から描かれ、線が通ったあとに丸が出る。動きを減らす設定なら描き終わった形）
 */
export function Sparkline({ points, height = 44, animKey }: { points: Point[]; height?: number; animKey?: string }) {
  const { progress, reduced } = useDrawProgress(animKey, duration.draw);
  const [width, setWidth] = useState(120);
  const pad = 4;
  const ys = points.map((p) => p.y);
  const lo = Math.min(...ys), hi = Math.max(...ys);
  const px = (x: number) => pad + x * (width - pad * 2);
  // 値がすべて同じなら、まん中の高さに引く
  const py = (y: number) => (hi === lo ? height / 2 : pad + (1 - (y - lo) / (hi - lo)) * (height - pad * 2));
  const xy = points.map((p) => ({ x: px(p.x), y: py(p.y) }));
  let length = 0;
  for (let i = 1; i < xy.length; i++) length += Math.hypot(xy[i].x - xy[i - 1].x, xy[i].y - xy[i - 1].y);
  const last = xy[xy.length - 1];
  const line = xy.map((p) => `${p.x},${p.y}`).join(' ');
  return (
    <View onLayout={(e) => setWidth(Math.max(1, e.nativeEvent.layout.width))}>
      <Svg width={width} height={height}>
        {xy.length > 1 && (reduced
          ? <Polyline points={line} fill="none" stroke={colors.accent} strokeWidth={1.5} strokeLinejoin="round" />
          : <DrawnLine points={line} length={length || 1} progress={progress} strokeWidth={1.5} />)}
        {last && (reduced
          ? <Circle cx={last.x} cy={last.y} r={3} fill={colors.accent} />
          : <Dot x={last.x} y={last.y} r={3} at={1} progress={progress} />)}
      </Svg>
    </View>
  );
}

/**
 * 積み上げの棒グラフ。refLine は平均などの点線（色だけにしないよう、凡例は呼ぶ側で添える）。formatY を渡すと縦の目盛り（0・半分・最大）。
 * peak を渡すと、その棒の上に値を出す（棒が伸びきったら出る）。accessibilityLabel は読み上げのグラフの要約
 */
export function StackedBarChart({ bars, height = 180, animKey, refLine, formatY, max: maxProp, labelAnchor = 'middle', peak, accessibilityLabel, testID }: {
  bars: { label: string; segments: { value: number; color: string }[] }[];
  height?: number;
  animKey?: string;
  refLine?: number;
  formatY?: (v: number) => string;
  /** 縦の最大（ないときは棒の最大） */
  max?: number;
  /** 軸の文字を棒のまん中に置くか、棒の左から始めるか（棒が細くて多いときの、週の始まりの日付など） */
  labelAnchor?: 'middle' | 'start';
  /** 値を出す棒（いちばん多い日など）と、その文字 */
  peak?: { index: number; label: string };
  accessibilityLabel?: string;
  testID?: string;
}) {
  const reducedMotion = useReducedMotion();
  const total = barDelay(bars.length - 1, bars.length, reducedMotion) + duration.barGrow;
  const { progress, reduced } = useDrawProgress(animKey, total);
  const [width, onLayout] = useWidth();
  const top = peak ? 20 : 6, bottom = 22;
  const left = formatY ? 36 : 0;
  const max = maxProp ?? Math.max(1, ...bars.map((b) => b.segments.reduce((a, s) => a + s.value, 0)));
  const slot = (width - left) / Math.max(1, bars.length);
  const barW = Math.min(32, slot * 0.6);
  const plotH = height - top - bottom;
  const yOf = (v: number) => top + plotH - (v / max) * plotH;
  const peakText = peak && bars[peak.index] && (() => {
    const cx = left + peak.index * slot + slot / 2;
    const v = bars[peak.index].segments.reduce((a, sg) => a + sg.value, 0);
    // 端の棒でも文字が切れないよう、端に寄せる
    const anchor: 'start' | 'middle' | 'end' = cx < left + 24 ? 'start' : cx > width - 24 ? 'end' : 'middle';
    const x = anchor === 'start' ? left + peak.index * slot + (slot - barW) / 2 : anchor === 'end' ? left + peak.index * slot + (slot + barW) / 2 : cx;
    const text = { x, y: yOf(v) - 6, fill: colors.text, fontSize: 11, fontFamily: fonts.num, textAnchor: anchor };
    const at = (barDelay(peak.index, bars.length, reduced) + duration.barGrow) / total;
    return reduced
      ? <SvgText {...text}>{peak.label}</SvgText>
      : <FadingText {...text} at={at} progress={progress}>{peak.label}</FadingText>;
  })();
  return (
    <View onLayout={onLayout} testID={testID} accessible={accessibilityLabel != null} accessibilityRole={accessibilityLabel != null ? 'image' : undefined} accessibilityLabel={accessibilityLabel}>
      <Svg width={width} height={height}>
        {formatY && [0, max / 2, max].map((t) => (
          <G key={`y${t}`}>
            <Line x1={left} x2={width} y1={yOf(t)} y2={yOf(t)} stroke={colors.line} strokeWidth={1} />
            <SvgText x={left - 6} y={yOf(t) + 4} fill={colors.sub} fontSize={11} fontFamily={fonts.num} textAnchor="end">{formatY(t)}</SvgText>
          </G>
        ))}
        <Line x1={left} x2={width} y1={top + plotH} y2={top + plotH} stroke={colors.line} strokeWidth={1} />
        {bars.map((b, i) => {
          const base = top + plotH;
          let y = base;
          const x = left + i * slot + (slot - barW) / 2;
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
              <SvgText x={labelAnchor === 'start' ? x : x + barW / 2} y={height - 6} fill={colors.sub} fontSize={11} fontFamily={fonts.num}
                textAnchor={labelAnchor === 'start' ? 'start' : i === 0 && formatY ? 'start' : i === bars.length - 1 && formatY ? 'end' : 'middle'}>{b.label}</SvgText>
            </G>
          );
        })}
        {peakText}
        {refLine != null && (
          <Line x1={left} x2={width} y1={yOf(refLine)} y2={yOf(refLine)} stroke={colors.text} strokeWidth={1.5} strokeDasharray={[4, 4]} />
        )}
      </Svg>
    </View>
  );
}

/** 左から右へ描かれていく線（線の長さだけの破線を、ずらしを減らして見せていく） */
function DrawnLine({ points, length, progress, color = colors.accent, strokeWidth = 2.5 }: {
  points: string; length: number; progress: SharedValue<number>; color?: string; strokeWidth?: number;
}) {
  const props = useAnimatedProps(() => ({ strokeDashoffset: length * (1 - progress.get()) }));
  return (
    <AnimatedPolyline points={points} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round"
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

/** 棒が伸びきったら（全体の進みが at を過ぎたら）出る文字 */
function FadingText({ at, progress, children, ...text }: ComponentProps<typeof SvgText> & { at: number; progress: SharedValue<number> }) {
  const props = useAnimatedProps(() => ({ opacity: progress.get() >= Math.min(at, 0.999) ? 1 : 0 }));
  return <AnimatedSvgText {...text} animatedProps={props}>{children}</AnimatedSvgText>;
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
