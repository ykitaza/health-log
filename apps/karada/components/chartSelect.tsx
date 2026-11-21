// グラフの棒・点を押して選び、その日（週）の中身を札で見せる部品（#327）。StackedBarChart・LineChart（components/charts.tsx）と、
// 食事の週の kcal のグラフ（components/MealWeekly.tsx）が使う。選びの計算は lib/chart.ts（jest で確かめる）。
// - 押せる範囲：棒・点ごとに、となりとの真ん中から真ん中までの縦の列（グラフの高さいっぱい）。細い棒でも列のどこを押してもよい
// - 列が細いとき（28 日・1 年の棒など）は、横になぞると指の下のものに選びが移る（縦に動かしたときはスクロールのまま）
// - 読み上げ：列はそれぞれ「日付と値」の名前のボタンで、選んだものは selected。札は polite で読み上げる
// - もう一度押すか、札の「閉じる」で外す。期間・週を変えたら外す（キーで持つので、並びが変わっても別の日を指さない）
// - 色は増やさない：選んでいないものを薄くし（opacity）、札は一段上の面（HUD）・罫（クラシック）。動きは付けない（動きを減らす設定と同じ）
// - 振動（触覚）は expo-haptics がネイティブで、アップデートでは届けられないので、lib/feedback.ts の呼び口（今は何もしない）だけを呼ぶ
import { ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, View, ViewInstance } from 'react-native';
import { detailLeft, hitColumns, isScrub, nearestIndex, selectedIndex, toggleSelection } from '@/lib/chart';
import { onFeedback } from '@/lib/feedback';
import { colors, isHud, radius, size as sz, space } from '@/theme';
import { Icon } from './Icon';
import { PressableScale } from './motion';
import { T } from './Text';

/** 選んだものの札の中身 */
export type ChartDetailContent = {
  /** 日付（「11月7日（土）」）や週（「11月2日からの週」） */
  title: string;
  /** 大きく出す値（「6:20」「1.7t」） */
  value: string;
  /** 値の単位などの添え（「時間」「歩」） */
  unit?: string;
  /** 中身の行（部位ごとの負荷量、寝た・起きた時刻、PFC など）。color は凡例と同じ色の印 */
  rows?: { label: string; value: string; color?: string }[];
  /** 行の下の補足（「ほか 1 回」など） */
  note?: string;
  /** 詳しい画面へ（その日の記録など） */
  link?: { label: string; onPress: () => void };
};

/** グラフを押せるようにするときに渡すもの。keys は棒・点と同じ順・同じ数 */
export type ChartSelect = {
  /** 棒・点ごとのキー（日付・週の始まり）。選びはキーで持つ */
  keys: readonly string[];
  /** 読み上げの名前（「11月7日（土） 6時間20分」） */
  label: (i: number) => string;
  /** 札の中身 */
  detail: (i: number) => ChartDetailContent;
  /** 横になぞって選びを移すか（横にスワイプする場所の中では false） */
  scrub?: boolean;
  /** 列のボタンの testID の頭（`${testID}-${key}`）と、札の testID（`${testID}-detail`） */
  testID?: string;
};

/** 選んでいない棒の濃さ */
export const DIM_OPACITY = 0.35;

/**
 * グラフの選びの状態。resetKey（期間・週・項目）が変わったら外す。選んだキーが並びになければ -1
 */
export function useChartSelection(keys: readonly string[], resetKey: unknown) {
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => { setSelected(null); }, [resetKey]);
  const index = selectedIndex(keys, selected);
  return { selected, index, setSelected };
}

/**
 * グラフの上に重ねる、押せる列（読み上げのボタン）となぞりの受け口。xs は棒のまん中・点の横の位置（px、グラフの左から）。
 * width・height はグラフ（Svg）の大きさ。列はグラフの左端から右端まで、すき間なく並ぶ
 */
export function SelectLayer({ select, xs, width, height, selected, onSelect }: {
  select: ChartSelect; xs: readonly number[]; width: number; height: number;
  selected: string | null; onSelect: (key: string | null) => void;
}) {
  const cols = hitColumns(xs, 0, width);
  const origin = useRef(0);
  const box = useRef<ViewInstance>(null);
  const last = useRef<string | null>(null);
  // なぞるあいだの最新の並び（PanResponder は一度だけ作る）
  const latest = useRef({ xs, keys: select.keys, onSelect });
  useLayoutEffect(() => { latest.current = { xs, keys: select.keys, onSelect }; });
  // 画面の左からの位置（なぞる指の位置 pageX から引く。web の locationX は押した中の要素からの位置になるため使わない）
  const measure = () => box.current?.measure((_x, _y, _w, _h, pageX) => { origin.current = pageX; });
  const pan = useMemo(() => {
    const pick = (pageX: number) => {
      const l = latest.current;
      const i = nearestIndex(l.xs, pageX - origin.current);
      const key = i >= 0 ? l.keys[i] : null;
      if (key != null && key !== last.current) {
        last.current = key;
        l.onSelect(key);
        onFeedback('select');
      }
    };
    // ref は指の動きの中（描く間ではない）でだけ読む
    // eslint-disable-next-line react-hooks/refs
    return PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_, g) => isScrub(g.dx, g.dy),
      onPanResponderGrant: (_, g) => {
        last.current = null;
        box.current?.measure((_x, _y, _w, _h, pageX) => { origin.current = pageX; });
        pick(g.moveX || g.x0);
      },
      onPanResponderMove: (_, g) => pick(g.moveX),
      // なぞると決めたあとは、スクロールやスワイプに渡さない
      onPanResponderTerminationRequest: () => false,
    }).panHandlers;
  }, []);
  const handlers = select.scrub === false ? {} : pan;
  return (
    <View ref={box} onLayout={measure} style={[StyleSheet.absoluteFill, { width, height }]} {...handlers}>
      {cols.map((c, i) => {
        const key = select.keys[i];
        const on = key === selected;
        return (
          <Pressable
            key={key}
            accessibilityRole="button"
            accessibilityLabel={select.label(i)}
            accessibilityState={{ selected: on }}
            aria-selected={on}
            onPress={() => { onSelect(toggleSelection(selected, key)); onFeedback('select'); }}
            testID={select.testID ? `${select.testID}-${key}` : undefined}
            style={{ position: 'absolute', left: c.left, width: c.width, top: 0, height }}
          />
        );
      })}
    </View>
  );
}

