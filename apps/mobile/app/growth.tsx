import { router, useIsFocused } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  cancelAnimation, Easing, FadeIn, FadeOut, useAnimatedReaction, useReducedMotion, useSharedValue, withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { GrowthShape } from '@/components/growth/GrowthShape';
import { ControlButton, PlayButton, SatMarks, Scrubber, TotalItem, TotalsRow } from '@/components/growth/player';
import { LoadError } from '@/components/LoadError';
import { easeIn, easeOut } from '@/components/motion';
import { Screen } from '@/components/Screen';
import { T } from '@/components/Text';
import { IconButton } from '@/components/ui';
import { useGrowthData } from '@/hooks/data';
import { useToday } from '@/hooks/today';
import { daysBetween } from '@/lib/date';
import {
  firstRecordDate, GrowthParams, growthSeries, highlights, nextHighlight, pickSubtitles, PlaybackSpeed, prevHighlight,
} from '@/lib/growth';
import {
  canPlay, dateAt, DAY_UPDATE_MS, dayIndexAt, EMPTY_PARAMS, formatFullDate, growthTotals, highlightsInRange, lastPosition, lerpParams,
  nextSpeed, NO_SATS, playLabel, remainingMs, satsByIndex, satsLabel, satWindowDays, scrubberLabels, smoothSats, speedLabel,
  subtitleOn, subtitlePassed,
} from '@/lib/growthPlayer';
import { colors, size, space } from '@/theme';
import { duration } from '@/theme/motion';

/** 形を描く箱の高さ（dp） */
const SHAPE_HEIGHT = 360;
/** 字幕を出しておく長さ（ms）。出る 250ms のあと、これだけ出して 150ms で消える */
const SUBTITLE_MS = 2000;
const NO_SERIES: GrowthParams[] = [];

/**
 * 成長を見る：最初の記録の日から今日までの「記録で育つ形」の育ち方を、音楽プレイヤーのように再生する。
 * 形の値は再生の位置（日の番号の小数）から UI スレッドで毎フレーム決める（React は描き直さない）。
 * 日の数字・日付・衛星の印・累計は、日が変わったときだけ描き直す（速い再生では間引く）
 */
