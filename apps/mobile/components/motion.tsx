import { ReactNode, useEffect, useState } from 'react';
import { Modal, Pressable, PressableProps, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { colors } from '@/theme';
import { duration, EASE_IN, EASE_OUT, motionDuration, PRESS_SCALE, springs } from '@/theme/motion';

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