/** 札の上の小さな三角（選んだ棒・点の位置を指す） */
const CARET = 12;

/**
 * 選んだものの札。グラフのすぐ下に置き、三角で選んだ棒・点を指す（グラフに重ねないので、棒も線も隠れない）。
 * 日付・値・中身の行・詳しい画面へのリンク・閉じる。読み上げは polite（選ぶたびに中身を読む）
 */
export function ChartDetail({ content, x, width, onClose, testID }: {
  content: ChartDetailContent; x: number; width: number; onClose: () => void; testID?: string;
}) {
  const caret = detailLeft(x, CARET, width);
  const spoken = [content.title, `${content.value}${content.unit ? ` ${content.unit}` : ''}`, ...(content.rows ?? []).map((r) => `${r.label} ${r.value}`), content.note]
    .filter(Boolean).join('、');
  return (
    <View testID={testID} style={{ marginTop: space.xs }}>
      <View style={s.card}>
        <View style={s.head}>
          {/* 中身は1つの読み上げにまとめ、選ぶたびに読む */}
          <View style={{ flex: 1, minWidth: 0, gap: 2 }} accessible accessibilityLabel={spoken} accessibilityLiveRegion="polite" aria-live="polite">
            <T variant="bodyS" color={colors.sub} numberOfLines={1}>{content.title}</T>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.xs, flexWrap: 'wrap' }}>
              <T num bold size={22}>{content.value}</T>
              {content.unit ? <T variant="bodyS" color={colors.sub}>{content.unit}</T> : null}
            </View>
            {(content.rows ?? []).map((r) => (
              <View key={r.label} style={s.row}>
                {r.color ? <View style={[s.swatch, { backgroundColor: r.color }]} /> : null}
                <T variant="bodyS" color={colors.sub} numberOfLines={1} style={{ flexShrink: 1 }}>{r.label}</T>
                <View style={{ flex: 1 }} />
                <T num variant="bodyS" bold>{r.value}</T>
              </View>
            ))}
            {content.note ? <T variant="bodyS" color={colors.sub}>{content.note}</T> : null}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="閉じる" onPress={onClose} hitSlop={4}
            style={s.close} testID={testID ? `${testID}-close` : undefined}>
            <Icon name="close" size={20} color={colors.sub} />
          </Pressable>
        </View>
        {content.link && (
          <PressableScale accessibilityRole="button" scaleTo={0.98} onPress={content.link.onPress} style={s.link} testID={testID ? `${testID}-link` : undefined}>
            <T variant="labelL" color={isHud ? colors.accent : colors.text} style={{ flexShrink: 1 }}>{content.link.label}</T>
            <Icon name="chevron" size={20} color={isHud ? colors.accent : colors.text} />
          </PressableScale>
        )}
      </View>
      {/* 札の縁に重ねる（クラシックは罫の上を地の色で切る） */}
      <View pointerEvents="none" style={[s.caret, { left: caret }]} />
    </View>
  );
}

/** 選べるグラフの中身（Svg・押せる列・札）。children は Svg */
export function SelectableFrame({ select, xs, width, height, selected, index, onSelect, children, summary }: {
  select: ChartSelect; xs: readonly number[]; width: number; height: number; selected: string | null; index: number;
  onSelect: (key: string | null) => void; children: ReactNode; summary?: string;
}) {
  return (
    <>
      <View>
        {/* グラフの要約は、押せる列と別の要素にする（まとめて 1 つの読み上げにすると、列のボタンに届かない） */}
        <View accessible={summary != null} accessibilityRole={summary != null ? 'image' : undefined} accessibilityLabel={summary}>
          {children}
        </View>
        <SelectLayer select={select} xs={xs} width={width} height={height} selected={selected} onSelect={onSelect} />
      </View>
      {index >= 0 && (
        <ChartDetail content={select.detail(index)} x={xs[index]} width={width} onClose={() => onSelect(null)}
          testID={select.testID ? `${select.testID}-detail` : undefined} />
      )}
    </>
  );
}

const s = StyleSheet.create({
  caret: {
    position: 'absolute', top: 0, width: CARET, height: CARET, transform: [{ rotate: '45deg' }],
    backgroundColor: isHud ? colors.input : colors.bg,
    borderLeftWidth: isHud ? 0 : 1, borderTopWidth: isHud ? 0 : 1, borderColor: colors.text,
  },
  // HUD は一段明るい面、クラシックは塗らずに墨の罫（帳の欄）
  card: isHud
    ? { marginTop: CARET / 2, backgroundColor: colors.input, borderRadius: radius.s, paddingLeft: space.m, paddingVertical: space.s }
    : { marginTop: CARET / 2, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.text, paddingLeft: space.m, paddingVertical: space.s },
  head: { flexDirection: 'row', alignItems: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: 20 },
  swatch: { width: 8, height: 8, borderRadius: isHud ? 2 : 0 },
  close: { width: sz.touch, height: sz.touch, alignItems: 'center', justifyContent: 'center', marginTop: -space.s },
  link: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: sz.touch, paddingRight: space.m },
});
