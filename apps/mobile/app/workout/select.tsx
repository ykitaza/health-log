import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { T } from '@/components/Text';
import { Card, Chip, ChipRow, EmptyState, Header, ListRow, SectionTitle } from '@/components/ui';
import { useFocusData } from '@/hooks/data';
import { relativeDays, todayKey } from '@/lib/date';
import { formatSetShort } from '@/lib/format';
import { topSet } from '@/lib/training';
import { colors, fonts } from '@/theme';

/** 種目の選択（検索、部位のチップ、部位ごとの一覧、前回の記録） */
export default function SelectExerciseScreen() {
  const { date = todayKey() } = useLocalSearchParams<{ date?: string }>();
  const [query, setQuery] = useState('');
  const [part, setPart] = useState<string | null>(null);
  const { data, repos } = useFocusData(async (r) => {
    const [parts, exercises, rows, settings, day] = await Promise.all([
      r.catalog.listBodyParts(), r.catalog.listExercises(), r.workouts.allSetRows(), r.settings.get(), r.workouts.getDay(date),
    ]);
    return { parts, exercises, rows, settings, day };
  }, date);

  // 種目ごとの前回（その日まで）のいちばん重いセット
  const last = useMemo(() => {
    const m = new Map<string, { date: string; text: string }>();
    if (!data) return m;
    const byEx = new Map<string, { date: string; sets: typeof data.rows }>();
    for (const r of data.rows) {
      if (r.date > date) continue;
      const cur = byEx.get(r.exerciseId);
      if (!cur || r.date > cur.date) byEx.set(r.exerciseId, { date: r.date, sets: [r] });
      else if (r.date === cur.date) cur.sets.push(r);
    }
    for (const [id, v] of byEx) {
      const t = topSet(v.sets);
      if (t) m.set(id, { date: v.date, text: `前回 ${formatSetShort(t.weightKg, t.reps ?? 0, data.settings.weightUnit)} ・ ${relativeDays(v.date, date)}` });
    }
    return m;
  }, [data, date]);

  const q = query.trim();
  const filtered = (data?.exercises ?? []).filter((e) => (!part || e.bodyPartId === part) && (q === '' || e.name.includes(q)));
  const groups = (data?.parts ?? []).map((p) => ({ part: p, items: filtered.filter((e) => e.bodyPartId === p.id) })).filter((g) => g.items.length > 0);

  const choose = async (exerciseId: string) => {
    const existing = data?.day.find((e) => e.exerciseId === exerciseId) ?? (await repos.workouts.findEntry(date, exerciseId));
    router.replace({ pathname: '/workout/entry', params: existing ? { date, entryId: existing.id } : { date, exerciseId } });
  };

  return (
    <Screen>
      <Header
        title="種目を選ぶ"
        onBack={() => router.back()}
        right={
          <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/exercises/new', params: part ? { bodyPartId: part } : {} })} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Icon name="plus" size={18} color={colors.accent} />
            <T bold size={14} color={colors.accent}>種目を追加</T>
          </Pressable>
        }
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.card, borderRadius: 12, paddingHorizontal: 14, height: 48, marginVertical: 10 }}>
        <Icon name="search" size={18} color={colors.sub} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="種目を検索"
          placeholderTextColor={colors.sub}
          style={{ flex: 1, minWidth: 0, color: colors.text, fontFamily: fonts.regular, fontSize: 15 }}
        />
      </View>
      <ChipRow>
        <Chip label="すべて" active={part == null} onPress={() => setPart(null)} />
        {data?.parts.map((p) => <Chip key={p.id} label={p.name} active={part === p.id} onPress={() => setPart(p.id)} />)}
      </ChipRow>
      {data && groups.length === 0 && <EmptyState icon="search" title="見つかりません" body="「＋ 種目を追加」で新しい種目を作れます" />}
      {groups.map((g) => (
        <View key={g.part.id}>
          <SectionTitle title={g.part.name} />
          <Card style={{ padding: 0 }}>
            {g.items.map((e, i) => (
              <ListRow
                key={e.id}
                first={i === 0}
                title={e.name}
                subtitle={last.get(e.id)?.text ?? 'まだ記録がありません'}
                onPress={() => choose(e.id)}
              />
            ))}
          </Card>
        </View>
      ))}
    </Screen>
  );
}
