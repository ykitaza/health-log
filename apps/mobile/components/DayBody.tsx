// その日の体：その日のトレーニングの部位と種目の札（EX-01〜）。Android は 3D（DayBody3D.native.tsx。見えないとき・ほかの画面では止め、
// 触っていないときは 30fps）、web と 3D が描けないときは 2D の図（前と後ろ）。ホームの LATEST と、筋トレの記録の画面で使う。
// DayBody は札と部位を渡す形、DayBodyForDate は日付を渡すとその日の記録を読む形。DayBodyBox は画面の流れの中に置く形（記録の画面）
import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, ViewInstance } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';
import { useFocusData } from '@/hooks/data';
import type { DateKey } from '@/lib/date';
import { dayBodyEntries } from '@/lib/dayBody';
import { layoutCallouts, PlacedCallout } from '@/lib/dayCallouts';
import { Muscle, musclesForParts, MuscleView } from '@/lib/muscleFigure';
import { colors, isHud, space, stageColors } from '@/theme';
import { matteVolume } from '@/theme/matte';
import { DayBody3D, DayBody3DProps, DayBodyAttribution, DayBodyEntry } from './DayBody3D';
import { DayBodyTag, DAY_TAG_W, MoreTag, tagHeight } from './dayBodyTag';
import { MuscleFigure } from './MuscleFigure';

/** 札と体をつなぐ線の色（クラシックは補足の灰色） */
const LEADER = isHud ? colors.accent : stageColors.outline;
/** その日の部位の塗り。クラシックは 3D のつや消しの体と同じ（部位の量のいちばん濃い青） */
const PAINT = isHud ? colors.accent : matteVolume(5);

export type DayBodyProps = {
  width: number;
  height: number;
  entries: DayBodyEntry[];
  /** その日の部位（光らせる・塗る） */
  parts: string[];
  /** 札を置ける上下の範囲（省くと上から下まで） */
  band?: { top: number; bottom: number };
  /** 3D を描けないときに出すもの（省くと、この部品の 2D の図） */
  fallback?: ReactNode;
  /** 2D の図の筋肉ごとの塗り（ホームの LATEST：回復の色。lib/recoveryMap.ts の muscleFills）。渡した筋肉は parts の緑より先 */
  fills?: Partial<Record<Muscle, string>>;
  /** 2D の図の、片側に出す札の数（省くと 3。ホームのヒーローは、気にしたい部位 3 つと押した部位で 4） */
  perSide?: number;
  /** 2D の図を押した（前か後ろ、図の座標の点。ホームのヒーロー。3D は onPick）。渡すと図が押せる（図の上に、札より下の面を置く） */
  onPickPoint?: (view: MuscleView, point: { x: number; y: number }) => void;
  /** 2D の図：図の外側にある輪の内側の半径（ホームのヒーロー）。渡すと、部位の札（kicker）が輪にかからないよう、図を小さくして札の幅を確保する */
  ringR?: number;
} & Pick<DayBody3DProps, 'recovery' | 'idle' | 'levelColor' | 'idleColor' | 'injuries' | 'onPick' | 'onPressEntry' | 'shield'>;

/** その日の体（親の中に width × height で重ねる。位置は親が決める） */
export function DayBody({ width, height, entries, parts, band = { top: 0, bottom: height }, fallback, fills, perSide, onPickPoint, ringR, ...rest }: DayBodyProps) {
  const figure2D = fallback ?? (
    <Figure2D width={width} band={band} entries={entries} parts={parts} fills={fills} perSide={perSide} onPickPoint={onPickPoint} ringR={ringR}
      onPressEntry={rest.onPressEntry} shield={rest.shield} />
  );
  return DayBody3D ? <DayBody3D width={width} height={height} entries={entries} parts={parts} band={band} fallback={figure2D} {...rest} /> : figure2D;
}

/**
 * 3D の体を画面の流れの中に置くか（3D を描ける端末で、まだ描けなかったことがない）と、描けなかったときに知らせる関数。
 * 描けないときは、その画面の 2D の図（大きさは 2D の図が決める）に代える
 */
