/**
 * 和の動き4つ（docs/words-design.md の「動き」、Figma の「動き」の絵コンテ）。
 * - InkSettle：拾ったとき、墨がにじむ（不透明度 0 → 1、後ろの薄い墨のにじみが消えていく）。600ms
 * - Bookmark：手札に入れたとき、札の右上に藍の栞が上からすべりこむ（上に 24px・不透明度 0 → 止まる）。400ms
 * - Seal：使えたとき、札の右下に朱の落款が押される（大きさ 125% → 100%・不透明度 0 → 1）。240ms・短い振動 1 回
 * - BrushReveal：答えを見たとき、言葉が左から右へ筆で書くように埋まる（切り抜きの幅 0 → 100%）。700ms
 *
 * 共通：曲線は cubic-bezier(0.2, 0, 0, 1)。どれも一度だけ（くり返さない）。動くのは本人が操作した1回だけ（play が true のとき）。
 * 動きを減らす設定なら、どれも 150ms のフェードだけ。動いている間も操作を止めない（pointerEvents を変えない）
 */
import { ReactNode, useEffect, useState } from 'react';
import { LayoutChangeEvent, StyleProp, Vibration, View, ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Defs, Ellipse, Path, RadialGradient, Stop, Text as SvgText } from 'react-native-svg';
import { colors, fonts } from '@/theme';
import { EASE, motion } from '@/theme/motion';

const ease = Easing.bezier(...EASE);

/** 0 → 1 を一度だけ進める。play が false なら、はじめから 1（動かない） */
function useProgress(play: boolean, duration: number) {
  const reduced = useReducedMotion();
  const p = useSharedValue(play ? 0 : 1);
  useEffect(() => {
    if (!play) { p.value = 1; return; }
    p.value = 0;
    p.value = withTiming(1, { duration: reduced ? motion.reducedFade : duration, easing: ease });
  }, [play, duration, reduced, p]);
  return { p, reduced };
}

export function InkSettle({ children, play, style }: { children: ReactNode; play: boolean; style?: StyleProp<ViewStyle> }) {
  const { p, reduced } = useProgress(play, motion.ink.duration);
  const text = useAnimatedStyle(() => ({ opacity: p.value }));
  const bleed = useAnimatedStyle(() => ({ opacity: reduced ? 0 : (1 - p.value) * (motion.ink.bleedFrom / 0.18) }));
  return (
    <View style={style}>
      {play && (
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: -12, right: -12, top: -8, bottom: -8 }, bleed]}>
          <Svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 100 100">
            <Defs>
              <RadialGradient id="ink" cx="50%" cy="50%" rx="50%" ry="50%">
                <Stop offset="0" stopColor={colors.inkBleed} stopOpacity={0.18} />
                <Stop offset="0.6" stopColor={colors.inkBleed} stopOpacity={0.08} />
                <Stop offset="1" stopColor={colors.inkBleed} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Ellipse cx="50" cy="50" rx="50" ry="50" fill="url(#ink)" />
          </Svg>
        </Animated.View>
      )}
      <Animated.View style={text}>{children}</Animated.View>
    </View>
  );
}

/** 札の右上の栞（藍）。show のあいだ出す。play なら上からすべりこむ */
export function Bookmark({ play, style }: { play: boolean; style?: StyleProp<ViewStyle> }) {
  const { p, reduced } = useProgress(play, motion.bookmark.duration);
  const anim = useAnimatedStyle(() => ({
    opacity: p.value,
    transform: [{ translateY: reduced ? 0 : motion.bookmark.dropFrom * (1 - p.value) }],
  }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: -2, right: 20, width: 16, height: 30 }, anim, style]} testID="bookmark">
      <Svg width={16} height={30} viewBox="0 0 16 30">
        <Path d="M0 0 H16 V30 L8 24 L0 30 Z" fill={colors.accent} />
      </Svg>
    </Animated.View>
  );
}

/** 朱の落款「使」。play なら押される（大きさを変えるのはこれだけ）。押したときに短く1回振動する */
export function Seal({ play, size = 36, style }: { play: boolean; size?: number; style?: StyleProp<ViewStyle> }) {
  const { p, reduced } = useProgress(play, motion.seal.duration);
  useEffect(() => {
    if (play && !reduced) Vibration.vibrate(motion.seal.vibrateMs);
  }, [play, reduced]);
  const anim = useAnimatedStyle(() => ({
    opacity: p.value,
    transform: [{ scale: reduced ? 1 : motion.seal.scaleFrom - (motion.seal.scaleFrom - 1) * p.value }],
  }));
  return (
    <Animated.View pointerEvents="none" style={[{ width: size, height: size }, anim, style]} testID="seal" accessibilityLabel="使えた">
      <Svg width={size} height={size} viewBox="0 0 36 36">
        <Path d="M4 2 H32 Q34 2 34 4 V32 Q34 34 32 34 H4 Q2 34 2 32 V4 Q2 2 4 2 Z" fill={colors.seal} />
        <SvgText x="18" y="25" fontSize="20" fontFamily={fonts.mincho} fill="#FFFFFF" textAnchor="middle">使</SvgText>
      </Svg>
    </Animated.View>
  );
}

/** 筆で書くように、左から右へ現れる（切り抜きの幅）。下線は先に引いてある */
export function BrushReveal({ children, play, style }: { children: ReactNode; play: boolean; style?: StyleProp<ViewStyle> }) {
  const { p, reduced } = useProgress(play, motion.brush.duration);
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const clip = useAnimatedStyle(() => (reduced || width === 0
    ? { opacity: p.value, width: width || undefined }
    : { opacity: 1, width: width * p.value }));
  return (
    <View style={style}>
      {/* 幅を測るための見えない写し */}
      <View style={{ opacity: 0 }} onLayout={onLayout} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {children}
      </View>
      <Animated.View style={[{ position: 'absolute', left: 0, top: 0, bottom: 0, overflow: 'hidden' }, clip]}>
        <View style={{ width: width || undefined }}>{children}</View>
      </Animated.View>
    </View>
  );
}
