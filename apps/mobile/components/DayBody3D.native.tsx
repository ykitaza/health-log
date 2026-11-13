// その日の体（3D）：その日のトレーニングの部位を明るいミントで光らせ、種目の札（EX-01〜）を引き出し線でつなぐ（ホームの LATEST。筋トレの記録の画面でも使う予定）。
// 場面は回復マップと同じ（components/bodyScene.ts）。描くのは BodyCanvas（画面を離れた・スクロールして見えないときは止め、触っていないときは 30fps）。
// 札は体が正面を向いたときの位置で止め、線の先だけが部位を追う（回復マップと同じ）。左右になぞると回る
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useReducedMotion, useSharedValue } from 'react-native-reanimated';
import Svg from 'react-native-svg';
import { dayBodyCallouts } from '@/lib/dayBody';
import { recoveryMeshesFor, REST_GREEN } from '@/lib/recoveryMap';
import { colors } from '@/theme';
import { BodyAttribution, BodyCanvas, Fallback, Leader } from './bodyCanvas.native';
import { BodyScene, Mark } from './bodyScene';
import type { DayBody3DProps } from './DayBody3D';
import { DayBodyTag, DAY_TAG_H, DAY_TAG_W, MoreTag } from './dayBodyTag';

/** 鍛えた部位の色（明るいミント。ふだんの体はアクセントの緑） */
const TRAINED = colors.onAccentDark;
const PER_SIDE = 3;
const GAP = 4;

function Stage({ width, height, entries, parts, band }: Omit<DayBody3DProps, 'fallback'>) {
  const reduced = useReducedMotion();
  const [scene] = useState(() => new BodyScene());
  const layout = useMemo(() => dayBodyCallouts(
    entries.map((e) => ({ key: e.key, no: e.no, part: e.part })), width, height,
    { perSide: PER_SIDE, height: DAY_TAG_H, gap: GAP, top: band.top, bottom: band.bottom },
  ), [entries, width, height, band.top, band.bottom]);
  const byKey = useMemo(() => new Map(entries.map((e) => [e.key, e])), [entries]);
  const levels = useMemo(() => Object.fromEntries(parts.flatMap((p) => recoveryMeshesFor(p).map((m) => [m, 1]))), [parts]);
  const tips = useSharedValue<number[]>([]);
  useEffect(() => {
    const tipMarks: Mark[] = layout.placed.map((p) => ({ id: p.key, parts: [], anchor: p.anchor, facing: p.facing, fixing: false }));
    scene.configure({
      marks: [], reduced, tipMarks, onPick: () => {}, onTips: (v) => tips.set(v), levels, quietMarks: true,
      baseColor: REST_GREEN, levelColor: () => TRAINED,
    });
  }, [scene, reduced, layout, levels, tips]);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <BodyCanvas scene={scene} />
      <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
        {layout.placed.map((p, i) => {
          const x = p.side === 'left' ? DAY_TAG_W + 4 : width - DAY_TAG_W - 4;
          return <Leader key={p.key} tips={tips} index={i} from={{ x, y: p.top + 9 }} toRight={p.side === 'left'} color={colors.accent} />;
        })}
      </Svg>
      {layout.placed.map((p) => (
        <DayBodyTag key={p.key} e={byKey.get(p.key)!} align={p.side === 'left' ? 'right' : 'left'}
          style={{ position: 'absolute', [p.side]: 0, top: p.top, width: DAY_TAG_W }} />
      ))}
      {layout.moreTop != null && <MoreTag nos={layout.more} style={{ position: 'absolute', right: 0, top: layout.moreTop }} />}
      {/* なぞると回る面（図の上いっぱい。四隅の押せるものはこの上に重ねる） */}
      <View style={StyleSheet.absoluteFill} {...scene.pan.panHandlers} />
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
