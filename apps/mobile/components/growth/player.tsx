// 「成長を見る」画面（app/growth.tsx）の部品：画面全体の指の操作、下の線、一時停止の印、下の累計の1行
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Platform, StyleSheet, View } from 'react-native';
import Animated, {
  FadeIn, FadeOut, SharedValue, useAnimatedReaction, useAnimatedStyle, useFrameCallback, useSharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import type { GrowthParams } from '@/lib/growth';
import {
  approachTotal, claimsDrag, dayIndexAt, dragIndex, growthTotals, isTap, lerpParams, LIVE_UPDATE_MS, ratioAt, startsAtEdge,
  TOTAL_STEPS, totalKeys, totalsLabel, totalsText, TotalValues, totalValues,
} from '@/lib/growthPlayer';
import { kgToUnit, WeightUnit } from '@/lib/units';
import { colors, growthColors, size, space } from '@/theme';
import { duration } from '@/theme/motion';
import { easeIn, easeOut } from '../motion';
import { T } from '../Text';

type MarkKind = 'training' | 'food' | 'sleep';

/**
 * 再生中の位置（日の番号の小数）を、細かい間隔（33ms）で React に渡す。日の数字を、再生の位置にそのまま合わせるため。
 * 再生していないあいだは null（止まったときの値は、画面が持つ日の番号から出す）。この値を使う小さな部品だけが描き直される
 */
export function useLivePos(pos: SharedValue<number>, playing: boolean): number | null {
  const [live, setLive] = useState<number | null>(null);
  const lastAt = useSharedValue(0);
  useAnimatedReaction(() => pos.get(), (p) => {
    if (!playing) return;
    const now = Date.now();
    if (now - lastAt.get() < LIVE_UPDATE_MS) return;
    lastAt.set(now);
    scheduleOnRN(setLive, p);
  }, [playing]);
  return playing ? live : null;
}
const MARK = 10;

/** 下の累計の印1つ（丸＝筋トレ、ひし形＝食事、輪＝睡眠。ホームの衛星と同じ形と色） */
export function SatMark({ kind, size: s = MARK }: { kind: MarkKind; size?: number }) {
  const color = growthColors[kind];
  const shape = kind === 'training'
    ? { width: s, height: s, borderRadius: s / 2, backgroundColor: color }
    : kind === 'food'
      ? { width: s * 0.8, height: s * 0.8, transform: [{ rotate: '45deg' }], backgroundColor: color }
      : { width: s, height: s, borderRadius: s / 2, borderWidth: 2, borderColor: color };
  return (
    <View style={{ width: s + 2, height: s + 2, alignItems: 'center', justifyContent: 'center' }}>
      <View style={shape} />
    </View>
  );
}

/**
 * 指の操作（1回押す・左右になぞる）。押し始めで指を受け取り、動いた量で見分ける（タップは縦横とも TAP_SLOP_DP 未満で放したとき）。
 * なぞると、押し始めの日から指の動きの分だけ日を移す（1日単位で onSeek）。edges なら、画面の左右の端で始まった指は何もしない。
 * ボタンなど子の押せるものは、自分で先に受け取るので、ここには来ない
 */
export function useDayGesture(o: {
  disabled: boolean; edges: boolean; screenWidth: number; dayCount: number;
  /** 押し始めの日の番号 */
  currentIndex: () => number;
  /** タップ。x は押した要素の中の横の位置 */
  onTap: (x: number) => void;
  onSeek: (index: number) => void;
}) {
  const latest = useRef({ ...o, ignored: false, dragging: false, startIndex: 0, lastIndex: 0, startX: 0 });
  useLayoutEffect(() => { Object.assign(latest.current, o); });
  // ref は指の動きの中（描く間ではない）でだけ読むので、描くたびに作り直さずに最新の値を使える
  return useMemo(() => {
    // eslint-disable-next-line react-hooks/refs
    return PanResponder.create({
      onStartShouldSetPanResponder: () => !latest.current.disabled,
      onPanResponderGrant: (e) => {
        const l = latest.current;
        l.ignored = l.edges && startsAtEdge(e.nativeEvent.pageX, l.screenWidth);
        l.dragging = false;
        l.startIndex = l.currentIndex();
        l.lastIndex = l.startIndex;
        l.startX = e.nativeEvent.locationX;
      },
      onPanResponderMove: (_, g) => {
        const l = latest.current;
        if (l.ignored || (!l.dragging && !claimsDrag(g.dx, g.dy))) return;
        l.dragging = true;
        const i = dragIndex(l.startIndex, g.dx, l.screenWidth, l.dayCount);
        if (i === l.lastIndex) return;
        l.lastIndex = i;
        l.onSeek(i);
      },
      onPanResponderRelease: (_, g) => {
        const l = latest.current;
        if (!l.ignored && !l.dragging && isTap(g.dx, g.dy)) l.onTap(l.startX);
      },
      // 指で動かしているあいだは、ほかに渡さない
      onPanResponderTerminationRequest: () => false,
    }).panHandlers;
  }, []);
}

const DOT = 6;
const TRACK = 2;

/**
 * 下の細い線。左が最初の記録の日、右が今日。進んだ分は緑、ハイライトのある日に小さい点（過ぎた点は橙、先の点は灰色）。
 * 塗りは再生の位置（pos）から UI スレッドで動かす。線のまわりの帯（高さ 48dp）を押すといちばん近い点の日へ（onPressAt）、
 * なぞると画面全体と同じように日を移す。読み上げでは「日を移す」スライダー（上下のスワイプで1日ずつ）
 */
export function TimelineBar({ pos, dayCount, index, markIndexes, labels, disabled, screenWidth, currentIndex, onPressAt, onSeek, valueText }: {
  pos: SharedValue<number>; dayCount: number; index: number; markIndexes: number[]; labels: { left: string; right: string | null };
  disabled: boolean; screenWidth: number; currentIndex: () => number; onPressAt: (x: number, width: number) => void; onSeek: (index: number) => void;
  valueText: string;
}) {
  const width = useSharedValue(0);
  const widthRef = useRef(0);
  const handlers = useDayGesture({
    disabled, edges: false, screenWidth, dayCount, currentIndex, onSeek,
    onTap: (x) => onPressAt(x, widthRef.current),
  });
  const fill = useAnimatedStyle(() => ({ width: width.get() * ratioAt(pos.get(), dayCount) }));

  return (
    <View>
      <View
        {...handlers}
        style={s.band}
        onLayout={(e) => { widthRef.current = e.nativeEvent.layout.width; width.set(e.nativeEvent.layout.width); }}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="日を移す"
        aria-disabled={disabled}
        accessibilityValue={{ min: dayCount > 0 ? 1 : 0, max: dayCount, now: dayCount > 0 ? index + 1 : 0, text: valueText }}
        accessibilityActions={disabled ? [] : [{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          const d = e.nativeEvent.actionName === 'increment' ? 1 : e.nativeEvent.actionName === 'decrement' ? -1 : 0;
          if (d !== 0 && !disabled) onSeek(Math.min(dayCount - 1, Math.max(0, index + d)));
        }}
        testID="growth-timeline"
      >
        <View style={s.track} pointerEvents="none">
          <Animated.View style={[s.fill, fill]} />
        </View>
        {markIndexes.map((i) => (
          <View
            key={i}
            pointerEvents="none"
            style={[s.dot, { left: `${ratioAt(i, dayCount) * 100}%`, backgroundColor: i <= index ? colors.star : colors.outline }]}
          />
        ))}
      </View>
      <View style={s.labels}>
        <T variant="bodyS" color={colors.sub}>{labels.left}</T>
        {labels.right != null && <T variant="bodyS" color={colors.sub}>{labels.right}</T>}
      </View>
    </View>
  );
}

const BAR_W = 8;
const BAR_H = 36;

/** 一時停止の印（白い縦棒2本、半透明）。出る 250ms、消える 150ms */
export function PauseMark({ motion }: { motion: boolean }) {
  return (
    <Animated.View
      pointerEvents="none"
      style={s.pause}
      entering={motion ? FadeIn.duration(duration.enter).easing(easeOut) : undefined}
      // web（E2E）は消える動きに対応していないので付けない（components/motion.tsx の useListMotion と同じ）
      exiting={motion && Platform.OS !== 'web' ? FadeOut.duration(duration.exit).easing(easeIn) : undefined}
      testID="growth-paused"
    >
      <View style={s.pauseBar} />
      <View style={s.pauseBar} />
    </Animated.View>
  );
}

/**
 * 下の累計の1行（筋トレの負荷量・食事の日数・睡眠の日数）。表示の値は UI スレッドで毎フレーム本当の値を追いかけて数え上がる
 * （approachTotal。行き過ぎず、小さい差は1単位ずつ、大きい差は速く進んで近づくほどゆっくり）。
 * 本当の値は、再生中は位置の値（前後の日をつないだ値）、止まっているときはその日の値。
 * 文字が変わったときだけ React に知らせるので、描き直すのはこの部品だけ。running でないとき（見えていない・アプリが後ろ）は止める。
 * instant（動きを減らす設定）なら追いかけず、その日の値をすぐ出す
 */
export function TotalsLine({ pos, playing, index, series, unit, running, instant }: {
  pos: SharedValue<number>; playing: SharedValue<boolean>; index: number; series: GrowthParams[]; unit: WeightUnit;
  running: boolean; instant: boolean;
}) {
  const n = series.length;
  const perKg = kgToUnit(1, unit);
  const [keys, setKeys] = useState<TotalValues>(() => totalKeys(totalValues(series[0] ?? ZERO, perKg)));
  const shown = useSharedValue<TotalValues | null>(null);
  const sent = useSharedValue<TotalValues | null>(null);

  const step = useCallback(() => {
    'worklet';
    if (n === 0) return;
    const p = pos.get();
    const target = totalValues(playing.get() ? lerpParams(series, p) : series[dayIndexAt(p, n)], perKg);
    const c = shown.get();
    const next = c == null ? target : {
      volume: approachTotal(c.volume, target.volume, TOTAL_STEPS.volume),
      food: approachTotal(c.food, target.food, TOTAL_STEPS.food),
      sleep: approachTotal(c.sleep, target.sleep, TOTAL_STEPS.sleep),
    };
    shown.set(next);
    const k = totalKeys(next);
    const last = sent.get();
    if (last != null && last.volume === k.volume && last.food === k.food && last.sleep === k.sleep) return;
    sent.set(k);
    scheduleOnRN(setKeys, k);
  }, [n, series, perKg, pos, playing, shown, sent]);
  const frame = useFrameCallback(step, false);
  const active = running && !instant && n > 0;
  useLayoutEffect(() => {
    frame.setActive(active);
  }, [active, frame]);

  const t = instant ? growthTotals(series[Math.min(index, n - 1)] ?? ZERO, unit) : totalsText(keys, unit);
  return (
    <View style={s.totals} accessible accessibilityLabel={totalsLabel(t, unit)} testID="growth-totals">
      <TotalItem kind="training" name="筋トレ" value={`${t.volume} ${t.volumeUnit}`} />
      <TotalItem kind="food" name="食事" value={`${t.foodDays} 日`} />
      <TotalItem kind="sleep" name="睡眠" value={`${t.sleepDays} 日`} />
    </View>
  );
}

const ZERO: GrowthParams = { volumeKg: 0, foodDays: 0, sleepDays: 0, days: 0 };

/** 累計1つ（「● 筋トレ 287.0 t」） */
function TotalItem({ kind, name, value }: { kind: MarkKind; name: string; value: string }) {
  return (
    <View style={s.total}>
      <SatMark kind={kind} size={8} />
      <T variant="bodyS" color={colors.sub}>{name}</T>
      <T variant="bodyS">{value}</T>
    </View>
  );
}

const s = StyleSheet.create({
  band: { height: size.touch, justifyContent: 'center' },
  track: { height: TRACK, borderRadius: TRACK / 2, backgroundColor: 'rgba(255,255,255,0.15)', overflow: 'hidden' },
  fill: { height: TRACK, backgroundColor: colors.accent },
  dot: { position: 'absolute', top: (size.touch - DOT) / 2, width: DOT, height: DOT, marginLeft: -DOT / 2, borderRadius: DOT / 2 },
  labels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -space.s },
  pause: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: BAR_W + 4 },
  pauseBar: { width: BAR_W, height: BAR_H, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.6)' },
  totals: { flexDirection: 'row', alignItems: 'center', gap: space.l, flexWrap: 'wrap' },
  total: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
});
