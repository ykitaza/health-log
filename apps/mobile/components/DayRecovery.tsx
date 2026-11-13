// 記録の画面の、記録のない日のヒーロー：その日の時点の回復マップ（2D の前と後ろの図）。
// 色・数え方・回復の日数・ケガの結びつけは、からだのタブの回復マップと同じ lib/recoveryMap.ts。
// 回復中とケガの部位に札と引き出し線（並べ方は種目の札と同じ lib/dayCallouts.ts の layoutCallouts）、回復済みの部位を1つすすめ、
// 下に「部位から記録」のチップ（図の筋肉を押すと、近い部位のチップが先頭に）
import { router } from 'expo-router';
import { ReactNode, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, ViewInstance } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';
import type { Injury } from '@/db/repositories/injuries';
import type { RecoveryInput } from './RecoveryMap';
import { MuscleFigure } from './MuscleFigure';
import { PartBadge } from './ExerciseFields';
import { T } from './Text';
import { Button, Card, Chip, ChipRow } from './ui';
import { DateKey, relativeDays } from '@/lib/date';
import { layoutCallouts, PlacedCallout } from '@/lib/dayCallouts';
import { siteLabel } from '@/lib/injuries';
import { MuscleView, partsAt } from '@/lib/muscleFigure';
import {
  fixingOn, INJURY_RED, injuriesForPart, LOAD_ORANGE, muscleFills, PartRecovery, partRecoveries, recoveryColor, REST_GREEN, suggestRecovered,
} from '@/lib/recoveryMap';
import type { Repositories } from '@/db';
import { colors, space } from '@/theme';

/** 回復マップの材料（からだのタブと同じ：セット・部位の名前・ケガ） */
export async function loadRecovery(r: Repositories): Promise<RecoveryInput> {
  const [rows, parts, injuries] = await Promise.all([r.workouts.allSetRows(), r.catalog.listBodyParts({ includeHidden: true }), r.injuries.list()]);
  const nameById = new Map(parts.map((p) => [p.id, p.name]));
  return { rows, partName: (id) => nameById.get(id) ?? '', names: parts.filter((p) => !p.hidden).map((p) => p.name), injuries };
}

/** その日までに、回復マップに出る部位を一度でも鍛えたか（メッセージの補足と図の色を同じ決まりにする） */
export function trainedBy(input: RecoveryInput, date: DateKey): boolean {
  return partRecoveries(input.rows, input.partName, input.names, date).some((p) => p.last != null);
}

/** 部位（チップの ID と名前） */
export type PickPart = { id: string; name: string };

/** 図で押した所：向き・図の座標の点・まわりの部位（近い順。ユーザーの部位にあるものだけ） */
export type Picked = { view: MuscleView; point: { x: number; y: number }; parts: PickPart[] };

/** 押した点のまわりの部位（ユーザーの部位にあるもの）。なければ null */
export function pickAt(view: MuscleView, point: { x: number; y: number }, pickParts: PickPart[]): Picked | null {
  const byName = new Map(pickParts.map((b) => [b.name.trim(), b]));
  const near = partsAt(view, point).flatMap((n) => byName.get(n) ?? []);
  return near.length > 0 ? { view, point, parts: near } : null;
}

/**
 * 図を押す所（読み上げでは隠す。下のチップが同じ入口）。押した位置は画面の座標から左上を引いて図の座標に直す
 * （MuscleFigure と同じ。web の locationX は押した中の要素からの位置になるため）
 */
export function FigurePress({ scale, onPick, style, testID }: { scale: number; onPick: (p: { x: number; y: number }) => void; style: object; testID: string }) {
  const ref = useRef<ViewInstance>(null);
  return (
    <Pressable
      ref={ref} testID={testID} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={style}
      onPress={(e) => {
        const { pageX, pageY } = e.nativeEvent;
        ref.current?.measure((_x, _y, _w, _h, left, top) => onPick({ x: (pageX - left) / scale, y: (pageY - top) / scale }));
      }}
    />
  );
}

/**
 * 「部位から記録」のチップ。押した所があれば、そのまわりの部位を先頭に（選んだ見た目）。
 * チップを押すと、その部位で絞った種目の選択。note を渡すと、チップに状態（色の点と「あと1日」）を添える
 */