export function useDayBody3D(): { on: boolean; fail: () => void } {
  const [failed, setFailed] = useState(false);
  return { on: DayBody3D != null && !failed, fail: useCallback(() => setFailed(true), []) };
}

/** 描けなかったことを知らせる（3D の代わりに置く） */
function Failed({ onFail }: { onFail: () => void }) {
  useEffect(() => { onFail(); }, [onFail]);
  return null;
}

/**
 * 画面の流れの中に置く 3D のその日の体（筋トレの記録の画面）。幅は親いっぱい、高さは height。札は上から下まで。
 * 描けなかったら onFail を呼ぶ（親が 2D の図に代える。useDayBody3D）
 */
export function DayBodyBox({ height, onFail, style, ...rest }: Omit<DayBodyProps, 'width' | 'band' | 'fallback'> & {
  onFail: () => void; style?: object;
}) {
  const [width, setWidth] = useState(0);
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={[{ height }, style]}>
      {width > 0 && <DayBody {...rest} width={width} height={height} fallback={<Failed onFail={onFail} />} />}
    </View>
  );
}

export { DayBodyAttribution };

/** 日付を渡すと、その日の記録を読んで体を描く（記録がなければ札のない体） */
export function DayBodyForDate({ date, unit, ...rest }: Omit<DayBodyProps, 'entries' | 'parts'> & { date: DateKey; unit: 'kg' | 'lb' }): ReactNode {
  const { data } = useFocusData(async (r) => dayBodyEntries(await r.workouts.getDays([date]), unit), `${date}|${unit}`);
  return <DayBody {...rest} entries={data?.entries ?? []} parts={data?.parts ?? []} />;
}

const FIG_GAP = space.s;
/** 部位の札の幅の目安（「背中 あと2日」「23セット」が収まる）。輪の内側の端と札のあいだの余白 */
const TAG_NEED = 74;
const RING_CLEAR = 12;
/** 輪の端を測る、中心の高さからのずれ（札は中ほどに並ぶ） */
const RING_DY = 40;
const MIN_FIG_H = 120;

/**
 * 2D の図（前と後ろ）：その日の部位を緑で塗り（fills があればその色）、種目の札を引き出し線でつなぐ（並べ方は記録の画面と同じ lib/dayCallouts.ts）。
 * onPressEntry があれば札を押せる（shield は図と札のあいだに重ねる）
 */
