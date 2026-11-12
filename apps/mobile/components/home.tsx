// ホームの部品：形の段、「記録する」のシート、取り込みの知らせ（今週やることは WeeklyTodo.tsx）
import { router, useIsFocused } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOut, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGrowthData } from '@/hooks/data';
import { useGrowthShape } from '@/hooks/growthShape';
import { useProfile } from '@/hooks/profile';
import { NOTICE_MS, useSync } from '@/hooks/sync';
import { DateKey, formatJpDate, formatMonthDay, MONTH_NAMES_EN } from '@/lib/date';
import type { GrowthScore } from '@/lib/growth';
import {
  GROWTH_SCORE_NOTE, homeGrowth, mealRecordTarget, scoreA11yLabel, scoreDiff, scoreDiffSpoken, scorePillars, scoreTotalText,
} from '@/lib/home';
import { HOME_ACCOUNT_LABEL } from '@/lib/profile';
import { DEFAULT_SHAPE, growthStageLabel } from '@/lib/shapes/labels';
import { Received, receivedMessage, receivedTarget } from '@/lib/sync/received';
import { colors, radius, size, space } from '@/theme';
import { duration } from '@/theme/motion';
import { Avatar } from './Avatar';
import { AI_RECORD_LABEL, useChatChooser } from './ChatSheet';
import { GrowthShape } from './growth/GrowthShape';
import { Icon, IconName } from './Icon';
import { CountToText } from './charts';
import { easeIn, easeOut, PressableScale, Sheet } from './motion';
import { T } from './Text';
import { SettingsButton, Snackbar } from './ui';

/** 形の段の高さ（ステータスバーの下まで含める） */
const STAGE_HEIGHT = 228;
/** 形の段の上の行（写真・月・歯車）と下の行（成長スコア・成長を見る）の高さ。押せる大きさ（48） */
const STAGE_ROW = size.touch;
/** 形の箱の下の端と、段の下の端のあいだ（形と軌道が下の行に重なりすぎないように） */
const SHAPE_BOTTOM_GAP = 8;

/** 左上のアカウントの写真の大きさ */
const AVATAR_SIZE = 40;

/** 成長を見る画面を開く */
const openGrowth = () => router.push('/growth');
/** アカウントの画面を開く */
const openAccount = () => router.push('/account');

/** 先週との差の色（上がった・下がった・同じ。向きは矢印と符号でも伝える） */
const diffColor = (dir: 'up' | 'down' | 'flat') => (dir === 'up' ? colors.accent : dir === 'down' ? colors.danger : colors.sub);

/**
 * ホームのいちばん上の「記録で育つ形」の段（高さ 228。ステータスバーの下まで含め、中身と一緒にスクロールする）。
 * 上の行：アカウントの写真（なければアプリのアイコン。押すとアカウントの画面）と、カレンダーの月の見出し、設定の歯車。まん中：形（押すと成長を見る画面）。
 * 下の行：成長スコア（押すと内訳のシート）と「成長を見る」。地は画面と同じ色なので、段の下の端はそのまま下の中身へつながる
 */
