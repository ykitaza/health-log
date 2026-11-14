// その日の体（3D）：その日のトレーニングの部位を明るいミントで光らせ、種目の札（EX-01〜）を引き出し線でつなぐ（ホームの LATEST と、筋トレの記録の画面）。
// 記録の画面の記録のない日は、前回の部位をミントで光らせ、回復中の部位（暖色）とケガ（赤）を重ねる（回復マップと同じ色。ミントより優先）。
// 場面は回復マップと同じ（components/bodyScene.ts）。描くのは BodyCanvas（画面を離れた・スクロールして見えないときは止め、触っていないときは 30fps）。
// 札は体が正面を向いたときの位置で止め、線の先だけが部位を追う（回復マップと同じ）。左右になぞると回る
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useReducedMotion, useSharedValue } from 'react-native-reanimated';
import Svg from 'react-native-svg';
import type { Injury } from '@/db/repositories/injuries';
import { anchorFor, facingOf, partsFor } from '@/lib/bodyModel';
import { dayBodyCallouts, dayBodyGlow } from '@/lib/dayBody';
import { INJURY_RED, recoveryColor } from '@/lib/recoveryMap';
import { colors, recoveryPalette, TRAINED_GLOW } from '@/theme';
import { BodyAttribution, BodyCanvas, Fallback, Leader } from './bodyCanvas.native';
import { BodyScene, Mark } from './bodyScene';
import type { DayBody3DProps } from './DayBody3D';
import { DayBodyTag, DAY_TAG_H, DAY_TAG_W, MoreTag } from './dayBodyTag';

const PER_SIDE = 3;
const GAP = 4;
const NO_RECOVERY: Record<string, number> = {};
const NO_INJURIES: Injury[] = [];
const NO_IDLE: string[] = [];

function Stage({ width, height, entries, parts, band, recovery = NO_RECOVERY, idle = NO_IDLE, injuries = NO_INJURIES, onPick, onPressEntry, shield }: Omit<DayBody3DProps, 'fallback'>) {
  const reduced = useReducedMotion();
  const [scene] = useState(() => new BodyScene());
  const layout = useMemo(() => dayBodyCallouts(
    entries.map((e) => ({ key: e.key, no: e.no, part: e.part })), width, height,
    { perSide: PER_SIDE, height: DAY_TAG_H, gap: GAP, top: band.top, bottom: band.bottom },
  ), [entries, width, height, band.top, band.bottom]);
  const byKey = useMemo(() => new Map(entries.map((e) => [e.key, e])), [entries]);
  const glow = useMemo(() => dayBodyGlow(parts, recovery), [parts, recovery]);
  // ケガの印（回復マップと同じ：控えめに赤で脈打つ）
  const marks = useMemo<Mark[]>(() => injuries.flatMap((i) => {
    const anchor = anchorFor(i.site, i.side);
    return anchor ? [{ id: i.id, parts: partsFor(i.site, i.side), anchor, facing: facingOf(i.site, i.side), fixing: true }] : [];
  }), [injuries]);
  // 押したときは最新の onPick を呼ぶ（渡す関数が変わっても場面を設定し直さない）
  const pick = useRef(onPick);
  useLayoutEffect(() => { pick.current = onPick; });
  const tips = useSharedValue<number[]>([]);
  useEffect(() => {
    const tipMarks: Mark[] = layout.placed.map((p) => ({ id: p.key, parts: [], anchor: p.anchor, facing: p.facing, fixing: false }));
    scene.configure({
      marks, reduced, tipMarks, onPick: (m) => pick.current?.(m), onTips: (v) => tips.set(v), levels: glow.levels, quietMarks: true,
      baseColor: recoveryPalette.rest, levelColor: (k, mesh) => (glow.warm.has(mesh) ? recoveryColor(k, recoveryPalette) : TRAINED_GLOW), injuryColor: INJURY_RED,
      idle, idleColor: recoveryPalette.idle,
    });
  }, [scene, reduced, layout, glow, idle, marks, tips]);
  const tags = (
    <>
      {layout.placed.map((p) => (
        <DayBodyTag key={p.key} e={byKey.get(p.key)!} align={p.side === 'left' ? 'right' : 'left'}
          style={{ position: 'absolute', [p.side]: 0, top: p.top, width: DAY_TAG_W }} onPress={onPressEntry && (() => onPressEntry(p.key))} />
      ))}
      {layout.moreTop != null && (
        <MoreTag nos={layout.more} style={{ position: 'absolute', right: 0, top: layout.moreTop }} onPress={onPressEntry && (() => onPressEntry(null))} />
      )}
    </>
  );
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <BodyCanvas scene={scene} />
      <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
        {layout.placed.map((p, i) => {
          const x = p.side === 'left' ? DAY_TAG_W + 4 : width - DAY_TAG_W - 4;
          return <Leader key={p.key} tips={tips} index={i} from={{ x, y: p.top + 9 }} toRight={p.side === 'left'} color={colors.accent} />;
        })}
      </Svg>
      {!onPressEntry && tags}
      {/* なぞると回る面（図の上いっぱい。四隅の押せるものはこの上に重ねる） */}
      <View style={StyleSheet.absoluteFill} {...scene.pan.panHandlers} />
      {shield}
      {/* 押せる札（ホームの LATEST）は、回す面と shield の上に出す。札は体の列の外なので、札から回し始めることはない */}
      {onPressEntry && tags}
    </View>
  );
}

/** 3D のその日の体。描けないときは fallback（2D の図） */
export function DayBody3D({ fallback, ...props }: DayBody3DProps) {
  return (
    <Fallback fallback={fallback}>
      <Stage {...props} />
    </Fallback>
  );
}

export const DayBodyAttribution = BodyAttribution;
