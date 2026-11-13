// ホームのヒーローの INJURY の 3D の体。場面は回復マップ・ケガの画面と同じ（components/bodyScene.ts）。
// ふだんの緑の体に、直している途中のケガを赤の印と札（INJ-01 ▲）で示す（ケガの画面と同じ形。RECOVERY はその日の体 DayBody の recovery を使う）。札は体が正面を向いたときの位置で止め、線の先だけが部位を追う。
// 回す操作は体の列（rotate）の上だけで受ける。その外の横スワイプは、ヒーローのページの切り替えに渡す
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useReducedMotion, useSharedValue } from 'react-native-reanimated';
import Svg from 'react-native-svg';
import { anchorFor, facingOf, layoutCallouts, partsFor } from '@/lib/bodyModel';
import { INJURY_RED, REST_GREEN } from '@/lib/recoveryMap';
import { BodyCanvas, Fallback, Leader } from './bodyCanvas.native';
import { BodyScene, Mark } from './bodyScene';
import { HERO_TAG_H, HERO_TAG_W, HeroInjuryTag } from './heroInjuryTag';
import type { HeroBody3DProps } from './HeroBody3D';

const PER_SIDE = 2;

function Stage({ width, height, band, injuries, numbers, rotate }: Omit<HeroBody3DProps, 'fallback'>) {
  const reduced = useReducedMotion();
  const [scene] = useState(() => new BodyScene());
  const marks = useMemo<Mark[]>(() => injuries.flatMap((i) => {
    const anchor = anchorFor(i.site, i.side);
    return anchor ? [{ id: i.id, parts: partsFor(i.site, i.side), anchor, facing: facingOf(i.site, i.side), fixing: true }] : [];
  }), [injuries]);
  // 札。左右それぞれ 2 つまで、四隅の数字の間に収める（下へはみ出したら、側ごとに下から詰め直して重ねない）
  const places = useMemo(() => {
    const raw = layoutCallouts(
      marks.map((m) => ({ id: m.id, anchor: m.anchor, facing: m.facing, fixing: true, occurredOn: injuries.find((i) => i.id === m.id)!.occurredOn })),
      width, height, { perSide: PER_SIDE, height: HERO_TAG_H },
    );
    return (['left', 'right'] as const).flatMap((side) => {
      const list = raw.filter((p) => p.side === side).map((p) => ({ ...p, top: Math.max(p.top, band.top) }));
      let limit = band.bottom - HERO_TAG_H;
      for (let i = list.length - 1; i >= 0; i--) { list[i].top = Math.max(band.top, Math.min(list[i].top, limit)); limit = list[i].top - HERO_TAG_H - 4; }
      return list;
    });
  }, [marks, injuries, width, height, band.top, band.bottom]);
  const tips = useSharedValue<number[]>([]);
  useEffect(() => {
    scene.configure({
      marks, reduced, tipMarks: places.map((p) => marks.find((m) => m.id === p.id)!), onPick: () => {}, onTips: (v) => tips.set(v),
      baseColor: REST_GREEN, injuryColor: INJURY_RED,
    });
  }, [scene, marks, reduced, places, tips]);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <BodyCanvas scene={scene} />
      <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
        {places.map((p, i) => {
          const x = p.side === 'left' ? HERO_TAG_W + 4 : width - HERO_TAG_W - 4;
          return <Leader key={p.id} tips={tips} index={i} from={{ x, y: p.top + 9 }} toRight={p.side === 'left'} color={INJURY_RED} />;
        })}
      </Svg>
      {places.map((p) => (
        <HeroInjuryTag key={p.id} injury={injuries.find((i) => i.id === p.id)!} number={numbers.get(p.id) ?? ''} align={p.side === 'left' ? 'right' : 'left'}
          style={{ position: 'absolute', [p.side]: 0, top: p.top, width: HERO_TAG_W }} />
      ))}
      {/* なぞると回る面（体の列だけ。四隅の押せるものはこの上に重ねる） */}
      <View style={{ position: 'absolute', top: 0, bottom: 0, left: rotate.left, width: rotate.width }} {...scene.pan.panHandlers} />
    </View>
  );
}

/** 3D のヒーローの体。描けないときは fallback（2D の図） */
export function HeroBody3D({ fallback, ...props }: HeroBody3DProps) {
  return (
    <Fallback fallback={fallback}>
      <Stage {...props} />
    </Fallback>
  );
}