export function GrowthStage({ today, year, month }: { today: DateKey; year: number; month: number }) {
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const { data } = useGrowthData(today);
  const { shape } = useGrowthShape();
  const profile = useProfile();
  const [open, setOpen] = useState(false);
  const growth = useMemo(() => homeGrowth(data?.days ?? [], today, data?.weeklyTrainingGoal ?? null), [data, today]);
  const score = data ? growth.score : null;
  const diff = score ? scoreDiff(score.diffFromLastWeek) : null;
  // 形の箱：上の行の下から、段の下の端の少し上まで。幅は画面の左右の余白の内側
  const [shapeWidth, setShapeWidth] = useState(0);
  const shapeTop = insets.top + STAGE_ROW;
  const shapeHeight = Math.max(0, STAGE_HEIGHT - shapeTop - SHAPE_BOTTOM_GAP);
  return (
    <View
      style={[s.stage, { height: STAGE_HEIGHT }]} testID="growth-stage"
      onLayout={(e) => setShapeWidth(Math.max(0, e.nativeEvent.layout.width - space.screen * 2))}
    >
      <PressableScale
        accessibilityRole="button" accessibilityLabel={growthStageLabel(shape ?? DEFAULT_SHAPE)} scaleTo={0.98} onPress={openGrowth} testID="growth-shape"
        style={{ position: 'absolute', left: space.screen, top: shapeTop, width: shapeWidth, height: shapeHeight }}
      >
        {shapeWidth > 0 && shapeHeight > 0 && shape != null && (
          // 形を変えたら作り直す（形ごとに点の数がちがう）
          <GrowthShape key={shape} shape={shape} params={growth.params} sats={growth.sats} width={shapeWidth} height={shapeHeight} paused={!focused} />
        )}
      </PressableScale>
      <View style={[s.stageRow, { marginTop: insets.top }]} pointerEvents="box-none">
        <PressableScale
          accessibilityRole="button" accessibilityLabel={HOME_ACCOUNT_LABEL} scaleTo={0.92} onPress={openAccount}
          style={s.account} testID="home-account"
        >
          <Avatar uri={profile.photoUri} size={AVATAR_SIZE} />
        </PressableScale>
        <T num bold size={28} accessibilityRole="header" numberOfLines={1} style={{ flex: 1 }}>{MONTH_NAMES_EN[month - 1]} {year}</T>
        <View style={{ marginRight: -12 }}><SettingsButton /></View>
      </View>
      <View style={[s.stageRow, { position: 'absolute', left: 0, right: 0, bottom: 0, justifyContent: 'space-between' }]} pointerEvents="box-none">
        <PressableScale
          accessibilityRole="button" accessibilityLabel={scoreA11yLabel(score)} scaleTo={0.96} onPress={() => setOpen(true)} style={s.score} testID="growth-score"
        >
          {/* 数え上げる（点が出せないときは「—」） */}
          <CountToText value={score ? score.total : null} format={(v) => (v == null ? '—' : String(Math.round(v)))} num bold size={28} />
          <View>
            <T variant="labelS" bold={false} color={colors.sub}>成長スコア</T>
            {diff && <T variant="labelS" color={diffColor(diff.dir)}>{diff.text}</T>}
          </View>
        </PressableScale>
        <PressableScale accessibilityRole="button" accessibilityLabel="成長を見る" scaleTo={0.96} onPress={openGrowth} style={s.growthLink} testID="growth-link">
          <T variant="labelM" color={colors.accent}>成長を見る ›</T>
        </PressableScale>
      </View>
      <GrowthScoreSheet visible={open} score={score} onClose={() => setOpen(false)} />
    </View>
  );
}

/** 成長スコアの内訳（下から出るシート）：柱ごとの 点／満点、合計、先週との差、計算のひとこと */
function GrowthScoreSheet({ visible, score, onClose }: { visible: boolean; score: GrowthScore | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const diff = score ? scoreDiff(score.diffFromLastWeek) : null;
  const total = scoreTotalText(score);
  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={{ padding: space.l, paddingBottom: space.l + insets.bottom, gap: space.m }} testID="growth-score-sheet">
        <View style={{ gap: space.xs }}>
          <T variant="titleL" accessibilityRole="header">成長スコア</T>
          <T variant="bodyM" color={colors.sub}>直近7日</T>
        </View>
        <View style={s.group}>
          {scorePillars(score).map((p, i) => (
            <View key={p.key} style={[s.scoreRow, i > 0 && s.line]} accessible accessibilityLabel={p.label} testID={`growth-score-${p.key}`}>
              <T variant="bodyL">{p.name}</T>
              <T num bold size={20}>{p.text}</T>
            </View>
          ))}
          <View style={[s.scoreRow, s.line]} accessible accessibilityLabel={score ? `合計 ${score.total}点、100点満点` : '合計 まだ記録がありません'} testID="growth-score-total">
            <T variant="titleM">合計</T>
            <T num bold size={20}>{total}</T>
          </View>
          {score && diff && (
            <View style={[s.scoreRow, s.line]} accessible accessibilityLabel={scoreDiffSpoken(score.diffFromLastWeek) ?? undefined} testID="growth-score-week">
              <T variant="bodyL">先週との差</T>
              <T variant="labelL" color={diffColor(diff.dir)}>{diff.text}</T>
            </View>
          )}
        </View>
        <T variant="bodyM" color={colors.sub}>{GROWTH_SCORE_NOTE}</T>
      </View>
    </Sheet>
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
  group: { backgroundColor: colors.input, borderRadius: radius.card, overflow: 'hidden' },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: space.l, paddingHorizontal: space.l, paddingVertical: space.m, minHeight: 72 },
  line: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  rowIcon: { width: 40, height: 40, borderRadius: radius.m, backgroundColor: colors.accentDark, alignItems: 'center', justifyContent: 'center' },
  scoreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.l, paddingHorizontal: space.l, minHeight: 56 },
  // 画面の左右の余白（Screen の paddingHorizontal）の外まで広げる
  stage: { marginHorizontal: -space.screen, backgroundColor: colors.bg },
  stageRow: { flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: STAGE_ROW, paddingHorizontal: space.screen },
  // 押せる大きさは 48。写真（40）の左の端を、画面の左の余白（16）にそろえる
  account: { width: size.touch, height: size.touch, alignItems: 'center', justifyContent: 'center', marginLeft: -(size.touch - AVATAR_SIZE) / 2 },
  score: { flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: size.touch, minWidth: size.touch },
  growthLink: { minHeight: size.touch, justifyContent: 'center', paddingLeft: space.s },
});
