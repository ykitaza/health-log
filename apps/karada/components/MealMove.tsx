import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, PanResponderInstance, ScrollView, StyleSheet, Vibration, View, ViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SharedValue, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useScreenScroll } from '@/hooks/useOnScreen';
import { dropSlot, edgeScrollStep, MENU_SLOP, moveLabel, moveTargets, SlotBox } from '@/lib/mealMove';
import { Meal, mealTitle, SLOT_LABELS, SLOTS, Slot } from '@/lib/meals';
import { colors, isHud, radius, rowOnFill } from '@/theme';
import { duration, springs } from '@/theme/motion';
import { Icon } from './Icon';
import { easeOut, PressableScale, Sheet } from './motion';
import { T } from './Text';
import { LIST_GROUP } from './ui';

/** 持ち上げたときの軽い振動（ms）。RN 標準の Vibration（休憩のタイマーと同じ。ネイティブの追加なし） */
const LIFT_BUZZ_MS = 12;
/** 持ち上げたときの大きさ */
const LIFT_SCALE = 1.03;

function buzz() {
  try { Vibration.vibrate(LIFT_BUZZ_MS); } catch { /* 振動できない端末・web では鳴らさない */ }
}

/** 持ち上げている食事と、指の下の区分（受け皿。今の区分の上・どこの上でもないときは null） */
export type MealDragState = { meal: Meal; over: Slot | null };

type Session = {
  meal: Meal;
  boxes: SlotBox[];
  /** 持ち上げたときのスクロールの位置 */
  offset0: number;
  /** 指を動かしてドラッグになった */
  panning: boolean;
  dy: number;
  y: number;
  over: Slot | null;
  /** 画面の端の自動スクロール */
  timer: ReturnType<typeof setInterval> | null;
  scrollTo: number | null;
};

/**
 * 食事を長押しで持ち上げ、区分の上へ動かして離すと移す（#328）。
 * 長押しで持ち上がり（軽い振動、少し大きくなり影が付く）、指についてくる。区分の上に来ると、その区分（受け皿）が光る。離すと onDrop。
 * 動かさずに離したら onMenu（長押しのメニュー）。持ち上げているあいだは、画面のスクロールを止め、画面の上下の端に指を寄せると自動でスクロールする。
 * 指は RN 標準の PanResponder で取る（ネイティブの追加なし）。持ち上げてから最初に動いたときに、行のまわりのビューが指を取る（capture）。
 * 動きを減らす設定なら、持ち上がる・戻るの動きを付けず、すぐにその形にする（指についてくるのは、直接の操作なのでそのまま）
 */
