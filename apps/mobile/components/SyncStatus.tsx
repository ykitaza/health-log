import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, LayoutAnimationConfig, useReducedMotion } from 'react-native-reanimated';
import { useAuth } from '@/hooks/auth';
import { useSync } from '@/hooks/sync';
import { SyncLine, syncStatusLine } from '@/lib/sync/status';
import { colors, size, space } from '@/theme';
import { duration } from '@/theme/motion';
import { Icon, IconName } from './Icon';
import { easeOut, PressableScale } from './motion';
import { T } from './Text';

const ICON: Record<SyncLine['kind'], IconName> = { signedOut: 'info', syncing: 'sync', error: 'caution', pending: 'arrowUp', synced: 'sync' };
/** 行の見た目の高さ。押せるものは上下に広げて 48 にする（まわりとの間は変えない） */
const LINE_HEIGHT = 24;

/** 同期の状態の小さな1行（ホームの上）。時刻は1分ごとに出し直す */
export function SyncStatusLine() {
  const { status } = useAuth();
  const sync = useSync();
  const reduced = useReducedMotion();
  // 同期した直後は now のほうが古いことがあるが、そのときは「たった今」になる（syncedAgo）。ずれは1分より小さい
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const line = syncStatusLine({ auth: status, ...sync }, now);
  if (!line) return null;
  return (
    <SyncStatusView
      line={line}
      reduced={reduced}
      onPress={() => (line.action?.to === 'retry' ? sync.syncNow() : router.push('/account'))}
    />
  );
}

/** 表示だけ（jest で props を確かめる）。文が変わると 150ms でふわっと出る。初めて出すときと、動きを減らす設定のときは動かさない */
export function SyncStatusView({ line, reduced, onPress }: { line: SyncLine; reduced: boolean; onPress: () => void }) {
  const error = line.kind === 'error';
  const color = error ? colors.danger : colors.sub;
  const body = (
    <Animated.View key={line.text} entering={reduced ? undefined : FadeIn.duration(duration.text).easing(easeOut)} style={s.row}>
      <Icon name={ICON[line.kind]} size={16} color={color} />
      <T variant="bodyS" color={color}>{line.text}</T>
      {line.action && <T variant="labelM" color={colors.accent}>{line.action.label}</T>}
    </Animated.View>
  );
  // Android では親の外に出た部分は押せないので、押せるものを1番外に置き、自分の上下を広げる（親はスクロールの中身）
  return <LayoutAnimationConfig skipEntering>{line.action ? (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${line.text}。${line.action.label}`}
      accessibilityLiveRegion={error ? 'polite' : 'none'}
      onPress={onPress}
      style={s.press}
      testID="sync-status"
    >
      {body}
    </PressableScale>
  ) : (
    <View style={s.plain} accessible accessibilityLabel={line.text} testID="sync-status">{body}</View>
  )}</LayoutAnimationConfig>;
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  // 見た目の行（24）より上下に 12 ずつ広げて、押せる高さを 48 にする。広げた分は margin で戻す
  press: { alignSelf: 'flex-start', minHeight: size.touch, marginVertical: (LINE_HEIGHT - size.touch) / 2, justifyContent: 'center', paddingRight: space.s },
  plain: { alignSelf: 'flex-start', height: LINE_HEIGHT, justifyContent: 'center' },
});
