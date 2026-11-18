import { router } from 'expo-router';
import { StyleSheet } from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';
import { useAuth } from '@/hooks/auth';
import { useSync } from '@/hooks/sync';
import { SyncAlert, syncAlert } from '@/lib/sync/status';
import { colors, size, space } from '@/theme';
import { duration } from '@/theme/motion';
import { Icon } from './Icon';
import { easeOut, PressableScale } from './motion';
import { T } from './Text';

/** 行の見た目の高さ。押せるものは上下に広げて 48 にする（まわりとの間は変えない） */
const LINE_HEIGHT = 24;

/**
 * 同期の失敗の小さな知らせ（ホームの見出しの下）。ふだんは何も出さない。
 * 続けて失敗しているときと、別のアカウントでログインしたときだけ出す（決まりは lib/sync/status.ts の syncAlert）
 */
export function SyncAlertLine() {
  const { status } = useAuth();
  const sync = useSync();
  const reduced = useReducedMotion();
  const alert = syncAlert({ auth: status, error: sync.error, failures: sync.failures });
  if (!alert) return null;
  return (
    <SyncAlertView
      alert={alert}
      reduced={reduced}
      onPress={() => (alert.action.to === 'retry' ? sync.syncNow() : router.push('/account'))}
    />
  );
}

/** 表示だけ（jest で props を確かめる）。出るときは 150ms でふわっと出る。動きを減らす設定のときは動かさない */
export function SyncAlertView({ alert, reduced, onPress }: { alert: SyncAlert; reduced: boolean; onPress: () => void }) {
  // Android では親の外に出た部分は押せないので、押せるものを1番外に置き、自分の上下を広げる（親はスクロールの中身）
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${alert.text}。${alert.action.label}`}
      accessibilityLiveRegion="polite"
      onPress={onPress}
      style={s.press}
      testID="sync-alert"
    >
      <Animated.View entering={reduced ? undefined : FadeIn.duration(duration.text).easing(easeOut)} style={s.row}>
        <Icon name="caution" size={16} color={colors.danger} />
        <T variant="bodyS" color={colors.danger}>{alert.text}</T>
        <T variant="labelM" color={colors.accent}>{alert.action.label}</T>
      </Animated.View>
    </PressableScale>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  // 見た目の行（24）より上下に 12 ずつ広げて、押せる高さを 48 にする。広げた分は margin で戻す
  press: { alignSelf: 'flex-start', minHeight: size.touch, marginVertical: (LINE_HEIGHT - size.touch) / 2, justifyContent: 'center', paddingRight: space.s },
});
