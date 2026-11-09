import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { T } from '@/components/Text';
import { Button, Card, Chip, ConfirmDialog, Header } from '@/components/ui';
import { BodyPart, HiddenDuplicateError } from '@/db/repositories/catalog';
import { useBusy } from '@/hooks/busy';
import { useConfirmDiscard } from '@/hooks/confirmDiscard';
import { useRepos } from '@/hooks/data';
import type { RecordType } from '@/lib/sets';
import { colors, fonts } from '@/theme';

const TYPES: { key: RecordType; title: string; body: string }[] = [
  { key: 'weight_reps', title: '重量 × 回数', body: 'ベンチプレス、スクワットなど' },
  { key: 'reps_only', title: '回数だけ', body: '腕立て伏せ、懸垂など自重の種目' },
];

/** 種目の追加（名前、部位、記録のしかた） */
export default function NewExerciseScreen() {
  const params = useLocalSearchParams<{ bodyPartId?: string }>();
  const repos = useRepos();
  const [parts, setParts] = useState<BodyPart[]>([]);
  const [name, setName] = useState('');
  const [partId, setPartId] = useState<string | null>(params.bodyPartId ?? null);
  const [type, setType] = useState<RecordType>('weight_reps');
  const [error, setError] = useState<string | null>(null);
  const [hiddenDup, setHiddenDup] = useState<HiddenDuplicateError | null>(null);
  const { dialog, allowLeave } = useConfirmDiscard(name.trim() !== '', '入力した種目は追加されません。');

  useEffect(() => {
    repos.catalog.listBodyParts().then((ps) => {
      setParts(ps);
      setPartId((cur) => cur ?? ps[0]?.id ?? null);
    });
  }, [repos]);

  // 続けて押しても、同じ種目を2つ足さない
  const { busy, run } = useBusy();
  const submit = () => run(async (stayBusy) => {
    if (name.trim() === '') { setError('種目の名前を入れてください'); return; }
    if (!partId) { setError('部位を選んでください'); return; }
    try {
      await repos.catalog.createExercise({ name, bodyPartId: partId, recordType: type });
      stayBusy();
      allowLeave();
      router.back();
    } catch (e) {
      if (e instanceof HiddenDuplicateError) setHiddenDup(e);
      else setError(e instanceof Error ? e.message : String(e));
    }
  });
  // 同じ部位の非表示の種目と同じ名前なら、新しく足さずに、その種目を表示に戻す
  const showHiddenExercise = () => run(async (stayBusy) => {
    if (!hiddenDup) return;
    await repos.catalog.setExerciseHidden(hiddenDup.id, false);
    stayBusy();
    setHiddenDup(null);
    allowLeave();
    router.back();
  });

  return (
    <Screen footer={<>{error && <T size={13} color={colors.danger} align="center">{error}</T>}<Button label={busy ? '追加しています…' : '追加する'} onPress={submit} busy={busy} /></>}>
      {dialog}
      <ConfirmDialog
        visible={hiddenDup != null}
        title={hiddenDup?.message ?? ''}
        body={`「${name.trim()}」を表示に戻すと、種目の選択にまた出ます。これまでの記録はそのままです。`}
        confirmLabel="表示に戻す"
        danger={false}
        onCancel={() => setHiddenDup(null)}
        onConfirm={showHiddenExercise}
        busy={busy}
      />
      <Header title="種目を追加" onBack={() => router.back()} />
      <T size={13} color={colors.sub} style={{ marginTop: 12, marginBottom: 6 }}>種目の名前</T>
      <Input
        value={name}
        onChangeText={(t) => { setName(t); setError(null); }}
        placeholder="例：インクラインベンチプレス"
        accessibilityLabel="種目の名前"
        placeholderTextColor={colors.sub}
        autoFocus
        style={{ height: 52, borderRadius: 12, backgroundColor: colors.input, borderWidth: 1.5, borderColor: colors.accent, color: colors.text, fontFamily: fonts.regular, fontSize: 16, paddingHorizontal: 14 }}
      />
      <T size={13} color={colors.sub} style={{ marginTop: 18, marginBottom: 6 }}>部位</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {parts.map((p) => <Chip key={p.id} label={p.name} active={partId === p.id} onPress={() => setPartId(p.id)} />)}
      </View>
      <T size={13} color={colors.sub} style={{ marginTop: 18, marginBottom: 6 }}>記録のしかた</T>
      <Card style={{ padding: 0 }}>
        {TYPES.map((t, i) => (
          <Pressable
            key={t.key}
            accessibilityRole="radio"
            aria-checked={type === t.key}
            onPress={() => setType(t.key)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderTopWidth: i ? 1 : 0, borderTopColor: colors.line }}
          >
            <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: type === t.key ? colors.accent : colors.sub, alignItems: 'center', justifyContent: 'center' }}>
              {type === t.key && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent }} />}
            </View>
            <View>
              <T bold size={16}>{t.title}</T>
              <T size={12} color={colors.sub}>{t.body}</T>
            </View>
          </Pressable>
        ))}
      </Card>
    </Screen>
  );
}
