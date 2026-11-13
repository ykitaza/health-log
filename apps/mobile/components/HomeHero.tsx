// ホームのヒーロー（刷新 A、Figma「スタディ：フェーズ」の 6・7）：輪の上にフェーズの 1 行、外の輪（フェーズの週。過ぎた週はミント）、
// 輪の中に 4 ページ LATEST → RECOVERY → INJURY（直している途中のケガがあるときだけ）→ GROWTH。計算は lib/homeHero.ts。
// - 横スワイプ（またはページの印を押す）で切り替える。最初のページはふだん LATEST、療養中は INJURY。前に見たページは覚えない
// - 見えているページだけを描く（3D の体はそのページに来たときに読み込み、2 つ同時には描かない）
// - 3D の体を回すのは輪の中の体の列の上だけ。それ以外の横スワイプはページの切り替え（縦のスクロール・引っぱって同期は止めない）
import { router } from 'expo-router';
import { ReactNode, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import type { Injury } from '@/db/repositories/injuries';
import { DateKey, formatJpDate, formatShortDate, WEEKDAY_EN, weekday } from '@/lib/date';
import { tonnes } from '@/lib/format';
import {
  GrowthCorners, HERO_PAGE_EN, HERO_PAGE_JA, HeroPage, HeroPhase, InjuryCorners, initialHeroPage, keepHeroPage, nextHeroPage, PhaseRing,
  phaseLine, PhaseRoute, RecoveryCorners, ringFooter, ringGap, ringSegment,
} from '@/lib/homeHero';
import type { LatestSession } from '@/lib/homeHud';
import { INJURY_RED, PartRecovery, recoveryColor } from '@/lib/recoveryMap';
import { claimsSwipe, dragOffset, rubberBand, SWIPE_CLAIM_DX, swipeDirection } from '@/lib/swipe';
import { fmt1, kgToUnit, WeightUnit } from '@/lib/units';
import { colors, hudColors, size, space } from '@/theme';
import { DayBody } from './DayBody';
import { DayBodyAttribution, DayBodyEntry } from './DayBody3D';
import { usePageSlide } from './DayPicker';
import { HeroBody } from './HeroBody';
import { Brackets } from './homeHud';
import { GrowthPage } from './home';
import { Mono } from './injuries';
import { PressableScale } from './motion';
import { T } from './Text';

export type HeroLatest = {
  session: LatestSession;
  entries: DayBodyEntry[];
  /** その日の部位（光らせる・塗る） */
  parts: string[];
  /** 自己ベストを更新した種目の名前 */
  prNames: string[];
};

/** ヒーローのページの中身（index.tsx が lib/homeHero.ts で作る） */
export type HeroData = {
  phase: HeroPhase;
  ring: PhaseRing | null;
  pages: HeroPage[];
  recovery: { list: PartRecovery[]; levels: Record<string, number>; corners: RecoveryCorners };
  injury: { fixing: Injury[]; numbers: Map<string, string>; corners: InjuryCorners };
  growth: GrowthCorners;
};

/** 四隅の数字の高さ（札はこの内側の上下に置く） */
const CORNER_H = 76;
/** 外の輪の太さ、内の輪の太さ */
const RING_W = 8;
const INNER_W = 4;

/** ヒーローの高さ：幅に合わせ、300〜380 */
const heroHeight = (w: number) => Math.round(Math.min(380, Math.max(300, w * 0.95)));
/** 3D の体を回す列（輪の中の体の上）の幅 */
const rotateColumn = (w: number) => {
  const c = Math.round(Math.min(160, w * 0.38));
  return { left: Math.round((w - c) / 2), width: c };
};

export function HomeHero({ today, unit, latest, ready, data }: {
  today: DateKey; unit: WeightUnit; latest: HeroLatest | null; ready: boolean; data: HeroData | null;
}) {
  // ユーザーが選んだページ（選ぶまでは、データが届くたびに決まりで選ぶ。療養中は INJURY）
  const [chosen, setChosen] = useState<HeroPage | null>(null);
  const pages = data?.pages ?? null;
  const page: HeroPage | null = !pages ? null : chosen ? keepHeroPage(chosen, pages) : initialHeroPage(pages, data!.phase.kind === 'rehab');
  const [w, setW] = useState(0);
  const h = heroHeight(w);
  const r = Math.min(w, h) / 2 - 12;
  const slide = usePageSlide();
  const latestRef = useRef({ page, pages, slide });
  useLayoutEffect(() => { latestRef.current = { page, pages, slide }; });
  // 横スワイプ：横の動きが十分大きく、縦の倍以上のときだけ受ける（縦のスクロール・引っぱって同期・押す操作はそのまま）。
  // 体の列の上でなぞり始めたら、3D の体が回す操作として受け、こちらには渡さない（bodyScene.ts）
  // eslint-disable-next-line react-hooks/refs -- ref は指の動きの中でだけ読む
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => latestRef.current.page != null && claimsSwipe(g.dx, g.dy),
    onPanResponderMove: (_, g) => {
      const l = latestRef.current;
      if (!l.page || !l.pages) return;
      const to = nextHeroPage(l.page, l.pages, g.dx < 0 ? 'next' : 'prev');
      l.slide.x.set(to ? dragOffset(g.dx, true) : rubberBand(g.dx - Math.sign(g.dx) * Math.min(Math.abs(g.dx), SWIPE_CLAIM_DX)));
    },
    onPanResponderRelease: (_, g) => {
      const l = latestRef.current;
      const d = swipeDirection(g.dx, g.dy);
      const to = d && l.page && l.pages ? nextHeroPage(l.page, l.pages, d) : null;
      if (!d || !to) { l.slide.back(); return; }
      l.slide.go(d, () => setChosen(to));
    },
    onPanResponderTerminate: () => latestRef.current.slide.back(),
    onPanResponderTerminationRequest: () => false,
  }).panHandlers, []);
  const anim = useAnimatedStyle(() => ({ transform: [{ translateX: slide.x.get() }] }));
  const pick = (to: HeroPage) => {
    if (!page || !pages || to === page) return;
    slide.go(pages.indexOf(to) > pages.indexOf(page) ? 'next' : 'prev', () => setChosen(to));
  };
  const line = data ? phaseLine(data.phase) : null;
  const footer = data ? ringFooter(data.phase) : null;
  const band = { top: CORNER_H, bottom: h - CORNER_H };
  const rotate = rotateColumn(w);

  return (
    <View testID="home-hero">
      <PressableScale
        accessibilityRole="button" accessibilityLabel={line?.spoken ?? 'フェーズ'} scaleTo={0.97} disabled={!line}
        onPress={() => { if (line) router.push(line.route); }} style={s.phaseLine} testID="hero-phase"
      >
        <Mono size={11} color={colors.accent}>{line?.text ?? ' '}</Mono>
      </PressableScale>
      <View style={[s.stage, { height: h }]} onLayout={(e) => setW(e.nativeEvent.layout.width)} {...pan} testID="hero-swipe">
        {w > 0 && (
          <>
            <Ring width={w} height={h} r={r} ring={data?.ring ?? null} inner={page === 'growth'} />
            <Brackets size={14} />
            <Animated.View style={[StyleSheet.absoluteFill, anim]} pointerEvents="box-none">
              {page === 'latest' && <LatestPage width={w} height={h} today={today} unit={unit} latest={latest} ready={ready} rotate={rotate} />}
              {page === 'recovery' && data && (
                <RecoveryPage width={w} height={h} band={band} rotate={rotate} data={data} />
              )}
              {page === 'injury' && data && (
                <InjuryPage width={w} height={h} band={band} rotate={rotate} data={data} />
              )}
              {page === 'growth' && data && (
                <GrowthPage today={today} width={w} height={h} box={Math.round(r * 1.3)}>
                  <GrowthCornersView c={data.growth} unit={unit} route={phaseLine(data.phase).route} />
                </GrowthPage>
              )}
            </Animated.View>
          </>
        )}
      </View>
      {/* 輪の下の 1 行（輪とページの印の間） */}
      {footer && (
        <View style={s.footer} pointerEvents="none">
          <T size={12} color={colors.sub} testID="hero-ring-footer">{footer}</T>
        </View>
      )}
      <View style={s.pager} testID="hero-pages">
        {(pages ?? ['latest' as const]).map((p) => {
          const on = p === page;
          return (
            <PressableScale
              key={p} accessibilityRole="tab" aria-selected={on} accessibilityLabel={HERO_PAGE_JA[p]}
              scaleTo={0.9} onPress={() => pick(p)} style={s.pageTab} testID={`hero-page-${p}`}
            >
              <View style={[s.pageDash, { backgroundColor: on ? colors.accent : colors.outline, width: on ? 20 : 6 }]} />
            </PressableScale>
          );
        })}
        {page && pages && (
          <View style={s.pageLabel} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
            <Mono size={11} color={colors.sub}>{`${String(pages.indexOf(page) + 1).padStart(2, '0')}/${String(pages.length).padStart(2, '0')} ${HERO_PAGE_EN[page]}`}</Mono>
          </View>
        )}
      </View>
      {(page === 'latest' || page === 'recovery' || page === 'injury') && DayBodyAttribution && <DayBodyAttribution />}
    </View>
  );
}

