import { ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleProp, useWindowDimensions, View, ViewStyle } from 'react-native';
import Animated, {
  SharedValue, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSequence, withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusData, useRepos } from '@/hooks/data';
import { addDays, addMonths, DateKey, MONTH_NAMES_EN, yearMonth } from '@/lib/date';
import {
  claimsSwipe, dragOffset, releaseDirection, showsSwipeHint, slideSign, SWIPE_HINT_NUDGE_DX, SwipeDirection, SwipeHintKind, swipeHintText,
} from '@/lib/swipe';
import { colors, space } from '@/theme';
import { duration, HOLD_MS, motionDuration } from '@/theme/motion';
import { Icon } from './Icon';
import { MonthCalendar } from './MonthCalendar';
import { easeIn, easeOut, PressableScale, Sheet } from './motion';
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

/** 日（週）が変わるときの、中身の横すべり。今の中身が出ていく半分と、次の中身が入る半分で、合わせて行き帰り同じ 250ms */
const SLIDE_HALF_MS = duration.toggle / 2;

export type PageSlide = {
  /** 中身の横の位置（dp） */
  x: SharedValue<number>;
  /**
   * 向きに合わせて中身を横へすべらせ、出ていったところで apply（日を変える）を呼び、次の中身を反対の側から入れる。
   * 動きを減らす設定なら、すぐに apply するだけ
   */
  go: (direction: SwipeDirection, apply: () => void) => void;
  /** 元の位置へ戻す（足りないスワイプ、進めない向き） */
  back: () => void;
};

/**
 * 日付の切り替えの中身の横すべり（SwipeArea に渡す）。＜ ＞ のボタン・「日を選ぶ」・「今日に戻る」も go を通すと、
 * スワイプと同じ向きの横すべりになる。apply の中では、最新の日から計算する（続けて押したとき、前の apply がまだでも数を落とさない）
 */
export function usePageSlide(): PageSlide {
  const reduced = useReducedMotion();
  const x = useSharedValue(0);
  // 出ていく・入る距離は画面の幅（左右の余白の分も、見えるところに残さない）
  const { width } = useWindowDimensions();
  // 出ていく途中の、まだ呼んでいない apply。続けて動かしたら、先のものをすぐ呼ぶ
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; apply: () => void } | null>(null);
  useEffect(() => () => { if (pending.current) clearTimeout(pending.current.timer); }, []);
  const go = useCallback((direction: SwipeDirection, apply: () => void) => {
    const p = pending.current;
    if (p) { clearTimeout(p.timer); pending.current = null; p.apply(); }
    if (reduced) { x.set(0); apply(); return; }
    const sign = slideSign(direction);
    const w = width;
    x.set(withTiming(sign * w, { duration: SLIDE_HALF_MS, easing: easeIn }));
    const timer = setTimeout(() => {
      pending.current = null;
      apply();
      x.set(withSequence(withTiming(-sign * w, { duration: 0 }), withTiming(0, { duration: SLIDE_HALF_MS, easing: easeOut })));
    }, SLIDE_HALF_MS);
    pending.current = { timer, apply };
  }, [reduced, x, width]);
  const back = useCallback(() => {
    x.set(withTiming(0, { duration: motionDuration(duration.toggle, reduced), easing: easeOut }));
  }, [reduced, x]);
  return useMemo(() => ({ x, go, back }), [x, go, back]);
}

/**
 * 左右のスワイプで前・次へ動かす範囲（食事の記録・推移、筋トレの記録）。header（日付の切り替え）は動かさず、その下の中身が
 * 指についてくる。放して日が変わるときは横にすべって入れ替わり、足りなければ元の位置へ戻る。次へ進めない（canNext でない）
 * ときに左へ引くと、ゴムのように抵抗して動き、放すと戻る（lib/swipe.ts）。
 * 横の動きが十分大きいときだけ指を受けるので、縦のスクロールと押す操作はそのまま。
 * 最初の数回は、開いたときに中身が少し左へずれて戻り、日付の切り替えの下に「左右にスワイプで日を移れます」を出す
 * （一度スワイプで動かしたら、もう出さない。端末だけに覚える）。読み上げでは前・次のボタンを使い、ヒントの文も読み上げる。
 * 動きを減らす設定なら、指についてこず、ヒントもずらさない（結果と文だけ）
 */
export function SwipeArea({ slide, onSwipe, canNext, hint, header, children, testID, style, contentStyle }: {
  slide: PageSlide; onSwipe: (direction: SwipeDirection) => void; canNext: boolean; hint: SwipeHintKind; header: ReactNode;
  children: ReactNode; testID?: string; style?: StyleProp<ViewStyle>; contentStyle?: StyleProp<ViewStyle>;
}) {
  const repos = useRepos();
  const reduced = useReducedMotion();
  const [hinting, setHinting] = useState(false);
  const latest = useRef({ slide, onSwipe, canNext, reduced, repos });
  useLayoutEffect(() => { latest.current = { slide, onSwipe, canNext, reduced, repos }; });

  // 開いたときに1回だけ、ヒントを出すかを決める
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!showsSwipeHint(await repos.settings.swipeHint(hint)) || !alive) return;
      // 数えてから出す（出たのに数えていない、を作らない）
      await repos.settings.markSwipeHintShown(hint);
      if (alive) setHinting(true);
    })().catch(() => {});
    return () => { alive = false; };
  }, [repos, hint]);
  // ヒントを出したら、中身を少し左へずらして戻す（行き帰り同じ長さ、はね返りなし）
  const { x } = slide;
  useEffect(() => {
    if (!hinting || reduced) return;
    const cfg = { duration: duration.toggle, easing: easeOut };
    x.set(withDelay(HOLD_MS, withSequence(withTiming(-SWIPE_HINT_NUDGE_DX, cfg), withTiming(0, cfg))));
  }, [hinting, reduced, x]);

  // ref は指の動きの中（描く間ではない）でだけ読むので、描くたびに作り直さずに最新の値を使える
  // eslint-disable-next-line react-hooks/refs
  const handlers = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => claimsSwipe(g.dx, g.dy),
    onPanResponderMove: (_, g) => {
      const l = latest.current;
      if (!l.reduced) l.slide.x.set(dragOffset(g.dx, l.canNext));
    },
    onPanResponderRelease: (_, g) => {
      const l = latest.current;
      const d = releaseDirection(g.dx, g.dy, l.canNext);
      if (!d) { l.slide.back(); return; }
      l.slide.go(d, () => l.onSwipe(d));
      setHinting(false);
      l.repos.settings.setSwipeHintUsed().catch(() => {});
    },
    onPanResponderTerminate: () => latest.current.slide.back(),
    // 横のスワイプと決めて受け取ったあとは、ほか（押したカード・JS のスクロール）に渡さない
    onPanResponderTerminationRequest: () => false,
  }).panHandlers, []);
  const anim = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));
  return (
    <View {...handlers} testID={testID} style={style}>
      {header}
      {hinting && (
        <T variant="bodyS" color={colors.sub} align="center" style={{ marginTop: space.s }} testID="swipe-hint">{swipeHintText(hint)}</T>
      )}
      <Animated.View style={[contentStyle, anim]} testID={testID && `${testID}-content`}>{children}</Animated.View>
    </View>
  );
}
