import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { Source } from '@/lib/types';
import { colors, space } from '@/theme';
import { Chip, T } from './ui';

/** 出会った場所のチップ（隠していないもの、並べた順）。最後に「編集」（出会った場所の画面） */
export function SourceChips({ sources, selected, onSelect }: { sources: Source[]; selected: string | null; onSelect: (id: string | null) => void }) {
  return (
    <View style={s.row}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.s, paddingRight: space.l }} style={{ flex: 1 }}>
        {sources.filter((x) => !x.hidden).map((x) => (
          <Chip
            key={x.id}
            label={x.name}
            variant={selected === x.id ? 'selected' : 'default'}
            onPress={() => onSelect(selected === x.id ? null : x.id)}
            testID={`source-${x.name}`}
          />
        ))}
      </ScrollView>
      <View style={s.divider} />
      <Pressable accessibilityRole="button" accessibilityLabel="出会った場所を編集" onPress={() => router.push('/sources')} style={s.edit} testID="sources-edit">
        <T variant="body">編集</T>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', marginRight: -space.xl },
  divider: { width: 1, height: 40, backgroundColor: colors.line },
  edit: { minHeight: 48, justifyContent: 'center', paddingHorizontal: space.l, paddingRight: space.xl },
});
