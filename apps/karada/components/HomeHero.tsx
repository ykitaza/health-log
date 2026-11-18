// ホームのヒーロー（刷新 A、Figma「スタディ：フェーズ」の 6・7）：輪の上にフェーズの 1 行、外の輪（フェーズの週。過ぎた週はミント）、
// 輪の中に 2 ページ LATEST → INJURY（直している途中のケガがあるときだけ）。計算は lib/homeHero.ts。
// LATEST の体は回復の色（からだのタブの回復マップと同じ）で塗る。RECOVERY のページはやめた（2026-11-15 ユーザーの要望）。
// 体の下の「回復」「部位の量」の切り替えで、フェーズの 1 週間あたりのセット数の色（体のすぐ下の「部位の量」の一覧と同じ）にもできる（3D の Canvas は 1 つのまま。選んだものは端末に覚える）。
// 体の札は、色の見方に合わせる（lib/heroTags.ts）：回復は回復中の部位（今日どこを鍛えるか決める）、部位の量はフェーズで多くやった部位（やる気のため。セット数の多い順）を、多くても 3 つ。なければ札なし。体を押すと、その部位の札を足す。
// 部位の量のキャプションは、フェーズの名前と合計（「増量 8週で 61セット」）。体の色は 1 週間あたりの量の段のまま（合計だと、フェーズの終わりに近づくほど全部が同じ色になるため）
// 直近のトレーニング（種目）は、四隅の数字（日付・種目の数・合計負荷量・自己ベスト）と読み上げに残し、体の札には使わない
// - 横スワイプ（またはページの印を押す）で切り替える。最初のページはふだん LATEST、療養中は INJURY。前に見たページは覚えない
// - 見えているページだけを描く（3D の体はそのページに来たときに読み込み、2 つ同時には描かない）
// - 3D の体を回すのは輪の中の体の列の上だけ。それ以外の横スワイプはページの切り替え（縦のスクロール・引っぱって同期は止めない）
import { router } from 'expo-router';
import { ReactNode, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import Svg, { Line, Path } from 'react-native-svg';
import type { Injury } from '@/db/repositories/injuries';
import { useRepos } from '@/hooks/data';
import { DateKey, formatJpDate, formatShortDate, WEEKDAY_EN, WEEKDAY_JA, weekday } from '@/lib/date';
import { tonnes } from '@/lib/format';
import {
  HERO_PAGE_EN, HERO_PAGE_JA, HeroPage, HeroPhase, InjuryCorners, initialHeroPage, keepHeroPage, nextHeroPage, phaseHead, PhaseRing,
  phaseLine, ringFooter, ringSegment,
} from '@/lib/homeHero';
import type { LatestSession } from '@/lib/homeHud';
import { HERO_TAG_MAX, HERO_TAG_MAX_WITH_RECOVERED, recoveryCandidates, selectHeroTags, TagCandidate, pickByMesh, pickByNames, volumeCandidates } from '@/lib/heroTags';
import { MuscleView, partsAt } from '@/lib/muscleFigure';
import { HeroBodyMode, heroVolumeCaptionParts, heroVolumeGlow, heroVolumeLevels, heroVolumeSpoken, PhaseVolume, volumeMuscleLevels } from '@/lib/partVolume';
import { PHASE_TICKS } from '@/lib/phases';
import { INJURY_RED, muscleFills, PartRecovery } from '@/lib/recoveryMap';
import { claimsSwipe, dragOffset, rubberBand, SWIPE_CLAIM_DX, swipeDirection } from '@/lib/swipe';
import type { WeightUnit } from '@/lib/units';
import { bodyColors } from '@/lib/bodyColors';
import { colors, deco, hudColors, isHud, lbl, matteBody, recoveryPalette, size, space, stageColors } from '@/theme';
import { DayBody } from './DayBody';
import { DayBodyAttribution, DayBodyEntry } from './DayBody3D';
import { usePageSlide } from './DayPicker';
import { HeroBody } from './HeroBody';
import { Brackets } from './homeHud';
import { Mono } from './injuries';
import { volumeColor } from './PartVolumeCard';
import { PressableScale } from './motion';
import { T } from './Text';
import { Segmented } from './ui';

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
  /** 部位ごとの回復（LATEST の体の色）。levels は部品ごとの明るさ、idle は空いている部品（3D） */
  recovery: { list: PartRecovery[]; levels: Record<string, number>; idle: string[] };
  injury: { fixing: Injury[]; numbers: Map<string, string>; corners: InjuryCorners };
  /** フェーズの部位ごとのセット数と 1 週間あたり（体を部位の量の色にするとき。体の下の「部位の量」の一覧と同じ） */
  volume: PhaseVolume | null;
  /** 覚えていた体の色の見方 */
  bodyMode: HeroBodyMode;
};

