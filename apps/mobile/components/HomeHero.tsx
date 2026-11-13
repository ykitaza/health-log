// ホームのヒーロー（刷新 A、Figma「スタディ：フェーズ」の 6・7）：輪の枠の中に、LATEST（直近のトレーニングの体と種目の札）か GROWTH（育つ形）。
// ページは下の切り替えで選ぶ（横スライドと RECOVERY・INJURY のページ、外の 16 週の輪の中身とフェーズの 1 行は、フェーズのデータが入る次の PR で足す）。
// 開くたびに LATEST から（前に見たページは覚えない）。見えているページだけを描く（3D の体と育つ形を同時に描かない）
import { router } from 'expo-router';
import { ReactNode, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { DateKey, formatJpDate, formatShortDate, WEEKDAY_EN, weekday } from '@/lib/date';
import { layoutCallouts, PlacedCallout } from '@/lib/dayCallouts';
import { tonnes } from '@/lib/format';
import type { LatestSession } from '@/lib/homeHud';
import { musclesForParts, MuscleView } from '@/lib/muscleFigure';
import type { WeightUnit } from '@/lib/units';
import { colors, hudColors, size, space } from '@/theme';
import { Brackets } from './homeHud';
import { GrowthPage } from './home';
import { HeroAttribution, HeroBody3D, HeroEntry } from './HeroBody3D';
import { HeroTag, HERO_TAG_H, HERO_TAG_W, MoreTag } from './heroTag';
import { Mono } from './injuries';
import { PressableScale } from './motion';
import { MuscleFigure } from './MuscleFigure';
import { T } from './Text';

export type HeroLatest = {
  session: LatestSession;
  entries: HeroEntry[];
  /** その日の部位（光らせる・塗る） */
  parts: string[];
  /** 自己ベストを更新した種目の名前 */
  prNames: string[];
};

type Page = 'latest' | 'growth';
const PAGES: { key: Page; label: string }[] = [{ key: 'latest', label: 'LATEST' }, { key: 'growth', label: 'GROWTH' }];

/** 四隅の数字の高さ（札はこの内側の上下に置く） */
const CORNER_H = 76;
/** 輪の太さと、16 週の区切り */
const RING_W = 8;
const RING_SEGMENTS = 16;

/** ヒーローの高さ：幅に合わせ、300〜380 */
const heroHeight = (w: number) => Math.round(Math.min(380, Math.max(300, w * 0.95)));

export function HomeHero({ today, unit, latest, ready }: { today: DateKey; unit: WeightUnit; latest: HeroLatest | null; ready: boolean }) {
  const [page, setPage] = useState<Page>('latest');
  const [w, setW] = useState(0);
  const h = heroHeight(w);
  const r = Math.min(w, h) / 2 - 12;
  return (
    <View testID="home-hero">
      <View style={{ height: h, marginTop: space.s }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
        {w > 0 && (
          <>
            <Ring width={w} height={h} r={r} />
            <Brackets size={14} />
            {page === 'latest'
              ? <LatestPage width={w} height={h} today={today} unit={unit} latest={latest} ready={ready} />
              : <GrowthPage today={today} width={w} height={h} box={Math.round(r * 1.3)} />}
          </>
        )}
      </View>
      <View style={s.pager} testID="hero-pages">
        {PAGES.map((p, i) => {
          const on = p.key === page;
          return (
            <PressableScale
              key={p.key} accessibilityRole="tab" aria-selected={on} accessibilityLabel={p.key === 'latest' ? '直近のトレーニング' : '成長の形'}
              scaleTo={0.96} onPress={() => setPage(p.key)} style={s.pageTab} testID={`hero-page-${p.key}`}
            >
              <View style={[s.pageDash, { backgroundColor: on ? colors.accent : colors.line, width: on ? 20 : 8 }]} />
              <Mono size={11} color={on ? colors.accent : colors.sub}>{`${String(i + 1).padStart(2, '0')} ${p.label}`}</Mono>
            </PressableScale>
          );
        })}
      </View>
      {page === 'latest' && HeroAttribution && <HeroAttribution />}
    </View>
  );
}

/** 外の輪の枠（16 週の区切りと目盛り）。中身（フェーズの進み）は次の PR で塗る。今は空の灰色 */
function Ring({ width, height, r }: { width: number; height: number; r: number }) {
  const cx = width / 2, cy = height / 2;
  const arc = (a0: number, a1: number, rr: number) => {
    const p = (a: number) => `${cx + rr * Math.cos(a)},${cy + rr * Math.sin(a)}`;
    return `M${p(a0)}A${rr},${rr} 0 0 1 ${p(a1)}`;
  };
  const step = (2 * Math.PI) / RING_SEGMENTS;
  const gap = 0.05;
  return (
    <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
      {Array.from({ length: RING_SEGMENTS }, (_, i) => {
        const a0 = -Math.PI / 2 + i * step + gap, a1 = -Math.PI / 2 + (i + 1) * step - gap;
        return <Path key={i} d={arc(a0, a1, r - RING_W / 2)} stroke={hudColors.ring} strokeWidth={RING_W} fill="none" />;
      })}
      {Array.from({ length: 48 }, (_, i) => {
        const a = (i / 48) * 2 * Math.PI;
        const r0 = r + 4, r1 = r + (i % 3 === 0 ? 10 : 7);
        return <Line key={`t${i}`} x1={cx + r0 * Math.cos(a)} y1={cy + r0 * Math.sin(a)} x2={cx + r1 * Math.cos(a)} y2={cy + r1 * Math.sin(a)} stroke={colors.line} strokeWidth={1} />;
      })}
    </Svg>
  );
}

/** 四隅の数字：英字のラベル・大きな数字・小さな補足。align は寄せる側 */
function Corner({ label, value, sub, align }: { label: string; value: string; sub?: string; align: 'left' | 'right' }) {
  return (
    <View style={{ alignItems: align === 'left' ? 'flex-start' : 'flex-end' }}>
      <Mono size={11} color={colors.accent}>{label}</Mono>
      <T num bold size={34} style={{ lineHeight: 38 }}>{value}</T>
      {sub ? <Mono size={11}>{sub}</Mono> : null}
    </View>
  );
}

const PR_EN: Record<string, string> = { ベンチプレス: 'BENCH', スクワット: 'SQUAT', デッドリフト: 'DEAD' };

/**
 * LATEST：直近のトレーニング（今日までのいちばん新しい日）の体と種目の札。四隅に日付（今日なら TODAY）・種目の数（セット数）・
 * 合計負荷量・自己ベストの数。左上を押すとその日の記録。Android は 3D の体、web と 3D が描けないときは 2D の図（前と後ろ）
 */
function LatestPage({ width, height, today, unit, latest, ready }: {
  width: number; height: number; today: DateKey; unit: WeightUnit; latest: HeroLatest | null; ready: boolean;
}) {
  const band = { top: CORNER_H, bottom: height - CORNER_H };
  const ss = latest?.session ?? null;
  const entries = latest?.entries ?? [];
  const parts = latest?.parts ?? [];
  const isToday = ss?.date === today;
  const fallback = <Figure2D width={width} band={band} entries={entries} parts={parts} />;
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
      {HeroBody3D ? <HeroBody3D width={width} height={height} entries={entries} parts={parts} band={band} fallback={fallback} /> : fallback}
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

const FIG_GAP = space.s;

/** 2D の図（前と後ろ）：その日の部位を緑で塗り、種目の札を引き出し線でつなぐ（並べ方は記録の画面と同じ lib/dayCallouts.ts） */
function Figure2D({ width, band, entries, parts }: { width: number; band: { top: number; bottom: number }; entries: HeroEntry[]; parts: string[] }) {
  const figH = Math.min(200, band.bottom - band.top);
  const figW = figH / 2;
  const scale = figH / 200;
  const frontX = (width - (figW * 2 + FIG_GAP)) / 2;
  const backX = frontX + figW + FIG_GAP;
  const tagW = Math.min(HERO_TAG_W, Math.max(0, frontX - 4));
  const layout = layoutCallouts(entries.map((e) => ({ key: e.key, no: e.no, part: e.part })), {
    figureHeight: figH, minHeight: figH, slot: HERO_TAG_H, gap: 4, perSide: 3,
  });
  const byKey = new Map(entries.map((e) => [e.key, e]));
  const toScreen = (view: MuscleView, p: { x: number; y: number }) => ({ x: (view === 'front' ? frontX : backX) + p.x * scale, y: band.top + p.y * scale });
  const lines = [...layout.left.map((c) => ({ c, x: tagW })), ...layout.right.map((c) => ({ c, x: width - tagW }))]
    .flatMap(({ c, x }) => (c.kind === 'entry' && c.anchor ? [{ key: c.key, x1: x, y1: band.top + c.top + HERO_TAG_H / 2, ...toScreen(c.anchor.view, c.anchor.point) }] : []));
  const paint = musclesForParts(parts);
  const tag = (c: PlacedCallout, side: 'left' | 'right'): ReactNode => {
    const style = { position: 'absolute', [side]: 0, top: band.top + c.top, width: tagW } as const;
    return c.kind === 'more'
      ? <MoreTag key={`more-${side}`} nos={c.nos} style={style} />
      : <HeroTag key={c.key} e={byKey.get(c.key)!} align={side === 'left' ? 'right' : 'left'} style={style} />;
  };
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" testID="hero-2d">
      {(['front', 'back'] as const).map((view) => (
        <View key={view} style={{ position: 'absolute', left: view === 'front' ? frontX : backX, top: band.top }}>
          <MuscleFigure view={view} paint={paint} paintColor={colors.accent} width={figW} height={figH} />
        </View>
      ))}
      <Svg width={width} height={band.bottom + CORNER_H} style={StyleSheet.absoluteFill}>
        {lines.map((l) => <Line key={l.key} x1={l.x1} y1={l.y1} x2={l.x} y2={l.y} stroke={colors.accent} strokeOpacity={0.7} strokeWidth={1} />)}
        {lines.map((l) => <Circle key={`d-${l.key}`} cx={l.x} cy={l.y} r={3} fill={colors.accent} stroke={colors.bg} strokeWidth={1} />)}
      </Svg>
      {layout.left.map((c) => tag(c, 'left'))}
      {layout.right.map((c) => tag(c, 'right'))}
    </View>
  );
}

const s = StyleSheet.create({
  corner: { position: 'absolute', minWidth: size.touch, minHeight: size.touch, padding: space.s },
  pager: { flexDirection: 'row', justifyContent: 'center', gap: space.s },
  pageTab: { minHeight: size.touch, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.s },
  pageDash: { height: 3 },
});