export default function GrowthScreen() {
  const today = useToday();
  const { data, error, reload } = useGrowthData(today);
  const reduced = useReducedMotion();
  const { width } = useWindowDimensions();

  const model = useMemo(() => {
    if (!data) return null;
    const series = growthSeries(data.days, data.today);
    const start = firstRecordDate(data.days, data.today);
    const all = highlights({
      today: data.today, sets: data.sets, days: data.days, exerciseNames: data.exerciseNames, big3: data.big3,
      weights: data.weights, goalWeightKg: data.goalWeightKg, weeklyGoals: data.weeklyGoals, unit: data.weightUnit,
    });
    return { series, start, items: highlightsInRange(all, start, data.today), sats: satsByIndex(data.days, start, series.length), unit: data.weightUnit };
  }, [data]);
  const series = model?.series ?? NO_SERIES;
  const n = series.length;
  const span = lastPosition(n);
  const start = model?.start ?? null;

  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  const [playing, setPlaying] = useState(false);
  const [index, setIndex] = useState(0);
  const [subtitle, setSubtitle] = useState<{ id: number; text: string } | null>(null);
  const picked = useMemo(
    () => (start == null || !model ? { subtitles: [], markDates: [] } : pickSubtitles(model.items, n, speed, start)),
    [model, n, speed, start],
  );

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

  // UI スレッドから、出す日が変わったとき・再生が止まったときに呼ばれる
  const onDayRef = useRef((_i: number, _finished: boolean) => {});
  useLayoutEffect(() => {
    onDayRef.current = (i, finished) => {
      const prev = indexRef.current;
      indexRef.current = i;
      setIndex(i);
      // 再生で通った日の字幕（速い再生で日を間引いても、通った日の分を拾う）
      if (playingRef.current && start != null) {
        const sub = subtitlePassed(picked.subtitles, start, prev, i);
        if (sub) showSubtitle(sub.text);
      }
      if (finished) {
        playingRef.current = false;
        playingSV.set(false);
        setPlaying(false);
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
  const startPlayback = useCallback((from: number, sp: PlaybackSpeed) => {
    playingRef.current = true;
    playingSV.set(true);
    setPlaying(true);
    pos.set(from);
    pos.set(withTiming(span, { duration: remainingMs(from, n, sp), easing: Easing.linear }, (finished) => {
      // 止めた・速さを変えたとき（finished が false）も、間引いて出していなかった日を出す
      const i = dayIndexAt(pos.get(), n);
      lastSent.set(i);
      scheduleOnRN(onDay, i, finished === true);
    }));
  }, [pos, playingSV, lastSent, onDay, span, n]);

  const pause = useCallback(() => {
    playingRef.current = false;
    playingSV.set(false);
    setPlaying(false);
    cancelAnimation(pos);
  }, [pos, playingSV]);

  /** その日へ移って止まる。日が変わったら、その日のハイライトを字幕に出す */
  const goTo = (i: number) => {
    if (start == null || !model) return;
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
  const togglePlay = () => {
    if (playingRef.current) { pause(); return; }
    if (!playable) return;
    // 終わり（今日）で押したら、最初からもう一度
    const from = indexRef.current >= span ? 0 : pos.get();
    if (from === 0) indexRef.current = -1;
    startPlayback(from, speed);
  };
  const changeSpeed = () => {
    const next = nextSpeed(speed);
    setSpeed(next);
    if (playingRef.current) startPlayback(pos.get(), next);
  };

  // 開いたら、最初の日から自動で再生する。動きを減らす設定なら再生せず、今日の姿を出す
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !model) return;
    started.current = true;
    if (canPlay(model.series.length, reduced)) {
      indexRef.current = -1;
      startPlayback(0, 1);
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

  const header = (
    <View style={s.header}>
      <IconButton name="back" label="戻る" onPress={() => router.back()} />
      <View style={{ flex: 1, alignItems: 'center' }}>
        <T variant="bodyS" color={colors.sub} testID="growth-status">{playing ? '成長を再生中' : '成長'}</T>
        <T variant="titleM" accessibilityRole="header">点の軌跡</T>
      </View>
      <View style={{ width: size.touch }} />
    </View>
  );
  if (error) return <Screen>{header}<LoadError onRetry={reload} /></Screen>;
  if (!model) return <Screen>{header}</Screen>;

  const empty = n === 0;
  const i = Math.min(index, span);
  const date = start == null ? today : dateAt(start, i);
  const sats = empty ? NO_SATS : playing ? smoothSats(model.sats, i, satWindowDays(n, speed)) : model.sats[i];
  const totals = growthTotals(empty ? EMPTY_PARAMS : series[i], model.unit);
  const dayNumber = empty ? 0 : i + 1;
  const prev = start == null ? null : prevHighlight(model.items, date);
  const next = start == null ? null : nextHighlight(model.items, date);
  const motionOn = !reduced;

  return (
    <Screen>
      {header}
      <View style={{ marginHorizontal: -space.screen }}>
        <GrowthShape
          shape="attractor" params={params} sats={sats} width={width} height={SHAPE_HEIGHT} paused={!visible}
          accessibilityLabel={`記録で育つ形（点の軌跡）。DAY ${dayNumber}`}
        />
      </View>

      <View style={s.subtitle} accessibilityLiveRegion="polite" testID="growth-subtitle">
        {empty ? (
          <T variant="bodyL" color={SUBTITLE_COLOR} align="center">記録を始めると、ここから育ちます</T>
        ) : subtitle && (
          <Animated.View
            key={subtitle.id}
            entering={motionOn ? FadeIn.duration(duration.enter).easing(easeOut) : undefined}
            // web（E2E）は消える動きに対応していないので付けない（components/motion.tsx の useListMotion と同じ）
            exiting={motionOn && Platform.OS !== 'web' ? FadeOut.duration(duration.exit).easing(easeIn) : undefined}
          >
            <T variant="bodyL" color={SUBTITLE_COLOR} align="center" numberOfLines={1}>{subtitle.text}</T>
          </Animated.View>
        )}
      </View>

      <View style={s.dayRow}>
        <View
          style={{ flex: 1 }}
          accessible
          accessibilityLabel={`DAY ${dayNumber}、${formatFullDate(date)}`}
          testID="growth-day"
        >
          <T variant="labelS" color={colors.sub}>DAY</T>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.m }}>
            <T variant="numDisplay">{dayNumber}</T>
            <T variant="bodyM" color={colors.sub}>{formatFullDate(date)}</T>
          </View>
        </View>
        <SatMarks sats={sats} label={`その日の記録：${satsLabel(sats)}`} />
      </View>

      <Scrubber
        pos={pos} dayCount={n} index={i} disabled={empty || n < 2}
        markIndexes={start == null ? [] : picked.markDates.map((d) => daysBetween(start, d))}
        labels={scrubberLabels(start, today)} onSeek={goTo}
        valueText={`DAY ${dayNumber}、${formatFullDate(date)}`}
      />

      <View style={s.controls}>
        <ControlButton text={`${speed}x`} label={speedLabel(speed)} onPress={changeSpeed} disabled={!playable} testID="growth-speed" />
        <ControlButton icon="skipPrev" label="前のハイライトへ" onPress={() => prev && goTo(daysBetween(start!, prev))} disabled={prev == null} />
        <PlayButton playing={playing} label={playLabel({ playing, dayCount: n, reduced })} onPress={togglePlay} disabled={!playing && !playable} />
        <ControlButton icon="skipNext" label="次のハイライトへ" onPress={() => next && goTo(daysBetween(start!, next))} disabled={next == null} />
        <ControlButton text="今日" label="今日の姿に戻る" onPress={() => goTo(span)} disabled={empty} />
      </View>

      <TotalsRow>
        <TotalItem
          first kind="training" name="筋トレ" value={totals.volume} unit={totals.volumeUnit}
          label={`筋トレの負荷量の累計 ${totals.volume} ${model.unit === 'kg' ? 'トン' : '千ポンド'}`}
        />
        <TotalItem kind="food" name="食事" value={totals.foodDays} unit="日" label={`食事の目標に届いた日 ${totals.foodDays}日`} />
        <TotalItem kind="sleep" name="睡眠" value={totals.sleepDays} unit="日" label={`7時間以上眠った日 ${totals.sleepDays}日`} />
      </TotalsRow>
    </Screen>
  );
}

/** 字幕の色（白の約7割の濃さ。地に対して 4.5:1 以上） */
const SUBTITLE_COLOR = 'rgba(243,245,247,0.7)';

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', minHeight: size.topBar, marginHorizontal: -12 },
  subtitle: { minHeight: 48, justifyContent: 'center', marginTop: space.s },
  dayRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: space.l, marginBottom: space.s },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.l, marginBottom: space.xl },
});
