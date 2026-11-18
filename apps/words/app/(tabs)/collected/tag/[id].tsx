import { router, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { Header, Screen, T } from '@/components/ui';
import { WordRow } from '@/components/WordRow';
import { useData } from '@/hooks/data';
import { rowSub } from '@/lib/collected';
import { reviewDay } from '@/lib/date';
import { applyFacets, EMPTY_FACETS } from '@/lib/facets';
import { REGISTER_LABELS, REGISTERS } from '@/lib/types';
import { colors, space } from '@/theme';

/** 場面で（Figma の 6c）：使う場面のタグの付いた表現を、硬さごとに並べる（本人が確かめたタグが先） */
export default function TagScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data } = useData(async (r) => ({
    items: await r.words.listAll(), links: await r.words.allTagLinks(), encounters: await r.words.encounterFacets(), tags: await r.catalog.tags(),
  }), [id]);
  const tag = data?.tags.find((t) => t.id === id);
  const results = data ? applyFacets(data.items, { ...EMPTY_FACETS, situations: [id] }, data.links, data.encounters, reviewDay(new Date())) : [];
  const groups = [...REGISTERS.map((r) => ({ key: r, label: REGISTER_LABELS[r], items: results.filter((e) => e.register === r) })),
    { key: 'none', label: '硬さはまだ', items: results.filter((e) => !e.register) }].filter((g) => g.items.length > 0);

  return (
    <Screen inTab testID="tag-screen">
      <Header title={tag?.name ?? ''} onBack={() => router.back()} />
      <T variant="bodyS" color={colors.sub}>拾った {results.length} 語</T>
      {groups.map((g) => (
        <View key={g.key} style={{ marginTop: space.xl }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.s }}>
            <T variant="bodyS" bold>{g.label}</T>
            <T variant="label" color={colors.sub}>{g.items.length}</T>
          </View>
          {g.items.map((e) => <WordRow key={e.id} e={e} sub={rowSub(e)} extra={e.tagIds.get(id) === 'proposed' ? 'Claude の案' : undefined} />)}
        </View>
      ))}
    </Screen>
  );
}
