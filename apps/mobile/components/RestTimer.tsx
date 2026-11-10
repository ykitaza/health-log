import { useSyncExternalStore } from 'react';
import { AppState, StyleSheet, Vibration, View } from 'react-native';
import Animated, { FadeIn, FadeOut, useReducedMotion } from 'react-native-reanimated';
import { createRestTimer, formatRest, REST_EXTEND_SECONDS, remainingRatio, remainingSeconds, spokenRest } from '@/lib/restTimer';
import { colors, space } from '@/theme';
import { duration } from '@/theme/motion';
import { easeIn, easeOut } from './motion';
import { T } from './Text';
import { Button } from './ui';

/**
 * アプリで1つの休憩のタイマー（lib/restTimer.ts）。記録の入力でセットを完了にすると数え始め、
 * 記録の入力とその日のトレーニングの画面の下に、同じ帯を出す。振動は RN 標準の Vibration（VIBRATE の許可は Expo の既定で入っている）
 */
export const restTimer = createRestTimer({
  now: () => Date.now(),
  vibrate: (pattern) => Vibration.vibrate(pattern),
  isActive: () => AppState.currentState === 'active',
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
});

// 前面に戻ったとき：裏にあるあいだに 0 を過ぎていたら、振動せずに帯を消す
AppState.addEventListener('change', (state) => { if (state === 'active') restTimer.resume(); });

/** タイマーが動くたびに（1秒ごと）描き直す */
function useRestTimer() {
  return useSyncExternalStore(restTimer.subscribe, restTimer.snapshot);
}

/**
 * 下のボタンの上の帯：「休憩 1:12」「+30秒」「止める」と、残りの細い線。動いていなければ何も出さない。
 * 出るときは 250ms で薄く現れ、消えるときは 150ms（動きを減らす設定なら、すぐに出し入れする）。残りの線は1秒ごとに縮める（動かさない）
 */
export function RestTimerBar() {
  const { state, now } = useRestTimer();
  const reduced = useReducedMotion();
  if (!state) return null;
  const seconds = remainingSeconds(state, now);
  return (
    <Animated.View
      entering={reduced ? undefined : FadeIn.duration(duration.enter).easing(easeOut)}
      exiting={reduced ? undefined : FadeOut.duration(duration.exit).easing(easeIn)}
      style={s.band}
      testID="rest-timer"
    >
      <View style={s.row}>
        <View style={s.time} accessible accessibilityLabel={`休憩 ${spokenRest(seconds)}`}>
          <T variant="labelL" color={colors.sub}>休憩</T>
          <T num bold size={28} testID="rest-timer-time">{formatRest(seconds)}</T>
        </View>
        <Button label={`+${REST_EXTEND_SECONDS}秒`} variant="text" small accessibilityLabel={`休憩を${REST_EXTEND_SECONDS}秒のばす`} onPress={() => restTimer.extend()} style={s.action} />
        <Button label="止める" variant="text" small accessibilityLabel="休憩のタイマーを止める" onPress={() => restTimer.stop()} style={s.action} />
      </View>
      <View style={s.track} importantForAccessibility="no-hide-descendants" aria-hidden>
        <View style={[s.fill, { width: `${remainingRatio(state, now) * 100}%` }]} />
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  // 画面の左右の余白の外まで広げる（下のボタンの列の上の帯）
  band: { marginHorizontal: -space.screen, marginTop: -space.s, marginBottom: space.xs, backgroundColor: colors.card },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingLeft: space.screen, paddingRight: space.s, minHeight: 56 },
  time: { flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: space.m },
  action: { paddingLeft: 12, paddingRight: 12 },
  track: { height: 3, backgroundColor: colors.line },
  fill: { height: 3, backgroundColor: colors.accent },
});
