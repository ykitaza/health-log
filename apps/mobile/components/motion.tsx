import { ComponentProps, ReactNode, useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, PressableProps, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import Animated, {
  EntryExitAnimationFunction, Easing, FadeInDown, interpolateColor, LinearTransition, useAnimatedStyle, useReducedMotion, useSharedValue,
  withSequence, withSpring, withTiming,
} from 'react-native-reanimated';
import { changedDigits } from '@/lib/digits';
import { colors } from '@/theme';
import { duration, EASE_IN, EASE_OUT, motionDuration, PRESS_SCALE, springs, STAGGER_TOTAL_MS, staggerDelay } from '@/theme/motion';
import { T } from './Text';

export const easeOut = Easing.bezier(...EASE_OUT);
export const easeIn = Easing.bezier(...EASE_IN);

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type PressableScaleProps = Omit<PressableProps, 'style'> & { style?: StyleProp<ViewStyle>; scaleTo?: number };

/** 押すと少し縮み、離すと軽くはねて戻る Pressable。動きを減らす設定なら縮まない */
export function PressableScale({ style, scaleTo = PRESS_SCALE, onPressIn, onPressOut, ...rest }: PressableScaleProps) {
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  return (
    <AnimatedPressable
      {...rest}
      style={[style, anim]}
      onPressIn={(e) => {
        if (!reduced && !rest.disabled) scale.set(withTiming(scaleTo, { duration: duration.press, easing: easeOut }));
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        if (!reduced) scale.set(withSpring(1, springs.release));
        onPressOut?.(e);
      }}
    />
  );
}

/**
 * 下から出るシート。開くとき 250ms で下から出て背景が暗くなり、閉じるとき 150ms で下へ抜ける。
 * 閉じる動きの間も、親の状態（visible）はすぐに変わる（次の操作や画面の切り替えを待たせない）
 */
export function Sheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: ReactNode }) {
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(visible);
  const progress = useSharedValue(0);
  const height = useSharedValue(800);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      progress.set(withTiming(1, { duration: motionDuration(duration.enter, reduced), easing: easeOut }));
      return;
    }
    if (reduced) { progress.set(0); setMounted(false); return; }
    progress.set(withTiming(0, { duration: duration.exit, easing: easeIn }));
    const t = setTimeout(() => setMounted(false), duration.exit);
    return () => clearTimeout(t);
  }, [visible, reduced, progress]);

  const backdrop = useAnimatedStyle(() => ({ opacity: progress.get() }));
  const panel = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - progress.get()) * height.get() }] }));

  if (!mounted) return null;
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <View style={{ flex: 1 }} pointerEvents={visible ? 'auto' : 'none'}>
        <Animated.View style={[StyleSheet.absoluteFill, s.backdrop, backdrop]}>
          <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityRole="button" accessibilityLabel="閉じる" />
        </Animated.View>
        <View style={{ flex: 1 }} pointerEvents="box-none" />
        <Animated.View style={[s.sheet, panel]} onLayout={(e) => height.set(e.nativeEvent.layout.height)}>
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: { maxHeight: '80%', backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
});

type TextProps = Omit<ComponentProps<typeof T>, 'children'>;

/**
 * 変わった桁だけが下から上がって入れ替わる数字（少し行き過ぎて戻る）。初めて出すときと、ready になる前の値の変化は動かさない
 * （読み込みが終わる前の 0 から、読み込んだ値に変わるときなど）。動きを減らす設定なら、ただの文字
 */
export function RollNumber({ value, ready = true, prefix = '', suffix = '', testID, ...text }: TextProps & {
  value: string; ready?: boolean; /** 動かさない前後の文字（「残り 」「kcal」など） */ prefix?: string; suffix?: string;
}) {
  const reduced = useReducedMotion();
  // gens：桁ごとの入れ替えの回数（右端からそろえる）。key に入れて、変わった桁だけを作り直して動かす
  const [st, setSt] = useState({ value, ready, gens: Array.from(value, () => 0) });
  if (st.value !== value || st.ready !== ready) {
    const changed = st.ready && ready && !reduced ? changedDigits(st.value, value) : Array.from(value, () => false);
    const offset = st.value.length - value.length;
    const gens = Array.from(value, (_, i) => (st.gens[i + offset] ?? 0) + (changed[i] ? 1 : 0));
    setSt({ value, ready, gens });
  }
  if (reduced) return <T {...text} testID={testID}>{prefix + value + suffix}</T>;
  const chars = Array.from(value);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline' }} testID={testID} accessible accessibilityLabel={prefix + value + suffix}>
      {prefix !== '' && <T {...text}>{prefix}</T>}
      {chars.map((c, i) => {
        const gen = st.value === value ? st.gens[i] ?? 0 : 0;
        return <Digit key={`${chars.length - i}-${gen}`} char={c} animate={gen > 0} size={text.size ?? 14} text={text} />;
      })}
      {suffix !== '' && <T {...text}>{suffix}</T>}
    </View>
  );
}

