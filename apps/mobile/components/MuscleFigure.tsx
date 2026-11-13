import { useEffect, useRef } from 'react';
import { Pressable, View, ViewInstance } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Circle, ClipPath, Defs, G, Path, Rect } from 'react-native-svg';
import type { InjuryStatus, Side } from '@/lib/injuries';
import {
  FIGURE_PIECES, FigurePiece, FigureTarget, jointPoints, JOINT_RADIUS, markPoint, Muscle, muscleFigureFor, MuscleView, piecesFor, pickTarget,
} from '@/lib/muscleFigure';
import { BODY } from '@/lib/muscleFigurePaths';
import { colors, figureColors, toneColors } from '@/theme';

/** ケガの印の色。直している途中は琥珀色（責める感じにしない。レポートの「気をつけたい」と同じ）、直せたは控えめな緑 */
export const INJURY_AMBER = toneColors.caution.accent;
const FIXED_RING = colors.accentMuted;

/** 脈打つ印の周期（直している途中のケガだけ。ゆっくり） */
export const PULSE_MS = 2000;

/** 図に付けるケガの印 */
export type FigureMark = { key: string; site: string; side: Side | null; status: InjuryStatus };

type Props = {
  /** 部位の名前（最近の流れ：その部位の筋肉を緑で塗る）。view を渡したときは使わない */
  name?: string;
  /** ケガの図：前か後ろ（paint と使うときは、記録の画面の図の向き） */
  view?: MuscleView;
  /** 塗る筋肉（記録の画面：その日に鍛えた部位の筋肉を緑で塗る。この図にない筋肉は塗らない） */
  paint?: Muscle[];
  /** 筋肉ごとの塗りの色（回復マップ：温存は青、最近の負荷は暖色）。渡した筋肉は paint より先 */
  fills?: Partial<Record<Muscle, string>>;
  /** ケガの印の色（回復マップは赤）。渡さなければ琥珀色 */
  markColor?: string;
  width: number;
  height: number;
  /** ケガの印（この図に置くものだけを描く。lib/muscleFigure.ts の markPoint） */
  marks?: FigureMark[];
  /** 選んだ部位（琥珀色で塗る） */
  selected?: { site: string; side: Side | null } | null;
  /** 押して部位を選ぶ（押した点のいちばん近い部位。体の外なら null）。渡すと関節の押せる点も出す */
  onPick?: (target: FigureTarget | null, point: { x: number; y: number }) => void;
  testID?: string;
};

/**
 * 筋肉の図（100×200 の体）：体の前か後ろを、左右に分けた筋肉の片で描く。
 * - name を渡すと（最近の流れ）、その部位の筋肉だけをアクセントの緑で塗る。向きと塗る筋肉は lib/muscleFigure.ts の muscleFigureFor
 * - view と paint を渡すと（記録の画面）、その向きの図で paint の筋肉を緑で塗る
 * - view を渡すとケガの図：選んだ部位を琥珀色で塗り、ケガの印（直している途中は琥珀色の塗りと二重の輪・光、直せたは緑の中抜きの輪）を置く。
 *   onPick を渡すと、図を押して部位を選べる（関節の点も出す）。図の上の部位は小さいので、画面には近くの部位のチップを添える（48dp）
 * 前の図は画面の左が本人の右、後ろの図は画面の左が本人の左
 */