const arcPath = (cx: number, cy: number, rr: number, a0: number, a1: number) => {
  const p = (a: number) => `${cx + rr * Math.cos(a)},${cy + rr * Math.sin(a)}`;
  return `M${p(a0)}A${rr},${rr} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p(a1)}`;
};

/**
 * 外の輪：フェーズの週の区切り（過ぎた週はミント、今の週は濃いミント、これからは灰色。療養で止めているあいだは過ぎた週も灰色）と目盛り。
 * フェーズがなければ灰色の枠だけ（16 の区切り）。inner（GROWTH）なら内の輪（主な指標の進み）と白い線（予定の位置）も描く
 */
function Ring({ width, height, r, ring, inner }: { width: number; height: number; r: number; ring: PhaseRing | null; inner: boolean }) {
  const cx = width / 2, cy = height / 2;
  const weeks = ring?.weeks ?? 16;
  const step = (2 * Math.PI) / weeks;
  const gap = ringGap(weeks);
  const color = (i: number) => {
    const k = ringSegment(ring, i);
    if (k === 'todo') return hudColors.ring;
    if (ring?.paused) return colors.outline;
    return k === 'done' ? colors.accent : colors.accentMuted;
  };
  const ri = r - RING_W - 10;
  const top = -Math.PI / 2;
  const showInner = inner && ring != null;
  const at = (k: number) => top + k * 2 * Math.PI;
  return (
    <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none" testID="hero-ring">
      {Array.from({ length: weeks }, (_, i) => (
        <Path key={i} d={arcPath(cx, cy, r - RING_W / 2, top + i * step + gap, top + (i + 1) * step - gap)} stroke={color(i)} strokeWidth={RING_W} fill="none" />
      ))}
      {Array.from({ length: 48 }, (_, i) => {
        const a = (i / 48) * 2 * Math.PI;
        const r0 = r + 4, r1 = r + (i % 3 === 0 ? 10 : 7);
        return <Line key={`t${i}`} x1={cx + r0 * Math.cos(a)} y1={cy + r0 * Math.sin(a)} x2={cx + r1 * Math.cos(a)} y2={cy + r1 * Math.sin(a)} stroke={colors.line} strokeWidth={1} />;
      })}
      {showInner && (
        <>
          <Circle cx={cx} cy={cy} r={ri} stroke={hudColors.ring} strokeWidth={INNER_W} fill="none" />
          {ring.inner != null && ring.inner > 0 && (
            ring.inner >= 0.999
              ? <Circle cx={cx} cy={cy} r={ri} stroke={colors.accent} strokeWidth={INNER_W} fill="none" />
              : <Path d={arcPath(cx, cy, ri, top, at(ring.inner))} stroke={colors.accent} strokeWidth={INNER_W} fill="none" testID="hero-ring-inner" />
          )}
          {ring.plan != null && (
            <Line
              x1={cx + (ri - 9) * Math.cos(at(ring.plan))} y1={cy + (ri - 9) * Math.sin(at(ring.plan))}
              x2={cx + (ri + 9) * Math.cos(at(ring.plan))} y2={cy + (ri + 9) * Math.sin(at(ring.plan))}
              stroke={colors.text} strokeWidth={2} testID="hero-ring-plan"
            />
          )}
        </>
      )}
    </Svg>
  );
}

