// からだのタブの回復マップの体の図（3D）。ケガの画面と同じ場面（components/bodyScene.ts）に、部品ごとの回復の光の明るさを渡す。
// 吹き出しと引き出し線は出さない。ケガの印は控えめ（小さなにじみが脈打つだけ）。左右になぞると回り、押すと部位を選ぶ
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { anchorFor, facingOf, partsFor } from '@/lib/bodyModel';
import { space } from '@/theme';
import { BodyAttribution, BodyCanvas, Fallback } from './bodyCanvas.native';
import { BodyScene, Mark } from './bodyScene';
import type { RecoveryMap3DProps } from './RecoveryMap3D';

/** 図の高さ（px） */
const STAGE_H = 340;
const noTips = () => {};

function Stage({ levels, injuries, selected, onPick }: Omit<RecoveryMap3DProps, 'fallback'>) {
  const reduced = useReducedMotion();
  const [scene] = useState(() => new BodyScene());
  const marks = useMemo<Mark[]>(() => injuries.flatMap((i) => {
    const anchor = anchorFor(i.site, i.side);
    return anchor ? [{ id: i.id, parts: partsFor(i.site, i.side), anchor, facing: facingOf(i.site, i.side), fixing: true }] : [];
  }), [injuries]);
  useEffect(() => {
    scene.configure({ marks, reduced, tipMarks: [], onPick, onTips: noTips, levels, quietMarks: true });
  }, [scene, marks, reduced, onPick, levels]);
  const selKey = selected.join(',');
  // 選んだ部品の名前が同じなら選び直さない
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { scene.select(selected); }, [scene, selKey]);
  return (
    <>
      <View style={{ height: STAGE_H, marginHorizontal: -space.l }}>
        <BodyCanvas scene={scene} />
        {/* なぞる・押すを受ける面（図の上いっぱい） */}
        <View style={StyleSheet.absoluteFill} {...scene.pan.panHandlers} />
      </View>
      <BodyAttribution />
    </>
  );
}

/** 3D の回復マップ。描けないときは fallback（2D の図） */
export function RecoveryMap3D({ fallback, ...props }: RecoveryMap3DProps) {
  return (
    <Fallback fallback={fallback}>
      <Stage {...props} />
    </Fallback>
  );
}