function Digit({ char, animate, size, text }: { char: string; animate: boolean; size: number; text: TextProps }) {
  const y = useSharedValue(animate ? size * 0.6 : 0);
  const opacity = useSharedValue(animate ? 0 : 1);
  useEffect(() => {
    if (!animate) return;
    y.set(withSpring(0, springs.pop));
    opacity.set(withTiming(1, { duration: duration.text, easing: easeOut }));
  }, [animate, y, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.get(), transform: [{ translateY: y.get() }] }));
  return (
    <Animated.View style={style}>
      <T {...text}>{char}</T>
    </Animated.View>
  );
}

/**
 * ポンと出るバッジの入れ物（自己ベストなど）。show が true に変わると、小さい大きさから少し行き過ぎて出る。
 * false に変わると、はね返らずに 150ms で消える。初めて出すときに show が true なら、動かさずに出しておく
 */
export function PopIn({ show, children, style, onShow }: { show: boolean; children: ReactNode; style?: StyleProp<ViewStyle>; onShow?: () => void }) {
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(show);
  const scale = useSharedValue(show ? 1 : 0);
  // 前に出したときの show。変わったときだけ動かす（初めて出すときは動かさない）
  const prev = useRef(show);
  const onShowRef = useRef(onShow);
  useEffect(() => { onShowRef.current = onShow; });
  useEffect(() => {
    const changed = prev.current !== show;
    prev.current = show;
    if (show) {
      if (!changed) return;
      setMounted(true);
      onShowRef.current?.();
      if (reduced) { scale.set(1); return; }
      scale.set(0.4);
      scale.set(withSpring(1, springs.pop));
      return;
    }
    if (reduced) { scale.set(0); setMounted(false); return; }
    scale.set(withTiming(0, { duration: duration.exit, easing: easeIn }));
    const t = setTimeout(() => setMounted(false), duration.exit);
    return () => clearTimeout(t);
  }, [show, reduced, scale]);
  const anim = useAnimatedStyle(() => ({ opacity: Math.min(1, scale.get() * 1.5), transform: [{ scale: scale.get() }] }));
  if (!mounted) return null;
  return <Animated.View style={[style, anim]}>{children}</Animated.View>;
}

/** 完了のチェック。done が true に変わると、少し回りながら出て、上下に小さくはねて止まる。外すときははね返らない */
export function CheckPop({ done, children }: { done: boolean; children: ReactNode }) {
  const reduced = useReducedMotion();
  const p = useSharedValue(1);
  const bounce = useSharedValue(0);
  const prev = useRef(done);
  useEffect(() => {
    const changed = prev.current !== done;
    prev.current = done;
    if (!changed) return;
    if (reduced || !done) { p.set(1); bounce.set(0); return; }
    p.set(0);
    p.set(withSpring(1, springs.pop));
    bounce.set(withSequence(
      withTiming(-3, { duration: 90, easing: easeOut }),
      withTiming(1.5, { duration: 80 }),
      withTiming(0, { duration: 80 }),
    ));
  }, [done, reduced, p, bounce]);
  const anim = useAnimatedStyle(() => ({
    transform: [{ translateY: bounce.get() }, { rotate: `${(1 - p.get()) * -90}deg` }, { scale: 0.5 + p.get() * 0.5 }],
  }));
  return <Animated.View style={anim}>{children}</Animated.View>;
}

