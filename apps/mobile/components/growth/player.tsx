// 「成長を見る」画面（app/growth.tsx）の部品：衛星の印、つまみ（スクラバー）、再生の操作のボタン、下の累計
import { ReactNode, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import Animated, { SharedValue, useAnimatedReaction, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { indexAtX, LIVE_UPDATE_MS, ratioAt, SatStates } from '@/lib/growthPlayer';
import type { SatState } from '@/lib/growth';
import { colors, growthColors, size, space } from '@/theme';
import { Icon, IconName } from '../Icon';
import { PressableScale } from '../motion';
import { T } from '../Text';

type MarkKind = keyof SatStates;

/**
 * 再生中の位置（日の番号の小数）を、細かい間隔（33ms）で React に渡す。日の数字と下の累計を、日と日のあいだの値で数え上げるため。
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

/** 衛星の印1つ（丸＝筋トレ、ひし形＝食事、輪＝睡眠）。明るい／薄い／なし（なしは形だけ薄く） */
export function SatMark({ kind, state = 'bright', size: s = MARK }: { kind: MarkKind; state?: SatState; size?: number }) {
  const color = growthColors[kind];
  const opacity = state === 'bright' ? 1 : state === 'dim' ? 0.45 : 0.3;
  const filled = state !== 'none';
  const shape = kind === 'training'
    ? { width: s, height: s, borderRadius: s / 2, backgroundColor: filled ? color : 'transparent', borderWidth: filled ? 0 : 1.5, borderColor: color }
    : kind === 'food'
      ? { width: s * 0.8, height: s * 0.8, transform: [{ rotate: '45deg' }], backgroundColor: filled ? color : 'transparent', borderWidth: filled ? 0 : 1.5, borderColor: color }
      : { width: s, height: s, borderRadius: s / 2, borderWidth: 2, borderColor: color };
  return (
    <View style={{ width: s + 2, height: s + 2, alignItems: 'center', justifyContent: 'center', opacity }}>
      <View style={shape} />
    </View>
  );
}

/** その日の衛星の印3つ（右はし）。読み上げは label にまとめる */
export function SatMarks({ sats, label }: { sats: SatStates; label: string }) {
  return (
    <View style={s.marks} accessible accessibilityLabel={label} testID="growth-sats">
      <SatMark kind="training" state={sats.training} />
      <SatMark kind="food" state={sats.food} />
      <SatMark kind="sleep" state={sats.sleep} />
    </View>
  );
}

const THUMB = 16;
const DOT = 6;

/**
 * つまみ。左が最初の記録の日、右が今日。進んだ分は緑、ハイライトのある日に小さい点（過ぎた点は橙、先の点は灰色）。
 * 塗りとつまみの位置は再生の位置（pos）から UI スレッドで動かす。指で動かすと 1日単位で onSeek を呼ぶ（押せる高さ 48dp）
 */
export function Scrubber({ pos, dayCount, index, markIndexes, labels, disabled, onSeek, valueText }: {
  pos: SharedValue<number>; dayCount: number; index: number; markIndexes: number[]; labels: { left: string; right: string | null };
  disabled: boolean; onSeek: (index: number) => void; valueText: string;
}) {
  const width = useSharedValue(0);
  const latest = useRef({ width: 0, dayCount, index, disabled, onSeek, startX: 0 });
  useLayoutEffect(() => { Object.assign(latest.current, { dayCount, index, disabled, onSeek }); });

  // ref は指の動きの中（描く間ではない）でだけ読むので、描くたびに作り直さずに最新の値を使える
  const handlers = useMemo(() => {
    const seek = (x: number) => {
      const l = latest.current;
      l.onSeek(indexAtX(x, l.width, l.dayCount));
    };
    // eslint-disable-next-line react-hooks/refs
    return PanResponder.create({
      onStartShouldSetPanResponder: () => !latest.current.disabled,
      onMoveShouldSetPanResponder: () => !latest.current.disabled,
      onPanResponderGrant: (e) => {
        latest.current.startX = e.nativeEvent.locationX;
        seek(latest.current.startX);
      },
      onPanResponderMove: (_, g) => seek(latest.current.startX + g.dx),
      // 指で動かしているあいだは、ほか（スクロール）に渡さない
      onPanResponderTerminationRequest: () => false,
    }).panHandlers;
  }, []);

  const fill = useAnimatedStyle(() => ({ width: width.get() * ratioAt(pos.get(), dayCount) }));
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: width.get() * ratioAt(pos.get(), dayCount) - THUMB / 2 }] }));

  return (
    <View>
      <View
        {...handlers}
        style={s.scrubTouch}
        onLayout={(e) => { latest.current.width = e.nativeEvent.layout.width; width.set(e.nativeEvent.layout.width); }}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="日を選ぶ"
        aria-disabled={disabled}
        accessibilityValue={{ min: dayCount > 0 ? 1 : 0, max: dayCount, now: dayCount > 0 ? index + 1 : 0, text: valueText }}
        accessibilityActions={disabled ? [] : [{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          const d = e.nativeEvent.actionName === 'increment' ? 1 : e.nativeEvent.actionName === 'decrement' ? -1 : 0;
          if (d !== 0 && !disabled) onSeek(Math.min(dayCount - 1, Math.max(0, index + d)));
        }}
        testID="growth-scrubber"
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
        <Animated.View pointerEvents="none" style={[s.thumb, { backgroundColor: disabled ? colors.outline : colors.text }, thumb]} />
      </View>
      <View style={s.scrubLabels}>
        <T variant="bodyS" color={colors.sub}>{labels.left}</T>
        {labels.right != null && <T variant="bodyS" color={colors.sub}>{labels.right}</T>}
      </View>
    </View>
  );
}