export function MuscleFigure({ name, view: injuryView, paint, fills, markColor = INJURY_AMBER, width, height, marks = [], selected, onPick, testID }: Props) {
  const box = useRef<ViewInstance>(null);
  const spec = name != null && injuryView == null ? muscleFigureFor(name) : null;
  const view = injuryView ?? spec?.view ?? 'front';
  const painted = new Set(paint ?? spec?.muscles ?? []);
  const chosen = new Set(selected ? piecesFor(view, selected.site, selected.side) : []);
  const placed = marks.map((m) => ({ m, at: markPoint(m.site, m.side) })).filter(({ at }) => at?.view === view);
  const scale = width / 100;
  const pieceFill = (p: FigurePiece) => (chosen.has(p) ? INJURY_AMBER : fills?.[p.muscle] ?? (painted.has(p.muscle) ? colors.accent : figureColors.muscle));
  // 直している途中のケガの筋肉は琥珀色で塗る（関節は点で示す）
  const hurt = new Set(placed.filter(({ m }) => m.status === 'fixing').flatMap(({ m }) => piecesFor(view, m.site, m.side)));

  const svg = (
    <Svg width={width} height={height} viewBox="0 0 100 200">
      <Defs>
        <ClipPath id={`fig-left-${view}`}><Rect x={0} y={0} width={50} height={200} /></ClipPath>
        <ClipPath id={`fig-right-${view}`}><Rect x={50} y={0} width={50} height={200} /></ClipPath>
      </Defs>
      <Path d={BODY[view]} fill={figureColors.body} />
      {FIGURE_PIECES[view].map((p) => (
        <G key={`${p.muscle}-${p.side}-${p.clip ?? ''}`} clipPath={p.clip ? `url(#fig-${p.clip}-${view})` : undefined}>
          <Path d={p.d} fill={hurt.has(p) && !chosen.has(p) ? markColor : pieceFill(p)} fillOpacity={hurt.has(p) && !chosen.has(p) ? 0.85 : 1} />
        </G>
      ))}
      {onPick && jointPoints(view).map((j) => {
        const on = selected && j.site === selected.site && (selected.side == null || j.side == null || j.side === selected.side);
        return (
          <Circle key={`${j.site}-${j.side}`} cx={j.center.x} cy={j.center.y} r={JOINT_RADIUS - 0.8}
            fill={on ? INJURY_AMBER : colors.bg} stroke={on ? INJURY_AMBER : colors.sub} strokeWidth={0.8} />
        );
      })}
      {placed.map(({ m, at }) => (m.status === 'fixing' ? (
        <G key={m.key}>
          <Circle cx={at!.point.x} cy={at!.point.y} r={9} fill={markColor} fillOpacity={0.18} />
          <Circle cx={at!.point.x} cy={at!.point.y} r={2.4} fill={markColor} />
          <Circle cx={at!.point.x} cy={at!.point.y} r={4.5} fill="none" stroke={markColor} strokeWidth={1} />
          <Circle cx={at!.point.x} cy={at!.point.y} r={7} fill="none" stroke={markColor} strokeWidth={0.6} strokeOpacity={0.6} />
        </G>
      ) : (
        <Circle key={m.key} cx={at!.point.x} cy={at!.point.y} r={3.5} fill="none" stroke={FIXED_RING} strokeWidth={1.2} />
      )))}
    </Svg>
  );

  const pulses = placed.filter(({ m }) => m.status === 'fixing').map(({ m, at }) => (
    <Pulse key={m.key} x={at!.point.x * scale} y={at!.point.y * scale} size={14 * scale} color={markColor} />
  ));

  if (!onPick) {
    return (
      <View style={{ width, height }} testID={testID} pointerEvents="none">
        {svg}
        {pulses}
      </View>
    );
  }
  // 図は押した点で部位を決める（Pressable の中の位置を図の座標に直す）。読み上げでは使えないので、画面に一覧から選ぶ入口を置く
  return (
    <Pressable
      testID={testID}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      ref={box}
      onPress={(e) => {
        // 押した位置は画面の座標から図の左上を引いて求める（locationX は、web では押した中の要素（筋肉のパス）からの位置になるため）
        const { pageX, pageY } = e.nativeEvent;
        box.current?.measure((_x, _y, _w, _h, left, top) => {
          const p = { x: (pageX - left) / scale, y: (pageY - top) / scale };
          onPick(pickTarget(view, p), p);
        });
      }}
      style={{ width, height }}
    >
      <View pointerEvents="none">
        {svg}
        {pulses}
      </View>
    </Pressable>
  );
}

/** 直している途中の印の、ゆっくり広がって消える輪（2秒の周期）。動きを減らす設定なら出さない */
function Pulse({ x, y, size, color }: { x: number; y: number; size: number; color: string }) {
  const reduced = useReducedMotion();
  const t = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    t.set(withRepeat(withTiming(1, { duration: PULSE_MS, easing: Easing.out(Easing.quad) }), -1, false));
    return () => cancelAnimation(t);
  }, [reduced, t]);
  const style = useAnimatedStyle(() => ({ opacity: 0.6 * (1 - t.get()), transform: [{ scale: 0.6 + t.get() * 0.9 }] }));
  if (reduced) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: 'absolute', left: x - size / 2, top: y - size / 2, width: size, height: size, borderRadius: size / 2, borderWidth: 1.5, borderColor: color }, style]}
    />
  );
}
