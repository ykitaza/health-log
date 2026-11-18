import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { AiCaptureButton } from '@/components/ChatSheet';
import { Button, Chip, Header, IconButton, Notice, Screen, Sheet, T } from '@/components/ui';
import { WordRow } from '@/components/WordRow';
import type { ListItem } from '@/db/repositories/words';
import { useData, useRepos } from '@/hooks/data';
import { useNotifications } from '@/hooks/notifications';
import { applyFilter, CollectedFilter, groupByWork, rowSub } from '@/lib/collected';
import { colors, space } from '@/theme';

/** 拾った（Figma の 2-collection）。本・人ごとのまとまり、絞り込み、探す（虫めがね）、記録と設定（…） */
export default function CollectedScreen() {
  const repos = useRepos();
  const notifications = useNotifications();
  const params = useLocalSearchParams<{ filter?: string }>();
  const [filter, setFilter] = useState<CollectedFilter>('all');
  const [notice, setNotice] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const { data } = useData(async (r) => ({ items: await r.words.listAll(), sources: await r.catalog.sources() }));

  // 手札の「自分の言葉 23 ›」から来たとき
  useEffect(() => {
    if (params.filter === 'own' || params.filter === 'hand') setFilter(params.filter);
  }, [params.filter]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const items = data?.items ?? [];
  const sources = data?.sources ?? [];
  const shown = applyFilter(items, filter);
  const groups = groupByWork(shown, sources);
  const unwritten = items.filter((e) => !e.scene).length;

  const toHand = async (e: ListItem) => {
    const r = await repos.words.move(e.id, 'hand');
    if (r.ok) { setNotice(`「${e.text}」を手札に入れました`); await notifications.askOnce(); } else setNotice('手札がいっぱいです（10枚まで）');
  };

  const chip = (f: CollectedFilter, label: string) => (
    <Chip key={f} label={label} variant={filter === f ? 'selected' : 'default'} onPress={() => setFilter(f)} testID={`filter-${f}`} />
  );

  return (
    <Screen inTab testID="collected-screen" footer={notice ? <Notice message={notice} testID="collected-notice" /> : undefined}>
      <Header
        title="拾った"
        count={String(items.length)}
        right={(
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
            <AiCaptureButton small prompt={() => ({ kind: 'capture' })} />
            <IconButton name="search" label="探す" onPress={() => router.push('/collected/search')} testID="open-search" />
            <IconButton name="moreH" label="記録と設定" onPress={() => setMenu(true)} testID="open-menu" style={{ marginRight: -space.m }} />
          </View>
        )}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.s, paddingRight: space.xl }} style={{ marginRight: -space.xl, marginBottom: space.m }}>
        {chip('all', 'すべて')}
        {chip('star', '★')}
        {unwritten > 0 && chip('unwritten', `未記入 ${unwritten}`)}
        {chip('ai', 'AI から')}
        {chip('hand', '手札')}
        {chip('own', '自分の言葉')}
        {sources.filter((s) => !s.hidden).map((s) => chip(`source:${s.id}`, s.name))}
        {sources.some((s) => s.hidden) && <T variant="label" color={colors.sub} style={{ alignSelf: 'center', marginLeft: space.s }}>隠した場所</T>}
        {sources.filter((s) => s.hidden).map((s) => chip(`source:${s.id}`, s.name))}
      </ScrollView>

      {data && items.length === 0 && (
        <View style={{ marginTop: space.xxl, gap: space.s }}>
          <T variant="wordS">まだ何も拾っていません</T>
          <T variant="bodyS" color={colors.sub}>「書き留める」か、Claude・ChatGPT から拾えます。</T>
        </View>
      )}
      {data && items.length > 0 && shown.length === 0 && <T variant="bodyS" color={colors.sub} style={{ marginTop: space.xl }}>当てはまる言葉はありません</T>}

      {groups.map((g) => (
        <View key={g.key} style={{ marginTop: space.l }} testID="collected-group">
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.m, paddingVertical: space.s }}>
            <T variant="bodyS" bold>{g.head}</T>
            {g.sub !== '' && <T variant="label" color={colors.sub}>{g.sub}</T>}
          </View>
          {g.items.map((e) => (
            <WordRow key={e.id} e={e} sub={rowSub(e)} onToHand={e.place === 'collected' ? toHand : undefined} />
          ))}
        </View>
      ))}
      <Sheet visible={menu} onClose={() => setMenu(false)} testID="collected-menu">
        <View style={{ gap: space.s }}>
          <Button label="記録" icon="chart" variant="plain" onPress={() => { setMenu(false); router.push('/records'); }} testID="open-records" />
          <Button label="設定" variant="plain" onPress={() => { setMenu(false); router.push('/settings'); }} testID="open-settings" />
        </View>
      </Sheet>
    </Screen>
  );
}
