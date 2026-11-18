import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button, Chip, ConfirmDialog, Field, Header, Notice, Screen, T } from '@/components/ui';
import { useData, useRepos } from '@/hooks/data';
import { isDateKey } from '@/lib/date';
import type { Encounter } from '@/lib/types';
import { colors, space } from '@/theme';

type Form = Pick<Encounter, 'source_id' | 'title' | 'locator' | 'time_hint' | 'scene' | 'wording' | 'surrounding_text' | 'note'> & { met_on: string };

/**
 * 出会った場所を編集：どこで（場所）・題・位置・いつ・その時の場面・言い回し・前後の文・メモ。
 * 出会いが2つ以上あれば、この出会いを消せる（表現は残る）
 */
export default function EncounterScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const repos = useRepos();
  const { data } = useData(async (r) => {
    const x = await r.words.encounter(id);
    return { x, sources: await r.catalog.sources(), siblings: x ? (await r.words.encounters(x.expression_id)).length : 0 };
  }, [id]);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    if (data?.x && !form) {
      const x = data.x;
      setForm({ source_id: x.source_id, title: x.title, locator: x.locator, met_on: x.met_on ?? '', time_hint: x.time_hint, scene: x.scene,
        wording: x.wording, surrounding_text: x.surrounding_text, note: x.note });
    }
  }, [data, form]);

  if (!data || !form) return <Screen><Header title="出会った場所" onBack={() => router.back()} /></Screen>;
  const set = (k: keyof Form) => (v: string) => setForm({ ...form, [k]: v });

  const save = async () => {
    if (form.met_on && !isDateKey(form.met_on)) { setError('日付は 2026-11-18 の形で入れてください'); return; }
    await repos.words.updateEncounter(id, { ...form, met_on: form.met_on || null });
    router.back();
  };
  const remove = async () => {
    setConfirm(false);
    await repos.words.removeEncounter(id);
    router.back();
  };

  // 隠した場所でも、いま選んでいるものは出す
  const choices = data.sources.filter((s) => !s.hidden || s.id === form.source_id);
  return (
    <Screen testID="encounter-screen" footer={(
      <View style={{ gap: space.s }}>
        <Notice message={error} />
        <Button label="保存" onPress={save} testID="encounter-save" />
      </View>
    )}>
      <Header title="出会った場所" onBack={() => router.back()} />
      <T variant="label" color={colors.sub}>どこで</T>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.s, paddingVertical: space.s }}>
        {choices.map((s) => (
          <Chip key={s.id} label={s.name} variant={form.source_id === s.id ? 'selected' : 'default'}
            onPress={() => setForm({ ...form, source_id: form.source_id === s.id ? null : s.id })} testID={`enc-source-${s.name}`} />
        ))}
      </ScrollView>
      <Field label="本・作品・人" value={form.title} onChangeText={set('title')} maxLength={200} testID="enc-title" />
      <Field label="位置（3章・p.142・No.2310・1:02:30）" value={form.locator} onChangeText={set('locator')} maxLength={100} testID="enc-locator" />
      <Field label="出会った日（2026-11-18）" value={form.met_on} onChangeText={set('met_on')} maxLength={10} testID="enc-met-on" />
      <Field label="いつごろ（先週・通勤中）" value={form.time_hint} onChangeText={set('time_hint')} maxLength={50} />
      <Field label="その時の場面" value={form.scene} onChangeText={set('scene')} maxLength={300} multiline testID="enc-scene" />
      <Field label="その時の言い回し（表現と違うとき）" value={form.wording} onChangeText={set('wording')} maxLength={200} mincho />
      <Field label="前後の文" value={form.surrounding_text} onChangeText={set('surrounding_text')} maxLength={1000} multiline mincho testID="enc-surrounding" />
      <Field label="メモ" value={form.note} onChangeText={set('note')} maxLength={500} multiline />
      {data.siblings > 1 && <Button label="この出会いを消す" variant="text" onPress={() => setConfirm(true)} style={{ marginTop: space.l }} testID="encounter-delete" />}
      <ConfirmDialog visible={confirm} title="この出会いを消しますか？" message="表現とほかの出会いは残ります。" confirmLabel="消す" onConfirm={remove} onCancel={() => setConfirm(false)} />
    </Screen>
  );
}