/** 四隅の数字の高さ（札はこの内側の上下に置く） */
const CORNER_H = 76;
/** 外の輪の太さ */
const RING_W = 8;
/** 外の輪の目盛りどうしの間（ラジアン） */
const RING_GAP = 0.05;

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
  // 体の色の見方（選ぶまでは覚えていたもの。選んだら端末に覚える）
  const repos = useRepos();
  const [pickedMode, setPickedMode] = useState<HeroBodyMode | null>(null);
  const mode: HeroBodyMode = pickedMode ?? data?.bodyMode ?? 'recovery';
  const chooseMode = (m: HeroBodyMode) => {
    setPickedMode(m);
    repos.settings.setHeroBodyMode(m).catch(() => {});
  };
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
  const captionVolume = page === 'latest' && mode === 'volume' ? data?.volume ?? null : null;
  // 回復の色で塗るのは、回復マップに出る部位を一度でも鍛えたときだけ（まっさらなときに体じゅうを灰色にしない）
  const recovery = data && data.recovery.list.some((p) => p.last != null) ? data.recovery : null;

  if (!isHud) {
    // クラシック（紙の記録帳）：フェーズの行 → 紙の上の体と 16 の目盛り → 切り替えとページの行 → 帳の 1 行（四隅の数字を体の外へ下ろした）
    const latestCells = latestCorners({ latest, today, unit, ready, recovery, volume: data?.volume ?? null, mode });
    const injuryCells = page === 'injury' && data ? injuryPageCorners(data) : null;
    const head = data ? phaseHead(data.phase) : null;
    return (
      <View testID="home-hero">
        <PressableScale
          accessibilityRole="button" accessibilityLabel={line?.spoken ?? 'フェーズ'} scaleTo={0.98} disabled={!line}
          onPress={() => { if (line) router.push(line.route); }} style={c.phase} testID="hero-phase"
        >
          <View style={{ flexShrink: 1 }}>
            <T size={12} color={colors.sub}>{head?.kicker ?? ' '}</T>
            {head?.big != null
              ? (
                <View style={c.phaseBig}>
                  <T num bold size={48} style={{ lineHeight: 52 }}>{head.big}</T>
                  <T size={14} color={colors.sub}>{head.of}</T>
                </View>
              )
              : <T bold size={22} style={{ lineHeight: 30, marginTop: space.xs }} numberOfLines={1}>{head?.title ?? ' '}</T>}
          </View>
          <View style={{ alignItems: 'flex-end', flexShrink: 0, marginLeft: space.s }}>
            {head?.status ? <T bold size={14}>{head.status}</T> : null}
            {head?.sub ? <T size={12} color={colors.sub} testID="hero-ring-footer">{head.sub}</T> : null}
          </View>
        </PressableScale>
        <View style={[s.stage, c.stage, { height: h }]} onLayout={(e) => setW(e.nativeEvent.layout.width)} {...pan} testID="hero-swipe">
          {w > 0 && (
            <>
              <Ring width={w} height={h} r={r} ring={data?.ring ?? null} />
              <Animated.View style={[StyleSheet.absoluteFill, anim]} pointerEvents="box-none">
                {page === 'latest' && (
                  <LatestPage width={w} height={h} today={today} unit={unit} latest={latest} ready={ready} rotate={rotate}
                    recovery={recovery} injuries={data?.injury.fixing ?? NO_INJURIES} volume={data?.volume ?? null} mode={mode} onMode={chooseMode} />
                )}
                {page === 'injury' && data && (
                  <InjuryPage width={w} height={h} band={CLASSIC_BAND(h)} rotate={rotate} data={data} />
                )}
              </Animated.View>
            </>
          )}
        </View>
        {captionVolume && <VolumeCaption volume={captionVolume} />}
        <View style={c.modeRow}>
          {page === 'latest' && data?.volume ? (
            <View style={c.modeBox} testID="hero-body-mode">
              <Segmented<HeroBodyMode> options={BODY_MODES} value={mode} onChange={chooseMode} check={false} />
            </View>
          ) : <View />}
          <View style={c.pages} testID="hero-pages" accessibilityRole="tablist">
            {(pages ?? ['latest' as const]).map((p) => {
              const on = p === page;
              return (
                <PressableScale
                  key={p} accessibilityRole="tab" aria-selected={on} accessibilityLabel={HERO_PAGE_JA[p]}
                  scaleTo={0.94} onPress={() => pick(p)} style={c.pageTab} testID={`hero-page-${p}`}
                >
                  <T size={13} bold={on} color={on ? colors.text : colors.sub}>{PAGE_TAB[p]}</T>
                  <View style={[c.pageMark, { backgroundColor: on ? colors.text : 'transparent' }]} />
                </PressableScale>
              );
            })}
          </View>
        </View>
        <Ledger cells={injuryCells ?? latestCells} narrow={w > 0 && w < 380} />
        {(page === 'latest' || page === 'injury') && DayBodyAttribution && <DayBodyAttribution />}
      </View>
    );
  }

  return (
    <View testID="home-hero">
      <PressableScale
        accessibilityRole="button" accessibilityLabel={line?.spoken ?? 'フェーズ'} scaleTo={0.97} disabled={!line}
        onPress={() => { if (line) router.push(line.route); }} style={s.phaseLine} testID="hero-phase"
      >
        {deco.enLabels
          ? <Mono size={11} color={colors.accent}>{line?.text ?? ' '}</Mono>
          : <T size={13} color={colors.sub}>{line?.ja ?? ' '}</T>}
      </PressableScale>
      <View style={[s.stage, { height: h }]} onLayout={(e) => setW(e.nativeEvent.layout.width)} {...pan} testID="hero-swipe">
        {w > 0 && (
          <>
            <Ring width={w} height={h} r={r} ring={data?.ring ?? null} />
            <Brackets size={14} />
            <Animated.View style={[StyleSheet.absoluteFill, anim]} pointerEvents="box-none">
              {page === 'latest' && (
                <LatestPage width={w} height={h} today={today} unit={unit} latest={latest} ready={ready} rotate={rotate}
                  recovery={recovery} injuries={data?.injury.fixing ?? NO_INJURIES} volume={data?.volume ?? null} mode={mode} onMode={chooseMode} />
              )}
              {page === 'injury' && data && (
                <InjuryPage width={w} height={h} band={band} rotate={rotate} data={data} />
              )}
            </Animated.View>
          </>
        )}
      </View>
      {captionVolume && <VolumeCaption volume={captionVolume} />}
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
        {page && pages && deco.enLabels && (
          <View style={s.pageLabel} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
            <Mono size={11} color={colors.sub}>{`${String(pages.indexOf(page) + 1).padStart(2, '0')}/${String(pages.length).padStart(2, '0')} ${HERO_PAGE_EN[page]}`}</Mono>
          </View>
        )}
      </View>
      {(page === 'latest' || page === 'injury') && DayBodyAttribution && <DayBodyAttribution />}
    </View>
  );
}