/** 値の文字の大きさ：日本語の長い部位名（「右肩の関節」）でも四隅に収める */
function valueSize(v: string): number {
  const n = [...v].length;
  if (/[^\x20-\x7E]/.test(v)) return n <= 2 ? 34 : n <= 3 ? 28 : n <= 4 ? 22 : 18;
  return n <= 5 ? 34 : 26;
}

/** 四隅の数字：英字のラベル・大きな数字・小さな補足。align は寄せる側 */
function Corner({ label, value, sub, align, labelColor = colors.accent, valueColor = colors.text, subColor }: {
  label: string; value: string; sub?: string; align: 'left' | 'right'; labelColor?: string; valueColor?: string; subColor?: string;
}) {
  const fs = valueSize(value);
  return (
    <View style={{ alignItems: align === 'left' ? 'flex-start' : 'flex-end' }}>
      <Mono size={11} color={labelColor}>{label}</Mono>
      <T num bold size={fs} color={valueColor} numberOfLines={1} style={{ lineHeight: Math.round(fs * 1.12) }}>{value}</T>
      {sub ? <Mono size={11} color={subColor}>{sub}</Mono> : null}
    </View>
  );
}

/** 四隅の置き場所（読み上げは、ページのまとめの文で読む） */
function Corners({ children }: { children: [ReactNode, ReactNode, ReactNode, ReactNode] }) {
  const pos = [{ left: 0, top: 0 }, { right: 0, top: 0 }, { left: 0, bottom: 0, justifyContent: 'flex-end' as const }, { right: 0, bottom: 0, justifyContent: 'flex-end' as const }];
  return (
    <>
      {children.map((c, i) => c != null && (
        <View key={i} style={[s.corner, pos[i]]} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>{c}</View>
      ))}
    </>
  );
}