export function PartChips({ date, pickParts, picked, note, testID }: {
  date: string; pickParts: PickPart[]; picked: Picked | null; testID: string;
  note?: (name: string) => { dot: string; text: string; spoken: string } | null;
}) {
  const nearIds = new Set(picked?.parts.map((b) => b.id) ?? []);
  const chips = picked ? [...picked.parts, ...pickParts.filter((b) => !nearIds.has(b.id))] : pickParts;
  return (
    <View testID={testID} style={{ gap: 2 }}>
      <T variant="labelM" color={colors.sub}>{picked ? '押した所の部位から記録' : '部位から記録'}</T>
      <ChipRow>
        {chips.map((b) => {
          const n = note?.(b.name) ?? null;
          return (
            <Chip key={b.id} label={b.name} active={nearIds.has(b.id)} dot={n?.dot} note={n?.text}
              accessibilityLabel={n ? `${b.name}の種目を選ぶ、${n.spoken}` : `${b.name}の種目を選ぶ`}
              onPress={() => router.push({ pathname: '/workout/select', params: { date, part: b.id } })} />
          );
        })}
      </ChipRow>
    </View>
  );
}

/** 凡例：からだのタブの回復マップと同じ（色の四角と文字。色だけにしない） */
const LEGEND = [
  { color: REST_GREEN, label: '回復済み' },
  { color: LOAD_ORANGE, label: '回復中' },
  { color: INJURY_RED, label: 'ケガ' },
];

/** 札の幅の下限（「上腕三頭筋」「▲ 腰の筋肉」が入る幅）。図はこの残りで大きくする */
const CALLOUT_MIN_W = 68;
/** 札と図のあいだ、前と後ろの図のあいだ */
const CALLOUT_INSET = space.xs;
const FIG_GAP = space.s;
/** 図の高さの上限・下限（幅は高さの半分） */
const FIG_MAX_H = 200;
const FIG_MIN_H = 132;
/** 図の下の「前・後ろ」の行 */
const LABEL_H = 20;
/** 札（部位・状態・ケガの 3 行）の高さと、札のあいだ。片側の札の数（「+N」も 1 つ） */
const CALLOUT_H = 48;
const CALLOUT_GAP = space.xs;
const CALLOUTS_PER_SIDE = 4;

/** 部位の色：ケガがあれば赤、回復中は明るさの暖色、回復済み・まだは緑（からだのタブと同じ） */
const partColor = (p: PartRecovery, hurt: boolean) => (hurt ? INJURY_RED : p.level > 0 ? recoveryColor(p.level) : REST_GREEN);

/**
 * 記録のない日のヒーロー：その日の時点の回復マップ（2D）と、すすめる部位、前回の1行（foot）、部位から記録のチップ。
 * 一度も記録がなければ、色を付けない体の図（押して部位から記録できる）
 */
