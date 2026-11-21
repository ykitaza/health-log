import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Icon, SOURCE_ICONS } from '@/components/Icon';
import { Button, Header, IconButton, Notice, Screen, T, Toggle } from '@/components/ui';
import { NameTakenError } from '@/db/repositories/catalog';
import { ICON_KEYS } from '@/db/seed';
import { useData, useRepos } from '@/hooks/data';
import type { Source } from '@/lib/types';
import { colors, fonts, radius, space } from '@/theme';

const errorText = (e: unknown) => (e instanceof NameTakenError ? '同じ名前の場所があります' : e instanceof Error ? e.message : '直せませんでした');

/** 名前の欄（押すと直せる） */
function NameEdit({ source, onSave }: { source: Source; onSave: (name: string) => Promise<void> }) {
  const [value, setValue] = useState<string | null>(null);
  if (value == null) {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={`${source.name}の名前を変える`} onPress={() => setValue(source.name)} style={{ minHeight: 48, justifyContent: 'center' }}>
        <T variant="body" color={source.hidden ? colors.sub : colors.ink}>{source.name}</T>
      </Pressable>
    );
  }
  return (
    <TextInput
      autoFocus value={value} onChangeText={setValue} maxLength={40} accessibilityLabel="場所の名前"
      onSubmitEditing={() => { void onSave(value).then(() => setValue(null)); }} onBlur={() => { void onSave(value).then(() => setValue(null)); }}
      style={s.input}
    />
  );
}

/** 出会った場所（Figma の 1c）。並べた順に、書き留めるの候補に出る。消すのは隠すこと（過去の出どころは残る） */
export default function SourcesScreen() {
  const repos = useRepos();
  const { data } = useData(async (r) => ({ sources: await r.catalog.sources(), counts: await r.catalog.sourceCounts() }));
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<string>('other');
  const [error, setError] = useState<string | null>(null);
  const sources = data?.sources ?? [];

  const run = async (f: () => Promise<unknown>) => {
    setError(null);
    try { await f(); } catch (e) { setError(errorText(e)); throw e; }
  };
  const move = (i: number, d: -1 | 1) => {
    const ids = sources.map((s) => s.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    void run(() => repos.catalog.reorderSources(ids)).catch(() => {});
  };
  const add = async () => {
    if (!name.trim()) return;
    await run(() => repos.catalog.addSource(name, icon)).then(() => { setName(''); setAdding(false); setIcon('other'); }).catch(() => {});
  };

  return (
    <Screen testID="sources-screen" footer={(
      <View style={{ gap: space.s }}>
        <Notice message={error} />
        <T variant="bodyS" color={colors.sub}>消しても隠れるだけ。過去の記録の出どころは残ります</T>
      </View>
    )}>
      <Header title="出会った場所" onBack={() => router.back()} right={<Button label="完了" variant="text" small onPress={() => router.back()} />} />
      <T variant="bodyS" color={colors.sub}>並べた順に、書き留めるの候補に出ます</T>
      {sources.map((src, i) => (
        <View key={src.id} style={s.row} testID={`source-row-${src.name}`}>
          <View>
            <IconButton name="arrowUp" label={`${src.name}を上へ`} onPress={() => move(i, -1)} size={18} color={colors.sub} style={{ height: 28 }} />
            <IconButton name="arrowDown" label={`${src.name}を下へ`} onPress={() => move(i, 1)} size={18} color={colors.sub} style={{ height: 28 }} />
          </View>
          <Icon name={SOURCE_ICONS[src.icon_key] ?? 'presentation'} size={26} color={src.hidden ? colors.sub : colors.ink} />
          <View style={{ flex: 1 }}>
            <NameEdit source={src} onSave={(n) => (n.trim() && n.trim() !== src.name ? run(() => repos.catalog.updateSource(src.id, { name: n })).catch(() => {}) : Promise.resolve())} />
            {src.hidden && <T variant="label" color={colors.sub}>隠し中・過去の {data?.counts.get(src.id) ?? 0} 件には残っています</T>}
          </View>
          <Toggle value={!src.hidden} onChange={(v) => { void run(() => repos.catalog.updateSource(src.id, { hidden: !v })).catch(() => {}); }} label={`${src.name}を候補に出す`} testID={`source-toggle-${src.name}`} />
        </View>
      ))}
      {adding ? (
        <View style={{ gap: space.m, marginTop: space.m }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
            <Icon name={SOURCE_ICONS[icon]} size={26} color={colors.accent} />
            <TextInput autoFocus value={name} onChangeText={setName} placeholder="場所の名前" placeholderTextColor={colors.sub} maxLength={40}
              accessibilityLabel="新しい場所の名前" onSubmitEditing={add} style={[s.input, { flex: 1, borderBottomColor: colors.accent }]} testID="source-new-name" />
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, paddingLeft: space.xxl }}>
            {ICON_KEYS.map((k) => (
              <Pressable key={k} accessibilityRole="button" accessibilityLabel={`アイコン ${k}`} accessibilityState={{ selected: icon === k }} onPress={() => setIcon(k)}
                style={[s.iconChoice, icon === k && { backgroundColor: colors.wash }]}>
                <Icon name={SOURCE_ICONS[k]} size={24} color={colors.ink} />
              </Pressable>
            ))}
          </View>
          <Button label="足す" small onPress={add} testID="source-add-save" />
        </View>
      ) : (
        <Pressable accessibilityRole="button" onPress={() => setAdding(true)} style={s.addRow} testID="source-add">
          <Icon name="plus" size={22} color={colors.accent} />
          <T variant="body" bold color={colors.accent}>場所を足す</T>
        </Pressable>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 72 },
  input: { fontFamily: fonts.sans, fontSize: 16, color: colors.ink, borderBottomWidth: 1, borderBottomColor: colors.line, minHeight: 48 },
  iconChoice: { width: 48, height: 48, borderRadius: radius.m, alignItems: 'center', justifyContent: 'center' },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 56, marginTop: space.m },
});