/**
 * 体の列の外に重ねる面（3D のページすべて）。その日の体（DayBody）の 3D と Canvas はヒーロー全面で指を受けるので、列の外に指が届かないように
 * 何もしない面を重ね、そこからの横スワイプをページの切り替えに回す（DayBody の部品は変えない）
 */
function SwipeShield({ width, rotate }: { width: number; rotate: { left: number; width: number } }) {
  return (
    <>
      <View collapsable={false} style={[s.shield, { left: 0, width: rotate.left }]} />
      <View collapsable={false} style={[s.shield, { left: rotate.left + rotate.width, width: width - rotate.left - rotate.width }]} />
    </>
  );
}

const PR_EN: Record<string, string> = { ベンチプレス: 'BENCH', スクワット: 'SQUAT', デッドリフト: 'DEAD' };

/**
 * LATEST：直近のトレーニング（今日までのいちばん新しい日）の体と種目の札。四隅に日付（今日なら TODAY）・種目の数（セット数）・
 * 合計負荷量・自己ベストの数。左上を押すとその日の記録。Android は 3D の体、web と 3D が描けないときは 2D の図（前と後ろ）
 */
function LatestPage({ width, height, today, unit, latest, ready, rotate }: {
  width: number; height: number; today: DateKey; unit: WeightUnit; latest: HeroLatest | null; ready: boolean; rotate: { left: number; width: number };
}) {
  const band = { top: CORNER_H, bottom: height - CORNER_H };
  const ss = latest?.session ?? null;
  const entries = latest?.entries ?? [];
  const parts = latest?.parts ?? [];
  const isToday = ss?.date === today;
  const spoken = !ready ? '直近のトレーニング'
    : !ss ? '直近のトレーニング。まだ記録がありません'
    : [
      `直近のトレーニング ${isToday ? '今日' : formatJpDate(ss.date)}`,
      `${ss.exercises}種目 ${ss.sets}セット ${tonnes(ss.volumeKg, unit)}${unit === 'kg' ? 'トン' : '千ポンド'}`,
      ss.prs.length > 0 ? `自己ベスト ${ss.prs.length}（${latest!.prNames.join('、')}）` : '',
      entries.map((e) => `${e.no} ${e.name} ${e.set}`).join('、'),
      'その日の記録を開く',
    ].filter(Boolean).join('。');
  const open = () => { if (ss) router.push({ pathname: '/workout', params: { date: ss.date } }); };
  const prSub = latest && latest.prNames.length > 0 ? PR_EN[latest.prNames[0]] ?? 'BEST' : undefined;
  return (
    <>
      <DayBody width={width} height={height} entries={entries} parts={parts} band={band} />
      <SwipeShield width={width} rotate={rotate} />
      <PressableScale accessibilityRole="button" accessibilityLabel={spoken} scaleTo={0.97} onPress={open} disabled={!ss} style={[s.corner, { left: 0, top: 0 }]} testID="home-latest">
        <Corner align="left" label="LATEST //" value={!ss ? '—' : isToday ? 'TODAY' : formatShortDate(ss.date)} sub={ss ? WEEKDAY_EN[weekday(ss.date)] : ready ? 'NO LOG' : undefined} />
      </PressableScale>
      <View style={[s.corner, { right: 0, top: 0 }]} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden testID="home-latest-ex">
        <Corner align="right" label="EX //" value={ss ? String(ss.exercises) : '—'} sub={ss ? `SETS ${ss.sets}` : undefined} />
      </View>
      <View style={[s.corner, { left: 0, bottom: 0, justifyContent: 'flex-end' }]} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden testID="home-latest-load">
        <Corner align="left" label="LOAD" value={ss ? `${tonnes(ss.volumeKg, unit)}${unit === 'kg' ? 't' : 'k'}` : '—'} sub="TOTAL" />
      </View>
      <View style={[s.corner, { right: 0, bottom: 0, justifyContent: 'flex-end' }]} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden testID="home-latest-pr">
        <Corner align="right" label="PR //" value={ss ? String(ss.prs.length) : '—'} sub={prSub} />
      </View>
    </>
  );
}