// key に日付を渡す（日を変えたら、押した所を消す）
export function RecoveryHero({ date, today, input, pickParts, foot, testID = 'recovery-hero' }: {
  date: DateKey; today: DateKey; input: RecoveryInput; pickParts: PickPart[]; foot?: ReactNode; testID?: string;
}) {
  const [width, setWidth] = useState(0);
  const [picked, setPicked] = useState<Picked | null>(null);
  const list = useMemo(() => partRecoveries(input.rows, input.partName, input.names, date), [input, date]);
  const injuries = useMemo(() => fixingOn(input.injuries, date), [input.injuries, date]);
  const hurtOf = useMemo(() => new Map(list.map((p) => [p.name, injuriesForPart(p, injuries)])), [list, injuries]);
  const byName = new Map(list.map((p) => [p.name, p]));
  const hurt = (p: PartRecovery) => (hurtOf.get(p.name)?.length ?? 0) > 0;
  const trained = list.some((p) => p.last != null);
  const suggest = trained ? suggestRecovered(list, hurt) : null;
  const suggestId = suggest ? pickParts.find((b) => b.name.trim() === suggest.name)?.id : undefined;
  // 札は回復中とケガの部位（からだのタブの 3D の札と同じ）
  const marked = list.filter((p) => p.level > 0 || hurt(p));

  // 図の大きさ：札の幅を残した残りで、できるだけ大きく
  const figH = Math.max(FIG_MIN_H, Math.min(FIG_MAX_H, Math.floor(width - 2 * (CALLOUT_MIN_W + CALLOUT_INSET) - FIG_GAP)));
  const figW = figH / 2;
  const scale = figH / 200;
  const layout = layoutCallouts(marked.map((p, i) => ({ key: p.name, no: i + 1, part: p.name })), {
    figureHeight: figH, minHeight: figH + LABEL_H, slot: CALLOUT_H, gap: CALLOUT_GAP, perSide: CALLOUTS_PER_SIDE,
  });
  const frontX = Math.max(0, (width - (figW * 2 + FIG_GAP)) / 2);
  const backX = frontX + figW + FIG_GAP;
  const calloutW = Math.max(0, frontX - CALLOUT_INSET);
  const toScreen = (view: MuscleView, p: { x: number; y: number }) => ({ x: (view === 'front' ? frontX : backX) + p.x * scale, y: p.y * scale });
  const lines = [
    ...layout.left.map((c) => ({ c, x: calloutW })),
    ...layout.right.map((c) => ({ c, x: width - calloutW })),
  ].flatMap(({ c, x }) => {
    if (c.kind !== 'entry' || !c.anchor) return [];
    const to = toScreen(c.anchor.view, c.anchor.point);
    return [{ key: c.key, x1: x, y1: c.top + CALLOUT_H / 2, ...to, color: partColor(byName.get(c.key)!, hurt(byName.get(c.key)!)) }];
  });
  const fills = trained ? muscleFills(list) : undefined;
  const marks = injuries.map((i) => ({ key: i.id, site: i.site, side: i.side, status: 'fixing' as const }));
  const mark = picked ? toScreen(picked.view, picked.point) : null;

  const recovering = list.filter((p) => p.level > 0);
  const spoken = trained ? [
    '回復マップ。緑は回復済み、暖色は回復中、赤はケガ',
    recovering.length > 0 ? `回復中の部位、${recovering.map((p) => `${p.name} あと${p.remaining}日`).join('、')}` : '回復中の部位はありません',
    injuries.length > 0 ? `直している途中のケガ、${injuries.map((i) => siteLabel(i.site, i.side)).join('、')}` : '',
  ].filter(Boolean).join('。') : '体の図';
  const note = (name: string) => {
    const p = byName.get(name.trim());
    if (!p) return null;
    if (hurt(p)) return { dot: INJURY_RED, text: 'ケガ', spoken: '直している途中のケガ' };
    if (p.remaining != null) return { dot: recoveryColor(p.level), text: `あと${p.remaining}日`, spoken: `回復中 あと${p.remaining}日` };
    return null;
  };

  return (
    <Card style={{ marginTop: space.s, paddingVertical: space.m, gap: space.s }}>
      <View style={s.head}>
        <T variant="labelM" color={colors.sub} accessibilityRole="header">{trained ? (date === today ? '今日の回復マップ' : 'この日の回復マップ') : '体の図'}</T>
        {trained && (
          <View style={s.legend} testID={`${testID}-legend`} aria-hidden importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
            {LEGEND.map((l) => (
              <View key={l.label} style={s.legendItem}>
                <View style={[s.swatch, { backgroundColor: l.color }]} />
                <T variant="bodyS" color={colors.sub}>{l.label}</T>
              </View>
            ))}
          </View>
        )}
      </View>
      <View accessible accessibilityLabel={spoken} testID={testID} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height: layout.height }}>
        {width > 0 && (
          <>
            {(['front', 'back'] as const).map((view) => (
              <View key={view} style={{ position: 'absolute', left: view === 'front' ? frontX : backX, top: 0, width: figW, alignItems: 'center' }}>
                <MuscleFigure view={view} fills={fills} marks={marks} markColor={INJURY_RED} width={figW} height={figH} />
                <View style={{ height: LABEL_H, justifyContent: 'flex-end' }}>
                  <T variant="labelS" color={colors.sub}>{view === 'front' ? '前' : '後ろ'}</T>
                </View>
              </View>
            ))}
            {/* 引き出し線と、その部位の点（回復の色。ケガは赤）。押した所は輪 */}
            <Svg width={width} height={layout.height} style={{ position: 'absolute', left: 0, top: 0 }} pointerEvents="none">
              {lines.map((l) => (
                <Line key={l.key} x1={l.x1} y1={l.y1} x2={l.x} y2={l.y} stroke={colors.sub} strokeWidth={1} strokeOpacity={0.7} />
              ))}
              {lines.map((l) => <Circle key={`dot-${l.key}`} cx={l.x} cy={l.y} r={3} fill={l.color} stroke={colors.card} strokeWidth={1.5} />)}
              {mark && <Circle cx={mark.x} cy={mark.y} r={8} fill="none" stroke={colors.text} strokeWidth={1.5} />}
            </Svg>
            {(['front', 'back'] as const).map((view) => (
              <FigurePress key={view} testID={`${testID}-press-${view}`} scale={scale} onPick={(p) => setPicked(pickAt(view, p, pickParts))}
                style={{ position: 'absolute', left: view === 'front' ? frontX : backX, top: 0, width: figW, height: figH }} />
            ))}
            {(['left', 'right'] as const).flatMap((side) => layout[side].map((c) => (
              <PartCallout
                key={c.kind === 'entry' ? c.key : `more-${side}`} callout={c} align={side === 'left' ? 'right' : 'left'}
                part={c.kind === 'entry' ? byName.get(c.key) : undefined} hurt={c.kind === 'entry' ? hurtOf.get(c.key) ?? [] : []}
                moreNames={c.kind === 'more' ? c.nos.map((n) => marked[n - 1].name) : []}
                style={{ [side]: 0, top: c.top, width: calloutW }}
              />
            )))}
          </>
        )}
      </View>
      {suggest && (
        <View style={s.suggest} testID={`${testID}-suggest`}>
          <View
            style={s.suggestText} accessible
            accessibilityLabel={`${date === today ? '今日は' : 'この日は'} ${suggest.name} はどう？ ${relativeDays(suggest.last!, date)}、回復済み`}
          >
            <T variant="titleS">{date === today ? '今日は' : 'この日は'}</T>
            <PartBadge name={suggest.name} />
            <T variant="titleS">はどう？</T>
            <T variant="bodyS" color={colors.sub}>{`${relativeDays(suggest.last!, date)}・回復済み`}</T>
          </View>
          {suggestId && (
            <Button
              label={`${suggest.name}の種目を選ぶ`} variant="text" small
              onPress={() => router.push({ pathname: '/workout/select', params: { date, part: suggestId } })}
              style={{ paddingLeft: 12, paddingRight: 12, marginRight: -12, marginLeft: 'auto' }}
            />
          )}
        </View>
      )}
      {foot}
      {pickParts.length > 0 && <PartChips date={date} pickParts={pickParts} picked={picked} note={trained ? note : undefined} testID={`${testID}-parts`} />}
    </Card>
  );
}