const arcPath = (cx: number, cy: number, rr: number, a0: number, a1: number) => {
  const p = (a: number) => `${cx + rr * Math.cos(a)},${cy + rr * Math.sin(a)}`;
  return `M${p(a0)}A${rr},${rr} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p(a1)}`;
};

/**
 * 外の輪：フェーズの進み具合の 16 の目盛り（期間に比例して進む。8 週なら 1 週で 2 つ。過ぎた目盛りはミント、今の目盛りは濃いミント、
 * これからは灰色。療養で止めているあいだは過ぎた目盛りも灰色）と、外側の細かい刻み。
 * フェーズがなければ灰色の枠だけ。
 * クラシックは 16 の目盛りだけ（外側の刻みはやめる）で、今の週だけミント、過ぎた目盛りは入力欄の枠の灰色（Figma「ホーム（unslop 案）」）
 */
function Ring({ width, height, r, ring }: { width: number; height: number; r: number; ring: PhaseRing | null }) {
  const cx = width / 2, cy = height / 2;
  const step = (2 * Math.PI) / PHASE_TICKS;
  const gap = RING_GAP;
  const color = (i: number) => {
    const k = ringSegment(ring, i);
    if (k === 'todo') return hudColors.ring;
    if (ring?.paused) return colors.outline;
    if (!isHud) return k === 'done' ? colors.outline : colors.accent;
    return k === 'done' ? colors.accent : colors.accentMuted;
  };
  const top = -Math.PI / 2;
  return (
    <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none" testID="hero-ring">
      {Array.from({ length: PHASE_TICKS }, (_, i) => (
        <Path key={i} d={arcPath(cx, cy, r - RING_W / 2, top + i * step + gap, top + (i + 1) * step - gap)} stroke={color(i)} strokeWidth={RING_W} fill="none" />
      ))}
      {deco.brackets && Array.from({ length: 48 }, (_, i) => {
        const a = (i / 48) * 2 * Math.PI;
        const r0 = r + 4, r1 = r + (i % 3 === 0 ? 10 : 7);
        return <Line key={`t${i}`} x1={cx + r0 * Math.cos(a)} y1={cy + r0 * Math.sin(a)} x2={cx + r1 * Math.cos(a)} y2={cy + r1 * Math.sin(a)} stroke={colors.line} strokeWidth={1} />;
      })}
    </Svg>
  );
}

/** 値の文字の大きさ：日本語の長い部位名（「右肩の関節」）でも四隅に収める */
function valueSize(v: string): number {
  const n = [...v].length;
  if (/[^\x20-\x7E]/.test(v)) return n <= 2 ? 34 : n <= 3 ? 28 : n <= 4 ? 22 : 18;
  return n <= 5 ? 34 : 26;
}

/**
 * 四隅の数字：英字のラベル・大きな数字・小さな補足。align は寄せる側。
 * クラシックはラベルと補足を補足の色の日本語にし、英数字の数字は 32 にそろえる（Figma「ホーム（unslop 案）」）。ラベルの色（ケガの赤）はそのまま
 */
