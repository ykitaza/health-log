import { useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  cancelAnimation, Easing, SharedValue, useAnimatedProps, useAnimatedReaction, useAnimatedStyle, useReducedMotion, useSharedValue,
  withRepeat, withSequence, withSpring, withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import {
  EXIT_SCALE, MARK_H_PATH, MARK_H_WIDTH, MARK_PULSE_PATH, MARK_PULSE_WIDTH, MARK_SIZE, MARK_SPACE, MARK_VIEWBOX, markPose, POP_SCALE,
  PULL_CYCLE_MS, PULSE_DASH, pulseDrawOffset, pulseLoopOffset, pullMarkMotion, reachedThreshold,
} from '@/lib/sync/pullMark';
import { colors } from '@/theme';
import { duration, springs } from '@/theme/motion';
import { easeIn, easeOut } from './motion';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const easeInOut = Easing.inOut(Easing.ease);
const WIDTH = (MARK_SIZE * MARK_VIEWBOX.width) / MARK_VIEWBOX.height;

/**
 * 下に引っぱって同期するときの印（RefreshControl の丸い印の代わり）。KARADA のマーク（K と心拍の線）がローディングの動きをする。
 * - 出る：上から下りてきて薄い状態から濃くなり、心拍の線が左から描かれる（250ms、ease-out）。描き終わり（しきい値）で一度ポンとはずむ
 * - 同期中：心拍の線が消えては描かれ、K がやわらかく光る（0.9 秒の周期、ease-in-out）
 * - 終わり：150ms で小さくなりながら消える。中身（shift を使う側）も元の位置に戻る
 * 動きを減らす設定なら、マークを出して消すだけ。読み上げは usePullToSync（hooks/sync.tsx）が知らせるので、ここは読まない
 */
export function usePullMark(active: boolean) {
  const reduced = useReducedMotion();
  const motion = pullMarkMotion(reduced, duration);
  /** 引っぱった量（0〜1）。Android の RefreshControl は途中の量を渡さないので、放したあとに 0 から 1 まで動かす */
  const progress = useSharedValue(0);
  /** 出ている量（0〜1）。中身を下げる量と、消えるときの大きさ・透明度 */
  const shown = useSharedValue(0);
  const pop = useSharedValue(1);
  const loop = useSharedValue(0);
  const glow = useSharedValue(0);
  const looping = useSharedValue(false);
  const enteredAt = useRef(0);

  useEffect(() => {
    if (active) {
      enteredAt.current = Date.now();
      looping.set(false);
      loop.set(0);
      pop.set(1);
      progress.set(0);
      progress.set(withTiming(1, { duration: motion.enterMs, easing: easeOut }));
      shown.set(withTiming(1, { duration: motion.enterMs, easing: easeOut }));
      return;
    }
    // 出る動きの途中で同期が終わったときは、出きってから消す（2つの動きを順に見せる。わざと遅くはしない）
    const wait = Math.max(0, motion.enterMs - (Date.now() - enteredAt.current));
    // 心拍の線は、そのときの形で止めて消す（描き終わりの形に跳ばない）
    const t = setTimeout(() => {
      cancelAnimation(loop);
      cancelAnimation(glow);
      glow.set(withTiming(0, { duration: motion.exitMs, easing: easeIn }));
      shown.set(withTiming(0, { duration: motion.exitMs, easing: easeIn }));
    }, wait);
    return () => clearTimeout(t);
    // motion は reduced から決まる
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reduced]);

  // しきい値まで来たら（描き終わったら）ポンとはずんで、同期中の動きを始める
  useAnimatedReaction(() => reachedThreshold(progress.get()) && shown.get() > 0, (armed, before) => {
    if (!armed || before || !motion.pop) return;
    pop.set(withSequence(withTiming(POP_SCALE, { duration: 90, easing: easeOut }), withSpring(1, springs.pop)));
    if (!motion.loop) return;
    looping.set(true);
    loop.set(withRepeat(withTiming(1, { duration: PULL_CYCLE_MS, easing: easeInOut }), -1, false));
    glow.set(withRepeat(withTiming(1, { duration: PULL_CYCLE_MS / 2, easing: easeInOut }), -1, true));
  }, [motion.pop, motion.loop]);

  /** 中身を下げる（マークの場所をあける） */
  const shift = useAnimatedStyle(() => ({ transform: [{ translateY: MARK_SPACE * shown.get() }] }));
  return { shift, values: { progress, shown, pop, loop, glow, looping } };
}

type MarkValues = ReturnType<typeof usePullMark>['values'];

/** マークの絵。上のまん中に重ねて置く（押せない・読まない） */
export function PullMark({ values }: { values: MarkValues }) {
  const { progress, shown, pop, loop, glow, looping } = values;
  const style = useAnimatedStyle(() => {
    const pose = markPose(progress.get());
    const s = shown.get();
    return {
      opacity: pose.opacity * s,
      transform: [{ translateY: pose.translateY }, { scale: pop.get() * (EXIT_SCALE + (1 - EXIT_SCALE) * s) }],
    };
  });
  return (
    <Animated.View style={[st.mark, style]} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID="pull-mark">
      <Svg width={WIDTH} height={MARK_SIZE} viewBox={`${MARK_VIEWBOX.x} ${MARK_VIEWBOX.y} ${MARK_VIEWBOX.width} ${MARK_VIEWBOX.height}`}>
        <Glow glow={glow} />
        <Path d={MARK_H_PATH} fill="none" stroke={colors.accent} strokeWidth={MARK_H_WIDTH} strokeLinecap="round" strokeLinejoin="round" />
        <Pulse progress={progress} loop={loop} looping={looping} />
      </Svg>
    </Animated.View>
  );
}

/** K の後ろの、緑の光のにじみ（太い線を薄く重ねる） */
function Glow({ glow }: { glow: SharedValue<number> }) {
  const props = useAnimatedProps(() => ({ strokeOpacity: 0.28 * glow.get() }));
  return (
    <AnimatedPath d={MARK_H_PATH} fill="none" stroke={colors.accent} strokeWidth={MARK_H_WIDTH * 1.7} strokeLinecap="round" strokeLinejoin="round"
      animatedProps={props} strokeOpacity={0} />
  );
}

function Pulse({ progress, loop, looping }: { progress: SharedValue<number>; loop: SharedValue<number>; looping: SharedValue<boolean> }) {
  const props = useAnimatedProps(() => ({
    strokeDashoffset: looping.get() ? pulseLoopOffset(loop.get()) : pulseDrawOffset(progress.get()),
  }));
  return (
    <AnimatedPath d={MARK_PULSE_PATH} fill="none" stroke={colors.accent} strokeWidth={MARK_PULSE_WIDTH} strokeLinecap="round" strokeLinejoin="round"
      strokeDasharray={[...PULSE_DASH]} animatedProps={props} />
  );
}

const st = StyleSheet.create({
  // 中身を下げた MARK_SPACE（56）の中で、上下 8 ずつあけてまん中に
  mark: { position: 'absolute', top: (MARK_SPACE - MARK_SIZE) / 2, left: '50%', marginLeft: -WIDTH / 2, width: WIDTH, height: MARK_SIZE },
});
