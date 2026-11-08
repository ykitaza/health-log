import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { T } from '@/components/Text';
import { Button, Card, Chip, Header } from '@/components/ui';
import { BodyPart, Exercise } from '@/db/repositories/catalog';
import { useConfirmDiscard } from '@/hooks/confirmDiscard';
import { useRepos } from '@/hooks/data';
import { colors, fonts } from '@/theme';

const TYPE_LABEL = { weight_reps: '重量 × 回数', reps_only: '回数だけ' } as const;

/** 種目の編集（名前、部位、選択に表示するか）。記録は種目の ID でつながるので、過去の記録も新しい名前で出る */
export default function EditExerciseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const repos = useRepos();
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [parts, setParts] = useState<BodyPart[]>([]);
  const [name, setName] = useState('');
  const [partId, setPartId] = useState('');
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = exercise != null && (name.trim() !== exercise.name || partId !== exercise.bodyPartId || hidden !== exercise.hidden);
  const { dialog, allowLeave } = useConfirmDiscard(dirty, '変更は保存されません。');

  useEffect(() => {
    Promise.all([repos.catalog.getExercise(id), repos.catalog.listBodyParts({ includeHidden: true })]).then(([ex, ps]) => {
      if (!ex) return;
      setExercise(ex);
      setName(ex.name);
      setPartId(ex.bodyPartId);
      setHidden(ex.hidden);
      // 非表示の部位は選べない（今の部位だけは出す）
      setParts(ps.filter((p) => !p.hidden || p.id === ex.bodyPartId));
    });
  }, [repos, id]);

  const submit = async () => {
    if (!exercise) return;
    try {
      await repos.catalog.updateExercise(exercise.id, { name, bodyPartId: partId });
      if (hidden !== exercise.hidden) await repos.catalog.setExerciseHidden(exercise.id, hidden);
      allowLeave();
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Screen footer={<>{error && <T size={13} color={colors.danger} align="center">{error}</T>}<Button label="変更を保存" onPress={submit} disabled={!exercise} /></>}>
      {dialog}
      <Header title="種目を編集" onBack={() => router.back()} />
      {exercise && (
        <>
          <T size={13} color={colors.sub} style={{ marginTop: 12, marginBottom: 6 }}>種目の名前</T>
          <TextInput
            value={name}
            onChangeText={(t) => { setName(t); setError(null); }}
            placeholder="種目の名前"
            placeholderTextColor={colors.sub}
            accessibilityLabel="種目の名前"
            style={{ height: 52, borderRadius: 12, backgroundColor: colors.input, borderWidth: 1.5, borderColor: colors.accent, color: colors.text, fontFamily: fonts.regular, fontSize: 16, paddingHorizontal: 14 }}
          />
          <T size={12} color={colors.sub} style={{ marginTop: 6 }}>名前を変えても、これまでの記録は新しい名前で残ります。</T>
          <T size={13} color={colors.sub} style={{ marginTop: 18, marginBottom: 6 }}>部位</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {parts.map((p) => <Chip key={p.id} label={p.name} active={partId === p.id} onPress={() => { setPartId(p.id); setError(null); }} />)}
          </View>
          <T size={13} color={colors.sub} style={{ marginTop: 18, marginBottom: 6 }}>記録のしかた</T>
          <Card>
            <T bold size={16}>{TYPE_LABEL[exercise.recordType]}</T>
            <T size={12} color={colors.sub}>これまでの記録と合わなくなるため、変えられません。</T>
          </Card>
          <Card style={{ marginTop: 18, padding: 0 }}>
            <Pressable
              accessibilityRole="switch"
              aria-checked={!hidden}
              accessibilityLabel="種目の選択に表示する"
              onPress={() => setHidden((h) => !h)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 }}
            >
              <View style={{ flex: 1 }}>
                <T bold size={16}>種目の選択に表示する</T>
                <T size={12} color={colors.sub}>使わなくなった種目は、消さずに非表示にできます。これまでの記録は残ります。</T>
              </View>
              <View style={{ width: 48, height: 28, borderRadius: 14, padding: 3, backgroundColor: hidden ? colors.input : colors.accent, alignItems: hidden ? 'flex-start' : 'flex-end' }}>
                <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: hidden ? colors.sub : colors.onAccent }} />
              </View>
            </Pressable>
          </Card>
        </>
      )}
    </Screen>
  );
}
