// からだのタブの回復マップの体の図（3D）。ケガの画面と同じ場面（components/bodyScene.ts）に、部品ごとの回復の光の明るさを渡す。
// 色は、回復済みは緑（ケガの画面のふだんと同じ）、回復中は暖色（明るさが高いほど橙）、直している途中のケガは赤で脈打つ。空いている・まだは灰色。
// 回復中とケガのある部位には、引き出し線つきの札（注釈）を付ける。札は体が正面を向いたときの位置で止め、線の先だけが部位を追う
// （ケガの画面と同じ）。左右になぞると回り、押すと部位を選ぶ
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useReducedMotion, useSharedValue } from 'react-native-reanimated';
import Svg from 'react-native-svg';
import { anchorFor, facingOf, layoutCallouts, partsFor } from '@/lib/bodyModel';
import { INJURY_RED, recoveryColor } from '@/lib/recoveryMap';
import { recoveryPalette, space } from '@/theme';
import { BodyAttribution, BodyCanvas, Fallback, Leader } from './bodyCanvas.native';
import { BodyScene, Mark } from './bodyScene';
import { Mono } from './injuries';
import type { RecoveryCallout, RecoveryMap3DProps } from './RecoveryMap3D';
import { T } from './Text';

/** 図の高さ（px） */
const STAGE_H = 340;
/** 札の幅・高さ（px）と、左右それぞれに出す数 */
const CALLOUT_W = 92;
const CALLOUT_H = 52;
const PER_SIDE = 3;

function Stage({ levels, idle, injuries, selected, onPick, callouts }: Omit<RecoveryMap3DProps, 'fallback'>) {
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const [scene] = useState(() => new BodyScene());
  const marks = useMemo<Mark[]>(() => injuries.flatMap((i) => {
    const anchor = anchorFor(i.site, i.side);
    return anchor ? [{ id: i.id, parts: partsFor(i.site, i.side), anchor, facing: facingOf(i.site, i.side), fixing: true }] : [];
  }), [injuries]);
  // 札の置き場所（ケガのある部位を先に、最後に鍛えた日の新しい順。左右それぞれ3つまで。超えた分は一覧にだけ出る）
  const places = useMemo(() => (width > 0 ? layoutCallouts(
    callouts.map((c) => ({ id: c.id, anchor: c.anchor, facing: c.facing, fixing: c.hurt, occurredOn: c.last })),
    width, STAGE_H, { perSide: PER_SIDE, height: CALLOUT_H },
  ) : []), [callouts, width]);
  const byId = useMemo(() => new Map(callouts.map((c) => [c.id, c])), [callouts]);
  const tips = useSharedValue<number[]>([]);
  useEffect(() => {
    const tipMarks: Mark[] = places.map((p) => {
      const c = byId.get(p.id)!;
      return { id: c.id, parts: [], anchor: c.anchor, facing: c.facing, fixing: false };
    });
    scene.configure({
      marks, reduced, tipMarks, onPick, onTips: (v) => tips.set(v), levels, quietMarks: true,
      baseColor: recoveryPalette.rest, levelColor: (k) => recoveryColor(k, recoveryPalette), injuryColor: INJURY_RED, idle, idleColor: recoveryPalette.idle,
    });
  }, [scene, marks, reduced, onPick, levels, idle, places, byId, tips]);
  const selKey = selected.join(',');
  // 選んだ部品の名前が同じなら選び直さない
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { scene.select(selected); }, [scene, selKey]);
  return (
    <>
      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height: STAGE_H, marginHorizontal: -space.l }}>
        {width > 0 && (
          <>
            <BodyCanvas scene={scene} />
            <Svg width={width} height={STAGE_H} style={StyleSheet.absoluteFill} pointerEvents="none">
              {places.map((p, i) => {
                const x = p.side === 'left' ? space.l + CALLOUT_W + 4 : width - space.l - CALLOUT_W - 4;
                return <Leader key={p.id} tips={tips} index={i} from={{ x, y: p.top + 9 }} toRight={p.side === 'left'} color={byId.get(p.id)!.color} />;
              })}
            </Svg>
            {/* 札は読み上げでは読まない（下の一覧で同じことを読む） */}
            {places.map((p) => (
              <CalloutTag key={p.id} c={byId.get(p.id)!} align={p.side === 'left' ? 'right' : 'left'}
                style={{ [p.side]: space.l, top: p.top, width: CALLOUT_W, maxHeight: CALLOUT_H }} />
            ))}
            {/* なぞる・押すを受ける面（図の上いっぱい） */}
            <View style={StyleSheet.absoluteFill} {...scene.pan.panHandlers} />
          </>
        )}
      </View>
      <BodyAttribution />
    </>
  );
}

/** 注釈の札：英字の部位名（Mono）、日本語名、状態かケガ。左の札は右寄せ（線のほうへ寄せる） */
function CalloutTag({ c, align, style }: { c: RecoveryCallout; align: 'left' | 'right'; style: object }) {
  return (
    <View
      pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden
      style={[s.tag, { borderColor: c.color, alignItems: align === 'right' ? 'flex-end' : 'flex-start' }, style]}
    >
      <Mono color={c.color} size={11}>{c.en}</Mono>
      <T variant="labelM" numberOfLines={1}>{c.name}</T>
      <T size={11} color={c.color} numberOfLines={1}>{c.injury ?? c.status}</T>
    </View>
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

const s = StyleSheet.create({
  tag: {
    position: 'absolute', backgroundColor: 'rgba(14,16,19,0.72)', borderLeftWidth: 0, borderRightWidth: 0, borderTopWidth: 1, borderBottomWidth: 0,
    paddingHorizontal: 4, paddingVertical: 2,
  },
});
