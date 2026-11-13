// その日の体：その日のトレーニングの部位と種目の札（EX-01〜）。Android は 3D（DayBody3D.native.tsx。見えないとき・ほかの画面では止め、
// 触っていないときは 30fps）、web と 3D が描けないときは 2D の図（前と後ろ）。ホームの LATEST で使い、筋トレの記録の画面でも使う予定。
// DayBody は札と部位を渡す形、DayBodyForDate は日付を渡すとその日の記録を読む形
import { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';
import { useFocusData } from '@/hooks/data';
import type { DateKey } from '@/lib/date';
import { dayBodyEntries } from '@/lib/dayBody';
import { layoutCallouts, PlacedCallout } from '@/lib/dayCallouts';
import { musclesForParts, MuscleView } from '@/lib/muscleFigure';
import { colors, space } from '@/theme';
import { DayBody3D, DayBodyEntry } from './DayBody3D';
import { DayBodyTag, DAY_TAG_H, DAY_TAG_W, MoreTag } from './dayBodyTag';
import { MuscleFigure } from './MuscleFigure';

export type DayBodyProps = {
  width: number;
  height: number;
  entries: DayBodyEntry[];
  /** その日の部位（光らせる・塗る） */
  parts: string[];
  /** 札を置ける上下の範囲（省くと上から下まで） */
  band?: { top: number; bottom: number };
};

/** その日の体（親の中に width × height で重ねる。位置は親が決める） */
export function DayBody({ width, height, entries, parts, band = { top: 0, bottom: height } }: DayBodyProps) {
  const fallback = <Figure2D width={width} band={band} entries={entries} parts={parts} />;
  return DayBody3D ? <DayBody3D width={width} height={height} entries={entries} parts={parts} band={band} fallback={fallback} /> : fallback;
}

/** 日付を渡すと、その日の記録を読んで体を描く（記録がなければ札のない体） */
export function DayBodyForDate({ date, unit, ...rest }: Omit<DayBodyProps, 'entries' | 'parts'> & { date: DateKey; unit: 'kg' | 'lb' }): ReactNode {
  const { data } = useFocusData(async (r) => dayBodyEntries(await r.workouts.getDays([date]), unit), `${date}|${unit}`);
  return <DayBody {...rest} entries={data?.entries ?? []} parts={data?.parts ?? []} />;
}

const FIG_GAP = space.s;

/** 2D の図（前と後ろ）：その日の部位を緑で塗り、種目の札を引き出し線でつなぐ（並べ方は記録の画面と同じ lib/dayCallouts.ts） */
function Figure2D({ width, band, entries, parts }: { width: number; band: { top: number; bottom: number }; entries: DayBodyEntry[]; parts: string[] }) {
  const figH = Math.min(200, band.bottom - band.top);
  const figW = figH / 2;
  const scale = figH / 200;
  const frontX = (width - (figW * 2 + FIG_GAP)) / 2;
  const backX = frontX + figW + FIG_GAP;
  const tagW = Math.min(DAY_TAG_W, Math.max(0, frontX - 4));
  const layout = layoutCallouts(entries.map((e) => ({ key: e.key, no: e.no, part: e.part })), {
    figureHeight: figH, minHeight: figH, slot: DAY_TAG_H, gap: 4, perSide: 3,
  });
  const byKey = new Map(entries.map((e) => [e.key, e]));
  const toScreen = (view: MuscleView, p: { x: number; y: number }) => ({ x: (view === 'front' ? frontX : backX) + p.x * scale, y: band.top + p.y * scale });
  const lines = [...layout.left.map((c) => ({ c, x: tagW })), ...layout.right.map((c) => ({ c, x: width - tagW }))]
    .flatMap(({ c, x }) => (c.kind === 'entry' && c.anchor ? [{ key: c.key, x1: x, y1: band.top + c.top + DAY_TAG_H / 2, ...toScreen(c.anchor.view, c.anchor.point) }] : []));
  const paint = musclesForParts(parts);
  const tag = (c: PlacedCallout, side: 'left' | 'right'): ReactNode => {
    const style = { position: 'absolute', [side]: 0, top: band.top + c.top, width: tagW } as const;
    return c.kind === 'more'
      ? <MoreTag key={`more-${side}`} nos={c.nos} style={style} />
      : <DayBodyTag key={c.key} e={byKey.get(c.key)!} align={side === 'left' ? 'right' : 'left'} style={style} />;
  };
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" testID="day-body-2d">
      {(['front', 'back'] as const).map((view) => (
        <View key={view} style={{ position: 'absolute', left: view === 'front' ? frontX : backX, top: band.top }}>
          <MuscleFigure view={view} paint={paint} paintColor={colors.accent} width={figW} height={figH} />
        </View>
      ))}
      <Svg width={width} height={band.bottom} style={StyleSheet.absoluteFill}>
        {lines.map((l) => <Line key={l.key} x1={l.x1} y1={l.y1} x2={l.x} y2={l.y} stroke={colors.accent} strokeOpacity={0.7} strokeWidth={1} />)}
        {lines.map((l) => <Circle key={`d-${l.key}`} cx={l.x} cy={l.y} r={3} fill={colors.accent} stroke={colors.bg} strokeWidth={1} />)}
      </Svg>
      {layout.left.map((c) => tag(c, 'left'))}
      {layout.right.map((c) => tag(c, 'right'))}
    </View>
  );
}

