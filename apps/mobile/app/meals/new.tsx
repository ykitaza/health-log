import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { T } from '@/components/Text';
import { Button, Card, Chip, Header, IconButton, Segmented } from '@/components/ui';
import { useConfirmDiscard } from '@/hooks/confirmDiscard';
import { useRepos } from '@/hooks/data';
import { formatJpDate, todayKey } from '@/lib/date';
import {
  ItemDraft, ItemInput, MAX_ITEMS, parseItem, SLOT_LABELS, SLOTS, Slot, sum, TEMPLATE_NAME_MAX, templateNameError, Unit, UNITS,
} from '@/lib/meals';
import { fmt1, fmtInt } from '@/lib/units';
import { colors, fonts, radius } from '@/theme';

const emptyItem = (numbers: boolean): ItemDraft =>
  ({ name: numbers ? 'kcal と PFC' : '', amount: numbers ? '1' : '', unit: numbers ? '個' : 'g', kcal: '', protein_g: '', fat_g: '', carbs_g: '' });

/** 品目を手で入れて記録する。mode=numbers は「kcal と PFC だけ」（品目1つ、量は 1個） */
export default function NewMealScreen() {
  const params = useLocalSearchParams<{ date?: string; slot?: Slot; mode?: 'items' | 'numbers' }>();
  const numbers = params.mode === 'numbers';
  const date = params.date ?? todayKey();
  const repos = useRepos();
  const [slot, setSlot] = useState<Slot>(params.slot && SLOTS.includes(params.slot) ? params.slot : 'breakfast');
  const [items, setItems] = useState<ItemDraft[]>([emptyItem(numbers)]);
  const [asTemplate, setAsTemplate] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = items.some((i) => i.kcal !== '' || i.protein_g !== '' || (!numbers && (i.name !== '' || i.amount !== '')));
  const { dialog, allowLeave } = useConfirmDiscard(dirty, '入力した食事は記録されません。');

  const set = (n: number, patch: Partial<ItemDraft>) => setItems((xs) => xs.map((x, i) => (i === n ? { ...x, ...patch } : x)));
  const parsed = items.map(parseItem);
  const valid = parsed.flatMap((p) => ('value' in p ? [p.value] : []));
  const total = sum(valid);

  const submit = async () => {
    const values: ItemInput[] = [];
    for (const [n, p] of parsed.entries()) {
      if ('error' in p) { setError(items.length > 1 ? `品目${n + 1}：${p.error}` : p.error); return; }
      values.push(p.value);
    }
    const name = templateName.trim() || values.map((v) => v.name).join('、').slice(0, TEMPLATE_NAME_MAX);
    if (asTemplate) {
      const e = templateNameError(name);
      if (e) { setError(e); return; }
    }
    setError(null);
    setSaving(true);
    try {
      const id = await repos.meals.record({ date, slot, source: numbers ? 'numbers' : 'text', items: values });
      if (asTemplate) await repos.meals.saveTemplateFromMeal(id, name);
      allowLeave();
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen footer={<>{error && <T size={13} color={colors.danger} align="center">{error}</T>}<Button label="記録する" onPress={submit} disabled={saving} /></>}>
      <Header title={numbers ? 'kcal と PFC だけ' : '品目を入力'} subtitle={formatJpDate(date)} onBack={() => router.back()} />
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {SLOTS.map((x) => <Chip key={x} label={SLOT_LABELS[x]} active={x === slot} onPress={() => setSlot(x)} />)}
      </View>

      {items.map((item, n) => (
        <Card key={n} style={{ marginTop: 12, gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
            <Field label={numbers ? '名前（例：ラーメン屋の定食）' : '品名'} style={{ flex: 1 }}>
              <Input value={item.name} onChangeText={(t) => set(n, { name: t })} placeholder={numbers ? '' : '例：白米'} placeholderTextColor={colors.sub}
                accessibilityLabel={`品目${n + 1}の品名`} style={s.text} maxLength={200} />
            </Field>
            {items.length > 1 && (
              <IconButton name="trash" label={`品目${n + 1}を外す`} size={44} bg={colors.input} color={colors.sub} onPress={() => setItems((xs) => xs.filter((_, i) => i !== n))} />
            )}
          </View>
          {!numbers && (
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-end' }}>
              <Field label="量" style={{ flex: 1 }}>
                <Input value={item.amount} onChangeText={(t) => set(n, { amount: t })} keyboardType="decimal-pad" accessibilityLabel={`品目${n + 1}の量`} style={s.num} />
              </Field>
              <View style={{ flex: 2 }}>
                <Segmented options={UNITS.map((u) => ({ key: u, label: u }))} value={item.unit} onChange={(u: Unit) => set(n, { unit: u })} />
              </View>
            </View>
          )}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <NumField label="エネルギー" unit="kcal" value={item.kcal} onChange={(t) => set(n, { kcal: t })} a11y={`品目${n + 1}のエネルギー`} />
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <NumField label="P たんぱく質" unit="g" value={item.protein_g} onChange={(t) => set(n, { protein_g: t })} a11y={`品目${n + 1}のたんぱく質`} />
            <NumField label="F 脂質" unit="g" value={item.fat_g} onChange={(t) => set(n, { fat_g: t })} a11y={`品目${n + 1}の脂質`} />
            <NumField label="C 炭水化物" unit="g" value={item.carbs_g} onChange={(t) => set(n, { carbs_g: t })} a11y={`品目${n + 1}の炭水化物`} />
          </View>
        </Card>
      ))}

      {!numbers && items.length < MAX_ITEMS && (
        <Pressable accessibilityRole="button" onPress={() => setItems((xs) => [...xs, emptyItem(false)])} style={s.addItem}>
          <Icon name="plus" size={18} color={colors.accent} />
          <T bold size={15} color={colors.accent}>品目を追加</T>
        </Pressable>
      )}

      <Card style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <T bold size={15}>合計</T>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }} testID="new-meal-total">
          <T size={12} color={colors.sub}>P {fmt1(total.protein_g)}・F {fmt1(total.fat_g)}・C {fmt1(total.carbs_g)}</T>
          <T num bold size={24}>{fmtInt(total.kcal)}</T>
          <T size={11} color={colors.sub}>kcal</T>
        </View>
      </Card>

      <Card style={{ marginTop: 12, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <T bold size={15}>いつもの として保存</T>
            <T size={12} color={colors.sub}>次からは、この組み合わせを1回で記録できます。同じ名前のいつものは上書きします</T>
          </View>
          <Switch value={asTemplate} onValueChange={setAsTemplate} accessibilityLabel="いつものとして保存"
            trackColor={{ true: colors.accent, false: colors.input }} thumbColor={colors.text} />
        </View>
        {asTemplate && (
          <Input value={templateName} onChangeText={setTemplateName} placeholder={valid.map((v) => v.name).join('、') || 'いつものの名前'}
            placeholderTextColor={colors.sub} accessibilityLabel="いつものの名前" maxLength={TEMPLATE_NAME_MAX} style={[s.text, s.box]} />
        )}
      </Card>
      {dialog}
    </Screen>
  );
}

function Field({ label, children, style }: { label: string; children: React.ReactNode; style?: object }) {
  return (
    <View style={[{ gap: 4 }, style]}>
      <T size={12} color={colors.sub}>{label}</T>
      {children}
    </View>
  );
}

function NumField({ label, unit, value, onChange, a11y }: { label: string; unit: string; value: string; onChange: (t: string) => void; a11y: string }) {
  return (
    <Field label={label} style={{ flex: 1 }}>
      <View style={[s.box, { flexDirection: 'row', alignItems: 'center', paddingRight: 8 }]}>
        <Input value={value} onChangeText={onChange} keyboardType="decimal-pad" accessibilityLabel={a11y} placeholder="0" placeholderTextColor={colors.sub}
          style={[s.num, { flex: 1, minWidth: 0, backgroundColor: 'transparent' }]} />
        <T size={11} color={colors.sub}>{unit}</T>
      </View>
    </Field>
  );
}

const s = StyleSheet.create({
  box: { backgroundColor: colors.input, borderRadius: radius.input },
  text: { height: 44, paddingHorizontal: 12, backgroundColor: colors.input, borderRadius: radius.input, color: colors.text, fontFamily: fonts.regular, fontSize: 15 },
  num: { height: 44, paddingHorizontal: 12, backgroundColor: colors.input, borderRadius: radius.input, color: colors.text, fontFamily: fonts.numBold, fontSize: 20 },
  addItem: {
    marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 52,
    borderWidth: 1, borderStyle: 'dashed', borderColor: colors.line, borderRadius: radius.card,
  },
});