function Figure2D({ width, band, entries, parts, fills, perSide = 3, onPickPoint, onPressEntry, shield, ringR }: {
  width: number; band: { top: number; bottom: number }; entries: DayBodyEntry[]; parts: string[]; fills?: Partial<Record<Muscle, string>>;
  perSide?: number; onPickPoint?: DayBodyProps['onPickPoint']; onPressEntry?: (key: string | null) => void; shield?: ReactNode; ringR?: number;
}) {
  // 輪（ホームのヒーロー）があれば札を輪の内側に収める：輪の内側の端（中心の高さから少しずれた所）から札の最小の幅を引いた分だけ、図の幅を使う。足りなければ図を小さくする
  const ringMax = ringR != null
    ? width / 2 + Math.sqrt(Math.max(0, (ringR - RING_CLEAR) ** 2 - RING_DY ** 2))
    : null;
  const bandH = band.bottom - band.top;
  const figHMax = ringMax != null ? Math.max(MIN_FIG_H, 2 * (ringMax - width / 2 - FIG_GAP / 2 - 4 - TAG_NEED)) : 200;
  const figH = Math.min(200, bandH, figHMax);
  const figW = figH / 2;
  const scale = figH / 200;
  const frontX = (width - (figW * 2 + FIG_GAP)) / 2;
  const backX = frontX + figW + FIG_GAP;
  // 札の置き場：左は図の左から、右は図の右から。輪があれば輪の内側まで（左右対称）。なければ画面の端まで
  const leftEdge = ringMax != null ? width - ringMax : 0;
  const rightEdge = ringMax ?? width;
  const tagWL = Math.min(DAY_TAG_W, Math.max(0, frontX - 4 - leftEdge));
  const tagWR = ringMax != null ? Math.min(DAY_TAG_W, Math.max(0, rightEdge - (backX + figW + 4))) : tagWL;
  const xL = ringMax != null ? frontX - 4 : tagWL;
  const xR = ringMax != null ? backX + figW + 4 : width - tagWR;
  const layout = layoutCallouts(entries.map((e) => ({ key: e.key, no: e.no, part: e.part })), {
    figureHeight: figH, minHeight: figH, slot: tagHeight(entries), gap: 4, perSide,
  });
  const byKey = new Map(entries.map((e) => [e.key, e]));
  const toScreen = (view: MuscleView, p: { x: number; y: number }) => ({ x: (view === 'front' ? frontX : backX) + p.x * scale, y: band.top + p.y * scale });
  const lines = [...layout.left.map((c) => ({ c, x: xL })), ...layout.right.map((c) => ({ c, x: xR }))]
    .flatMap(({ c, x }) => (c.kind === 'entry' && c.anchor ? [{ key: c.key, x1: x, y1: band.top + c.top + tagHeight(entries) / 2, ...toScreen(c.anchor.view, c.anchor.point) }] : []));
  const paint = musclesForParts(parts);
  const tag = (c: PlacedCallout, side: 'left' | 'right'): ReactNode => {
    const style = { position: 'absolute', left: side === 'left' ? xL - tagWL : xR, top: band.top + c.top, width: side === 'left' ? tagWL : tagWR } as const;
    return c.kind === 'more'
      ? <MoreTag key={`more-${side}`} nos={c.nos} style={style} onPress={onPressEntry && (() => onPressEntry(null))} />
      : <DayBodyTag key={c.key} e={byKey.get(c.key)!} align={side === 'left' ? 'right' : 'left'} style={style} onPress={onPressEntry && (() => onPressEntry(c.key))} />;
  };
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={onPressEntry || onPickPoint ? 'box-none' : 'none'} testID="day-body-2d">
      {(['front', 'back'] as const).map((view) => (
        <View key={view} pointerEvents="none" style={{ position: 'absolute', left: view === 'front' ? frontX : backX, top: band.top }}>
          <MuscleFigure view={view} paint={paint} paintColor={PAINT} fills={fills} width={figW} height={figH} />
        </View>
      ))}
      <Svg width={width} height={band.bottom} style={StyleSheet.absoluteFill} pointerEvents="none">
        {lines.map((l) => <Line key={l.key} x1={l.x1} y1={l.y1} x2={l.x} y2={l.y} stroke={LEADER} strokeOpacity={0.7} strokeWidth={1} />)}
        {lines.map((l) => <Circle key={`d-${l.key}`} cx={l.x} cy={l.y} r={3} fill={isHud ? colors.accent : colors.text} stroke={colors.bg} strokeWidth={1} />)}
      </Svg>
      {shield}
      {/* 図を押す面（shield の上。押せるのは図のところだけで、そこからの横スワイプは親のページの切り替えに回る） */}
      {onPickPoint && (['front', 'back'] as const).map((view) => (
        <PickLayer key={view} testID={`day-body-2d-press-${view}`} scale={scale} onPick={(p) => onPickPoint(view, p)}
          style={{ position: 'absolute', left: view === 'front' ? frontX : backX, top: band.top, width: figW, height: figH }} />
      ))}
      {layout.left.map((c) => tag(c, 'left'))}
      {layout.right.map((c) => tag(c, 'right'))}
    </View>
  );
}


/** 2D の図を押す面（読み上げでは隠す。押した位置は画面の座標から左上を引いて図の座標に直す。web の locationX は押した中の要素からの位置になるため） */
function PickLayer({ scale, onPick, style, testID }: { scale: number; onPick: (p: { x: number; y: number }) => void; style: object; testID: string }) {
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