function Corner({ label, value, sub, align, labelColor = colors.accent, valueColor = colors.text, subColor }: {
  label: string; value: string; sub?: string; align: 'left' | 'right'; labelColor?: string; valueColor?: string; subColor?: string;
}) {
  if (!deco.enLabels) {
    // 英数字は 32 にそろえる。長い値（「12.50 t」）だけ、HUD と同じく小さくして輪の下の切り替えにかからないようにする
    const n = /[^\x20-\x7E]/.test(value) ? valueSize(value) : value.replace(/ /g, '').length <= 5 ? 32 : 26;
    const tone = labelColor === colors.accent ? colors.sub : labelColor;
    return (
      <View style={{ alignItems: align === 'left' ? 'flex-start' : 'flex-end' }}>
        <T size={12} color={tone} numberOfLines={1}>{label}</T>
        <T num size={n} color={valueColor} numberOfLines={1} style={{ lineHeight: Math.round(n * 1.15) }}>{value}</T>
        {sub ? <T size={12} color={subColor ?? colors.sub} numberOfLines={1}>{sub}</T> : null}
      </View>
    );
  }
  const fs = valueSize(value);
  return (
    <View style={{ alignItems: align === 'left' ? 'flex-start' : 'flex-end' }}>
      <Mono size={11} color={labelColor}>{label}</Mono>
      <T num bold size={fs} color={valueColor} numberOfLines={1} style={{ lineHeight: Math.round(fs * 1.12) }}>{value}</T>
      {sub ? <Mono size={11} color={subColor}>{sub}</Mono> : null}
    </View>
  );
}

/** 四隅の置き場所（左上・右上・左下・右下） */
const AT = {
  tl: { left: 0, top: 0 },
  tr: { right: 0, top: 0 },
  bl: { left: 0, bottom: 0, justifyContent: 'flex-end' as const },
  br: { right: 0, bottom: 0, justifyContent: 'flex-end' as const },
};

/** 押せる四隅（見た目は Corner。押せる大きさは 44dp 以上。label は読み上げ） */
function CornerButton({ at, label, onPress, disabled, testID, children }: {
  at: keyof typeof AT; label: string; onPress: () => void; disabled?: boolean; testID?: string; children: ReactNode;
}) {
  return (
    <PressableScale accessibilityRole="button" accessibilityLabel={label} scaleTo={0.97} onPress={onPress} disabled={disabled} style={[s.corner, AT[at]]} testID={testID}>
      {children}
    </PressableScale>
  );
}

/**
 * 体の列の外に重ねる面（3D のページすべて）。その日の体（DayBody）の 3D と Canvas はヒーロー全面で指を受けるので、列の外に指が届かないように
 * 何もしない面を重ね、そこからの横スワイプをページの切り替えに回す。体と札のあいだに重ねる（札はこの上で押せる。DayBody・HeroBody の shield）
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

/** 筋トレのタブの記録のその日（entry があれば、その種目のカードまでスクロール） */
const openTrainingDay = (date: DateKey, entry?: string | null) =>
  router.navigate({ pathname: '/training', params: entry ? { view: 'record', date, entry } : { view: 'record', date } });
const openInjuries = () => router.navigate({ pathname: '/training', params: { view: 'injury' } });
const openInjury = (id: string) => router.push(`/injuries/${id}`);

/** 体の色の見方の切り替え */
const BODY_MODES: { key: HeroBodyMode; label: string }[] = [{ key: 'recovery', label: '回復' }, { key: 'volume', label: '部位の量' }];

/** LATEST の体に部位の光（ミント）を重ねない（描くたびに新しい配列を渡さない） */
/** 部位の量の見出し（「増量 8週で 64セット」）：体の面の下の 1 行。長いと折り返す */
function VolumeCaption({ volume }: { volume: PhaseVolume }) {
  // 「〜で」と「80セット」を別の塊にして、塊ごとに折り返す（日本語は RN の折り返しの設定では言葉の途中で折れるため）。
  // 1 行に収まるときは、間に空白 1 つの 1 行（これまでと同じ見た目）
  const [head, sets] = heroVolumeCaptionParts(volume);
  return (
    <View style={s.captionRow} pointerEvents="none" testID="hero-body-caption">
      {isHud
        ? <><Mono size={11} color={colors.sub}>{head}</Mono><Mono size={11} color={colors.sub}>{` ${sets}`}</Mono></>
        : <><T size={12} color={colors.sub} style={s.captionText}>{head}</T><T size={12} color={colors.sub} style={s.captionText}>{` ${sets}`}</T></>}
    </View>
  );
}

const NO_PARTS: string[] = [];
const NO_INJURIES: Injury[] = [];

/** 押した所：3D の部品、2D の図の点のまわりの部位の名前 */
type BodyPick = { mesh: string } | { names: string[] } | null;

/**
 * LATEST：直近のトレーニング（今日までのいちばん新しい日）の四隅と、体。四隅に日付（今日なら TODAY）・種目の数（セット数）・
 * 合計負荷量・自己ベストの数。Android は 3D の体、web と 3D が描けないときは 2D の図（前と後ろ）。
 * 体は今日の時点の回復の色で塗る（回復済みは緑、回復中は暖色、空いている・まだは灰色、ケガは赤。からだのタブの回復マップと同じ）。
 * その日の部位をミントで光らせると緑のホログラムに緑が重なって分からない（2026-11-15 ユーザーの要望）。recovery が null（一度も鍛えていない）なら今までどおり。
 * 体の札は種目ではなく、色の見方に合わせた部位の札（lib/heroTags.ts。回復は「あと3日」、部位の量は「23セット」。押しても何も開かない）。体を押すと、その部位の札を足す。もう一度押す・ほかを押すと消える。
 * 四隅を押すと：日付・種目の数・合計負荷量はその日の記録、自己ベストは 1 種目ならその種目の推移、ほかは種目ごとの自己ベスト
 */
