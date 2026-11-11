// ホームの部品：今週の目標、カレンダーの凡例、「記録する」のシート、取り込みの知らせ（今週やることは WeeklyTodo.tsx）
import { router, useIsFocused } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOut, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { syncStore } from '@/db/repositories/sync';
import { useGoalStreak, useWeeklyAchievement } from '@/hooks/data';
import { NOTICE_MS, useSync } from '@/hooks/sync';
import { DateKey, formatJpDate, formatMonthDay } from '@/lib/date';
import { allGoalsReached, GoalProgress } from '@/lib/goals';
import {
  goalA11yLabel, goalRatio, goalStreakText, mealRecordTarget, shouldCelebrate, WEEKLY_GOALS_SECTION, weeklyGoalCardLabel,
} from '@/lib/home';
import { Received, receivedMessage, receivedTarget } from '@/lib/sync/received';
import { colors, radius, space } from '@/theme';
import { duration } from '@/theme/motion';
import { AI_RECORD_LABEL, useChatChooser } from './ChatSheet';
import { Icon, IconName } from './Icon';
import { DrawCheck, easeIn, easeOut, GrowBar, PressableScale, Sheet } from './motion';
import { T } from './Text';
import { Snackbar } from './ui';

/** 達成のチェックを動かした週の月曜を置く場所（sync_meta。同期しない。端末だけ）。同じ週に2回目からは動かさない */
const CELEBRATED_KEY = 'home.goals_celebrated';

/**
 * 今週の目標（右の列のいちばん下）。筋トレの回数と食事を記録した日数を、数字と細い棒で。睡眠はホームには出さない（週のレポートで見せる）。
 * 設定の目標がすべて届いたら、見出しの右に「✓ 達成」（その週で初めて見たときだけ、チェックが線を描くように出る）。
 * いちばん下に、すべて達成した週の連続（連続が0なら出さない）。押すと設定の「今週の目標」の欄へ（目標を変えられると分かるように）
 */
export function WeeklyGoalCard({ today }: { today: DateKey }) {
  const db = useSQLiteContext();
  const store = useMemo(() => syncStore(db), [db]);
  const { data } = useWeeklyAchievement(today);
  const { data: streak } = useGoalStreak(today);
  const achieved = data != null && allGoalsReached(data);
  const week = data?.start ?? null;
  // 達成の印の出し方。端末に覚えた週を読むまでは出さない（読んでから動かすと、一度出た印がもう一度動いて見えるため）
  const [mark, setMark] = useState<{ week: string; animate: boolean } | null>(null);
  useEffect(() => {
    if (!achieved || week == null) return;
    let alive = true;
    void (async () => {
      const seen = await store.getMeta(CELEBRATED_KEY).catch(() => week);
      const animate = shouldCelebrate(true, week, seen);
      if (animate) await store.setMeta(CELEBRATED_KEY, week).catch(() => {});
      if (alive) setMark({ week, animate });
    })();
    return () => { alive = false; };
  }, [achieved, week, store]);
  const streakText = streak ? goalStreakText(streak) : null;
  const rows = data ? [goalA11yLabel('筋トレ', '回', data.training), goalA11yLabel('食事の記録', '日', data.meals)] : [];
  return (
    <PressableScale
      style={s.small} testID="weekly-goals" scaleTo={0.98}
      accessibilityRole="button" accessibilityLabel={weeklyGoalCardLabel(achieved, rows, streakText)}
      onPress={() => router.push({ pathname: '/settings', params: { section: WEEKLY_GOALS_SECTION } })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4, minHeight: 16 }}>
        <T variant="labelS" color={colors.sub} style={{ lineHeight: 13 }}>今週の目標</T>
        {achieved && mark?.week === week && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }} testID="goals-achieved">
            <DrawCheck animate={mark.animate} size={14} color={colors.accent} />
            <T variant="labelS" color={colors.accent} style={{ lineHeight: 13 }}>達成</T>
          </View>
        )}
      </View>
      <View style={{ gap: 8, marginTop: 6 }}>
        <GoalRow testID="goal-training" name="筋トレ" unit="回" p={data?.training ?? null} />
        <GoalRow testID="goal-meals" name="食事の記録" unit="日" p={data?.meals ?? null} />
      </View>
      {streakText && <T variant="labelS" bold={false} color={colors.sub} style={{ marginTop: 8 }} testID="goal-streak">{streakText}</T>}
    </PressableScale>
  );
}

