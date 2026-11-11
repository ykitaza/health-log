import { router, useIsFocused } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  cancelAnimation, Easing, FadeIn, FadeOut, SharedValue, useAnimatedReaction, useReducedMotion, useSharedValue, withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { GrowthShape } from '@/components/growth/GrowthShape';
import { PauseMark, TimelineBar, TotalsLine, useDayGesture, useLivePos } from '@/components/growth/player';
import { LoadError } from '@/components/LoadError';
import { easeIn, easeOut } from '@/components/motion';
import { Screen } from '@/components/Screen';
import { T } from '@/components/Text';
import { ShapePickerSheet } from '@/components/growth/ShapePickerSheet';
import { Button, Chip, IconButton } from '@/components/ui';
import { syncStore } from '@/db/repositories/sync';
import { useGrowthData } from '@/hooks/data';
import { useGrowthShape } from '@/hooks/growthShape';
import { useToday } from '@/hooks/today';
import { DateKey, daysBetween } from '@/lib/date';
import { firstRecordDate, GrowthParams, growthSeries, highlights, pickSubtitles } from '@/lib/growth';
import {
  canPlay, dateAt, DAY_UPDATE_MS, dayIndexAt, EMPTY_PARAMS, formatFullDate, highlightsInRange, lastPosition, lerpParams,
  remainingMs, scrubberLabels, seekIndexAtX, showsTimelapseHint, subtitleOn, subtitlePassed, TIMELAPSE_HINT_KEY, TIMELAPSE_HINT_TEXT,
} from '@/lib/growthPlayer';
import { growthShapeLabel } from '@/lib/shapes/labels';
import { colors, size, space } from '@/theme';
import { duration } from '@/theme/motion';

/** 再生中に形を回す速さ（止まっているときの何倍か） */
const PLAYING_SPIN = 2.5;
/** 字幕を出しておく長さ（ms）。出る 250ms のあと、これだけ出して 150ms で消える */
const SUBTITLE_MS = 2000;
const NO_SERIES: GrowthParams[] = [];

// 形の下の段の高さ（dp）。形の箱は、画面の高さからこれと上の行を引いた残り全部
/** 字幕（とヒント・案内の文）と「もう一度」の段 */
const CAPTION_H = 88;
/** DAY と日の数字 */
const DAY_H = 72;
/** 累計の1行 */
const TOTALS_H = 24;
/** 線の帯（48）と下の日付（帯に 8 重ねる） */
const TIMELINE_H = size.touch + 16 - space.s;
/** いちばん下の余白（この下はシステムのジェスチャーの帯。Screen が safe area の分を空ける） */
const BOTTOM_PAD = space.s;
const BELOW_SHAPE_H = CAPTION_H + DAY_H + TOTALS_H + TIMELINE_H + BOTTOM_PAD;
/** 形の箱の高さの下限（小さい画面・横向き） */
const MIN_SHAPE_H = 160;

/**
 * 成長を見る：最初の記録の日から今日までの「記録で育つ形」の育ち方を、タイムラプスのように再生する。
 * 画面のどこかを1回押すと再生と一時停止、左右になぞると日を移す（左右の端から始まる指は、Android の「戻る」のために使わない）。
 * 形の値は再生の位置（日の番号の小数）から UI スレッドで毎フレーム決める（React は描き直さない）。
 * 日の数字・日付は日が変わったときだけ描き直し（間引く）、下の累計は表示の値が本当の値を追いかけて数え上がる
 */