function LatestPage({ width, height, today, unit, latest, ready, rotate, recovery, injuries, volume, mode, onMode }: {
  width: number; height: number; today: DateKey; unit: WeightUnit; latest: HeroLatest | null; ready: boolean; rotate: { left: number; width: number };
  recovery: HeroData['recovery'] | null; injuries: Injury[]; volume: PhaseVolume | null; mode: HeroBodyMode; onMode: (m: HeroBodyMode) => void;
}) {
  const band = { top: CORNER_H, bottom: height - CORNER_H };
  const parts = latest?.parts ?? [];
  const fills = useMemo(() => (recovery ? muscleFills(recovery.list, recoveryPalette) : undefined), [recovery]);
  // 部位の量の色（フェーズの 1 週間あたりのセット数の段。データが届くまでは回復のまま）
  const byVolume = mode === 'volume' && volume != null;
  const volumeBody = useMemo(() => {
    if (!volume) return null;
    const { glow, idle } = heroVolumeGlow(heroVolumeLevels(volume));
    const muscles = Object.fromEntries(Object.entries(volumeMuscleLevels(volume)).map(([m, l]) => [m, volumeColor(l!)]));
    return { glow, idle, fills: muscles };
  }, [volume]);
  // 体の札：色の見方ごとの候補から、気にしたい部位（多くても 3 つ）と押した部位。押した所は色の見方を変えても残し、見方ごとに部位へ引き直す
  const [pick, setPick] = useState<BodyPick>(null);
  const cands = useMemo<TagCandidate[]>(
    () => (byVolume ? volumeCandidates(volume) : recovery ? recoveryCandidates(recovery.list) : []), [byVolume, volume, recovery],
  );
  const pickedKey = pick == null ? null : 'mesh' in pick ? pickByMesh(cands, pick.mesh) : pickByNames(cands, pick.names);
  const tags = useMemo<DayBodyEntry[]>(
    () => selectHeroTags(cands, pickedKey, HERO_TAG_MAX, byVolume ? HERO_TAG_MAX : HERO_TAG_MAX_WITH_RECOVERED).map((t, i) => ({ key: t.key, no: i + 1, name: t.main, set: t.sub, part: t.part, kicker: t.lead, stack: t.stack })),
    [cands, pickedKey, byVolume],
  );
  const onPickMesh = useCallback((mesh: string | null) => setPick(mesh ? { mesh } : null), []);
  const onPickPoint = useCallback((view: MuscleView, point: { x: number; y: number }) => {
    const names = partsAt(view, point);
    // 同じ部位をもう一度押したら消す
    setPick((cur) => {
      const key = pickByNames(cands, names);
      const curKey = cur == null ? null : 'mesh' in cur ? pickByMesh(cands, cur.mesh) : pickByNames(cands, cur.names);
      return key == null || key === curKey ? null : { names };
    });
  }, [cands]);
  const corners = latestCorners({ latest, today, unit, ready, recovery, volume, mode });
  return (
    <>
      <DayBody width={width} height={height} entries={tags} perSide={4} band={isHud ? band : CLASSIC_BAND(height)} ringR={Math.min(width, height) / 2 - 12} onPick={onPickMesh} onPickPoint={onPickPoint} shield={<SwipeShield width={width} rotate={rotate} />}
        {...(byVolume && volumeBody
          ? { parts: NO_PARTS, recovery: volumeBody.glow, idle: volumeBody.idle, injuries, fills: volumeBody.fills, levelColor: bodyColors.volume, idleColor: bodyColors.volume(0) }
          : recovery ? { parts: NO_PARTS, recovery: recovery.levels, idle: recovery.idle, injuries, fills } : { parts })} />
      {/* クラシックは、切り替えと四隅の数字を体の外（紙の帳）へ下ろす（HomeHero） */}
      {volume && isHud && (
        <View style={s.mode} pointerEvents="box-none" testID="hero-body-mode">
          <View style={s.modeBox}>
            <Segmented<HeroBodyMode> options={BODY_MODES} value={mode} onChange={onMode} check={false} />
          </View>
        </View>
      )}
      {isHud && corners.map((k) => (
        <CornerButton key={k.testID} at={k.at} label={k.label} onPress={k.onPress} disabled={k.disabled} testID={k.testID}>
          <Corner {...k.hud} />
        </CornerButton>
      ))}
    </>
  );
}

/** 四隅の数字の 1 つ：HUD は体の四隅（Corner）、クラシックは体の下の帳の 1 マス（Ledger）。押すと行き先へ */
type CornerSpec = {
  at: keyof typeof AT; testID: string; label: string; onPress: () => void; disabled?: boolean;
  hud: Parameters<typeof Corner>[0];
  ledger: LedgerCell;
};

/** 帳のマス：小さな見出し・大きな数字・小さな単位（クラシック） */
type LedgerCell = { label: string; labelParts?: string[]; value: string; unit?: string; labelColor?: string; valueColor?: string };