function GoalRow({ testID, name, unit, p }: { testID: string; name: string; unit: string; p: GoalProgress | null }) {
  return (
    <View testID={testID} accessible accessibilityLabel={p ? goalA11yLabel(name, unit, p) : name}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 4 }}>
        <T variant="labelS" numberOfLines={1} style={{ flexShrink: 1 }}>{name}</T>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 2 }}>
          <T num bold size={18}>{p ? p.days : '—'}</T>
          {p?.goal != null && <T variant="labelS" bold={false} color={colors.sub}>／{p.goal} {unit}</T>}
        </View>
      </View>
      <View style={s.track}>
        <GrowBar ratio={p ? goalRatio(p) : 0} style={s.fill} />
      </View>
    </View>
  );
}

/** カレンダーの凡例：○ 筋トレ ・ 食事の記録（形でも分かるように、丸の枠と点） */
export function CalendarLegend() {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.l, marginTop: space.s }} accessible accessibilityLabel="凡例。緑の丸の枠は筋トレ、白い点は食事の記録">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View style={{ width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: colors.accent }} />
        <T variant="bodyS" color={colors.sub}>筋トレ</T>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.text }} />
        <T variant="bodyS" color={colors.sub}>食事の記録</T>
      </View>
    </View>
  );
}

/**
 * 体重の行から、からだのタブに計測のシートを開いてもらう頼み（その日）。タブがもう開いていると、道の引数（params）を変えても
 * 届かないことがあるので、ここに置いて、からだのタブが前に出たときに受け取る（takeBodyInputRequest）
 */
let bodyInputRequest: DateKey | null = null;

/** からだのタブが前に出たときに呼ぶ。頼みがあればその日を返し、消す */
export function takeBodyInputRequest(): DateKey | null {
  const d = bodyInputRequest;
  bodyInputRequest = null;
  return d;
}

/**
 * 「記録する」のシート：筋トレ・食事・体重・AI で記録。date はホームで選んでいる日（過去の日もある）。
 * AI で記録は、食事の文で ChatGPT か Claude を選ぶシートを開く（筋トレの AI で記録は、筋トレの画面から）
 */