type BodyPageProps = { width: number; height: number; band: { top: number; bottom: number }; rotate: { left: number; width: number }; data: HeroData };

/** RECOVERY：3D の体を回復の色で塗る（からだのタブの回復マップと同じ）。四隅に READY・NEXT・RECOVERING・INJURY */
function RecoveryPage({ width, height, band, rotate, data }: BodyPageProps) {
  const c = data.recovery.corners;
  const rec = c.recovering;
  const spoken = [
    `回復。回復済み ${c.ready}部位（${c.total}部位のうち）`,
    c.next ? `次の部位 ${c.next}` : '',
    rec ? `回復中 ${rec.name} あと${rec.remaining}日${rec.more > 0 ? `、ほか${rec.more}部位` : ''}` : '回復中の部位はありません',
    c.injuries > 0 ? `直している途中のケガ ${c.injuries}件` : '',
  ].filter(Boolean).join('。');
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <HeroBody kind="recovery" width={width} height={height} band={band} list={data.recovery.list} levels={data.recovery.levels}
        injuries={data.injury.fixing} numbers={data.injury.numbers} rotate={rotate} />
      <SwipeShield width={width} rotate={rotate} />
      <PressableScale accessibilityRole="button" accessibilityLabel={`${spoken}。回復マップを開く`} scaleTo={0.97} style={[s.corner, { left: 0, top: 0 }]}
        testID="hero-recovery" onPress={() => router.navigate('/body')}>
        <Corner align="left" label="READY //" value={String(c.ready)} sub={`/ ${c.total} PARTS`} />
      </PressableScale>
      <Corners>
        {null}
        <Corner align="right" label="NEXT //" value={c.next ?? '—'} sub={c.next ? 'RECOVERED' : undefined} />
        <Corner align="left" label="RECOVERING" value={rec?.name ?? '—'} valueColor={rec ? recoveryColor(rec.level) : colors.text}
          sub={rec ? `${rec.remaining}D LEFT${rec.more > 0 ? ` +${rec.more}` : ''}` : 'ALL READY'} />
        <Corner align="right" label="INJURY" labelColor={c.injuries > 0 ? INJURY_RED : colors.accent} value={String(c.injuries)}
          valueColor={c.injuries > 0 ? INJURY_RED : colors.text} sub="FIXING" />
      </Corners>
    </View>
  );
}

