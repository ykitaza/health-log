// 部位のバランスの大きなレーダー（成長の記録・筋トレの推移）。部位ごとのセット数を六角形のレーダーで
import { useLayoutEffect } from 'react';
import Animated, { SharedValue, useAnimatedProps, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, Path, RadialGradient, Stop, Text as SvgText } from 'react-native-svg';
import { axisAngle, BALANCE_PARTS, PartBalance } from '@/lib/partBalance';
import { colors, fonts } from '@/theme';
import { duration } from '@/theme/motion';
import { easeOut } from './motion';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** 目盛りの段（外周を 1 として） */
const RINGS = [1 / 3, 2 / 3, 1];
const ZEROS = BALANCE_PARTS.map(() => 0);
const COS = BALANCE_PARTS.map((_, i) => Math.cos(axisAngle(i)));
const SIN = BALANCE_PARTS.map((_, i) => Math.sin(axisAngle(i)));

/** 大きなレーダーの、軸の名前と数の余白（左右は「背中 60」の幅、上下は文字の高さ。Figma 成長 11-2 の 348×262 で外周の半径 108） */
const BIG_PAD_X = 64;
const BIG_PAD_Y = 22;
/** 直近2週の点線の色（白の約85%） */
const RECENT_COLOR = 'rgba(243,245,247,0.85)';

/**
 * 大きなレーダー（Figma 成長 11-2 ⑤、筋トレ 1-4-2）。all（緑の実線・放射状の面・点）と、recent（白の点線）を重ねる。
 * 成長の記録では all がこれまでの累計、recent が直近2週。筋トレの推移では all が選んだ期間で、recent はこれまでのときだけ。
 * どちらも、その期間でいちばん多い部位を外周にそろえる。軸の名前の横に、all のセット数。
 * token を渡さなければ動かさない（成長の記録はスクロールで何度も出入りするため）。渡すと、token が変わるたびに中心から外へ広がる
 * （1200ms、ease-out。動きを減らす設定ならすぐ）。
 * 読み上げはカードの側でまとめて出すので、ここは飾り。fillId は画面ごとに変える（Web では SVG の id が画面をまたいで重なるため）
 */
export function PartStackRadar({ all, recent, width, token, fillId = 'partStackFill', testID = 'growth-part-radar' }: {
  all: PartBalance; recent: PartBalance | null; width: number; token?: number; fillId?: string; testID?: string;
}) {
  const reduced = useReducedMotion();
  const height = Math.round(width * 0.75);
  const R = Math.max(0, Math.min((width - BIG_PAD_X * 2) / 2, (height - BIG_PAD_Y * 2) / Math.sqrt(3)));
  const cx = width / 2, cy = height / 2;
  const at = (i: number, r: number) => ({ x: cx + r * COS[i], y: cy + r * SIN[i] });
  const poly = (ratios: number[], k = 1) => `${ratios.map((v, i) => { const p = at(i, R * v * k); return `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`; }).join('')}Z`;
  const ring = (k: number) => poly(ZEROS.map(() => 1), k);
  const axes = BALANCE_PARTS.map((_, i) => { const p = at(i, R); return `M${cx},${cy}L${p.x},${p.y}`; }).join('');
  const shape = all.total > 0 ? all.ratios.map((v, i) => at(i, R * v)) : null;
  const showRecent = recent != null && recent.total > 0;
  const moving = token != null && !reduced && (shape != null || showRecent);
  const progress = useSharedValue(moving ? 0 : 1);
  useLayoutEffect(() => {
    if (!moving) { progress.set(1); return; }
    progress.set(0);
    progress.set(withTiming(1, { duration: duration.radar, easing: easeOut }));
    // 動かすのは合図（token）が来たときだけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moving, token]);
  return (
    <Svg width={width} height={height} testID={testID}>
      <Defs>
        <RadialGradient id={fillId} cx={cx} cy={cy} r={R} fx={cx} fy={cy} gradientUnits="userSpaceOnUse">
          <Stop offset={0} stopColor={colors.accent} stopOpacity={0.12} />
          <Stop offset={1} stopColor={colors.accent} stopOpacity={0.5} />
        </RadialGradient>
      </Defs>
      {RINGS.map((k) => <Path key={k} d={ring(k)} fill="none" stroke={colors.outline} strokeWidth={1} />)}
      <Path d={axes} stroke={colors.outline} strokeWidth={1} />
      {shape && (moving ? (
        <>
          <MovingShape from={ZEROS} to={all.ratios} cx={cx} cy={cy} R={R} progress={progress} fill={`url(#${fillId})`} strokeWidth={2} />
          {all.ratios.map((v, i) => <MovingDot key={i} i={i} from={0} to={v} cx={cx} cy={cy} R={R} progress={progress} r={3} />)}
        </>
      ) : (
        <>
          <Path d={poly(all.ratios)} fill={`url(#${fillId})`} stroke={colors.accent} strokeWidth={2} strokeLinejoin="round" />
          {shape.map((p, i) => <Circle key={i} cx={p.x} cy={p.y} r={3} fill={colors.accent} />)}
        </>
      ))}
      {showRecent && (moving ? (
        <MovingShape from={ZEROS} to={recent.ratios} cx={cx} cy={cy} R={R} progress={progress} fill="none" stroke={RECENT_COLOR} strokeWidth={1.5} dash="4 3" />
      ) : (
        <Path d={poly(recent.ratios)} fill="none" stroke={RECENT_COLOR} strokeWidth={1.5} strokeDasharray="4 3" strokeLinejoin="round" />
      ))}
      {BALANCE_PARTS.map((name, i) => {
        const p = at(i, R);
        const side = COS[i] < 0 ? 'end' : 'start';
        const dx = COS[i] < 0 ? -6 : 6;
        const dy = SIN[i] < -0.5 ? -6 : SIN[i] > 0.5 ? 14 : 4;
        return (
          <SvgText key={name} x={p.x + dx} y={p.y + dy} fill={colors.sub} fontSize={12} fontFamily={fonts.bold} textAnchor={side}>
            {`${name} ${all.sets[i]}`}
          </SvgText>
        );
      })}
    </Svg>
  );
}

/** 中心から外へ広がる面と線（6点が同時に、前の半径から今の半径へ） */
function MovingShape({ from, to, cx, cy, R, progress, fill, stroke = colors.accent, strokeWidth, dash }: {
  from: number[]; to: number[]; cx: number; cy: number; R: number; progress: SharedValue<number>;
  fill: string; stroke?: string; strokeWidth: number; dash?: string;
}) {
  const props = useAnimatedProps(() => {
    const t = progress.get();
    let d = '';
    for (let i = 0; i < to.length; i++) {
      const r = R * (from[i] + (to[i] - from[i]) * t);
      d += `${i === 0 ? 'M' : 'L'}${cx + r * COS[i]},${cy + r * SIN[i]}`;
    }
    return { d: `${d}Z` };
  });
  return <AnimatedPath fill={fill} stroke={stroke} strokeWidth={strokeWidth} strokeDasharray={dash} strokeLinejoin="round" animatedProps={props} />;
}

function MovingDot({ i, from, to, cx, cy, R, progress, r }: { i: number; from: number; to: number; cx: number; cy: number; R: number; progress: SharedValue<number>; r: number }) {
  const c = COS[i], sn = SIN[i];
  const props = useAnimatedProps(() => {
    const r = R * (from + (to - from) * progress.get());
    return { cx: cx + r * c, cy: cy + r * sn };
  });
  return <AnimatedCircle r={r} fill={colors.accent} animatedProps={props} />;
}