/**
 * 直近のトレーニングの四隅：日付（今日なら TODAY）・種目の数（セット数）・合計負荷量・自己ベストの数。
 * 押すと：日付・種目の数・合計負荷量はその日の記録、自己ベストは 1 種目ならその種目の推移、ほかは種目ごとの自己ベスト
 */
function latestCorners({ latest, today, unit, ready, recovery, volume, mode }: {
  latest: HeroLatest | null; today: DateKey; unit: WeightUnit; ready: boolean; recovery: HeroData['recovery'] | null; volume: PhaseVolume | null; mode: HeroBodyMode;
}): CornerSpec[] {
  const ss = latest?.session ?? null;
  const entries = latest?.entries ?? [];
  const isToday = ss?.date === today;
  const byVolume = mode === 'volume' && volume != null;
  const recovering = recovery?.list.filter((p) => p.remaining != null) ?? [];
  const spoken = !ready ? '直近のトレーニング'
    : !ss ? '直近のトレーニング。まだ記録がありません'
    : [
      `直近のトレーニング ${isToday ? '今日' : formatJpDate(ss.date)}`,
      `${ss.exercises}種目 ${ss.sets}セット ${tonnes(ss.volumeKg, unit)}${unit === 'kg' ? 'トン' : '千ポンド'}`,
      ss.prs.length > 0 ? `自己ベスト ${ss.prs.length}（${latest!.prNames.join('、')}）` : '',
      entries.map((e) => `${e.no} ${e.name} ${e.set}`).join('、'),
      byVolume ? heroVolumeSpoken(volume) : recovering.length > 0 ? `回復中 ${recovering.map((p) => `${p.name} あと${p.remaining}日`).join('、')}` : '',
      'その日の記録を開く',
    ].filter(Boolean).join('。');
  const open = () => { if (ss) openTrainingDay(ss.date); };
  // 自己ベスト：1 種目ならその種目の推移（推定1RM の折れ線）、0 か 2 種目以上なら推移の「種目ごとの自己ベスト」
  const onePr = ss?.prs.length === 1 ? ss.prs[0] : null;
  const openPr = () => router.navigate({ pathname: '/training', params: onePr ? { view: 'trend', exercise: onePr.exerciseId } : { view: 'trend', focus: 'best' } });
  const prSpoken = !ss ? '自己ベスト' : onePr ? `自己ベスト 1（${latest!.prNames[0]}）。${latest!.prNames[0]}の推移を開く`
    : `自己ベスト ${ss.prs.length}${ss.prs.length > 0 ? `（${latest!.prNames.join('、')}）` : ''}。種目ごとの自己ベストを開く`;
  const prSub = latest && latest.prNames.length > 0 ? PR_EN[latest.prNames[0]] ?? 'BEST' : undefined;
  const volumeText = ss ? `${tonnes(ss.volumeKg, unit)}${unit === 'kg' ? 'トン' : '千ポンド'}` : '';
  return [
    {
      at: 'tl', label: spoken, onPress: open, disabled: !ss, testID: 'home-latest',
      hud: {
        align: 'left', label: lbl('LATEST //', '直近'), value: !ss ? '—' : isToday ? lbl('TODAY', '今日') : formatShortDate(ss.date),
        sub: ss ? lbl(WEEKDAY_EN[weekday(ss.date)], `${WEEKDAY_JA[weekday(ss.date)]}曜`) : ready ? lbl('NO LOG', '記録なし') : undefined,
      },
      ledger: { label: '直近', value: !ss ? '—' : isToday ? '今日' : formatShortDate(ss.date), unit: ss ? `${WEEKDAY_JA[weekday(ss.date)]}曜` : ready ? '記録なし' : undefined },
    },
    {
      at: 'tr', label: ss ? `${ss.exercises}種目 ${ss.sets}セット。その日の記録を開く` : '種目の数', onPress: open, disabled: !ss, testID: 'home-latest-ex',
      hud: { align: 'right', label: deco.enLabels ? 'EX //' : ss ? `種目 · ${ss.sets}セット` : '種目', value: ss ? String(ss.exercises) : '—', sub: ss && deco.enLabels ? `SETS ${ss.sets}` : undefined },
      ledger: { label: ss ? `種目 · ${ss.sets}セット` : '種目', labelParts: ss ? ['種目 ·', `${ss.sets}セット`] : undefined, value: ss ? String(ss.exercises) : '—' },
    },
    {
      at: 'bl', label: ss ? `合計負荷量 ${volumeText}。その日の記録を開く` : '合計負荷量', onPress: open, disabled: !ss, testID: 'home-latest-load',
      hud: { align: 'left', label: lbl('LOAD', '合計負荷量'), value: ss ? `${tonnes(ss.volumeKg, unit)}${lbl('', ' ')}${unit === 'kg' ? 't' : 'k'}` : '—', sub: lbl('TOTAL', '') },
      ledger: { label: '合計負荷量', value: ss ? tonnes(ss.volumeKg, unit) : '—', unit: ss ? (unit === 'kg' ? 't' : 'k lb') : undefined },
    },
    {
      at: 'br', label: prSpoken, onPress: openPr, disabled: !ss, testID: 'home-latest-pr',
      hud: { align: 'right', label: lbl('PR //', '自己ベスト'), value: ss ? String(ss.prs.length) : '—', sub: deco.enLabels ? prSub : latest?.prNames[0] },
      ledger: { label: '自己ベスト', value: ss ? String(ss.prs.length) : '—', unit: latest?.prNames[0] },
    },
  ];
}