/** INJURY：3D の体にケガの部位と札（ケガの画面と同じ形、赤）。四隅に INJURY・FIX・SINCE・ALERT */
function InjuryPage({ width, height, band, rotate, data }: BodyPageProps) {
  const c = data.injury.corners;
  const spoken = [
    `ケガ。直している途中 ${c.count}件`,
    c.fix ? `直している部位 ${c.fix.label}${c.fix.review ? `、最後の振り返り ${formatJpDate(c.fix.review.date)}` : '、振り返りはまだ'}` : '',
    c.since ? `${formatJpDate(c.since.date)}から ${c.since.day}日目` : '',
    c.alert > 0 ? `振り返りが1週間以上ないケガ ${c.alert}件` : '',
    'ケガの一覧を開く',
  ].filter(Boolean).join('。');
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <HeroBody kind="injury" width={width} height={height} band={band} list={data.recovery.list} levels={{}}
        injuries={data.injury.fixing} numbers={data.injury.numbers} rotate={rotate} />
      <SwipeShield width={width} rotate={rotate} />
      <PressableScale accessibilityRole="button" accessibilityLabel={spoken} scaleTo={0.97} style={[s.corner, { left: 0, top: 0 }]} testID="hero-injury"
        onPress={() => router.navigate({ pathname: '/training', params: { view: 'injury' } })}>
        <Corner align="left" label="INJURY //" labelColor={INJURY_RED} value={String(c.count)} valueColor={INJURY_RED} sub="ACTIVE" />
      </PressableScale>
      <View style={[s.corner, { right: 0, top: 0 }]} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Corner align="right" label="FIX //" value={c.fix?.label ?? '—'} sub={c.fix ? (c.fix.review ? `${formatShortDate(c.fix.review.date)} ${c.fix.review.mark}` : 'NO REVIEW') : undefined} />
      </View>
      <View style={[s.corner, { left: 0, bottom: 0, justifyContent: 'flex-end' }]} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Corner align="left" label="SINCE" value={c.since ? formatShortDate(c.since.date) : '—'} sub={c.since ? `DAY ${String(c.since.day).padStart(2, '0')}` : undefined} />
      </View>
      <View style={[s.corner, { right: 0, bottom: 0, justifyContent: 'flex-end' }]} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Corner align="right" label="ALERT" labelColor={c.alert > 0 ? INJURY_RED : colors.accent} value={c.alert > 0 ? `▲ ${c.alert}` : '0'}
          valueColor={c.alert > 0 ? INJURY_RED : colors.text} sub="REVIEW" />
      </View>
    </View>
  );
}

/** GROWTH の四隅のうち PHASE・PACE・WEIGHT（SCORE は GrowthPage が出す） */
function GrowthCornersView({ c, unit, route }: { c: GrowthCorners; unit: WeightUnit; route: PhaseRoute }) {
  const u = (kg: number) => fmt1(kgToUnit(kg, unit));
  const spoken = [
    c.phase ? `フェーズ ${c.phase.value}` : 'フェーズは未設定',
    c.pace ? `ペース ${c.pace.value ?? '判定なし'}` : '',
    `体重 週平均 ${c.weekAvgKg != null ? `${u(c.weekAvgKg)}${unit}` : 'まだ'}${c.goalKg != null ? `、目標 ${u(c.goalKg)}${unit}` : ''}`,
  ].filter(Boolean).join('。');
  return (
    <>
      <PressableScale accessibilityRole="button" accessibilityLabel={`${spoken}。${route === '/phase' ? 'フェーズの進み具合を開く' : 'フェーズを始める'}`}
        scaleTo={0.97} style={[s.corner, { left: 0, top: 0 }]} testID="hero-growth" onPress={() => router.push(route)}>
        <Corner align="left" label="PHASE //" value={c.phase?.value ?? '—'} sub={c.phase?.sub ?? 'NO PHASE'} />
      </PressableScale>
      <View style={[s.corner, { right: 0, top: 0 }]} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Corner align="right" label="PACE //" value={c.pace?.value ?? '—'} sub={c.pace?.sub ?? 'NO DATA'} />
      </View>
      <View style={[s.corner, { left: 0, bottom: 0, justifyContent: 'flex-end' }]} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Corner align="left" label="WEIGHT" value={c.weekAvgKg != null ? u(c.weekAvgKg) : '—'} sub={c.goalKg != null ? `→ ${u(c.goalKg)} ${unit.toUpperCase()}` : 'NO GOAL'} />
      </View>
    </>
  );
}

const s = StyleSheet.create({
  phaseLine: { minHeight: size.touch, alignItems: 'center', justifyContent: 'center', marginTop: -space.s, marginBottom: -space.s },
  stage: { overflow: 'hidden' },
  corner: { position: 'absolute', minWidth: size.touch, minHeight: size.touch, padding: space.s },
  shield: { position: 'absolute', top: 0, bottom: 0 },
  footer: { alignItems: 'center', marginTop: space.xs },
  pager: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  pageTab: { minHeight: size.touch, minWidth: 28, alignItems: 'center', justifyContent: 'center' },
  pageDash: { height: 3, borderRadius: 2 },
  pageLabel: { marginLeft: space.s },
});