export function useMealDrag({ onDrop, onMenu }: { onDrop: (meal: Meal, to: Slot) => void; onMenu: (meal: Meal) => void }) {
  const watch = useScreenScroll();
  const reduced = useReducedMotion();
  const [state, setState] = useState<MealDragState | null>(null);
  const slotViews = useRef<Partial<Record<Slot, ViewInstance | null>>>({});
  const session = useRef<Session | null>(null);
  const y = useSharedValue(0);
  const lift = useSharedValue(0);
  const latest = useRef({ onDrop, onMenu, reduced, watch });
  useLayoutEffect(() => { latest.current = { onDrop, onMenu, reduced, watch }; });

  const stopEdge = (s: Session) => {
    if (s.timer) clearInterval(s.timer);
    s.timer = null;
    s.scrollTo = null;
  };

  const end = useCallback((settle: boolean) => {
    const s = session.current;
    if (!s) return;
    stopEdge(s);
    session.current = null;
    const r = latest.current.reduced;
    // 移したら、行はすぐ新しい区分に出るので戻さない。移さないときは元の位置へ戻す
    if (settle && !r) {
      y.set(withSpring(0, springs.release));
      lift.set(withTiming(0, { duration: duration.exit, easing: easeOut }));
    } else {
      y.set(0);
      lift.set(0);
    }
    latest.current.watch?.setScrollEnabled?.(true);
    setState(null);
  }, [y, lift]);

  // 画面を離れた・消えたときは、持ち上げたままにしない
  useEffect(() => () => {
    const s = session.current;
    if (s) stopEdge(s);
    session.current = null;
    latest.current.watch?.setScrollEnabled?.(true);
  }, []);

  /** 指の位置から、行のずれと指の下の区分を決め直す（指が動いたとき・自動スクロールしたとき） */
  const follow = useCallback(() => {
    const s = session.current;
    if (!s) return;
    const scrolled = (latest.current.watch?.offset ?? s.offset0) - s.offset0;
    y.set(s.dy + scrolled);
    const over = dropSlot(s.y + scrolled, s.boxes, s.meal.slot);
    if (over !== s.over) {
      s.over = over;
      if (over) buzz();
      setState({ meal: s.meal, over });
    }
  }, [y]);

  const edge = useCallback(() => {
    const s = session.current;
    const w = latest.current.watch;
    if (!s || !w?.scrollTo) return;
    if (edgeScrollStep(s.y, w.viewport) === 0) { stopEdge(s); return; }
    if (s.timer) return;
    s.timer = setInterval(() => {
      const cur = session.current;
      const step = cur ? edgeScrollStep(cur.y, w.viewport) : 0;
      if (!cur || step === 0) { if (cur) stopEdge(cur); return; }
      cur.scrollTo = Math.max(0, (cur.scrollTo ?? w.offset) + step);
      w.scrollTo!(cur.scrollTo, false);
      follow();
    }, 16);
  }, [follow]);

  /** 長押しで持ち上げる（行の onLongPress） */
  const begin = useCallback((meal: Meal) => {
    if (session.current) return;
    const w = latest.current.watch;
    const s: Session = { meal, boxes: [], offset0: w?.offset ?? 0, panning: false, dy: 0, y: 0, over: null, timer: null, scrollTo: null };
    session.current = s;
    // 区分（受け皿）の位置を、持ち上げたときに 1 回だけ測る（スクロールした分は offset で直す）
    for (const slot of SLOTS) {
      slotViews.current[slot]?.measureInWindow((_x, top, _w, h) => {
        if (session.current === s && h > 0) s.boxes.push({ slot, top, bottom: top + h });
      });
    }
    w?.setScrollEnabled?.(false);
    buzz();
    y.set(0);
    lift.set(latest.current.reduced ? 1 : withTiming(1, { duration: duration.press, easing: easeOut }));
    setState({ meal, over: null });
  }, [y, lift]);

  /** 行から指を離した・指を取られた（行の onPressOut）。ドラッグにならずに離したら、長押しのメニューを開く */
  const pressOut = useCallback(() => {
    // 指を取ったビューの grant と、行の終わりの順は決まっていないので、1 コマ待ってから決める
    requestAnimationFrame(() => {
      const s = session.current;
      if (!s || s.panning) return;
      end(false);
      latest.current.onMenu(s.meal);
    });
  }, [end]);

  // ref は指の動きの中（描く間ではない）でだけ読むので、描くたびに作り直さずに最新の値を使える（SwipeArea と同じ）
  // eslint-disable-next-line react-hooks/refs
  const pan: PanResponderInstance = useMemo(() => PanResponder.create({
    // 持ち上げているときだけ、最初に動いたところで指を取る（行の Pressable・横のスワイプ・スクロールより先に）
    onMoveShouldSetPanResponderCapture: () => session.current != null,
    onPanResponderGrant: () => { if (session.current) session.current.panning = true; },
    onPanResponderMove: (_, g) => {
      const s = session.current;
      if (!s) return;
      s.dy = g.dy;
      s.y = g.moveY;
      follow();
      edge();
    },
    onPanResponderRelease: (_, g) => {
      const s = session.current;
      if (!s) return;
      const to = s.over;
      if (to) {
        end(false);
        latest.current.onDrop(s.meal, to);
        return;
      }
      // ほとんど動かさなかったら、メニューを開く
      if (Math.abs(g.dx) < MENU_SLOP && Math.abs(g.dy) < MENU_SLOP) {
        end(false);
        latest.current.onMenu(s.meal);
        return;
      }
      end(true);
    },
    onPanResponderTerminate: () => end(true),
    onPanResponderTerminationRequest: () => false,
  }), [follow, edge, end]);

  const slotRef = useCallback((slot: Slot) => (v: ViewInstance | null) => { slotViews.current[slot] = v; }, []);

  return { state, begin, pressOut, panHandlers: pan.panHandlers, slotRef, y, lift };
}

