import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import type { ListItem } from '@/db/repositories/words';
import { PLACE_LABELS } from '@/lib/types';
import { colors, space } from '@/theme';
import { Icon } from './Icon';
import { T } from './ui';

/** 「○ 未記入」（場面がまだない） */
function Unwritten() {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <View style={{ width: 9, height: 9, borderRadius: 5, borderWidth: 1.5, borderColor: colors.sub }} />
      <T variant="label" color={colors.sub}>未記入</T>
    </View>
  );
}

/** 一覧の右の印（手札・自分の言葉・★・未記入・出会いの数） */
export function RowMarks({ e }: { e: ListItem }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
      {e.encounterCount > 1 && <T variant="label" color={colors.sub}>出会い {e.encounterCount}</T>}
      {e.place !== 'collected' && <T variant="label" color={e.place === 'hand' ? colors.accent : colors.sub}>{PLACE_LABELS[e.place]}</T>}
      {!e.scene && <Unwritten />}
      {e.star && <Icon name="star" size={20} color={colors.ink} />}
    </View>
  );
}

const ACTION_WIDTH = 128;

/**
 * 拾ったの1行。押すと言葉の詳細。拾ったにあるものは、横にすべらせると「手札に入れる」が出る
 * （読み上げでは、行の操作としても出す）
 */
export function WordRow({ e, sub, extra, onToHand, testID }: { e: ListItem; sub: string; extra?: string; onToHand?: (e: ListItem) => void; testID?: string }) {
  const { width } = useWindowDimensions();
  const row = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={e.text}
      accessibilityActions={onToHand ? [{ name: 'toHand', label: '手札に入れる' }] : undefined}
      onAccessibilityAction={(ev) => { if (ev.nativeEvent.actionName === 'toHand') onToHand?.(e); }}
      onPress={() => router.push(`/word/${e.id}`)}
      style={({ pressed }) => [s.row, onToHand && { width: Math.min(width, 640) - space.xl * 2 }, pressed && { opacity: 0.6 }]}
      testID={testID ?? 'word-row'}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
        <T variant="word" style={{ flex: 1 }} numberOfLines={2}>{e.text}</T>
        <RowMarks e={e} />
      </View>
      {sub !== '' && <T variant="bodyS" color={colors.sub} numberOfLines={1}>{sub}</T>}
      {extra && <T variant="label" color={colors.sub} numberOfLines={1}>{extra}</T>}
    </Pressable>
  );
  if (!onToHand) return row;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} snapToOffsets={[0, ACTION_WIDTH + space.l]} decelerationRate="fast" bounces={false}>
      {row}
      <Pressable accessibilityRole="button" accessibilityLabel={`${e.text}を手札に入れる`} onPress={() => onToHand(e)} style={s.action}
        importantForAccessibility="no" accessibilityElementsHidden>
        <Icon name="cards" size={20} color={colors.onAccent} />
        <T variant="label" color={colors.onAccent}>手札に入れる</T>
      </Pressable>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  row: { paddingVertical: space.m, gap: 2, minHeight: 64, justifyContent: 'center' },
  action: { width: ACTION_WIDTH, marginLeft: space.l, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', gap: 4, marginVertical: space.s, borderRadius: 12 },
});