/** 入力の間違いで、欄を左右に小さく揺らす。trigger が 0 より大きい値に変わるたびに揺れる（間違いのたびに数を増やす） */
export function Shake({ trigger, children, style }: { trigger: number; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduced = useReducedMotion();
  const x = useSharedValue(0);
  useEffect(() => {
    if (trigger <= 0 || reduced) return;
    const step = duration.shake / 6;
    x.set(withSequence(
      withTiming(-6, { duration: step }), withTiming(6, { duration: step }), withTiming(-4, { duration: step }),
      withTiming(4, { duration: step }), withTiming(-2, { duration: step }), withTiming(0, { duration: step }),
    ));
  }, [trigger, reduced, x]);
  const anim = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));
  return <Animated.View style={[style, anim]}>{children}</Animated.View>;
}

/** 0〜1 の割合まで、横に伸びる棒の中身。値が変わると 250ms で伸び縮みする */
export function GrowBar({ ratio, style }: { ratio: number; style?: StyleProp<ViewStyle> }) {
  const reduced = useReducedMotion();
  const w = useSharedValue(reduced ? ratio : 0);
  useEffect(() => {
    w.set(withTiming(ratio, { duration: motionDuration(duration.enter, reduced), easing: easeOut }));
  }, [ratio, reduced, w]);
  const anim = useAnimatedStyle(() => ({ width: `${w.get() * 100}%` }));
  return <Animated.View style={[style, anim]} />;
}

export type ItemLayout = { x: number; width: number };

/** 選んだ印（切り替えの後ろの面）。選んだものへ横にすべる（250ms、行き帰り同じ）。初めて出すときは動かさない */
export function SlidingMark({ layout, style }: { layout: ItemLayout | undefined; style?: StyleProp<ViewStyle> }) {
  const reduced = useReducedMotion();
  const x = useSharedValue(layout?.x ?? 0);
  const width = useSharedValue(layout?.width ?? 0);
  const placed = useRef(false);
  useEffect(() => {
    if (!layout) return;
    if (!placed.current || reduced) {
      placed.current = true;
      x.set(layout.x);
      width.set(layout.width);
      return;
    }
    const cfg = { duration: duration.toggle, easing: easeOut };
    x.set(withTiming(layout.x, cfg));
    width.set(withTiming(layout.width, cfg));
  }, [layout, reduced, x, width]);
  const anim = useAnimatedStyle(() => ({ width: width.get(), transform: [{ translateX: x.get() }] }));
  if (!layout) return null;
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0 }, style, anim]} />;
}

/** リストの行の出入り。足すとすっと現れ、消すと縮んで消え、ほかの行はなめらかに詰める。動きを減らす設定なら動かさない */
const shrinkOut: EntryExitAnimationFunction = () => {
  'worklet';
  const cfg = { duration: duration.exit, easing: easeIn };
  return {
    initialValues: { opacity: 1, transform: [{ scale: 1 }] },
    animations: { opacity: withTiming(0, cfg), transform: [{ scale: withTiming(0.92, cfg) }] },
  };
};

export function useListMotion(ready: boolean) {
  const reduced = useReducedMotion();
  // 開いて並べるときだけ順にずらす（あとから足した行は待たせない）
  const [staggering, setStaggering] = useState(true);
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => setStaggering(false), STAGGER_TOTAL_MS);
    return () => clearTimeout(t);
  }, [ready]);
  // web（E2E で使うだけ）では動かさない。web の Reanimated は自前の消える動きに対応しておらず、消えた行が残って押せなくなる
  if (reduced || Platform.OS === 'web') return { entering: () => undefined, exiting: undefined, layout: undefined };
  return {
    entering: (index: number) =>
      FadeInDown.duration(duration.listItem).easing(easeOut).withInitialValues({ transform: [{ translateY: 12 }] })
        .delay(staggering ? staggerDelay(index, false) : 0),
    exiting: shrinkOut,
    layout: LinearTransition.duration(duration.toggle).easing(easeOut),
  };
}

/** on に変わると、背景の色が 250ms で移る（完了したセットの行が緑になる）。初めて出すときは動かさない */
export function ColorFade({ on, from, to, style, children }: { on: boolean; from: string; to: string; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const reduced = useReducedMotion();
  const p = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    p.set(withTiming(on ? 1 : 0, { duration: motionDuration(on ? duration.enter : duration.exit, reduced), easing: easeOut }));
  }, [on, reduced, p]);
  const anim = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(p.get(), [0, 1], [from, to]) }));
  return <Animated.View style={[style, anim]}>{children}</Animated.View>;
}
