import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { T } from '@/components/Text';
import { Button, Card, ConfirmDialog, Header, ListRow } from '@/components/ui';
import { HiddenDuplicateError } from '@/db/repositories/catalog';
import { useConfirmDiscard } from '@/hooks/confirmDiscard';
import { useFocusData } from '@/hooks/data';
import { colors, fonts } from '@/theme';

const TYPE_LABEL = { weight_reps: '重量×回数', reps_only: '回数だけ' } as const;

/** 種目と部位の管理。使わなくなったものは消さずに非表示にする */
export default function ManageScreen() {
  const { data, reload, repos } = useFocusData(async (r) => {
    const [parts, exercises] = await Promise.all([r.catalog.listBodyParts({ includeHidden: true }), r.catalog.listExercises({ includeHidden: true })]);
    return { parts, exercises };
  });
  const [adding, setAdding] = useState(false);
  const [partName, setPartName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [hiddenDup, setHiddenDup] = useState<HiddenDuplicateError | null>(null);
  const { dialog } = useConfirmDiscard(adding && partName.trim() !== '', '入力した部位は追加されません。');

  const toggleExercise = async (id: string, hidden: boolean) => { await repos.catalog.setExerciseHidden(id, !hidden); reload(); };
  const togglePart = async (id: string, hidden: boolean) => { await repos.catalog.setBodyPartHidden(id, !hidden); reload(); };
  const addPart = async () => {
    try {
      await repos.catalog.createBodyPart(partName);
      setPartName(''); setAdding(false); setError(null);
      reload();
    } catch (e) {
      if (e instanceof HiddenDuplicateError) setHiddenDup(e);
      else setError(e instanceof Error ? e.message : String(e));
    }
  };
  // 非表示の部位と同じ名前なら、新しく足さずに、その部位を表示に戻す
  const showHiddenPart = async () => {
    if (!hiddenDup) return;
    await repos.catalog.setBodyPartHidden(hiddenDup.id, false);
    setHiddenDup(null); setPartName(''); setAdding(false); setError(null);
    reload();
  };

  return (
    <Screen>
      {dialog}
      <ConfirmDialog
        visible={hiddenDup != null}
        title={hiddenDup?.message ?? ''}
        body={`「${partName.trim()}」を表示に戻すと、種目の選択にまた出ます。`}
        confirmLabel="表示に戻す"
        danger={false}
        onCancel={() => setHiddenDup(null)}
        onConfirm={showHiddenPart}
      />
      <Header
        title="種目と部位の管理"
        onBack={() => router.back()}
        right={
          <Pressable accessibilityRole="button" onPress={() => router.push('/exercises/new')} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Icon name="plus" size={18} color={colors.accent} />
            <T bold size={14} color={colors.accent}>種目を追加</T>
          </Pressable>
        }
      />
      <View style={{ flexDirection: 'row', gap: 8, marginVertical: 10 }}>
        <Icon name="eyeOff" size={18} color={colors.sub} />
        <T size={12} color={colors.sub} style={{ flex: 1 }}>使わなくなった種目は消さずに「非表示」にできます。これまでの記録は残ります。行を押すと切り替わります。</T>
      </View>
      {data?.parts.map((p) => {
        const items = data.exercises.filter((e) => e.bodyPartId === p.id);
        const hiddenCount = items.filter((e) => e.hidden).length;
        return (
          <View key={p.id} style={{ marginTop: 14 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <T bold size={14} color={p.hidden ? colors.sub : colors.text}>{p.name}{p.hidden ? '（非表示）' : ''}</T>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <T size={12} color={colors.sub}>{items.length}種目{hiddenCount ? `・非表示 ${hiddenCount}` : ''}</T>
                <Pressable accessibilityRole="button" onPress={() => togglePart(p.id, p.hidden)} hitSlop={8}>
                  <T size={12} bold color={colors.accent}>{p.hidden ? '部位を表示' : '部位を非表示'}</T>
                </Pressable>
              </View>
            </View>
            <Card style={{ padding: 0, opacity: p.hidden ? 0.5 : 1 }}>
              {items.length === 0 && <View style={{ padding: 16 }}><T size={13} color={colors.sub}>種目がありません</T></View>}
              {items.map((e, i) => (
                <ListRow
                  key={e.id}
                  first={i === 0}
                  title={e.name}
                  subtitle={TYPE_LABEL[e.recordType]}
                  dim={e.hidden}
                  chevron={false}
                  onPress={() => toggleExercise(e.id, e.hidden)}
                  right={
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.input, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
                      {e.hidden && <Icon name="eyeOff" size={13} color={colors.sub} />}
                      <T size={12} color={colors.sub}>{e.hidden ? '非表示' : '表示中'}</T>
                    </View>
                  }
                />
              ))}
            </Card>
          </View>
        );
      })}
      <View style={{ marginTop: 20 }}>
        {adding ? (
          <Card style={{ gap: 10 }}>
            <TextInput
              value={partName}
              onChangeText={(t) => { setPartName(t); setError(null); }}
              placeholder="部位の名前（例：前腕）"
              placeholderTextColor={colors.sub}
              autoFocus
              style={{ height: 48, borderRadius: 10, backgroundColor: colors.input, color: colors.text, fontFamily: fonts.regular, fontSize: 15, paddingHorizontal: 12 }}
            />
            {error && <T size={12} color={colors.danger}>{error}</T>}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Button label="キャンセル" variant="secondary" small style={{ flex: 1 }} onPress={() => { setAdding(false); setPartName(''); setError(null); }} />
              <Button label="追加する" small style={{ flex: 1 }} onPress={addPart} />
            </View>
          </Card>
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={() => setAdding(true)}
            style={{ height: 52, borderRadius: 14, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.line, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          >
            <Icon name="plus" size={18} color={colors.accent} />
            <T bold color={colors.accent}>部位を追加</T>
          </Pressable>
        )}
      </View>
    </Screen>
  );
}