export default function GrowthScreen() {
  const today = useToday();
  const { data, error, reload } = useGrowthData(today);
  const reduced = useReducedMotion();
  const { width, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const shapeHeight = Math.max(MIN_SHAPE_H, windowHeight - insets.top - insets.bottom - size.topBar - BELOW_SHAPE_H);

  const model = useMemo(() => {
    if (!data) return null;
    const series = growthSeries(data.days, data.today);
    const start = firstRecordDate(data.days, data.today);
    const all = highlights({
      today: data.today, sets: data.sets, days: data.days, exerciseNames: data.exerciseNames, big3: data.big3,
      weights: data.weights, goalWeightKg: data.goalWeightKg, weeklyGoals: data.weeklyGoals, unit: data.weightUnit,
    });
    return { series, start, items: highlightsInRange(all, start, data.today), unit: data.weightUnit };
  }, [data]);
  const series = model?.series ?? NO_SERIES;
  const n = series.length;
  const span = lastPosition(n);
  const start = model?.start ?? null;

  const [playing, setPlaying] = useState(false);
  // 自分で止めた（タップ・なぞる・点・形を選ぶ・画面が隠れた）。一時停止の印を出す。終わりまで再生して止まったときは false
  const [held, setHeld] = useState(false);
  const [index, setIndex] = useState(0);
  const [subtitle, setSubtitle] = useState<{ id: number; text: string } | null>(null);
  const [hint, setHint] = useState(false);
  const picked = useMemo(
    () => (start == null || !model ? { subtitles: [], markDates: [] } : pickSubtitles(model.items, n, 1, start)),
    [model, n, start],
  );
  // 下の線に点を置く日の番号
  const marks = useMemo(() => (start == null ? [] : picked.markDates.map((d) => daysBetween(start, d))), [picked, start]);

  // 再生の位置（UI スレッド）と、そこから決めた形の値
  const pos = useSharedValue(0);
  const params = useSharedValue<GrowthParams>(EMPTY_PARAMS);
  const playingSV = useSharedValue(false);
  const lastSent = useSharedValue(-1);
  const lastAt = useSharedValue(0);
  // 指の操作や UI スレッドからの知らせの中で読む、いまの値（描き直しを待たない）
  const playingRef = useRef(false);
  const indexRef = useRef(0);
  const subId = useRef(0);

  const showSubtitle = useCallback((text: string) => {
    subId.current += 1;
    setSubtitle({ id: subId.current, text });
  }, []);

  // 初回のヒント：端末に置いた印を読むまでは、見せたことにしておく（読む前に出して、2回目にも出さないように）
  const db = useSQLiteContext();
  const store = useMemo(() => syncStore(db), [db]);
  const hintSeen = useRef(true);
  const touched = useRef(false);
  useEffect(() => {
    let alive = true;
    void store.getMeta(TIMELAPSE_HINT_KEY).catch(() => '1').then((v) => {
      if (alive) hintSeen.current = v != null;
    });
    return () => { alive = false; };
  }, [store]);
  /** タップで止めたとき・終わったときに呼ぶ。出すなら出して、端末に印を置く */
  const maybeHint = useCallback(() => {
    if (!showsTimelapseHint(hintSeen.current, touched.current)) return;
    hintSeen.current = true;
    setHint(true);
    void store.setMeta(TIMELAPSE_HINT_KEY, '1').catch(() => {});
  }, [store]);
  /** 画面を触った。ヒントを出す前なら、もう出さない。出ていれば消す */
  const touch = () => {
    touched.current = true;
    setHint(false);
  };

  // UI スレッドから、出す日が変わったとき・再生が止まったときに呼ばれる
  const onDayRef = useRef((_i: number, _finished: boolean) => {});
  useLayoutEffect(() => {
    onDayRef.current = (i, finished) => {
      const prev = indexRef.current;
      indexRef.current = i;
      setIndex(i);
      // 再生で通った日の字幕（日の描き直しを間引いても、通った日の分を拾う）
      if (playingRef.current && start != null) {
        const sub = subtitlePassed(picked.subtitles, start, prev, i);
        if (sub) showSubtitle(sub.text);
      }
      if (finished) {
        playingRef.current = false;
        playingSV.set(false);
        setPlaying(false);
        maybeHint();
      }
    };
  });
  const onDay = useCallback((i: number, finished: boolean) => onDayRef.current(i, finished), []);

  useAnimatedReaction(() => pos.get(), (p) => {
    params.set(lerpParams(series, p));
    const i = dayIndexAt(p, n);
    if (i === lastSent.get()) return;
    // 再生中は描き直しを間引く（最後の日は必ず出す）
    const now = Date.now();
    if (playingSV.get() && i !== n - 1 && now - lastAt.get() < DAY_UPDATE_MS) return;
    lastSent.set(i);
    lastAt.set(now);
    scheduleOnRN(onDay, i, false);
  }, [series, n]);

  /** from（日の番号）から今日まで、等速で再生する */
  const startPlayback = useCallback((from: number) => {
    playingRef.current = true;
    playingSV.set(true);
    setPlaying(true);
    setHeld(false);
    setHint(false);
    pos.set(from);
    pos.set(withTiming(span, { duration: remainingMs(from, n), easing: Easing.linear }, (finished) => {
      // 止めたとき（finished が false）も、間引いて出していなかった日を出す
      const i = dayIndexAt(pos.get(), n);
      lastSent.set(i);
      scheduleOnRN(onDay, i, finished === true);
    }));
  }, [pos, playingSV, lastSent, onDay, span, n]);

  const pause = useCallback(() => {
    playingRef.current = false;
    playingSV.set(false);
    setPlaying(false);
    setHeld(true);
    cancelAnimation(pos);
  }, [pos, playingSV]);

  /** その日へ移って止まる（なぞる・点を押す・読み上げのスライダー）。日が変わったら、その日のハイライトを字幕に出す */
  const goTo = (i: number) => {
    if (start == null || !model) return;
    touch();
    pause();
    pos.set(i);
    const prev = indexRef.current;
    indexRef.current = i;
    setIndex(i);
    if (i === prev) return;
    const h = subtitleOn(model.items, dateAt(start, i));
    if (h) showSubtitle(h.text);
  };

  const playable = canPlay(n, reduced);
  /** 1回押す：再生 ↔ 一時停止。終わり（今日）で押したら最初から。動きを減らす設定・記録が2日未満なら何もしない */
  const togglePlay = () => {
    if (!playable) return;
    if (playingRef.current) {
      pause();
      maybeHint();
      touched.current = true;
      return;
    }
    touch();
    // 終わり（今日）なら、最初からもう一度
    const from = indexRef.current >= span ? 0 : pos.get();
    if (from === 0) indexRef.current = -1;
    startPlayback(from);
  };
  const replay = () => {
    touch();
    indexRef.current = -1;
    startPlayback(0);
  };

  // 開いたら、最初の日から自動で再生する。動きを減らす設定なら再生せず、今日の姿を出す
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !model) return;
    started.current = true;
    if (canPlay(model.series.length, reduced)) {
      indexRef.current = -1;
      startPlayback(0);
    } else {
      const last = lastPosition(model.series.length);
      pos.set(last);
      indexRef.current = last;
      setIndex(last);
    }
  }, [model, reduced, startPlayback, pos]);

  // 画面が見えていない・アプリが後ろのときは、再生を止めて形も回さない
  const focused = useIsFocused();
  const [appActive, setAppActive] = useState(AppState.currentState !== 'background');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);
  const visible = focused && appActive;
  useEffect(() => {
    if (!visible && playingRef.current) pause();
  }, [visible, pause]);
  useEffect(() => () => cancelAnimation(pos), [pos]);

  // 字幕は 2秒ほど出して消す（再生は止めない）
  useEffect(() => {
    if (!subtitle) return;
    const t = setTimeout(() => setSubtitle(null), duration.enter + SUBTITLE_MS);
    return () => clearTimeout(t);
  }, [subtitle]);

  // 形を選ぶ：再生中なら一時停止してから、下からシートを出す
  const { shape, setShape } = useGrowthShape();
  const [picking, setPicking] = useState(false);
  const openPicker = () => {
    touch();
    if (playingRef.current) pause();
    setPicking(true);
  };

  const empty = n === 0;
  const currentIndex = () => dayIndexAt(pos.get(), n);
  // 画面全体の指の操作（ボタン・線の帯は自分で先に受け取る）
  const gesture = useDayGesture({
    disabled: empty, edges: true, screenWidth: width, dayCount: n, currentIndex, onTap: togglePlay, onSeek: goTo,
  });

  // 左上に「戻る」、右上に「形を選ぶ」
  const header = (
    <View style={s.header}>
      <IconButton name="back" label="戻る" onPress={() => router.back()} />
      <View style={{ paddingRight: 12 }}>
        <Chip label="形を選ぶ" onPress={openPicker} />
      </View>
      <ShapePickerSheet
        visible={picking} value={shape} onClose={() => setPicking(false)}
        onSelect={(kind) => { setShape(kind); setPicking(false); }}
      />
    </View>
  );
  if (error) return <Screen>{header}<LoadError onRetry={reload} /></Screen>;
  if (!model) return <Screen>{header}</Screen>;

  const i = Math.min(index, span);
  const date = start == null ? today : dateAt(start, i);
  const dayNumber = empty ? 0 : i + 1;
  const motionOn = !reduced;
  const ended = playable && !playing && i >= span;
  const caption = empty ? '記録を始めると、ここから育ちます' : subtitle?.text ?? (hint && !playing ? TIMELAPSE_HINT_TEXT : null);

  return (
    <Screen scroll={false}>
      <View style={s.root} {...gesture}>
        {header}
        {/* 計算した高さが実際より大きいときは、下の段を押し出さずに箱を縮めて切る */}
        <View style={[s.shapeBox, { height: shapeHeight }]}>
          {/* 形を変えたら作り直す（形ごとに点の数がちがう） */}
          {shape != null && (
            <GrowthShape
              key={shape} shape={shape} params={params} width={width} height={shapeHeight} paused={!visible} spin={playing ? PLAYING_SPIN : 1}
              accessibilityLabel={growthShapeLabel(shape, dayNumber)}
            />
          )}
          {held && !ended && playable && <PauseMark motion={motionOn} />}
          {/* 読み上げ用の再生・一時停止のボタン（見た目はなく、指の操作は通す。指では画面のどこかを1回押す） */}
          {playable && !ended && (
            <View
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
              accessible
              accessibilityRole="button"
              accessibilityLabel={playing ? '一時停止' : '再生'}
              accessibilityActions={[{ name: 'activate' }]}
              onAccessibilityAction={togglePlay}
              testID="growth-toggle"
            />
          )}
        </View>

        <View style={s.caption}>
          <View style={s.captionText} accessibilityLiveRegion="polite" testID="growth-subtitle">
            {caption != null && (
              <Animated.View
                key={subtitle?.id ?? caption}
                entering={motionOn ? FadeIn.duration(duration.enter).easing(easeOut) : undefined}
                // web（E2E）は消える動きに対応していないので付けない（components/motion.tsx の useListMotion と同じ）
                exiting={motionOn && Platform.OS !== 'web' ? FadeOut.duration(duration.exit).easing(easeIn) : undefined}
              >
                <T variant={empty || subtitle ? 'bodyL' : 'bodyM'} color={SUBTITLE_COLOR} align="center" numberOfLines={1}>{caption}</T>
              </Animated.View>
            )}
          </View>
          {ended && <Button label="もう一度" icon="replay" variant="outline" small onPress={replay} />}
        </View>

        <DayReadout pos={pos} playing={playing} index={i} dayCount={n} start={start} today={today} />

        <View style={s.totalsRow}>
          <TotalsLine pos={pos} playing={playingSV} index={i} series={series} unit={model.unit} running={visible} instant={reduced} />
        </View>

        <TimelineBar
          pos={pos} dayCount={n} index={i} disabled={empty || n < 2}
          markIndexes={marks}
          labels={scrubberLabels(start, today)} screenWidth={width} currentIndex={currentIndex}
          onPressAt={(x, w) => goTo(seekIndexAtX(x, w, n, marks))}
          onSeek={goTo}
          valueText={`DAY ${dayNumber}、${formatFullDate(date)}`}
        />
      </View>
    </Screen>
  );
}

