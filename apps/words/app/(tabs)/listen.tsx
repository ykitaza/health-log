import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, IconName } from '@/components/Icon';
import { Header, Screen, T } from '@/components/ui';
import { BrushReveal } from '@/components/wa';
import { useListen } from '@/hooks/listen';
import { progressOf } from '@/lib/listen/queue';
import { colors, space } from '@/theme';

/** 大きな丸いボタン（運転中でも押せる大きさ。72〜120dp） */
function Control({ icon, label, onPress, size, primary, disabled, testID }: {
  icon: IconName; label: string; onPress: () => void; size: number; primary?: boolean; disabled?: boolean; testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} onPress={onPress} disabled={disabled} testID={testID}
      hitSlop={12}
      style={({ pressed }) => [
        s.control, { width: size, height: size, borderRadius: size / 2 },
        primary ? { backgroundColor: colors.accent } : { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card },
        (pressed || disabled) && { opacity: disabled ? 0.35 : 0.7 },
      ]}
    >
      <Icon name={icon} size={size * 0.42} color={primary ? colors.onAccent : colors.ink} />
    </Pressable>
  );
}

/**
 * 聞く（運転中に耳で聞く）。大きな再生・一時停止と前・次、いまの表現（明朝）と進み具合の線だけ。読ませる文は置かない。
 * 並びは手札 → 期限のもの → ★ → 最近拾ったもの。画面を消しても、ロック画面・車のボタンで操作できる
 */
export default function ListenScreen() {
  const { state, queue, rebuild, play, pause, next, previous } = useListen();
  // 開いたときに並びを作り直す（鳴らしているあいだは変えない）
  useFocusEffect(useCallback(() => { void rebuild(); }, [rebuild]));
  const current = queue[state.index];
  const empty = queue.length === 0;

  return (
    <Screen inTab scroll={false} testID="listen-screen">
      <Header title="聞く" right={!empty ? <T variant="body" color={colors.sub} testID="listen-position">{state.index + 1} / {queue.length}</T> : undefined} />
      {empty ? (
        <View style={{ flex: 1, justifyContent: 'center', gap: space.m }}>
          <T variant="wordS">まだ聞くものがありません</T>
          <T variant="body" color={colors.sub}>手札に入れた言葉や、最近拾った言葉を、運転中に耳で聞けます。</T>
        </View>
      ) : (
        <>
          <View style={{ flex: 1, justifyContent: 'center', gap: space.m }}>
            {/* 次の表現に移ったら、筆で書くように左から現れる（鳴らしているときだけ。動きを減らす設定ではフェード） */}
            <View testID="listen-current" accessible accessibilityLabel={current?.text ?? ''}>
              <BrushReveal key={current?.id ?? 'none'} play={state.playing}>
                <T variant="wordXL" style={{ fontSize: 44, lineHeight: 60 }} numberOfLines={3}>{current?.text ?? ''}</T>
              </BrushReveal>
            </View>
            {current?.reading ? <T variant="body" color={colors.sub}>{current.reading}</T> : null}
            <View style={s.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(progressOf(state.position, state.duration) * 100) }}>
              <View style={[s.bar, { width: `${progressOf(state.position, state.duration) * 100}%` }]} testID="listen-progress" />
            </View>
            {state.mode === 'speech' && <T variant="label" color={colors.sub} testID="listen-mode">端末の声で読んでいます</T>}
          </View>
          <View style={s.controls}>
            <Control icon="skipPrev" label="前へ" onPress={previous} size={80} testID="listen-prev" />
            {state.playing
              ? <Control icon="pause" label="一時停止" onPress={pause} size={120} primary testID="listen-pause" />
              : <Control icon="play" label="再生" onPress={play} size={120} primary disabled={state.loading && !current} testID="listen-play" />}
            <Control icon="skipNext" label="次へ" onPress={next} size={80} disabled={state.index + 1 >= queue.length} testID="listen-next" />
          </View>
        </>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  control: { alignItems: 'center', justifyContent: 'center' },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: space.xxl, paddingHorizontal: space.s },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.line, overflow: 'hidden', marginTop: space.xl },
  bar: { height: 4, backgroundColor: colors.accent },
});
