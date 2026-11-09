import type { BottomTabBarButtonProps } from 'expo-router/js-tabs';
import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { MIN_TOUCH } from '@/lib/touch';
import { colors } from '@/theme';
import { tabIndicatorDuration } from '@/theme/motion';
import { Icon, IconName } from './Icon';
import { easeIn, easeOut } from './motion';
import { T } from './Text';

/** 選んだタブのアイコンの後ろの印（M3 の active indicator） */
export const INDICATOR = { width: 64, height: 32, radius: 16 } as const;

/**
 * 選んだタブの印。選ぶと、まん中から横に広がりながら現れる（200ms、ease-out、はね返りなし）。
 * 選ばなくなると、すっと消える（150ms）。初めて出すときは動かさない。動きを減らす設定なら、すぐに切り替える
 */
export function TabIndicator({ selected }: { selected: boolean }) {
  const reduced = useReducedMotion();
  const scaleX = useSharedValue(selected ? 1 : 0);
  const opacity = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    const ms = tabIndicatorDuration(selected, reduced);
    if (selected) {
      // 消えたあとの印は横の大きさを残しているので、まん中から広げ直す
      if (opacity.get() === 0) scaleX.set(0);
      scaleX.set(withTiming(1, { duration: ms, easing: easeOut }));
      opacity.set(withTiming(1, { duration: ms, easing: easeOut }));
      return;
    }
    opacity.set(withTiming(0, { duration: ms, easing: easeIn }));
  }, [selected, reduced, scaleX, opacity]);
  const anim = useAnimatedStyle(() => ({ opacity: opacity.get(), transform: [{ scaleX: scaleX.get() }] }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: 'absolute', width: INDICATOR.width, height: INDICATOR.height, borderRadius: INDICATOR.radius, backgroundColor: colors.accentDark }, anim]}
    />
  );
}

/**
 * 下のタブの1つ（M3 の navigation bar の項目）。Android の波紋は出さない（押した手ごたえは印が広がる動き）。
 * アイコンの色とラベルの太字は、印と同時に切り替える（色だけで伝えない）
 */
export function TabButton({ icon, label, style, onPress, onLongPress, testID, 'aria-selected': selected }: BottomTabBarButtonProps & { icon: IconName; label: string }) {
  const focused = selected === true;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      testID={testID}
      role="tab"
      aria-selected={focused}
      aria-label={label}
      style={[style, { minHeight: MIN_TOUCH, padding: 0, alignItems: 'center', justifyContent: 'flex-start' }]}
    >
      <View style={{ width: INDICATOR.width, height: INDICATOR.height, alignItems: 'center', justifyContent: 'center' }}>
        <TabIndicator selected={focused} />
        {/* web では位置を指定した印がアイコンの上に描かれるので、アイコンも View に入れて印の上に重ねる */}
        <View>
          <Icon name={icon} color={focused ? colors.onAccentDark : colors.sub} size={24} />
        </View>
      </View>
      <T variant="labelM" bold={focused} color={focused ? colors.text : colors.sub} style={{ marginTop: 4 }}>{label}</T>
    </Pressable>
  );
}
