import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { T } from '@/components/Text';
import { Badge, Button, Card, Chip, ConfirmDialog, Header, IconButton, Segmented } from '@/components/ui';
import { useBusy } from '@/hooks/busy';
import { useConfirmDiscard } from '@/hooks/confirmDiscard';
import { useRepos } from '@/hooks/data';
import { addDays, formatJpDate, todayKey } from '@/lib/date';
import {
  AMOUNT_MAX, changeAmount, ItemDraft, itemRangeError, MAX_ITEMS, Meal, MealItem, mealTitle, mealTotal, parseItem, SLOT_LABELS, SLOTS, Slot,
  TEMPLATE_NAME_MAX, templateNameError, Unit, UNITS,
} from '@/lib/meals';
import { fmt1, fmtInt, parseNumber, trimNumber } from '@/lib/units';
import { colors, fonts, radius } from '@/theme';

/** 画面で直している品目。saved は保存してある品目（量を変えるときは、ここから同じ割合で計算する）。足した品目は saved がない */
type Row = { key: string; saved: MealItem | null; item: MealItem; amountText: string };

const toRow = (i: MealItem): Row => ({ key: i.id, saved: i, item: i, amountText: trimNumber(i.amount) });
const step = (unit: Unit) => (unit === 'g' || unit === 'ml' ? 10 : 1);
const emptyDraft = (): ItemDraft => ({ name: '', amount: '', unit: 'g', kcal: '', protein_g: '', fat_g: '', carbs_g: '' });

