import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AI_RECORD_LABEL, AiRecordButton, useChatChooser } from '@/components/ChatSheet';
import { DateSwitcher, DayPickerSheet, SwipeArea, usePageSlide } from '@/components/DayPicker';
import { FuelPanel } from '@/components/homeHud';
import { Icon } from '@/components/Icon';
import { LoadError } from '@/components/LoadError';
import { NutritionSummary } from '@/components/meals';
import { PressableScale, Sheet, useListMotion } from '@/components/motion';
import { DailyHighlights } from '@/components/reports';
import { Screen, ScrollTarget } from '@/components/Screen';
import { T } from '@/components/Text';
import { MealWeekly } from '@/components/MealWeekly';
import { Button, Card, IconButton, PrimaryTabs, Segmented, TabHeader } from '@/components/ui';
import { useAuth } from '@/hooks/auth';
import { useBackToToday } from '@/hooks/backToToday';
import { useBusy } from '@/hooks/busy';
import { useFocusData, useRepos } from '@/hooks/data';
import { useToday } from '@/hooks/today';
import { addDays, DateKey, formatJpDate, todayKey } from '@/lib/date';
import { fuelGauge } from '@/lib/homeHud';
import { DAY_TYPE_LABELS, Meal, mealTitle, mealTotal, SLOT_LABELS, SLOTS, Slot, slotAt } from '@/lib/meals';
import { TAB_AREAS } from '@/lib/reports';
import { pageDirection, SwipeDirection } from '@/lib/swipe';
import { fmt1, fmtInt } from '@/lib/units';
import { colors, radius, space } from '@/theme';

/**
 * 食事のタブ。「記録」はその日の区分ごとの食事、合計と目標の残り（日付は過去にも戻れる。今日が初め）。「推移」は週のふり返り（週のまとめ）。
 * 記録の上には、ホームの FUEL と同じカード（その日の kcal と PFC のドーナツ）を置く。ホームの FUEL から来たら（focus=fuel）、そこまでスクロールする
 */
