import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Header, Notice, Screen, T } from '@/components/ui';
import { RowMarks } from '@/components/WordRow';
import { useData, useRepos } from '@/hooks/data';
import { useNotifications } from '@/hooks/notifications';
import { rowSub } from '@/lib/collected';
import { colors, space } from '@/theme';

/** 拾ったから選ぶ（手札の空き）。★・出会いの多いものを先に出す（手札に勧められるもの） */
export default function PickScreen() {
  const repos = useRepos();
  const notifications = useNotifications();
  const [error, setError] = useState<string | null>(null);
  const { data } = useData(async (r) => (await r.words.listAll()).filter((e) => e.place === 'collected'));
  const items = [...(data ?? [])].sort((a, b) => Number(b.star) - Number(a.star) || b.encounterCount - a.encounterCount || b.created_at.localeCompare(a.created_at));

  const pick = async (id: string) => {
    const r = await repos.words.move(id, 'hand');
    if (!r.ok) { setError('手札がいっぱいです'); return; }
    await notifications.askOnce();
    router.back();
  };

  return (
    <Screen testID="pick-screen" footer={error ? <Notice message={error} /> : undefined}>
      <Header title="拾ったから選ぶ" onBack={() => router.back()} />
      {data && items.length === 0 && <T variant="bodyS" color={colors.sub}>拾ったに、まだ言葉がありません</T>}
      {items.map((e) => (
        <Pressable key={e.id} accessibilityRole="button" accessibilityLabel={`${e.text}を手札に入れる`} onPress={() => pick(e.id)}
          style={({ pressed }) => [{ paddingVertical: space.m, gap: 2 }, pressed && { opacity: 0.6 }]} testID="pick-row">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
            <T variant="word" style={{ flex: 1 }}>{e.text}</T>
            <RowMarks e={e} />
          </View>
          {rowSub(e) !== '' && <T variant="bodyS" color={colors.sub}>{rowSub(e)}</T>}
        </Pressable>
      ))}
    </Screen>
  );
}