/** クラシックのページの切り替えの短い名前（Figma の「直近」「ケガ」。読み上げは HERO_PAGE_JA） */
const PAGE_TAB: Record<HeroPage, string> = { latest: '直近', injury: 'ケガ' };

/** クラシックの体の札を置ける高さ（四隅の数字は体の外なので、上の見出しの下から下の端まで） */
const CLASSIC_BAND = (h: number) => ({ top: 28, bottom: h - 8 });

/**
 * クラシックの帳の 1 行（Figma「クラシック（大胆版）」の直近の帳）：4 つのマスを罫で区切り、小さな見出し・大きな数字・小さな単位。
 * マスを押すと四隅と同じ行き先（読み上げも同じ）
 */
function Ledger({ cells, narrow }: { cells: CornerSpec[]; narrow: boolean }) {
  const big = narrow ? 26 : 30;
  return (
    <View style={c.ledger} testID="hero-ledger">
      {cells.map((k, i) => {
        const v = k.ledger;
        const ascii = !/[^\x20-\x7E]/.test(v.value);
        const size = ascii ? big : [...v.value].length <= 2 ? 22 : 14;
        return (
          <PressableScale
            key={k.testID} accessibilityRole="button" accessibilityLabel={k.label} scaleTo={0.97} onPress={k.onPress} disabled={k.disabled}
            style={[c.cell, i === 0 ? c.cellFirst : c.cellRule]} testID={k.testID}
          >
            {v.labelParts
              // 「種目 ·」と「20セット」を別の塊にして塊ごとに折り返す（数と単位の途中で折れない）。1 行に収まるときは空白 1 つの 1 行
              ? <View style={c.labelRow}>{v.labelParts.map((part, j) => <T key={j} size={12} color={v.labelColor ?? colors.sub}>{j < v.labelParts!.length - 1 ? `${part} ` : part}</T>)}</View>
              : <T size={12} color={v.labelColor ?? colors.sub} numberOfLines={2}>{v.label}</T>}
            <View style={c.cellValue}>
              <T num={ascii} bold={!ascii} size={size} color={v.valueColor ?? colors.text} numberOfLines={ascii ? 1 : 2} style={{ lineHeight: Math.round(size * 1.15), flexShrink: ascii ? 0 : 1 }}>{v.value}</T>
              {v.unit ? <T size={12} color={colors.sub} numberOfLines={2} style={{ flexShrink: 1 }}>{v.unit}</T> : null}
            </View>
          </PressableScale>
        );
      })}
    </View>
  );
}

type BodyPageProps = { width: number; height: number; band: { top: number; bottom: number }; rotate: { left: number; width: number }; data: HeroData };

/**
 * INJURY：3D の体にケガの部位と札（ケガの画面と同じ形、赤。札を押すとそのケガ）。四隅に INJURY・FIX・SINCE・ALERT。
 * 押すと：INJURY・ALERT はケガの一覧、FIX は直している部位のケガ、SINCE はいちばん古いケガ（療養中はフェーズの画面）
 */
function InjuryPage({ width, height, band, rotate, data }: BodyPageProps) {
  const c = data.injury.corners;
  const spoken = injurySpoken(c);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <HeroBody width={width} height={height} band={band}
        injuries={data.injury.fixing} numbers={data.injury.numbers} rotate={rotate} shield={<SwipeShield width={width} rotate={rotate} />} onPressInjury={openInjury} />
      {isHud && injuryPageCorners(data, spoken).map((k) => (
        <CornerButton key={k.testID} at={k.at} label={k.label} testID={k.testID} onPress={k.onPress}>
          <Corner {...k.hud} />
        </CornerButton>
      ))}
    </View>
  );
}

/** INJURY の読み上げ */
function injurySpoken(c: InjuryCorners) {
  return [
    `ケガ。直している途中 ${c.count}件`,
    c.fix ? `直している部位 ${c.fix.label}${c.fix.review ? `、最後の振り返り ${formatJpDate(c.fix.review.date)}` : '、振り返りはまだ'}` : '',
    c.since ? `${formatJpDate(c.since.date)}から ${c.since.day}日目` : '',
    c.alert > 0 ? `振り返りが1週間以上ないケガ ${c.alert}件` : '',
    'ケガの一覧を開く',
  ].filter(Boolean).join('。');
}