/**
 * 図の横の札：部位・状態（「あと1日」。回復の色）・ケガ（「▲ 腰の筋肉」。赤）。「+N」は出せなかった部位の名前。
 * align は文字を寄せる側（図の左の札は図の側の右に寄せる）。読み上げは図のまとめで言うので隠す
 */
function PartCallout({ callout, part, hurt, moreNames, align, style }: {
  callout: PlacedCallout; part?: PartRecovery; hurt: Injury[]; moreNames: string[];
  align: 'left' | 'right'; style: object;
}) {
  const hide = { 'aria-hidden': true, importantForAccessibility: 'no-hide-descendants', accessibilityElementsHidden: true } as const;
  const box = [{ position: 'absolute', height: CALLOUT_H, justifyContent: 'center', alignItems: align === 'right' ? 'flex-end' : 'flex-start' } as const, style];
  if (callout.kind === 'more' || !part) {
    return (
      <View style={box} testID="recovery-callout-more" {...hide}>
        <T variant="labelM" color={colors.sub}>{`+${moreNames.length}`}</T>
        <T size={11} style={{ lineHeight: 16 }} color={colors.sub} numberOfLines={2} align={align}>{moreNames.join('・')}</T>
      </View>
    );
  }
  return (
    <View style={box} testID="recovery-callout" {...hide}>
      <T variant="labelM" numberOfLines={1} align={align}>{part.name}</T>
      <T size={11} style={{ lineHeight: 16 }} color={part.level > 0 ? recoveryColor(part.level) : colors.sub} numberOfLines={1} align={align}>
        {part.remaining != null ? `あと${part.remaining}日` : part.last ? '回復済み' : 'まだ'}
      </T>
      {hurt.length > 0 && (
        <T size={11} style={{ lineHeight: 16 }} color={INJURY_RED} numberOfLines={1} align={align}>{`▲ ${siteLabel(hurt[0].site, hurt[0].side)}`}</T>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: space.m, rowGap: space.xs },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.m, rowGap: space.xs },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  swatch: { width: 10, height: 10, borderRadius: 2 },
  suggest: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space.s },
  suggestText: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space.xs, rowGap: 2, flexShrink: 1 },
});
