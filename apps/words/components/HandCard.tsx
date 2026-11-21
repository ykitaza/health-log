import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import type { ListItem } from '@/db/repositories/words';
import { isDue } from '@/lib/schedule';
import { Source, STAGE_LABELS, STAGE_STEPS } from '@/lib/types';
import { colors, radius, space } from '@/theme';
import { NO_SPACING, T } from './ui';
import { Seal } from './wa';

/** 段階の印（2本の線。意味がわかる → 使えた） */
export function StageDashes({ step }: { step: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 3 }}>
      {[1, 2].map((i) => <View key={i} style={{ width: 16, height: 3, borderRadius: 2, backgroundColor: i <= step ? colors.sub : colors.line }} />)}
    </View>
  );
}

/** 手札の札（Figma の 3-hand）。段階・表現・出どころ・そろそろの印。使えたは朱の落款 */
export function HandCard({ e, sources, today }: { e: ListItem; sources: Source[]; today: string }) {
  const stage = e.stage ?? 'understood';
  const src = sources.find((s) => s.id === e.firstSourceId)?.name;
  const where = [e.firstTitle ? null : src, e.firstTitle || null].filter(Boolean).join(' · ') || src || '';
  const due = isDue(e, today);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${e.text}、${STAGE_LABELS[stage]}${due ? '、そろそろ' : ''}`}
      onPress={() => router.push(`/word/${e.id}`)}
      style={({ pressed }) => [s.card, pressed && { opacity: 0.7 }]}
      testID="hand-card"
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space.s, rowGap: 2 }}>
        <StageDashes step={STAGE_STEPS[stage]} />
        <T variant="label" color={colors.sub}>{STAGE_LABELS[stage]}</T>
      </View>
      <T variant="wordS" numberOfLines={3} style={{ fontSize: 20, lineHeight: 30, ...NO_SPACING }}>{e.text}</T>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
        <T variant="label" color={colors.sub} numberOfLines={1} style={{ flex: 1 }}>{where}</T>
        {due && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }} testID="due-mark">
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent }} />
            <T variant="label" color={colors.accent}>そろそろ</T>
          </View>
        )}
        {!due && stage === 'used' && <Seal play={false} size={24} />}
      </View>
    </Pressable>
  );
}

export function EmptySlot({ onPress }: { onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="空き。拾ったから選ぶ" onPress={onPress} style={({ pressed }) => [s.card, s.empty, pressed && { opacity: 0.6 }]} testID="hand-empty">
      <T variant="bodyS" color={colors.sub}>空き</T>
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: {
    flexBasis: '47%', flexGrow: 1, minHeight: 124, backgroundColor: colors.card, borderRadius: radius.l, borderWidth: 1, borderColor: colors.line,
    padding: space.l, gap: space.s, justifyContent: 'space-between',
  },
  empty: { backgroundColor: 'transparent', borderStyle: 'dashed', borderColor: colors.faint, alignItems: 'center', justifyContent: 'center' },
});
