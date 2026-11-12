// ホームの右列のいちばん下「部位のバランス」（Figma ホーム 1-23）。直近2週の部位ごとのセット数を六角形のレーダーで
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { SharedValue, useAnimatedProps, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, Path, RadialGradient, Stop, Text as SvgText } from 'react-native-svg';
import { useEntrance } from '@/hooks/entrance';
import { axisAngle, BALANCE_PARTS, PartBalance, partBalanceLabel } from '@/lib/partBalance';
import { colors, fonts } from '@/theme';
import { duration } from '@/theme/motion';
import { easeOut, PressableScale } from './motion';
import { T } from './Text';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** 六角形のまわりの余白（左右は軸の名前の分、上下は名前の高さの半分ほど）。右の端の軸は「背中」（2文字）、左の端は「腹」（1文字） */
const PAD_L = 14;
const PAD_R = 27;
const PAD_Y = 9;
/** 目盛りの段（外周を 1 として） */
const RINGS = [1 / 3, 2 / 3, 1];
const ZEROS = BALANCE_PARTS.map(() => 0);
const COS = BALANCE_PARTS.map((_, i) => Math.cos(axisAngle(i)));
const SIN = BALANCE_PARTS.map((_, i) => Math.sin(axisAngle(i)));

/**
 * 部位のバランスのカード。見出し「部位のバランス」と「2週」、レーダー（目盛り3段・軸の線・データの面と線と点・軸の名前）。
 * 最大の軸を外周にそろえる。記録がなければ目盛りだけと、短い一言。押すと筋トレの推移（部位ごとの総負荷量の棒がある）。
 * ホームが見えるたびに中心から外へ広がり（1200ms、ease-out）、見えているあいだに値が変わったら前の形から新しい形へ（hooks/entrance.ts）
 */
export function PartBalanceCard({ balance }: { balance: PartBalance | null }) {
  const ratios = balance && balance.total > 0 ? balance.ratios : null;
  const { token, prev } = useEntrance(ratios, ratios ? ratios.map((r) => r.toFixed(4)).join(',') : null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  return (
    <PressableScale
      testID="home-part-balance" accessibilityRole="button" accessibilityLabel={`${partBalanceLabel(balance)}。筋トレの推移を開く`} scaleTo={0.98}
      onPress={() => router.navigate({ pathname: '/training', params: { view: 'trend' } })} style={s.card}
    >
      <View style={s.head}>
        <T variant="labelS" color={colors.sub} style={{ lineHeight: 13 }}>部位のバランス</T>
        <T variant="labelS" color={colors.sub} style={{ lineHeight: 13 }}>2週</T>
      </View>
      <View style={{ flex: 1, minHeight: 96 }} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        {size && size.w > PAD_L + PAD_R && (
          <Radar width={size.w} height={size.h} to={ratios} from={prev ?? ZEROS} token={token} />
        )}
      </View>
      {balance != null && ratios == null && (
        <T variant="labelS" bold={false} color={colors.sub} style={{ paddingHorizontal: 7, textAlign: 'center' }} testID="home-part-balance-empty">
          記録がたまると形になります
        </T>
      )}
    </PressableScale>
  );
}

function Radar({ width, height, from, to, token }: { width: number; height: number; from: number[]; to: number[] | null; token: number }) {
  const reduced = useReducedMotion();
  const R = Math.max(0, Math.min((width - PAD_L - PAD_R) / 2, (height - PAD_Y * 2) / Math.sqrt(3)));
  const cx = PAD_L + (width - PAD_L - PAD_R) / 2, cy = height / 2;
  const at = (i: number, r: number) => ({ x: cx + r * COS[i], y: cy + r * SIN[i] });
  const ring = (k: number) => `${BALANCE_PARTS.map((_, i) => { const p = at(i, R * k); return `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`; }).join('')}Z`;
  const axes = BALANCE_PARTS.map((_, i) => { const p = at(i, R); return `M${cx},${cy}L${p.x},${p.y}`; }).join('');
  const moving = !reduced && to != null;
  const progress = useSharedValue(moving ? 0 : 1);
  useEffect(() => {
    if (!moving) { progress.set(1); return; }
    progress.set(0);
    progress.set(withTiming(1, { duration: duration.radar, easing: easeOut }));
    // 動かすのは合図（token）が来たときだけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moving, token]);
  const shape = to && to.map((v, i) => at(i, R * v));
  return (
    <Svg width={width} height={height}>
      <Defs>
        {/* 中心は薄く、外周（最大の軸）ほど濃い緑 */}
        <RadialGradient id="partBalanceFill" cx={cx} cy={cy} r={R} fx={cx} fy={cy} gradientUnits="userSpaceOnUse">
          <Stop offset={0} stopColor={colors.accent} stopOpacity={0.15} />
          <Stop offset={1} stopColor={colors.accent} stopOpacity={0.55} />
        </RadialGradient>
      </Defs>
      {RINGS.map((k) => <Path key={k} d={ring(k)} fill="none" stroke={colors.outline} strokeWidth={1} />)}
      <Path d={axes} stroke={colors.outline} strokeWidth={1} />
      {shape && to && (moving ? (
        <>
          <MovingShape from={from} to={to} cx={cx} cy={cy} R={R} progress={progress} />
          {to.map((v, i) => <MovingDot key={i} i={i} from={(from)[i]} to={v} cx={cx} cy={cy} R={R} progress={progress} />)}
        </>
      ) : (
        <>
          <Path d={`${shape.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join('')}Z`} fill="url(#partBalanceFill)" stroke={colors.accent} strokeWidth={1.5} strokeLinejoin="round" />
          {shape.map((p, i) => <Circle key={i} cx={p.x} cy={p.y} r={2} fill={colors.accent} />)}
        </>
      ))}
      {BALANCE_PARTS.map((name, i) => {
        const p = at(i, R);
        const left = COS[i] < 0;
        return (
          <SvgText key={name} x={left ? p.x - 3 : p.x + 3} y={p.y + 4} fill={colors.sub} fontSize={11} fontFamily={fonts.bold} textAnchor={left ? 'end' : 'start'}>
            {name}
          </SvgText>
        );
      })}
    </Svg>
  );
}

/** 中心から外へ広がる面と線（6点が同時に、前の半径から今の半径へ） */
function MovingShape({ from, to, cx, cy, R, progress }: { from: number[]; to: number[]; cx: number; cy: number; R: number; progress: SharedValue<number> }) {
  const props = useAnimatedProps(() => {
    const t = progress.get();
    let d = '';
    for (let i = 0; i < to.length; i++) {
      const r = R * (from[i] + (to[i] - from[i]) * t);
      d += `${i === 0 ? 'M' : 'L'}${cx + r * COS[i]},${cy + r * SIN[i]}`;
    }
    return { d: `${d}Z` };
  });
  return <AnimatedPath fill="url(#partBalanceFill)" stroke={colors.accent} strokeWidth={1.5} strokeLinejoin="round" animatedProps={props} />;
}

function MovingDot({ i, from, to, cx, cy, R, progress }: { i: number; from: number; to: number; cx: number; cy: number; R: number; progress: SharedValue<number> }) {
  const c = COS[i], sn = SIN[i];
  const props = useAnimatedProps(() => {
    const r = R * (from + (to - from) * progress.get());
    return { cx: cx + r * c, cy: cy + r * sn };
  });
  return <AnimatedCircle r={2} fill={colors.accent} animatedProps={props} />;
}

const s = StyleSheet.create({
  card: { flexGrow: 1, backgroundColor: colors.input, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 3, gap: 6 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 4, paddingHorizontal: 7 },
});
