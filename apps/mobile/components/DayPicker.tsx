import { ReactNode, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleProp, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusData } from '@/hooks/data';
import { addDays, addMonths, DateKey, MONTH_NAMES_EN, yearMonth } from '@/lib/date';
import { claimsSwipe, swipeDirection } from '@/lib/swipe';
import { colors, space } from '@/theme';
import { Icon } from './Icon';
import { MonthCalendar } from './MonthCalendar';
import { PressableScale, Sheet } from './motion';
import { T } from './Text';
import { Button, Card, IconButton } from './ui';

/**
 * 日付の切り替え（「＜ 📅 11月8日（日） ＞」。食事の記録・推移、筋トレの記録）。
 * onPick を渡すと、まん中の日付を押して「日を選ぶ」のシートを開ける。次へは canNext のときだけ（未来へは進めない）
 */
export function DateSwitcher({ label, prevLabel, nextLabel, onPrev, onNext, canNext, onPick, style }: {
  label: string; prevLabel: string; nextLabel: string; onPrev: () => void; onNext: () => void; canNext: boolean;
  onPick?: () => void; style?: StyleProp<ViewStyle>;
}) {
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
      <Icon name="calendar" size={20} color={colors.text} />
      <T variant="titleM">{label}</T>
    </View>
  );
  return (
    <Card style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: space.xs, paddingHorizontal: space.xs }, style]}>
      <IconButton name="prev" label={prevLabel} onPress={onPrev} />
      {onPick ? (
        <PressableScale
          accessibilityRole="button" accessibilityLabel={`日を選ぶ（${label}）`} onPress={onPick} scaleTo={0.96}
          style={{ minHeight: 48, paddingHorizontal: space.m, justifyContent: 'center' }} testID="open-day-picker"
        >
          {body}
        </PressableScale>
      ) : body}
      <IconButton name="next" label={nextLabel} disabled={!canNext} onPress={() => canNext && onNext()} />
    </Card>
  );
}

/** 今日でない日を見ているときの知らせと「今日に戻る」（筋トレの記録の、日付の下） */
export function NotTodayRow({ onToday }: { onToday: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.s, marginTop: space.s }}>
      <T variant="bodyM" color={colors.sub} style={{ flex: 1 }}>今日ではない日を見ています</T>
      <Button label="今日に戻る" variant="text" small onPress={onToday} style={{ paddingLeft: 12, paddingRight: 12, marginRight: -12 }} />
    </View>
  );
}

type PickerKind = 'training' | 'meal';
const PICKER_TEXT: Record<PickerKind, { note: string; count: (n: number, when: string) => string }> = {
  training: { note: '点のある日に筋トレの記録があります', count: (n, when) => `筋トレをした日：${when} ${n}回` },
  meal: { note: '点のある日に食事の記録があります', count: (n, when) => `食事を記録した日：${when} ${n}日` },
};

/**
 * 「日を選ぶ」の下からのシート。月のカレンダーで、記録のある日に点（筋トレは筋トレをした日、食事は食事を記録した日）。
 * 今日より後の日は押せない。日を押すとシートを閉じて、その日にする
 */
export function DayPickerSheet({ visible, kind, value, today, onClose, onPick }: {
  visible: boolean; kind: PickerKind; value: DateKey; today: DateKey; onClose: () => void; onPick: (date: DateKey) => void;
}) {
  return (
    <Sheet visible={visible} onClose={onClose}>
      <DayPickerBody kind={kind} value={value} today={today} onPick={(d) => { onClose(); onPick(d); }} />
    </Sheet>
  );
}

/** シートの中身。シートを開くたびに作り直されるので、月は選んでいる日の月から始まる */
function DayPickerBody({ kind, value, today, onPick }: { kind: PickerKind; value: DateKey; today: DateKey; onPick: (date: DateKey) => void }) {
  const insets = useSafeAreaInsets();
  const [month, setMonth] = useState(value.slice(0, 7) + '-01');
  const thisMonth = today.slice(0, 7) + '-01';
  const { data } = useFocusData(async (r) => {
    const last = addDays(addMonths(month, 1), -1);
    if (kind === 'training') {
      const rows = await r.workouts.allSetRows();
      return { month, dates: new Set(rows.filter((x) => x.date >= month && x.date <= last).map((x) => x.date)) };
    }
    const { days } = await r.meals.summaries(month, last);
    return { month, dates: new Set(days.filter((d) => d.meals.length > 0).map((d) => d.date)) };
  }, `${kind}-${month}`);
  const marked = data?.month === month ? data.dates : new Set<DateKey>();
  const { year, month: m } = yearMonth(month);
  const text = PICKER_TEXT[kind];
  return (
    <View style={{ paddingHorizontal: space.l, paddingTop: space.s, paddingBottom: space.l + insets.bottom }} testID="day-picker">
      <View style={{ alignSelf: 'center', width: 32, height: 4, borderRadius: 2, backgroundColor: colors.sub, marginBottom: space.l }} />
      <T variant="headlineS" accessibilityRole="header">日を選ぶ</T>
      <T variant="bodyM" color={colors.sub} style={{ marginTop: space.xs }}>{text.note}</T>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.m, marginBottom: space.s }}>
        <IconButton name="prev" label="前の月" onPress={() => setMonth(addMonths(month, -1))} />
        <T num bold size={22}>{MONTH_NAMES_EN[m - 1]} {year}</T>
        <IconButton name="next" label="次の月" disabled={month >= thisMonth} onPress={() => month < thisMonth && setMonth(addMonths(month, 1))} />
      </View>
      <MonthCalendar
        year={year} month={m} today={today} marked={marked} markStyle="dot" selected={value} maxDate={today}
        onPressDay={onPick} cell={44} testID="day-picker-calendar"
      />
      <T variant="bodyS" color={colors.sub} style={{ marginTop: space.m }}>
        {text.count(marked.size, month === thisMonth ? '今月' : `${m}月`)}
      </T>
    </View>
  );
}

/**
 * 左右のスワイプで前・次へ動かす範囲（食事の記録・推移、筋トレの記録の中身を包む）。
 * 横の動きが十分大きいときだけ指を受けるので、縦のスクロールと押す操作はそのまま（lib/swipe.ts）。
 * 未来へ進めないなどの判断は onSwipe の側でする。読み上げでは前・次のボタンを使う
 */
export function SwipeArea({ onSwipe, children, testID, style }: {
  onSwipe: (direction: 'prev' | 'next') => void; children: ReactNode; testID?: string; style?: StyleProp<ViewStyle>;
}) {
  const ref = useRef(onSwipe);
  useLayoutEffect(() => { ref.current = onSwipe; });
  // ref は指の動きの中（描く間ではない）でだけ読むので、描くたびに作り直さずに最新の onSwipe を呼べる
  // eslint-disable-next-line react-hooks/refs
  const handlers = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => claimsSwipe(g.dx, g.dy),
    onPanResponderRelease: (_, g) => {
      const d = swipeDirection(g.dx, g.dy);
      if (d) ref.current(d);
    },
    // 横のスワイプと決めて受け取ったあとは、ほか（押したカード・JS のスクロール）に渡さない
    onPanResponderTerminationRequest: () => false,
  }).panHandlers, []);
  return <View {...handlers} testID={testID} style={style}>{children}</View>;
}