type LiveProps = { pos: SharedValue<number>; playing: boolean; /** 止まっているときに出す日の番号 */ index: number };

/** DAY の数字と日付。再生中は、再生の位置にそのまま合わせる（この部品だけが描き直される） */
function DayReadout({ pos, playing, index, dayCount, start, today }: LiveProps & { dayCount: number; start: DateKey | null; today: DateKey }) {
  const live = useLivePos(pos, playing);
  const i = live == null ? index : dayIndexAt(live, dayCount);
  const date = start == null ? today : dateAt(start, i);
  const dayNumber = dayCount === 0 ? 0 : i + 1;
  return (
    <View style={s.day} accessible accessibilityLabel={`DAY ${dayNumber}、${formatFullDate(date)}`} testID="growth-day">
      <T variant="labelS" color={colors.sub}>DAY</T>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.m }}>
        <T variant="numDisplay">{dayNumber}</T>
        <T variant="bodyM" color={colors.sub}>{formatFullDate(date)}</T>
      </View>
    </View>
  );
}

/** 字幕の色（白の約7割の濃さ。地に対して 4.5:1 以上） */
const SUBTITLE_COLOR = 'rgba(243,245,247,0.7)';

const s = StyleSheet.create({
  // 画面全体で指を受けるため、左右の余白の外（画面の端）まで広げる
  root: { flex: 1, marginHorizontal: -space.screen, paddingHorizontal: space.screen },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: size.topBar, marginHorizontal: -12 },
  shapeBox: { marginHorizontal: -space.screen, flexShrink: 1, overflow: 'hidden', justifyContent: 'center' },
  caption: { height: CAPTION_H, alignItems: 'center', justifyContent: 'flex-end', gap: space.s },
  captionText: { minHeight: 24, justifyContent: 'center' },
  day: { height: DAY_H, justifyContent: 'flex-end' },
  totalsRow: { height: TOTALS_H, justifyContent: 'center' },
});