/** 持ち上げた行の動き（指についてくる・少し大きくなる） */
export function useLiftStyle(y: SharedValue<number>, lift: SharedValue<number>, on: boolean) {
  return useAnimatedStyle(() => (on
    ? { transform: [{ translateY: y.get() }, { scale: 1 + (LIFT_SCALE - 1) * lift.get() }] }
    : { transform: [{ translateY: 0 }, { scale: 1 }] }));
}

/**
 * 持ち上げた行の形。HUD は緑の縁と影、クラシックは墨の縁と紙の影（帳の 1 行をつまみ上げた形）。
 * 行の地は、HUD はカードの色のまま、クラシックは紙の色を敷く（下の罫が透けないように）
 */
export const LIFTED_ROW = isHud
  ? { borderWidth: 1, borderColor: colors.accent, shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 12 } as const
  : {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.text, borderRadius: radius.xs, paddingHorizontal: 8, marginHorizontal: -8,
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8,
  } as const;

/**
 * 区分（受け皿）の光。持ち上げているあいだ、ほかの区分は控えめな縁で受け皿と分かるようにし、指の下の区分は光らせる。
 * 形は、ほかの画面から来たときの光（components/Screen.tsx の Glow）と同じ：HUD は緑の縁と面、クラシックは墨の左の罫と薄い墨の面
 */
export function DropZone({ active, testID }: { active: boolean; testID?: string }) {
  return (
    <View
      pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" testID={testID}
      style={[s.zone, active ? s.zoneOn : s.zoneIdle]}
    />
  );
}

/**
 * 長押しのメニュー（ドラッグが難しいとき・読み上げのとき）。今の区分のほかの 3 つへ「〜へ移す」と、詳細を開く
 */
export function MoveSheet({ meal, onClose, onMove, onOpen }: {
  meal: Meal | null; onClose: () => void; onMove: (meal: Meal, to: Slot) => void; onOpen: (meal: Meal) => void;
}) {
  const insets = useSafeAreaInsets();
  // 閉じる動きの間も中身を出しておく
  const [last, setLast] = useState(meal);
  if (meal && meal !== last) setLast(meal);
  const shown = meal ?? last;
  return (
    <Sheet visible={meal != null} onClose={onClose}>
      {shown && (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 16 + insets.bottom, gap: 12 }} testID="meal-move-sheet">
          <View>
            <T bold size={22} numberOfLines={2}>{mealTitle(shown)}</T>
            <T size={13} color={colors.sub}>{SLOT_LABELS[shown.slot]}の記録。同じ日の別の食事へ移せます</T>
          </View>
          <View style={s.group}>
            {moveTargets(shown.slot).map((to, i) => (
              <PressableScale key={to} accessibilityRole="button" accessibilityLabel={moveLabel(to)} style={[s.row, i > 0 && s.line]}
                onPress={() => onMove(shown, to)} testID={`meal-move-${to}`}>
                <View style={s.icon}><Icon name="swap" size={20} color={colors.accent} /></View>
                <T bold size={15} style={{ flex: 1 }}>{moveLabel(to)}</T>
              </PressableScale>
            ))}
            <PressableScale accessibilityRole="button" accessibilityLabel="開いて直す" style={[s.row, s.line]} onPress={() => onOpen(shown)}>
              <View style={s.icon}><Icon name="pencil" size={20} color={colors.accent} /></View>
              <T bold size={15} style={{ flex: 1 }}>開いて直す</T>
              <Icon name="chevron" color={colors.sub} size={18} />
            </PressableScale>
          </View>
        </ScrollView>
      )}
    </Sheet>
  );
}

const s = StyleSheet.create({
  zone: { position: 'absolute', top: 0, bottom: 0, left: isHud ? -8 : -12, right: isHud ? -8 : -12 },
  zoneIdle: isHud
    ? { borderRadius: radius.card, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.outline }
    : { borderLeftWidth: 2, borderLeftColor: colors.line },
  zoneOn: isHud
    ? { borderRadius: radius.card, borderWidth: 2, borderColor: colors.accent, backgroundColor: `${colors.accent}33` }
    : { borderLeftWidth: 2, borderLeftColor: colors.text, backgroundColor: rowOnFill },
  group: isHud ? { backgroundColor: colors.input, borderRadius: radius.card } : LIST_GROUP,
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: isHud ? 16 : 0, paddingVertical: 12, minHeight: 56 },
  line: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  icon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
});