/** 再生の操作のボタン（48dp 以上）。icon か文字のどちらか。使えないときは使えない色で、読み上げでも伝える */
export function ControlButton({ icon, text, label, onPress, disabled, testID }: {
  icon?: IconName; text?: string; label: string; onPress: () => void; disabled?: boolean; testID?: string;
}) {
  const fg = disabled ? colors.disabled : colors.text;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      scaleTo={0.92}
      testID={testID}
      style={s.control}
    >
      {icon ? <Icon name={icon} color={fg} size={size.icon} /> : <T variant="labelL" color={fg}>{text}</T>}
    </PressableScale>
  );
}

/** 再生／一時停止の大きいボタン（白い丸、76dp） */
export function PlayButton({ playing, label, onPress, disabled }: { playing: boolean; label: string; onPress: () => void; disabled: boolean }) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID="growth-play"
      style={[s.play, { backgroundColor: disabled ? colors.disabledContainer : colors.text }]}
    >
      <Icon name={playing ? 'pause' : 'play'} color={disabled ? colors.disabled : colors.bg} size={32} />
    </PressableScale>
  );
}

/** 下の累計1つ（「287.0 t」と、印つきの「筋トレ」） */
export function TotalItem({ value, unit, kind, name, label, first }: {
  value: string; unit: string; kind: MarkKind; name: string; label: string; first?: boolean;
}) {
  return (
    <View style={[s.total, !first && s.totalLine]} accessible accessibilityLabel={label} testID={`growth-total-${kind}`}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.xs }}>
        <T variant="numL">{value}</T>
        <T variant="bodyS" color={colors.sub}>{unit}</T>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
        <SatMark kind={kind} size={8} />
        <T variant="bodyS" color={colors.sub}>{name}</T>
      </View>
    </View>
  );
}

export function TotalsRow({ children }: { children: ReactNode }) {
  return <View style={s.totals}>{children}</View>;
}

const s = StyleSheet.create({
  marks: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  scrubTouch: { height: size.touch, justifyContent: 'center' },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.line, overflow: 'hidden' },
  fill: { height: 4, backgroundColor: colors.accent },
  dot: { position: 'absolute', top: (size.touch - DOT) / 2, width: DOT, height: DOT, marginLeft: -DOT / 2, borderRadius: DOT / 2 },
  thumb: { position: 'absolute', left: 0, top: (size.touch - THUMB) / 2, width: THUMB, height: THUMB, borderRadius: THUMB / 2 },
  scrubLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -space.xs },
  control: { minWidth: size.touch, height: size.touch, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xs },
  play: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center' },
  totals: { flexDirection: 'row' },
  total: { flex: 1, gap: space.xs },
  totalLine: { paddingLeft: space.l, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.line },
});