/** 食事の詳細と編集（量の変更、品目の追加・削除、日付と区分の変更、削除、いつものとして保存） */
export default function MealDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const repos = useRepos();
  const [meal, setMeal] = useState<Meal | null | undefined>(undefined);
  const [rows, setRows] = useState<Row[]>([]);
  const [date, setDate] = useState('');
  const [slot, setSlot] = useState<Slot>('breakfast');
  const [draft, setDraft] = useState<ItemDraft | null>(null);
  const [templateName, setTemplateName] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    repos.meals.getMeal(id).then((m) => {
      setMeal(m);
      if (!m) return;
      setRows(m.items.map(toRow));
      setDate(m.date);
      setSlot(m.slot);
    });
  }, [repos, id]);

  const dirty = !!meal && (date !== meal.date || slot !== meal.slot || rows.length !== meal.items.length
    || rows.some((r, i) => r.saved?.id !== meal.items[i].id || r.amountText !== trimNumber(meal.items[i].amount)));
  const { dialog, allowLeave } = useConfirmDiscard(dirty, '直した内容は保存されません。');
  // 保存・消す・いつものに保存は1つずつ。続けて押しても2回書かず、2つ前の画面まで戻らない
  const { busy, run } = useBusy();

  if (meal === undefined) return <Screen><Header title="" onBack={() => router.back()} /></Screen>;
  if (meal === null) {
    return <Screen><Header title="食事が見つかりません" onBack={() => router.back()} /><T color={colors.sub}>消されたか、まだ届いていない食事です。</T></Screen>;
  }

  const total = mealTotal({ items: rows.map((r) => r.item) });
  const setAmount = (key: string, text: string) => setRows((rs) => rs.map((r) => {
    if (r.key !== key) return r;
    const n = parseNumber(text);
    const base = r.saved ?? r.item;
    return { ...r, amountText: text, item: n != null && n > 0 ? changeAmount(base, n) : r.item };
  }));
  const bump = (r: Row, dir: 1 | -1) => {
    const now = parseNumber(r.amountText) ?? r.item.amount;
    const next = Math.round((now + dir * step(r.item.unit)) * 100) / 100;
    if (next > 0 && next <= AMOUNT_MAX) setAmount(r.key, trimNumber(next));
  };
  const removeRow = (key: string) => {
    if (rows.length === 1) { setError('最後の品目は消せません。食事ごと消してください'); return; }
    setError(null);
    setRows((rs) => rs.filter((r) => r.key !== key));
  };
  const addDraft = () => {
    if (!draft) return;
    const p = parseItem(draft);
    if ('error' in p) { setError(p.error); return; }
    if (rows.length >= MAX_ITEMS) { setError(`品目は1回の食事に${MAX_ITEMS}件までです`); return; }
    setError(null);
    const item: MealItem = { ...p.value, id: '', confidence: 'high' };
    setRows((rs) => [...rs, { key: `new-${Date.now()}-${rs.length}`, saved: null, item, amountText: trimNumber(item.amount) }]);
    setDraft(null);
  };

  const save = () => run(async (stayBusy) => {
    for (const r of rows) {
      const n = parseNumber(r.amountText);
      if (n == null || n <= 0 || n > AMOUNT_MAX) { setError(`${r.item.name}：量は 0 より大きく ${AMOUNT_MAX.toLocaleString('en-US')} までで入れてください`); return; }
      const e = itemRangeError(r.item);
      if (e) { setError(e); return; }
    }
    setError(null);
    try {
      await repos.meals.update(meal.id, { date, slot, items: rows.map((r) => (r.saved ? r.item : { ...r.item, id: undefined })) });
      stayBusy();
      allowLeave();
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  });
  const remove = () => run(async (stayBusy) => {
    setConfirmDelete(false);
    await repos.meals.remove(meal.id);
    stayBusy();
    allowLeave();
    router.back();
  });
  const saveTemplate = () => run(async () => {
    const name = (templateName ?? '').trim();
    const e = templateNameError(name);
    if (e) { setError(e); return; }
    setError(null);
    await repos.meals.saveTemplateFromMeal(meal.id, name);
    setTemplateName(null);
    setNotice(`いつもの「${name}」として保存しました`);
  });

  const today = todayKey();
  return (
    <Screen footer={<>{error && <T size={13} color={colors.danger} align="center">{error}</T>}<Button label="この食事を消す" variant="danger" onPress={() => setConfirmDelete(true)} disabled={busy} /></>}>
      <Header title={mealTitle(meal)} onBack={() => router.back()}
        right={<Pressable accessibilityRole="button" onPress={save} disabled={busy} aria-busy={busy} hitSlop={{ top: 14, bottom: 14, left: 8, right: 8 }} style={busy && { opacity: 0.45 }}><T bold size={16} color={colors.accent}>保存</T></Pressable>} />
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {SLOTS.map((x) => <Chip key={x} label={SLOT_LABELS[x]} active={x === slot} onPress={() => setSlot(x)} />)}
      </View>
      <Card style={{ marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4, paddingHorizontal: 4 }}>
        <IconButton name="prev" label="前の日に移す" bg="transparent" onPress={() => setDate(addDays(date, -1))} />
        <T bold size={15}>{formatJpDate(date)}{meal.time ? `　${meal.time}` : ''}</T>
        <IconButton name="next" label="次の日に移す" bg="transparent" disabled={date >= today} color={date >= today ? colors.line : colors.text} onPress={() => date < today && setDate(addDays(date, 1))} />
      </Card>

      <Card style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }} testID="meal-detail-kcal">
          <T num bold size={40}>{fmtInt(total.kcal)}</T>
          <T size={13} color={colors.sub}>kcal</T>
        </View>
        <T size={13} color={colors.sub}>P {fmt1(total.protein_g)}g・F {fmt1(total.fat_g)}g・C {fmt1(total.carbs_g)}g</T>
      </Card>
      {meal.basis && (
        <Card style={{ marginTop: 10, gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name="info" size={20} color={colors.sub} />
            <T bold size={14} accessibilityRole="header">推定の根拠</T>
          </View>
          {/* AI が書いた文なので、文字として出すだけ */}
          <T size={14} selectable style={{ lineHeight: 21 }}>{meal.basis}</T>
          <T size={12} color={colors.sub}>Claude・ChatGPT が kcal と PFC を推定したときのメモです。</T>
        </Card>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 }}>
        <Icon name="pencil" size={14} color={colors.sub} />
        <T size={12} color={colors.sub}>量を変えると、kcal と PFC も同じ割合で変わります。</T>
      </View>

      <Card style={{ marginTop: 10, padding: 0 }}>
        {rows.map((r, i) => (
          <View key={r.key} style={[s.item, i > 0 && s.line]}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <T bold size={15} style={{ flexShrink: 1 }}>{r.item.name}</T>
                  {r.item.confidence === 'low' && <Badge label="推定・低" color={colors.star} bg={colors.input} />}
                </View>
                <T size={12} color={colors.sub}>P {fmt1(r.item.protein_g)}・F {fmt1(r.item.fat_g)}・C {fmt1(r.item.carbs_g)}</T>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
                <T num bold size={20}>{fmtInt(r.item.kcal)}</T>
                <T size={11} color={colors.sub}>kcal</T>
              </View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
              <View style={s.stepper}>
                <IconButton name="down" label={`${r.item.name}の量を減らす`} bg="transparent" onPress={() => bump(r, -1)} />
                <Input value={r.amountText} onChangeText={(t) => setAmount(r.key, t)} keyboardType="decimal-pad" accessibilityLabel={`${r.item.name}の量`}
                  style={s.amount} />
                <T size={12} color={colors.sub}>{r.item.unit}</T>
                <IconButton name="up" label={`${r.item.name}の量を増やす`} bg="transparent" onPress={() => bump(r, 1)} />
              </View>
              <IconButton name="trash" label={`${r.item.name}を外す`} bg={colors.input} color={colors.sub} onPress={() => removeRow(r.key)} />
            </View>
          </View>
        ))}
      </Card>

      {draft ? (
        <Card style={{ marginTop: 12, gap: 8 }}>
          <Input value={draft.name} onChangeText={(t) => setDraft({ ...draft, name: t })} placeholder="品名" placeholderTextColor={colors.sub}
            accessibilityLabel="足す品目の品名" maxLength={200} style={s.text} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Input value={draft.amount} onChangeText={(t) => setDraft({ ...draft, amount: t })} placeholder="量" placeholderTextColor={colors.sub}
              keyboardType="decimal-pad" accessibilityLabel="足す品目の量" style={[s.text, { flex: 1 }]} />
            <View style={{ flex: 2 }}>
              <Segmented options={UNITS.map((u) => ({ key: u, label: u }))} value={draft.unit} onChange={(u: Unit) => setDraft({ ...draft, unit: u })} />
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {([['kcal', 'kcal'], ['protein_g', 'P'], ['fat_g', 'F'], ['carbs_g', 'C']] as const).map(([k, label]) => (
              <Input key={k} value={draft[k]} onChangeText={(t) => setDraft({ ...draft, [k]: t })} placeholder={label} placeholderTextColor={colors.sub}
                keyboardType="decimal-pad" accessibilityLabel={`足す品目の${{ kcal: 'エネルギー', protein_g: 'たんぱく質', fat_g: '脂質', carbs_g: '炭水化物' }[k]}`}
                style={[s.text, { flex: 1, minWidth: 0 }]} />
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button label="キャンセル" variant="secondary" small onPress={() => setDraft(null)} style={{ flex: 1 }} />
            <Button label="品目を足す" small onPress={addDraft} style={{ flex: 1 }} />
          </View>
        </Card>
      ) : (
        <Pressable accessibilityRole="button" onPress={() => setDraft(emptyDraft())} style={s.addItem}>
          <Icon name="plus" size={18} color={colors.accent} />
          <T bold size={15} color={colors.accent}>品目を追加</T>
        </Pressable>
      )}

      <Card style={{ marginTop: 12, gap: 8 }}>
        {templateName == null ? (
          <Pressable accessibilityRole="button" onPress={() => { setNotice(null); setTemplateName(mealTitle(meal).slice(0, TEMPLATE_NAME_MAX)); }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Icon name="star" size={18} color={colors.accent} />
            <View style={{ flex: 1 }}>
              <T bold size={15}>いつものとして保存</T>
              <T size={12} color={colors.sub}>保存してある内容で保存します。同じ名前のいつものは上書きします</T>
            </View>
          </Pressable>
        ) : (
          <>
            <Input value={templateName} onChangeText={setTemplateName} accessibilityLabel="いつものの名前" maxLength={TEMPLATE_NAME_MAX} style={s.text} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button label="キャンセル" variant="secondary" small onPress={() => setTemplateName(null)} style={{ flex: 1 }} />
              <Button label={busy ? '保存しています…' : 'いつものに保存'} small onPress={saveTemplate} busy={busy} style={{ flex: 1 }} />
            </View>
          </>
        )}
        {notice && <T size={12} color={colors.accent}>{notice}</T>}
      </Card>

      <ConfirmDialog visible={confirmDelete} title="この食事を消しますか？" body={`${formatJpDate(meal.date)}の${SLOT_LABELS[meal.slot]}「${mealTitle(meal)}」を消します。`}
        confirmLabel="消す" onCancel={() => setConfirmDelete(false)} onConfirm={remove} busy={busy} />
      {dialog}
    </Screen>
  );
}

const s = StyleSheet.create({
  item: { padding: 16 },
  line: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  stepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.input, borderRadius: 12, paddingHorizontal: 2 },
  amount: { width: 72, height: 40, textAlign: 'center', color: colors.text, fontFamily: fonts.numBold, fontSize: 20 },
  text: { height: 44, paddingHorizontal: 12, backgroundColor: colors.input, borderRadius: radius.input, color: colors.text, fontFamily: fonts.regular, fontSize: 15 },
  addItem: {
    marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 52,
    borderWidth: 1, borderStyle: 'dashed', borderColor: colors.line, borderRadius: radius.card,
  },
});
