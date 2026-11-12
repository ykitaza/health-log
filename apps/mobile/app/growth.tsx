import { router, useIsFocused } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  cancelAnimation, Easing, FadeIn, FadeOut, interpolate, SharedValue, useAnimatedReaction, useAnimatedScrollHandler, useAnimatedStyle,
  useDerivedValue, useReducedMotion, useSharedValue, withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { GrowthShape } from '@/components/growth/GrowthShape';
import { FormulaReadout, PauseMark, TimelineBar, TotalsLine, useDayGesture, useLivePos } from '@/components/growth/player';
import { GrowthRecords, RECORDS_HEAD_OFFSET } from '@/components/growth/records';
import { LoadError } from '@/components/LoadError';
import { easeIn, easeOut } from '@/components/motion';
import { Screen } from '@/components/Screen';
import { T } from '@/components/Text';
import { ShapePickerSheet } from '@/components/growth/ShapePickerSheet';
import { Chip, IconButton } from '@/components/ui';
import { syncStore } from '@/db/repositories/sync';
import { useGrowthData } from '@/hooks/data';
import { useGrowthShape } from '@/hooks/growthShape';
import { useToday } from '@/hooks/today';
import { DateKey, daysBetween } from '@/lib/date';
import { firstRecordDate, GrowthParams, growthSeries, highlights, pickSubtitles } from '@/lib/growth';
import {
  canPlay, dateAt, DAY_UPDATE_MS, dayIndexAt, EMPTY_PARAMS, formatFullDate, highlightsInRange, lastPosition, lerpParams,
  remainingMs, scrubberLabels, seekIndexAtX, showsTimelapseHint, subtitleOn, subtitlePassed, REPLAY_TEXT, TIMELAPSE_HINT_KEY, TIMELAPSE_HINT_TEXT,
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

// 下の「成長の記録」へのスクロール（Figma 成長 11-1〜11-3）。1画面目＝タイムラプス、その下にカード
/** 止まったとき、DAY から線までの段を上げる量（dp）。空いた所に「↑ 成長の記録」と①のカードの頭がのぞく */
const PEEK_SHIFT = 72;
/** 「↑ 成長の記録」の行の高さ（線の下。カードの頭はこの下から） */
const HINT_SPACE = 24;
/** カードがこの割合（1画面の高さに対して）までスクロールしたら、再生を止めて形を回すのも止める */
const COVER_RATIO = 0.5;
/** 1画面分スクロールしたときの、後ろの形（Figma 11-2：不透明度 0.5・ぼかし 6・上へ約 0.22 画面） */
const BG_MIN_OPACITY = 0.5;
const BG_MAX_BLUR = 6;
const BG_SHIFT_RATIO = 0.22;
/** 下の段（字幕・DAY・累計・線）が消えきるスクロール（1画面の高さに対して） */
const ROWS_FADE_RATIO = 0.3;
/** 「成長の記録」の見出しが出始める・出きるスクロール（1画面の高さに対して）。下の段が消えてから出す（止まったときは線に重なるため） */
const HEADING_FROM_RATIO = 0.3;
const HEADING_TO_RATIO = 0.45;
/** 上のバーの地の濃さ（1画面分スクロールしたとき。画面の色の 92%） */
const BAR_MAX_OPACITY = 0.92;
/** 動きを減らす設定で、後ろの形を最後の姿に切り替えるスクロール（1画面の高さに対して） */
const REDUCED_SWITCH_RATIO = 0.25;

/**
 * 成長を見る：最初の記録の日から今日までの「記録で育つ形」の育ち方を、タイムラプスのように再生する。
 * 画面のどこかを1回押すと再生と一時停止、左右になぞると日を移す（左右の端から始まる指は、Android の「戻る」のために使わない）。
 * 形の値は再生の位置（日の番号の小数）から UI スレッドで毎フレーム決める（React は描き直さない）。
 * 日の数字・日付は日が変わったときだけ描き直し（間引く）、下の累計は表示の値が本当の値を追いかけて数え上がる。
 * 1画面目の下に「成長の記録」のカード（components/growth/records.tsx）。上にスクロールするとカードがせり上がり、形は暗く・ぼけて背景に残る。
 * カードが半分ほど上がったら再生を止める。再生中は下の手がかり（「↑ 成長の記録」と①の頭）を隠し、止まったらのぞかせる
 */
export default function GrowthScreen() {
  const today = useToday();
  const { data, error, reload } = useGrowthData(today);
  const reduced = useReducedMotion();
  const { width, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // 1画面目の高さ＝スクロールの枠の高さ（測るまでは画面の大きさから見積もる）
  const [measured, setMeasured] = useState<number | null>(null);
  const pageH = measured ?? windowHeight - insets.top - insets.bottom;
  const shapeHeight = Math.max(MIN_SHAPE_H, pageH - size.topBar - BELOW_SHAPE_H);

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
  // 開いて最初の再生を始めた（それまでは、下の手がかりを出さない）
  const [begun, setBegun] = useState(false);
  // カードが上がって、形を背景に回した（再生と回転を止める）
  const [covered, setCovered] = useState(false);
  // 横になぞっているあいだは、縦のスクロールを止める
  const [dragLock, setDragLock] = useState(false);
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
    setBegun(true);
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
  // カードが半分ほど上がったら止める（一番上に戻しても止まったまま。押せば再生）
  useEffect(() => {
    if (covered && playingRef.current) pause();
  }, [covered, pause]);

  // スクロールの量（UI スレッド）。後ろの形の暗さ・ぼかし・ずれ、下の段、上のバーの地、カードののぞきを決める
  const scrollY = useSharedValue(0);
  const pageSV = useSharedValue(pageH);
  useEffect(() => { pageSV.set(pageH); }, [pageH, pageSV]);
  const onScroll = useAnimatedScrollHandler((e) => { scrollY.set(e.contentOffset.y); });
  useAnimatedReaction(() => scrollY.get() > pageSV.get() * COVER_RATIO, (c, prev) => {
    if (c !== prev) scheduleOnRN(setCovered, c);
  });
  // ぼかしの層は、少しでもスクロールしたときだけ作る（再生中の形に余計な層をかけない）
  const [blurOn, setBlurOn] = useState(false);
  useAnimatedReaction(() => scrollY.get() > 1, (on, prev) => {
    if (on !== prev) scheduleOnRN(setBlurOn, on);
  });
  // 後ろに回す進み（0＝画面いっぱい、1＝1画面分スクロール）。動きを減らす設定なら途中を見せず、決まった所で切り替える
  const back = useDerivedValue(() => {
    const y = scrollY.get();
    const h = Math.max(1, pageSV.get());
    if (reduced) return y > h * REDUCED_SWITCH_RATIO ? 1 : 0;
    return Math.min(1, Math.max(0, y / h));
  });
  const blur = useDerivedValue(() => Math.max(0.01, back.get() * BG_MAX_BLUR));
  const bgStyle = useAnimatedStyle(() => ({
    opacity: interpolate(back.get(), [0, 1], [1, BG_MIN_OPACITY]),
    transform: [{ translateY: reduced ? 0 : -back.get() * pageSV.get() * BG_SHIFT_RATIO }],
  }));
  const barStyle = useAnimatedStyle(() => ({ opacity: back.get() * BAR_MAX_OPACITY }));

  // 下の手がかり（「↑ 成長の記録」と①の頭）：再生中は隠し、止まったら下からのぞかせる（出る 250ms・消える 150ms）
  const peekOn = begun && !playing;
  const peek = useSharedValue(0);
  useEffect(() => {
    const to = peekOn ? 1 : 0;
    if (reduced) peek.set(to);
    else peek.set(withTiming(to, { duration: peekOn ? duration.enter : duration.exit, easing: peekOn ? easeOut : easeIn }));
  }, [peekOn, reduced, peek]);
  // スクロールした分も上げる（スクロールの途中で止まっても、カードが跳ねない）
  const lift = useDerivedValue(() => Math.max(peek.get(), Math.min(1, scrollY.get() / PEEK_SHIFT)));
  const rowsStyle = useAnimatedStyle(() => ({
    opacity: 1 - Math.min(1, scrollY.get() / Math.max(1, pageSV.get() * ROWS_FADE_RATIO)),
    transform: [{ translateY: -PEEK_SHIFT * lift.get() }],
  }));
  const hintStyle = useAnimatedStyle(() => ({ opacity: peek.get() }));
  const headingStyle = useAnimatedStyle(() => {
    const h = pageSV.get();
    return { opacity: interpolate(scrollY.get(), [h * HEADING_FROM_RATIO, h * HEADING_TO_RATIO], [0, 1], 'clamp') };
  });
  const cardsStyle = useAnimatedStyle(() => ({ transform: [{ translateY: PEEK_SHIFT * (1 - lift.get()) }] }));
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
    scrollable: true, onDragging: setDragLock,
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
  if (!model || !data) return <Screen>{header}</Screen>;

  const i = Math.min(index, span);
  const date = start == null ? today : dateAt(start, i);
  const dayNumber = empty ? 0 : i + 1;
  const motionOn = !reduced;
  const ended = playable && !playing && i >= span;
  const caption = empty ? '記録を始めると、ここから育ちます'
    : subtitle?.text ?? (hint && !playing ? TIMELAPSE_HINT_TEXT : ended ? REPLAY_TEXT : null);

  return (
    <Screen scroll={false}>
      <View style={s.root}>
        {/* 後ろの形と数式（画面に固定）。スクロールにつれて暗く・ぼけて、少し上へずれる */}
        <Animated.View style={[s.background, { top: size.topBar, height: shapeHeight }, bgStyle]} pointerEvents="none">
          {/* 形を変えたら作り直す（形ごとに点の数がちがう） */}
          {shape != null && (
            <GrowthShape
              key={shape} shape={shape} params={params} width={width} height={shapeHeight} paused={!visible || covered}
              spin={playing ? PLAYING_SPIN : 1} blur={blurOn ? blur : undefined}
              accessibilityLabel={growthShapeLabel(shape, dayNumber)}
            />
          )}
          {/* 左上の数式（いま打った点の番号と値）。形の上の光る点と同じ点を指す */}
          {shape != null && (
            <FormulaReadout shape={shape} pos={pos} playing={playing} index={i} series={series} />
          )}
        </Animated.View>

        <Animated.ScrollView
          onScroll={onScroll} scrollEventThrottle={16} scrollEnabled={!dragLock} showsVerticalScrollIndicator={false}
          onLayout={(e) => setMeasured(e.nativeEvent.layout.height)} testID="growth-scroll"
        >
          {/* 1画面目：タイムラプス。どこかを1回押すと再生・一時停止、左右になぞると日を移す（ボタン・線の帯は自分で先に受け取る） */}
          <View style={{ height: pageH }} {...gesture}>
            <View style={{ height: size.topBar }} />
            <View style={[s.shapeBox, { height: shapeHeight }]}>
              {held && !ended && playable && <PauseMark motion={motionOn} />}
              {/* 終わったときの、読み上げ用の「もう一度」（見た目はなく、指の操作は通す。指では画面のどこかを1回押す） */}
              {ended && (
                <View
                  style={StyleSheet.absoluteFill}
                  pointerEvents="none"
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel="もう一度"
                  accessibilityHint="最初からもう一度再生します"
                  accessibilityActions={[{ name: 'activate' }]}
                  onAccessibilityAction={replay}
                  testID="growth-replay"
                />
              )}
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

            {/* 字幕・DAY・累計・線。止まったら上げて、下に手がかりとカードの頭をのぞかせる。スクロールにつれて消える */}
            <Animated.View style={[s.rows, rowsStyle]}>
              <View style={s.caption}>
                <View style={s.captionText} accessibilityLiveRegion="polite" testID="growth-subtitle">
                  {caption != null && (
                    <Animated.View
                      key={subtitle?.id ?? caption}
                      entering={motionOn ? FadeIn.duration(duration.enter).easing(easeOut) : undefined}
                      // web（E2E）は消える動きに対応していないので付けない（components/motion.tsx の useListMotion と同じ）
                      exiting={motionOn && Platform.OS !== 'web' ? FadeOut.duration(duration.exit).easing(easeIn) : undefined}
                    >
                      <T
                        variant={empty || subtitle ? 'bodyL' : 'bodyM'} color={caption === REPLAY_TEXT ? REPLAY_COLOR : SUBTITLE_COLOR}
                        align="center" numberOfLines={1}
                      >
                        {caption}
                      </T>
                    </Animated.View>
                  )}
                </View>
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
              {/* 止まっているときだけ、下にカードがあることを知らせる（再生中は出さない） */}
              {peekOn && (
                <Animated.View style={[s.hint, hintStyle]} pointerEvents="none" testID="growth-records-hint">
                  <T variant="labelS" bold={false} color={colors.sub} align="center" accessibilityLabel="上にスクロールで成長の記録">
                    ↑  成長の記録
                  </T>
                </Animated.View>
              )}
            </Animated.View>
          </View>

          {/* 成長の記録。止まっているときは、頭が1画面目の下にのぞく（再生中は画面の外） */}
          <Animated.View style={[s.records, cardsStyle]} pointerEvents="box-none">
            <GrowthRecords data={data} headingStyle={headingStyle} />
          </Animated.View>
        </Animated.ScrollView>

        {/* 上のバー（戻る・形を選ぶ）は固定。カードがこの下をくぐるので、スクロールしたら画面の色の地を敷く */}
        <View style={s.bar} pointerEvents="box-none">
          <Animated.View style={[StyleSheet.absoluteFill, s.barBg, barStyle]} pointerEvents="none" />
          {header}
        </View>
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
/** 終わったときの「タップでもう一度」の色（字幕より薄く。白の約45%） */
const REPLAY_COLOR = 'rgba(243,245,247,0.45)';

const s = StyleSheet.create({
  // 画面全体で指を受け、カードを左右の端まで流すため、左右の余白の外（画面の端）まで広げる
  root: { flex: 1, marginHorizontal: -space.screen },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: size.topBar, marginHorizontal: -12 },
  bar: { position: 'absolute', top: 0, left: 0, right: 0, height: size.topBar, paddingHorizontal: space.screen },
  barBg: { backgroundColor: colors.bg },
  background: { position: 'absolute', left: 0, right: 0, overflow: 'hidden', justifyContent: 'center' },
  shapeBox: { overflow: 'hidden' },
  rows: { paddingHorizontal: space.screen },
  hint: { position: 'absolute', left: 0, right: 0, top: '100%', height: HINT_SPACE, justifyContent: 'center' },
  // ①の頭は、上げた段（PEEK_SHIFT）のうち、手がかりの行の下から（見出しはその上に重なり、スクロールしてから見せる）
  records: { marginTop: -(PEEK_SHIFT - HINT_SPACE) - RECORDS_HEAD_OFFSET, paddingBottom: space.xl },
  caption: { height: CAPTION_H, alignItems: 'center', justifyContent: 'flex-end', gap: space.s },
  captionText: { minHeight: 24, justifyContent: 'center' },
  day: { height: DAY_H, justifyContent: 'flex-end' },
  totalsRow: { height: TOTALS_H, justifyContent: 'center' },
});