/** INJURY の四隅：INJURY・FIX・SINCE・ALERT（クラシックは帳の 1 行）。spoken は INJURY の読み上げ */
function injuryPageCorners(data: HeroData, spoken = injurySpoken(data.injury.corners)): CornerSpec[] {
  const c = data.injury.corners;
  const since = c.since;
  return [
    {
      at: 'tl', label: spoken, testID: 'hero-injury', onPress: openInjuries,
      hud: { align: 'left', label: lbl('INJURY //', 'ケガ'), labelColor: INJURY_RED, value: String(c.count), valueColor: INJURY_RED, sub: lbl('ACTIVE', '直している途中') },
      ledger: { label: 'ケガ', labelColor: INJURY_RED, value: String(c.count), valueColor: INJURY_RED, unit: '件' },
    },
    {
      at: 'tr', label: c.fix ? `直している部位 ${c.fix.label}。このケガを開く` : '直している部位はありません。ケガの一覧を開く', testID: 'hero-injury-fix',
      onPress: () => (c.fix ? openInjury(c.fix.id) : openInjuries()),
      hud: {
        align: 'right', label: lbl('FIX //', '直している部位'), value: c.fix?.label ?? '—',
        sub: c.fix ? (c.fix.review ? `${formatShortDate(c.fix.review.date)} ${c.fix.review.mark}` : lbl('NO REVIEW', '振り返りはまだ')) : undefined,
      },
      ledger: { label: '直している', value: c.fix?.label ?? '—' },
    },
    {
      at: 'bl', testID: 'hero-injury-since',
      label: !since ? 'いつから。ケガの一覧を開く' : `${formatJpDate(since.date)}から ${since.day}日目。${since.injuryId ? 'このケガを開く' : 'フェーズの進み具合を開く'}`,
      onPress: () => (since?.injuryId ? openInjury(since.injuryId) : since ? router.push('/phase') : openInjuries()),
      hud: {
        align: 'left', label: lbl('SINCE', 'いつから'), value: since ? formatShortDate(since.date) : '—',
        sub: since ? lbl(`DAY ${String(since.day).padStart(2, '0')}`, `${since.day}日目`) : undefined,
      },
      ledger: { label: 'いつから', value: since ? formatShortDate(since.date) : '—', unit: since ? `${since.day}日目` : undefined },
    },
    {
      at: 'br', label: `振り返りが1週間以上ないケガ ${c.alert}件。ケガの一覧を開く`, testID: 'hero-injury-alert', onPress: openInjuries,
      hud: {
        align: 'right', label: lbl('ALERT', '振り返りが遅れ'), labelColor: c.alert > 0 ? INJURY_RED : colors.accent, value: c.alert > 0 ? lbl(`▲ ${c.alert}`, String(c.alert)) : '0',
        valueColor: c.alert > 0 ? INJURY_RED : colors.text, sub: lbl('REVIEW', '1週間以上'),
      },
      ledger: { label: '振り返り遅れ', value: String(c.alert), valueColor: c.alert > 0 ? INJURY_RED : colors.text, unit: '件' },
    },
  ];
}

/** クラシックの形（紙の記録帳） */
const c = StyleSheet.create({
  phase: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', minHeight: size.touch, marginTop: space.l },
  phaseBig: { flexDirection: 'row', alignItems: 'baseline', gap: space.s },
  // 体の面：つや消しの体は紙の上にじかに立つ。ホログラムに戻したときは、体の面だけ暗い地にする（theme の stageColors）
  stage: matteBody ? { marginTop: space.l } : { marginTop: space.l, backgroundColor: stageColors.bg, borderRadius: 20 },
  modeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.m },
  modeBox: { width: 178 },
  pages: { flexDirection: 'row', gap: space.m },
  pageTab: { minHeight: size.touch, minWidth: size.touch - 8, alignItems: 'center', justifyContent: 'center', gap: 4 },
  pageMark: { height: 2, alignSelf: 'stretch' },
  ledger: { flexDirection: 'row', marginTop: space.l, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.line },
  cell: { flex: 1, minWidth: 0, minHeight: 78, paddingVertical: space.m, paddingHorizontal: space.s, justifyContent: 'space-between' },
  // 直近のマスは日付と曜日が並ぶので少し広く、紙の端にそろえる（Figma の直近の帳）
  cellFirst: { flex: 1.25, paddingLeft: 0 },
  cellRule: { borderLeftWidth: 1, borderLeftColor: colors.line },
  labelRow: { flexDirection: 'row', flexWrap: 'wrap' },
  cellValue: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
});

const s = StyleSheet.create({
  phaseLine: { minHeight: size.touch, alignItems: 'center', justifyContent: 'center', marginTop: -space.s, marginBottom: -space.s },
  stage: { overflow: 'hidden' },
  corner: { position: 'absolute', minWidth: size.touch, minHeight: size.touch, padding: space.s },
  shield: { position: 'absolute', top: 0, bottom: 0 },
  // 部位の量の見出しは体の面の外（輪の下）に出す。体の頭や輪の上の弧に重ならない。長いフェーズ名は折り返す
  captionRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', paddingHorizontal: space.l, marginTop: space.xs },
  captionText: { textAlign: 'center' },
  mode: { position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center' },
  modeBox: { width: 176 },
  footer: { alignItems: 'center', marginTop: space.xs },
  pager: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  pageTab: { minHeight: size.touch, minWidth: 28, alignItems: 'center', justifyContent: 'center' },
  pageDash: { height: 3, borderRadius: 2 },
  pageLabel: { marginLeft: space.s },
});