export default function MealsScreen() {
  const [date, setDate] = useState(todayKey);
  // 日をまたいだら、今日を見ていたなら新しい今日へ移す（前の日に記録を足さないように）
  const today = useToday((next, prev) => setDate((d) => (d === prev ? next : d)));
  const [adding, setAdding] = useState<Slot | null>(null);
  // 上の切り替え：その日の「記録」と「推移」（週のまとめ。前の履歴／分析のタブの食事）
  const [pane, setPane] = useState<'day' | 'week'>('day');
  // ホームの食事のカードから、その日を指定して開いたとき
  const { date: asked, focus } = useLocalSearchParams<{ date?: string; focus?: string }>();
  useEffect(() => { if (asked && asked <= todayKey()) { setDate(asked); setPane('day'); } }, [asked]);
  // ホームの FUEL から来たとき：その日の記録の FUEL のカードまでスクロールする。n は来るたびに変える（同じ日でももう一度スクロールする）。
  // 受け取った focus は消す（次に来たときも動くように）。画面を離れたら、合わせ直すのをやめる
  const [fuelRequest, setFuelRequest] = useState<number | null>(null);
  const focusCount = useRef(0);
  useEffect(() => {
    if (focus !== 'fuel') return;
    if (asked && asked <= todayKey()) setDate(asked);
    setPane('day');
    setFuelRequest(++focusCount.current);
    router.setParams({ focus: undefined });
  }, [focus, asked]);
  useFocusEffect(useCallback(() => () => setFuelRequest(null), []));
  const { status } = useAuth();
  const [picking, setPicking] = useState(false);
  // 日を変えるときは、向きに合わせて中身を横へすべらせる（スワイプ・前後のボタン・日を選ぶ・Android の戻る）
  const slide = usePageSlide();
  // 前の日・次の日（ボタンとスワイプ）。未来の日へは進めない。すべり終わる前に続けて動かしても数を落とさないよう、最新の日から計算する
  const move = (d: SwipeDirection) => setDate((cur) => (d === 'prev' ? addDays(cur, -1) : cur < today ? addDays(cur, 1) : cur));
  const goTo = (to: DateKey) => {
    const d = pageDirection(date, to);
    if (d) slide.go(d, () => setDate(to));
  };
  // 前の日を見ているときは、Android の戻るでまず今日に戻す
  useBackToToday(date === today, () => goTo(today));
  const { data, error, reload, repos } = useFocusData(async (r) => {
    const [{ days, goal }, templates, yesterday] = await Promise.all([
      r.meals.summaries(date, date), r.meals.listTemplates(), r.meals.listDay(addDays(date, -1)),
    ]);
    return { date, day: days[0], goal, templates, yesterday };
  }, date);
  const day = data?.date === date ? data.day : null;
  const list = useListMotion(day != null);
  // 書き込み（日の種類の切り替え、いつもの・昨日と同じで記録）は1つずつ。続けて押しても2回書かない
  const { busy, run } = useBusy();
  const chat = useChatChooser();

  // 日の種類のバッジを押すと、その日を筋トレの日／休みの日に決める（MCP の set_day_type と同じ）
  const toggleDayType = () => run(async () => {
    if (!day) return;
    await repos.meals.setDayType(date, day.dayType === 'training' ? 'rest' : 'training');
    await reload();
  });

  if (error) return <Screen tab><LoadError onRetry={reload} /></Screen>;

  // 「記録」の下：「AI で記録」と「食事を追加」（筋トレと同じ並び）。未来の日はどちらも押せない
  const footer = pane === 'day' ? (
    <View style={{ flexDirection: 'row', gap: space.s }}>
      <AiRecordButton prompt={{ kind: 'meal', date, today }} disabled={date > today} style={{ flex: 1 }} />
      <Button label="食事を追加" icon="plus" disabled={date > today} onPress={() => setAdding(slotAt(new Date().getHours()))} style={{ flex: 1 }} testID="meal-add" />
    </View>
  ) : undefined;

  return (
    <Screen tab footer={footer}>
      <TabHeader title="食事" />
      <PrimaryTabs<'day' | 'week'>
        options={[{ key: 'day', label: '記録', icon: 'meal' }, { key: 'week', label: '推移', icon: 'chart' }]}
        value={pane}
        onChange={setPane}
      />
      {pane === 'week' ? <View style={{ marginTop: 8 }}><MealWeekly /></View> : (<SwipeArea
        slide={slide} onSwipe={move} canNext={date < today} hint="meal-day" testID="meals-day"
        header={(
          <DateSwitcher
            label={formatJpDate(date)} prevLabel="前の日" nextLabel="次の日" canNext={date < today}
            onPrev={() => slide.go('prev', () => move('prev'))} onNext={() => slide.go('next', () => move('next'))}
            onPick={() => setPicking(true)} style={{ marginTop: space.l }}
          />
        )}
      >

      <ScrollTarget request={fuelRequest}>
        {day && (
          <View style={s.gaugeRow}>
            <FuelPanel fuel={fuelGauge(day)} date={date} dayLabel={date === today ? '今日' : formatJpDate(date)} link={false} testID="meal-fuel" />
          </View>
        )}
      </ScrollTarget>
      {day && (
        <Card style={{ marginTop: space.m }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: -space.xs }}>
            <T variant="titleM">{date === today ? '今日の合計' : 'この日の合計'}</T>
            {/* 日の種類は、押して切り替えられると分かる assist chip（入れ替えのアイコン付き、押せる範囲 48） */}
            <PressableScale accessibilityRole="button" accessibilityLabel={`日の種類：${DAY_TYPE_LABELS[day.dayType]}（押すと切り替え）`} onPress={toggleDayType}
              disabled={busy} aria-busy={busy} style={s.chipTouch}>
              <View style={[s.dayChip, day.dayType === 'training' ? { backgroundColor: colors.accentDark, borderColor: colors.accentDark } : { borderColor: colors.outline }, busy && { opacity: 0.38 }]}>
                <Icon name="swap" size={18} color={day.dayType === 'training' ? colors.onAccentDark : colors.sub} />
                <T variant="labelL" color={day.dayType === 'training' ? colors.onAccentDark : colors.sub}>{DAY_TYPE_LABELS[day.dayType]}</T>
              </View>
            </PressableScale>
          </View>
          <NutritionSummary total={day.total} target={day.target} remaining={day.remaining} />
          {!data?.goal && (
            // 文と、押せる「目標を決める」を分ける
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.s, marginTop: space.s }}>
              <T variant="bodyS" color={colors.sub} style={{ flex: 1 }}>目標が未設定です（Claude・ChatGPT でも決められます）</T>
              <Button label="目標を決める" variant="text" small accessibilityLabel="目標が未設定です。目標を決める" onPress={() => router.push('/meals/goal')} style={{ paddingLeft: 12, paddingRight: 12, marginRight: -12 }} />
            </View>
          )}
        </Card>
      )}
      <DailyHighlights date={date} areas={TAB_AREAS.meals} />

      {SLOTS.map((slot, slotIndex) => {
        const meals = day?.meals.filter((m) => m.slot === slot) ?? [];
        const kcal = meals.reduce((n, m) => n + mealTotal(m).kcal, 0);
        return (
          <View key={slot}>
            <View style={s.slotHead}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.s }}>
                <T variant="titleM">{SLOT_LABELS[slot]}</T>
                <T variant="bodyM" color={colors.sub}>{fmtInt(kcal)} kcal</T>
              </View>
              <IconButton name="plus" label={`${SLOT_LABELS[slot]}を記録`} variant="tonal" onPress={() => setAdding(slot)} />
            </View>
            {meals.length === 0 ? (
              <View style={s.empty}><T variant="bodyM" color={colors.sub}>{SLOT_LABELS[slot]}はまだ記録していません</T></View>
            ) : (
              <View style={{ gap: 8 }}>
                {meals.map((m, i) => (
                  <Animated.View key={m.id} entering={list.entering(slotIndex + i)} exiting={list.exiting} layout={list.layout}>
                    <MealRow meal={m} />
                  </Animated.View>
                ))}
              </View>
            )}
          </View>
        );
      })}

      <PressableScale accessibilityRole="button" accessibilityLabel="食事の目標を見る・決める" onPress={() => router.push('/meals/goal')}>
        <Card style={{ marginTop: 20, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <T bold size={15}>目標</T>
            <T size={12} color={colors.sub}>kcal と PFC の目標を見る・決める</T>
          </View>
          <Icon name="chevron" color={colors.sub} size={18} />
        </Card>
      </PressableScale>
      {status !== 'signedIn' && (
        <T size={12} color={colors.sub} align="center" style={{ marginTop: 14 }}>
          ログインして同期すると、MCP（Claude・ChatGPT）で記録した食事も出ます
        </T>
      )}
      </SwipeArea>)}
      <DayPickerSheet visible={picking} kind="meal" value={date} today={today} onClose={() => setPicking(false)} onPick={goTo} />

      <AddSheet
        slot={adding}
        date={date}
        templates={data?.templates ?? []}
        yesterday={data?.yesterday ?? []}
        onSlot={setAdding}
        onClose={() => setAdding(null)}
        onRecord={(record) => run(async () => { setAdding(null); await record(); await reload(); })}
        onAi={(slot) => { setAdding(null); chat.record({ kind: 'meal', date, today, slot }); }}
      />
      {chat.sheet}
    </Screen>
  );
}

