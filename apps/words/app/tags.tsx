import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { TagAdd } from '@/components/TagAdd';
import { Button, Header, Notice, Screen, SectionTitle, T, Toggle } from '@/components/ui';
import { NameTakenError } from '@/db/repositories/catalog';
import { useData, useRepos } from '@/hooks/data';
import { Tag, TAG_KIND_LABELS, TagKind } from '@/lib/types';
import { colors, fonts, space } from '@/theme';

/** タグ（使う場面と気持ち）。足す・名前を変える・隠す（消すのは隠すこと。付いている表現からは外れない） */
export default function TagsScreen() {
  const repos = useRepos();
  const { data } = useData((r) => r.catalog.tags());
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tags = data ?? [];

  const rename = async () => {
    if (!editing) return;
    const e = editing;
    setEditing(null);
    if (!e.name.trim()) return;
    try {
      await repos.catalog.updateTag(e.id, { name: e.name });
      setError(null);
    } catch (err) {
      setError(err instanceof NameTakenError ? '同じ名前のタグがあります' : '直せませんでした');
    }
  };

  const section = (kind: TagKind) => (
    <View key={kind}>
      <SectionTitle title={TAG_KIND_LABELS[kind]} />
      {tags.filter((t) => t.kind === kind).map((t: Tag) => (
        <View key={t.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 56 }}>
          <View style={{ flex: 1 }}>
            {editing?.id === t.id ? (
              <TextInput autoFocus value={editing.name} onChangeText={(name) => setEditing({ id: t.id, name })} onSubmitEditing={rename} onBlur={rename}
                maxLength={20} accessibilityLabel="タグの名前" style={{ fontFamily: fonts.sans, fontSize: 16, color: colors.ink, borderBottomWidth: 1, borderBottomColor: colors.accent, minHeight: 44 }} />
            ) : (
              <Pressable accessibilityRole="button" accessibilityLabel={`${t.name}の名前を変える`} onPress={() => setEditing({ id: t.id, name: t.name })} style={{ minHeight: 48, justifyContent: 'center' }}>
                <T variant="body" color={t.hidden ? colors.sub : colors.ink}>{t.name}{t.created_by === 'claude' ? '（Claude が足した）' : ''}</T>
              </Pressable>
            )}
          </View>
          <Toggle value={!t.hidden} onChange={(v) => { void repos.catalog.updateTag(t.id, { hidden: !v }); }} label={`${t.name}を選択肢に出す`} />
        </View>
      ))}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: space.s }}>
        <TagAdd kind={kind} tags={tags} onAdded={() => {}} />
      </View>
    </View>
  );

  return (
    <Screen testID="tags-screen" footer={error ? <Notice message={error} /> : undefined}>
      <Header title="タグ" onBack={() => router.back()} right={<Button label="完了" variant="text" small onPress={() => router.back()} />} />
      <T variant="bodyS" color={colors.sub}>探すときの手がかりです。隠しても、付いている言葉からは外れません</T>
      {section('situation')}
      {section('feeling')}
    </Screen>
  );
}
