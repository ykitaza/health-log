import { router } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/Icon';
import { NutritionSummary } from '@/components/meals';
import { Screen } from '@/components/Screen';
import { T } from '@/components/Text';
import { Card, IconButton } from '@/components/ui';
import { useAuth } from '@/hooks/auth';
import { useFocusData, useRepos } from '@/hooks/data';
import { useToday } from '@/hooks/today';
import { addDays, formatJpDate, todayKey } from '@/lib/date';
import { DAY_TYPE_LABELS, Meal, mealTitle, mealTotal, SLOT_LABELS, SLOTS, Slot } from '@/lib/meals';
import { fmt1, fmtInt } from '@/lib/units';
import { colors, radius } from '@/theme';

/** 食事（その日の区分ごとの食事、合計と目標の残り）。日付は過去にも戻れる。今日が初め */
export default function MealsScreen() {
  const [date, setDate] = useState(todayKey);
  // 日をまたいだら、今日を見ていたなら新しい今日へ移す（前の日に記録を足さないように）
  const today = useToday((next, prev) => setDate((d) => (d === prev ? next : d)));
  const [adding, setAdding] = useState<Slot | null>(null);
  const { status } = useAuth();
  const { data, reload, repos } = useFocusData(async (r) => {
    const [{ days, goal }, templates, yesterday] = await Promise.all([
      r.meals.summaries(date, date), r.meals.listTemplates(), r.meals.listDay(addDays(date, -1)),
    ]);
    return { date, day: days[0], goal, templates, yesterday };
  }, date);
  const day = data?.date === date ? data.day : null;

  // 日の種類のバッジを押すと、その日を筋トレの日／休みの日に決める（MCP の set_day_type と同じ）
  const toggleDayType = async () => {
    if (!day) return;
    await repos.meals.setDayType(date, day.dayType === 'training' ? 'rest' : 'training');
    reload();
  };

  return (
    <Screen tab>
      <View style={{ paddingVertical: 12 }}><T bold size={26} accessibilityRole="header">食事</T></View>
      <Card style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4, paddingHorizontal: 4 }}>
        <IconButton name="prev" label="前の日" bg="transparent" onPress={() => setDate(addDays(date, -1))} />
        <T bold size={16}>{formatJpDate(date)}</T>
        <IconButton name="next" label="次の日" bg="transparent" color={date >= today ? colors.line : colors.text} onPress={() => date < today && setDate(addDays(date, 1))} />
      </Card>

      {day && (
        <Card style={{ marginTop: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <T bold size={15}>{date === today ? '今日の合計' : 'この日の合計'}</T>
            <Pressable accessibilityRole="button" accessibilityLabel={`日の種類：${DAY_TYPE_LABELS[day.dayType]}（押すと切り替え）`} onPress={toggleDayType} hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
              style={[s.badge, day.dayType === 'training' ? { backgroundColor: colors.accentDark } : { backgroundColor: colors.input }]}>
              <T size={12} bold color={day.dayType === 'training' ? colors.accent : colors.sub}>{DAY_TYPE_LABELS[day.dayType]}</T>
            </Pressable>
          </View>
          <NutritionSummary total={day.total} target={day.target} remaining={day.remaining} />
          {!data?.goal && (
            <Pressable accessibilityRole="button" accessibilityLabel="目標が未設定です。目標を決める" onPress={() => router.push('/meals/goal')} hitSlop={{ top: 15, bottom: 15 }} style={{ marginTop: 10 }}>
              <T size={12} color={colors.sub}>目標が未設定です。<T size={12} bold color={colors.accent}>目標を決める</T>（Claude・ChatGPT でも決められます）</T>
            </Pressable>
          )}
        </Card>
      )}

      {SLOTS.map((slot) => {
        const meals = day?.meals.filter((m) => m.slot === slot) ?? [];
        const kcal = meals.reduce((n, m) => n + mealTotal(m).kcal, 0);
        return (
          <View key={slot}>
            <View style={s.slotHead}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                <T bold size={16}>{SLOT_LABELS[slot]}</T>
                <T size={13} color={colors.sub}>{fmtInt(kcal)}kcal</T>
              </View>
              <IconButton name="plus" label={`${SLOT_LABELS[slot]}を記録`} size={36} bg={colors.card} color={colors.accent} onPress={() => setAdding(slot)} />
            </View>
            {meals.length === 0 ? (
              <View style={s.empty}><T size={13} color={colors.sub}>{SLOT_LABELS[slot]}はまだ記録していません</T></View>
            ) : (
              <View style={{ gap: 8 }}>{meals.map((m) => <MealRow key={m.id} meal={m} />)}</View>
            )}
          </View>
        );
      })}

      <Pressable accessibilityRole="button" accessibilityLabel="食事の目標を見る・決める" onPress={() => router.push('/meals/goal')}>
        <Card style={{ marginTop: 20, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <T bold size={15}>目標</T>
            <T size={12} color={colors.sub}>kcal と PFC の目標を見る・決める</T>
          </View>
          <Icon name="chevron" color={colors.sub} size={18} />
        </Card>
      </Pressable>
      {status !== 'signedIn' && (
        <T size={12} color={colors.sub} align="center" style={{ marginTop: 14 }}>
          ログインして同期すると、MCP（Claude・ChatGPT）で記録した食事も出ます
        </T>
      )}

      <AddSheet
        slot={adding}
        date={date}
        templates={data?.templates ?? []}
        yesterday={(data?.yesterday ?? []).filter((m) => m.slot === adding)}
        onClose={() => setAdding(null)}
        onRecord={async (run) => { setAdding(null); await run(); reload(); }}
      />
    </Screen>
  );
}

function MealRow({ meal }: { meal: Meal }) {
  const t = mealTotal(meal);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${mealTitle(meal)}を開く`} onPress={() => router.push({ pathname: '/meals/[id]', params: { id: meal.id } })}
      style={({ pressed }) => [s.mealRow, { opacity: pressed ? 0.7 : 1 }]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <T bold size={16} numberOfLines={1}>{mealTitle(meal)}</T>
        <T size={12} color={colors.sub}>P {fmt1(t.protein_g)}・F {fmt1(t.fat_g)}・C {fmt1(t.carbs_g)}{meal.source === 'photo' ? '　写真から推定' : ''}</T>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
        <T num bold size={22}>{fmtInt(t.kcal)}</T>
        <T size={11} color={colors.sub}>kcal</T>
      </View>
      <Icon name="chevron" color={colors.sub} size={18} />
    </Pressable>
  );
}

/** 記録の方法を選ぶ（いつもの・昨日と同じ・品目を入力・kcal と PFC だけ） */
function AddSheet({ slot, date, templates, yesterday, onClose, onRecord }: {
  slot: Slot | null; date: string; templates: { id: string; name: string; items: { kcal: number }[] }[]; yesterday: Meal[];
  onClose: () => void; onRecord: (run: () => Promise<unknown>) => void;
}) {
  const repos = useRepos();
  const insets = useSafeAreaInsets();
  if (!slot) return null;
  const to = { date, slot };
  const open = (mode: 'items' | 'numbers') => { onClose(); router.push({ pathname: '/meals/new', params: { date, slot, mode } }); };
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="閉じる" />
      <View style={s.sheet}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 16 + insets.bottom, gap: 12 }}>
          <View>
            <T bold size={22}>{SLOT_LABELS[slot]}を記録</T>
            <T size={13} color={colors.sub}>{formatJpDate(date)}</T>
          </View>
          {templates.length > 0 && (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Icon name="star" size={16} color={colors.accent} />
                <T bold size={14} color={colors.sub}>いつもの</T>
              </View>
              <View style={s.group}>
                {templates.map((t, i) => (
                  <View key={t.id} style={[s.sheetRow, i > 0 && s.line]}>
                    <View style={{ flex: 1 }}>
                      <T bold size={15}>{t.name}</T>
                      <T size={12} color={colors.sub}>{t.items.length}品・{fmtInt(t.items.reduce((n, x) => n + x.kcal, 0))}kcal</T>
                    </View>
                    <IconButton name="plus" label={`いつもの「${t.name}」を記録`} size={36} bg={colors.accentDark} color={colors.accent}
                      onPress={() => onRecord(() => repos.meals.recordTemplate(t.id, to))} />
                  </View>
                ))}
              </View>
            </>
          )}
          <View style={s.group}>
            {yesterday.length === 0 ? (
              <View style={s.sheetRow}>
                <MethodIcon name="copy" />
                <View style={{ flex: 1 }}>
                  <T bold size={15} color={colors.sub}>昨日と同じ</T>
                  <T size={12} color={colors.sub}>昨日の{SLOT_LABELS[slot]}の記録はありません</T>
                </View>
              </View>
            ) : yesterday.map((m, i) => (
              <Pressable key={m.id} accessibilityRole="button" accessibilityLabel={`昨日と同じ：${mealTitle(m)}`} style={[s.sheetRow, i > 0 && s.line]}
                onPress={() => onRecord(() => repos.meals.copy(m.id, to))}>
                <MethodIcon name="copy" />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <T bold size={15}>昨日と同じ</T>
                  <T size={12} color={colors.sub} numberOfLines={1}>{formatJpDate(addDays(date, -1))}の{SLOT_LABELS[slot]}（{mealTitle(m)}・{fmtInt(mealTotal(m).kcal)}kcal）</T>
                </View>
                <Icon name="chevron" color={colors.sub} size={18} />
              </Pressable>
            ))}
            <Pressable accessibilityRole="button" accessibilityLabel="品目を入力" style={[s.sheetRow, s.line]} onPress={() => open('items')}>
              <MethodIcon name="pencil" />
              <View style={{ flex: 1 }}>
                <T bold size={15}>品目を入力</T>
                <T size={12} color={colors.sub}>品名・量・kcal・PFC を入れます</T>
              </View>
              <Icon name="chevron" color={colors.sub} size={18} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="kcal と PFC だけ" style={[s.sheetRow, s.line]} onPress={() => open('numbers')}>
              <MethodIcon name="calc" />
              <View style={{ flex: 1 }}>
                <T bold size={15}>kcal と PFC だけ</T>
                <T size={12} color={colors.sub}>外食などで、数字だけ分かるとき</T>
              </View>
              <Icon name="chevron" color={colors.sub} size={18} />
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

function MethodIcon({ name }: { name: 'copy' | 'pencil' | 'calc' }) {
  return (
    <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={name} size={20} color={colors.accent} />
    </View>
  );
}

const s = StyleSheet.create({
  badge: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  slotHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, marginBottom: 8 },
  empty: { borderWidth: 1, borderStyle: 'dashed', borderColor: colors.line, borderRadius: radius.card, padding: 16, alignItems: 'center' },
  mealRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.card, borderRadius: radius.card, padding: 16 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: { maxHeight: '80%', backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  group: { backgroundColor: colors.input, borderRadius: radius.card },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, minHeight: 60 },
  line: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
});