function MealRow({ meal }: { meal: Meal }) {
  const t = mealTotal(meal);
  return (
    <PressableScale accessibilityRole="button" accessibilityLabel={`${mealTitle(meal)}を開く`} onPress={() => router.push({ pathname: '/meals/[id]', params: { id: meal.id } })}
      style={s.mealRow}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <T variant="titleM" numberOfLines={1}>{mealTitle(meal)}</T>
        <T variant="bodyS" color={colors.sub}>P {fmt1(t.protein_g)}・F {fmt1(t.fat_g)}・C {fmt1(t.carbs_g)}{meal.source === 'photo' ? '　写真から推定' : ''}</T>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.xs }}>
        <T variant="numM" bold>{fmtInt(t.kcal)}</T>
        <T variant="labelS" bold={false} color={colors.sub}>kcal</T>
      </View>
      <Icon name="chevron" color={colors.sub} size={24} />
    </PressableScale>
  );
}

/** 記録の方法を選ぶ（いつもの・昨日と同じ・品目を入力・kcal と PFC だけ）。上の切り替えで区分を選び直せる */
function AddSheet({ slot, date, templates, yesterday, onSlot, onClose, onRecord, onAi }: {
  slot: Slot | null; date: string; templates: { id: string; name: string; items: { kcal: number }[] }[]; yesterday: Meal[];
  onSlot: (slot: Slot) => void; onClose: () => void; onRecord: (run: () => Promise<unknown>) => void; onAi: (slot: Slot) => void;
}) {
  const repos = useRepos();
  const insets = useSafeAreaInsets();
  // 閉じる動きの間も中身を出しておくため、最後に開いた区分を覚えておく
  const [last, setLast] = useState(slot);
  if (slot && slot !== last) setLast(slot);
  const shown = slot ?? last;
  return (
    <Sheet visible={slot != null} onClose={onClose}>
      {shown && <AddSheetBody slot={shown} date={date} templates={templates} yesterday={yesterday.filter((m) => m.slot === shown)} insetBottom={insets.bottom} onSlot={onSlot} onClose={onClose} onRecord={onRecord} onAi={() => onAi(shown)} repos={repos} />}
    </Sheet>
  );
}