export function RecordSheet({ visible, date, today, onClose }: { visible: boolean; date: DateKey; today: DateKey; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const chat = useChatChooser();
  const isToday = date === today;
  const meal = mealRecordTarget(date, today, new Date().getHours());
  const go = (f: () => void) => { onClose(); f(); };
  const rows: { key: string; icon: IconName; title: string; sub: string; label?: string; external?: boolean; onPress: () => void }[] = [
    {
      key: 'training', icon: 'dumbbell', title: '筋トレ', sub: '種目を選んで、セットを入れます',
      onPress: () => go(() => router.push({ pathname: '/workout', params: { date } })),
    },
    {
      key: 'meal', icon: 'meal', title: '食事', sub: meal.text,
      onPress: () => go(() => (meal.slot
        ? router.push({ pathname: '/meals/new', params: { date, slot: meal.slot, mode: 'items' } })
        : router.navigate({ pathname: '/meals', params: { date } }))),
    },
    {
      key: 'body', icon: 'scale', title: '体重', sub: `${isToday ? '今日' : formatMonthDay(date)}の体重や体脂肪率を入れます`,
      onPress: () => go(() => { bodyInputRequest = date; router.navigate('/body'); }),
    },
    {
      key: 'ai', icon: 'chat', title: 'AI で記録', sub: 'ChatGPT か Claude を開きます', label: `${AI_RECORD_LABEL}（食事）`, external: true,
      onPress: () => go(() => chat.record({ kind: 'meal', date, today, slot: meal.slot ?? undefined })),
    },
  ];
  return (
    <>
      <Sheet visible={visible} onClose={onClose}>
        <View style={{ padding: space.l, paddingBottom: space.l + insets.bottom, gap: space.m }} testID="record-sheet">
          <View style={{ gap: space.xs }}>
            <T variant="titleL" accessibilityRole="header">記録する</T>
            <T variant="bodyM" color={colors.sub}>{formatJpDate(date)}の記録</T>
          </View>
          <View style={s.group}>
            {rows.map((r, i) => (
              <PressableScale
                key={r.key}
                accessibilityRole="button"
                accessibilityLabel={r.label ?? `${r.title}。${r.sub}`}
                scaleTo={0.98}
                onPress={r.onPress}
                style={[s.sheetRow, i > 0 && s.line]}
                testID={`record-${r.key}`}
              >
                <View style={s.rowIcon}><Icon name={r.icon} size={24} color={colors.onAccentDark} /></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <T variant="titleM">{r.title}</T>
                  <T variant="bodyM" color={colors.sub}>{r.sub}</T>
                </View>
                <Icon name={r.external ? 'external' : 'chevron'} size={24} color={colors.sub} />
              </PressableScale>
            ))}
          </View>
        </View>
      </Sheet>
      {chat.sheet}
    </>
  );
}

/**
 * 同期でほかから食事か筋トレを受け取ったときの知らせ（ホームを開いているときだけ）。「見る」でその日の食事か筋トレへ。
 * 出る 250ms・消える 150ms（動きを減らす設定なら動かさない）。bottom は画面の下からの位置（FAB の上）
 */
export function ReceivedNotice({ bottom }: { bottom: number }) {
  const { received } = useSync();
  const focused = useIsFocused();
  const reduced = useReducedMotion();
  const [shown, setShown] = useState<{ id: number; counts: Received } | null>(null);
  const [seen, setSeen] = useState(received?.id ?? 0);
  if (received && received.id !== seen) {
    setSeen(received.id);
    // ほかの画面を開いていたときに受け取った分は出さない（戻ったときに古い知らせを出さない）
    if (focused) setShown(received);
  }
  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => setShown(null), NOTICE_MS);
    return () => clearTimeout(t);
  }, [shown]);
  const message = shown ? receivedMessage(shown.counts) : null;
  const target = shown ? receivedTarget(shown.counts) : null;
  if (!shown || !message) return null;
  const open = () => {
    setShown(null);
    if (target?.kind === 'meals') router.navigate({ pathname: '/meals', params: { date: target.date } });
    else if (target) router.push({ pathname: '/workout', params: { date: target.date } });
  };
  return (
    <Animated.View
      key={shown.id}
      entering={reduced ? undefined : FadeInDown.duration(duration.enter).easing(easeOut).withInitialValues({ transform: [{ translateY: 16 }] })}
      // web（E2E）は消える動きに対応していないので付けない（components/motion.tsx の useListMotion と同じ）
      exiting={reduced || Platform.OS === 'web' ? undefined : FadeOut.duration(duration.exit).easing(easeIn)}
      style={{ position: 'absolute', left: space.screen, right: space.screen, bottom }}
    >
      <Snackbar message={message} action={target ? { label: '見る', onPress: open } : undefined} testID="received-notice" />
    </Animated.View>
  );
}

const s = StyleSheet.create({
  small: { backgroundColor: colors.input, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 10 },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.line, overflow: 'hidden', marginTop: 4 },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.accent },
  group: { backgroundColor: colors.input, borderRadius: radius.card, overflow: 'hidden' },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: space.l, paddingHorizontal: space.l, paddingVertical: space.m, minHeight: 72 },
  line: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  rowIcon: { width: 40, height: 40, borderRadius: radius.m, backgroundColor: colors.accentDark, alignItems: 'center', justifyContent: 'center' },
});