function AddSheetBody({ slot, date, templates, yesterday, insetBottom, onSlot, onClose, onRecord, onAi, repos }: {
  slot: Slot; date: string; templates: { id: string; name: string; items: { kcal: number }[] }[]; yesterday: Meal[]; insetBottom: number;
  onSlot: (slot: Slot) => void; onClose: () => void; onRecord: (run: () => Promise<unknown>) => void; onAi: () => void; repos: ReturnType<typeof useRepos>;
}) {
  const to = { date, slot };
  const open = (mode: 'items' | 'numbers') => { onClose(); router.push({ pathname: '/meals/new', params: { date, slot, mode } }); };
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 16 + insetBottom, gap: 12 }}>
      <View>
        <T bold size={22}>{SLOT_LABELS[slot]}を記録</T>
        <T size={13} color={colors.sub}>{formatJpDate(date)}</T>
      </View>
      <Segmented<Slot> options={SLOTS.map((k) => ({ key: k, label: SLOT_LABELS[k] }))} value={slot} onChange={onSlot} />
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
                <IconButton name="plus" label={`いつもの「${t.name}」を記録`} bg={colors.accentDark} color={colors.accent}
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
          <PressableScale key={m.id} accessibilityRole="button" accessibilityLabel={`昨日と同じ：${mealTitle(m)}`} style={[s.sheetRow, i > 0 && s.line]}
            onPress={() => onRecord(() => repos.meals.copy(m.id, to))}>
            <MethodIcon name="copy" />
            <View style={{ flex: 1, minWidth: 0 }}>
              <T bold size={15}>昨日と同じ</T>
              <T size={12} color={colors.sub} numberOfLines={1}>{formatJpDate(addDays(date, -1))}の{SLOT_LABELS[slot]}（{mealTitle(m)}・{fmtInt(mealTotal(m).kcal)}kcal）</T>
            </View>
            <Icon name="chevron" color={colors.sub} size={18} />
          </PressableScale>
        ))}
        <PressableScale accessibilityRole="button" accessibilityLabel={AI_RECORD_LABEL} style={[s.sheetRow, s.line]} onPress={onAi} testID="meal-ai-record">
          <MethodIcon name="chat" />
          <View style={{ flex: 1 }}>
            <T bold size={15}>AI で記録（写真や文から推定）</T>
            <T size={12} color={colors.sub}>写真や文を送ると、推定して記録します</T>
          </View>
          <Icon name="external" color={colors.sub} size={18} />
        </PressableScale>
        <PressableScale accessibilityRole="button" accessibilityLabel="品目を入力" style={[s.sheetRow, s.line]} onPress={() => open('items')}>
          <MethodIcon name="pencil" />
          <View style={{ flex: 1 }}>
            <T bold size={15}>品目を入力</T>
            <T size={12} color={colors.sub}>品名・量・kcal・PFC を入れます</T>
          </View>
          <Icon name="chevron" color={colors.sub} size={18} />
        </PressableScale>
        <PressableScale accessibilityRole="button" accessibilityLabel="kcal と PFC だけ" style={[s.sheetRow, s.line]} onPress={() => open('numbers')}>
          <MethodIcon name="calc" />
          <View style={{ flex: 1 }}>
            <T bold size={15}>kcal と PFC だけ</T>
            <T size={12} color={colors.sub}>外食などで、数字だけ分かるとき</T>
          </View>
          <Icon name="chevron" color={colors.sub} size={18} />
        </PressableScale>
      </View>
    </ScrollView>
  );
}

function MethodIcon({ name }: { name: 'copy' | 'pencil' | 'calc' | 'chat' }) {
  return (
    <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={name} size={20} color={colors.accent} />
    </View>
  );
}

const s = StyleSheet.create({
  // ホームの FUEL と同じく横の並びに置く（計器は flex: 1 で、並びの幅いっぱい）
  gaugeRow: { flexDirection: 'row', marginTop: space.m },
  chipTouch: { minHeight: 48, justifyContent: 'center' },
  dayChip: { flexDirection: 'row', alignItems: 'center', gap: space.s, height: 32, borderRadius: radius.s, borderWidth: 1, paddingLeft: space.s, paddingRight: space.l },
  slotHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.l, marginBottom: space.xs },
  // まだ記録していない枠の点線（3.7:1 の outline）
  empty: { borderWidth: 1, borderStyle: 'dashed', borderColor: colors.outline, borderRadius: radius.card, padding: space.l, alignItems: 'center' },
  // 食事の行（高さ 72 の押せる行）
  mealRow: { flexDirection: 'row', alignItems: 'center', gap: space.m, backgroundColor: colors.card, borderRadius: radius.card, paddingHorizontal: space.l, paddingVertical: space.m, minHeight: 72 },
  group: { backgroundColor: colors.input, borderRadius: radius.card },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, minHeight: 60 },
  line: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
});
