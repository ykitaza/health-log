import { ReactNode, useEffect, useMemo } from 'react';
import { View } from 'react-native';
import {
  Atlas, Blur, BlurMask, Canvas, Circle, DashPathEffect, FilterMode, Group, MipmapMode, Oval, Paint, Path, RadialGradient, rect, Skia, useRSXformBuffer, useTexture, vec,
} from '@shopify/react-native-skia';
import Animated, {
  isSharedValue, SharedValue, useAnimatedStyle, useDerivedValue, useFrameCallback, useReducedMotion, useSharedValue,
} from 'react-native-reanimated';
import { MIN_POINTS } from '@/lib/shapes/attractor';
import { dotStyle, PERSPECTIVE, PlaceFrame, placePoint, pointShown, projectPoint, shapeUnit } from '@/lib/shapes/common';
import { partTip, TIP_STRIDE } from '@/lib/shapes/tree';
import { Orbit, orbitPoint, ORBITS, outerOrbitRadius, SAT_RADIUS } from '@/lib/shapes/orbits';
import type { GrowthParams, SatState, ShapeKind } from '@/lib/shapes/types';
import { growthColors } from '@/theme';
import { T } from '../Text';
import { shapeBuild, SHAPES } from './shapes';

/** 今日の衛星の状態（内側から 筋トレ・食事・睡眠） */
export type SatStates = { training: SatState; food: SatState; sleep: SatState };

export type GrowthShapeProps = {
  shape: ShapeKind;
  /**
   * 記録の値。再生では SharedValue を渡し、UI スレッドで毎フレーム書き換える（React の再描画なしで形が育つ）。
   * 点の並びは最初に1回だけ作り、値からは「出す点の数・広がり・光」だけを決めるので、毎フレーム点を計算し直さない
   */
  params: GrowthParams | SharedValue<GrowthParams>;
  /** 今日の衛星。渡さなければ、軌道も衛星も描かず、形を箱いっぱいに大きく描く（成長を見る画面） */
  sats?: SatStates;
  width: number;
  height: number;
  /** 回す速さの倍率（既定 1）。再生中に速く回して、育つ動きを大きく見せる */
  spin?: number;
  /** true なら回すのを止める（別のタブ、アプリが後ろ、画面の外）。止めているあいだは描き直さない */
  paused?: boolean;
  /** 読み上げの名前。渡さなければ飾りとして扱い、読み上げに出さない */
  accessibilityLabel?: string;
  /**
   * 形全体のぼかし（Skia の Blur の半径）。渡したときだけ、形を1枚の層にまとめてぼかす（成長を見る画面で、カードの後ろに回すとき）。
   * 0 のときも層は作るので、ぼかさないあいだは渡さない
   */
  blur?: SharedValue<number>;
  /**
   * 部位の名前（BALANCE_PARTS の順）。渡すと、木の太い枝の先の近くに小さく薄く出す（揺れと育ち方に合わせて追いかける）。
   * 成長を見る画面でだけ渡す（ホームでは出さない）。部位の枝のない形では出さない
   */
  partNames?: readonly string[];
};

/** Y 軸まわりに1周する秒数 */
const ROTATION_PERIOD_S = 50;
/** 揺れる形（木）が左右に1往復する秒数 */
const SWAY_PERIOD_S = 7;
/** 回し始めの時刻（秒）。動きを減らす設定のときは、この向きで止める */
const START_S = 9;
/** 光る点の絵の大きさ（px）と、画面に出す大きさ（dp、光のにじみを含む）。絵は出す大きさより細かく作り、縮めてもぼやけないようにする */
const SPRITE = 32;
const DOT_DP = 5;
/** 点の芯（くっきりした部分）の、絵の半径に対する割合。その外は薄い光 */
const CORE = 0.3;
/** 絵を縮めるときの補間（なめらかに。指定しないと粗く見える） */
const SAMPLING = { filter: FilterMode.Linear, mipmap: MipmapMode.None };
/** 点1つの濃さ。重なると足し合わせて光るので、密なところだけが明るくなる（濃すぎると白くつぶれる） */
const POINT_ALPHA = 0.42;
/** 形を箱に収めるときの、箱の端との余白（dp。点の半径） */
const FIT_MARGIN = DOT_DP / 2;

const EMPTY: GrowthParams = { volumeKg: 0, foodDays: 0, sleepDays: 0, days: 0, partSets: [0, 0, 0, 0, 0, 0] };
const NO_FILLS: readonly number[] = [];
const NO_GATES = new Float32Array(0);
const SAT_COLORS: Record<Orbit['key'], string> = growthColors;

/** 毎フレーム1回だけ決める値（出す点の数・組と部位の割合・形の大きさ・光・回し方と揺れ） */
type ViewValue = {
  count: number; fills: readonly number[]; growth: readonly number[]; partScale: readonly number[]; unit: number; glow: number; frame: PlaceFrame;
};

/**
 * 記録で育つ形と、今日の衛星。形はゆっくり回る点の群れ（Skia の Atlas で、光る点の絵を数千個まとめて描く）。
 * 点の位置は UI スレッドで毎フレーム計算する（JS スレッドを使わない）。動きを減らす設定なら止まった形を出す
 */
export function GrowthShape({ shape, params, sats, width, height, spin = 1, paused = false, accessibilityLabel, blur, partNames }: GrowthShapeProps) {
  const def = SHAPES[shape];
  const {
    points, tints, gates = NO_GATES, seedY = 0, parts = NO_GATES, partMin = NO_GATES, pivots = NO_GATES, tips = NO_GATES,
  } = useMemo(() => shapeBuild(shape), [shape]);
  // 揺れる形（木）は回さず、根元を中心に左右へ小さく揺らす。再生中も速めない（枝と部位の対応を見やすく）
  const sway = def.sway ?? 0;
  const layout = def.layout;
  const maxPoints = def.maxPoints;
  const tilt = def.tilt;
  // どう回しても、形が画面の上で届く範囲（形の半径を 1 としたとき）
  const extent = def.extent;

  // 値：SharedValue ならそのまま、ふつうの値なら自前の SharedValue に写す
  const own = useSharedValue<GrowthParams>(isSharedValue(params) ? EMPTY : (params as GrowthParams));
  useEffect(() => {
    if (!isSharedValue(params)) own.set(params as GrowthParams);
  }, [params, own]);
  const source = isSharedValue(params) ? (params as SharedValue<GrowthParams>) : own;

  // 時刻（秒）。止めているあいだは進めない
  const reduced = useReducedMotion();
  const seconds = useSharedValue(START_S);
  const spinSV = useSharedValue(spin);
  useEffect(() => {
    spinSV.set(sway > 0 ? 1 : spin);
  }, [spin, spinSV, sway]);
  const clock = useFrameCallback((info) => {
    seconds.set(seconds.get() + ((info.timeSincePreviousFrame ?? 0) / 1000) * spinSV.get());
  }, false);
  const running = !paused && !reduced;
  useEffect(() => {
    clock.setActive(running);
  }, [running, clock]);

  const cx = width / 2;
  const cy = height / 2;
  const orbitY = def.orbitOffsetY * height;
  const outer = outerOrbitRadius(width, height, { x: 0, y: orbitY });
  // 形の大きさ。軌道の中心をずらした形（木）も、ずらさないときと同じ大きさを目安にし、どう回しても箱からはみ出さない大きさに抑える
  const baseUnit = shapeUnit(width, height, extent, sats != null, FIT_MARGIN);

  const tiltCos = Math.cos(tilt);
  const tiltSin = Math.sin(tilt);
  const view = useDerivedValue<ViewValue>(() => {
    const l = layout(source.get());
    const t = seconds.get();
    // 回す形は Y 軸まわりに回す。揺れる形は回さず、回し始めの時刻（動きを減らす設定で止める時刻）で揺れが 0 になるように揺らす
    const a = sway > 0 ? 0 : (t / ROTATION_PERIOD_S) * Math.PI * 2;
    const frame: PlaceFrame = {
      cos: Math.cos(a), sin: Math.sin(a), tiltCos, tiltSin,
      bend: sway > 0 ? sway * Math.sin(((t - START_S) / SWAY_PERIOD_S) * Math.PI * 2) : 0, rootY: seedY,
    };
    return {
      count: l.count, fills: l.fills ?? NO_FILLS, growth: l.parts ?? NO_FILLS, partScale: l.partScale ?? NO_FILLS,
      unit: baseUnit * l.spread, glow: l.glow, frame,
    };
  });

  // 点の大きさと濃さは、形の大きさに合わせる（小さい形で点が重なり、線が太くにじんで見えないように）
  const dot = dotStyle(baseUnit);
  const dotScale = (DOT_DP * dot.size) / SPRITE;
  const half = SPRITE / 2;
  // 点ごとの位置と大きさ。出さない点（並びの先頭から count 個の外、組・部位で出さない点）は大きさ 0 にする
  const transforms = useRSXformBuffer(maxPoints, (val, i) => {
    'worklet';
    const v = view.get();
    const k = Math.min(1, pointShown(i, v.count, gates, v.fills, parts, partMin, v.growth));
    if (k <= 0) {
      val.set(0, 0, 0, 0);
      return;
    }
    // 部位の枝を付け根を中心に縮め、揺らし、Y 軸まわりに回してから X 軸まわりに倒す
    const q = placePoint(points, i, parts, pivots, v.partScale, v.frame);
    const s = dotScale * k * (0.75 + 0.25 * q.p);
    val.set(s, 0, cx + q.x * v.unit - s * half, cy + q.y * v.unit - s * half);
  });

  const sprites = useMemo(() => Array.from({ length: maxPoints }, () => rect(0, 0, SPRITE, SPRITE)), [maxPoints]);
  const palette = def.palette;
  const colors = useMemo(
    () => Array.from(tints, (t) => Skia.Color(mixPalette(palette, t, POINT_ALPHA * dot.alpha))),
    [tints, palette, dot.alpha],
  );
  // 白い光る点の絵（中心が明るく、まわりへ薄れる）。色は点ごとに掛け合わせる
  const texture = useTexture(
    <Circle cx={half} cy={half} r={half}>
      <RadialGradient
        c={vec(half, half)} r={half}
        colors={['#FFFFFF', '#FFFFFF', 'rgba(255,255,255,0.2)', 'rgba(255,255,255,0)']} positions={[0, CORE, CORE + 0.08, 1]}
      />
    </Circle>,
    { width: SPRITE, height: SPRITE },
  );

  const glow = useDerivedValue(() => view.get().glow);
  // 形のまわりの薄い光。箱の端で切れて見えないよう、箱の中で消えきる大きさにする
  const haloMax = Math.min(width, height) / 2;
  const haloR = useDerivedValue(() => Math.max(Math.min(view.get().unit * 1.3, haloMax), 24));
  // 種：記録がまだないときの光る点。点が増えるにつれて消える
  const seedOpacity = useDerivedValue(() => Math.max(0, 1 - view.get().count / MIN_POINTS));
  // 種の位置：形が育ち始める所（木は根元）。形と同じように倒して奥行きをつける
  const seedP = 1 / (1 - seedY * tiltSin * PERSPECTIVE);
  const seedTransform = useDerivedValue(() => [{ translateY: seedY * tiltCos * seedP * view.get().unit }]);


  return (
    <View
      style={{ width, height }}
      pointerEvents="none"
      accessible={accessibilityLabel != null}
      accessibilityRole={accessibilityLabel != null ? 'image' : undefined}
      accessibilityLabel={accessibilityLabel}
      importantForAccessibility={accessibilityLabel != null ? 'yes' : 'no-hide-descendants'}
    >
      <Canvas style={{ width, height }}>
        <Layer blur={blur}>
          {sats && ORBITS.map((o) => (
            <OrbitLine key={o.key} orbit={o} state={sats[o.key]} outer={outer} cx={cx} cy={cy + orbitY} />
          ))}
          <Group opacity={glow}>
            <Circle cx={cx} cy={cy} r={haloR}>
              <RadialGradient c={vec(cx, cy)} r={haloR} colors={[withAlpha(growthColors.training, 0.16), withAlpha(growthColors.training, 0)]} />
            </Circle>
          </Group>
          <Group opacity={seedOpacity} transform={seedTransform}>
            <Circle cx={cx} cy={cy} r={20}>
              <RadialGradient c={vec(cx, cy)} r={20} colors={[withAlpha(growthColors.training, 0.45), withAlpha(growthColors.training, 0)]} />
            </Circle>
            <Circle cx={cx} cy={cy} r={2.5} color="#FFFFFF" />
          </Group>
          <Group opacity={glow}>
            <Atlas image={texture} sprites={sprites} transforms={transforms} colors={colors} colorBlendMode="modulate" blendMode="plus" sampling={SAMPLING} />
          </Group>
          {sats && ORBITS.map((o) => (
            <Satellite key={o.key} orbit={o} state={sats[o.key]} outer={outer} cx={cx} cy={cy + orbitY} seconds={seconds} />
          ))}
        </Layer>
      </Canvas>
      {partNames && tips.length > 0 && partNames.map((name, p) => (
        <PartName key={name} name={name} part={p} view={view} tips={tips} pivots={pivots} cx={cx} cy={cy} width={width} />
      ))}
    </View>
  );
}

/** 部位の名前の箱の幅と、枝の先からのすき間（dp） */
const NAME_W = 48;
const NAME_GAP = 4;
/** 部位の名前の文字の色（白の 60%） */
const NAME_COLOR = 'rgba(255,255,255,0.6)';

/**
 * 木の太い枝の先の近くに置く、部位の名前（11sp・白の 60%）。枝の先が左なら名前を左に、右なら右に置き、
 * 揺れと育ち方（長さ・段数・出ている点の数）に合わせて UI スレッドで追いかける。その部位の枝がまだ出ていなければ出さない
 */
function PartName({ name, part, view, tips, pivots, cx, cy, width }: {
  name: string; part: number; view: SharedValue<ViewValue>; tips: Float32Array; pivots: Float32Array; cx: number; cy: number; width: number;
}) {
  const left = isLeftPart(tips, pivots, part);
  const style = useAnimatedStyle(() => {
    const v = view.get();
    const tip = partTip(tips, pivots, part, v.count, v.growth[part] ?? 0, v.partScale[part] ?? 1);
    if (!tip) return { opacity: 0, transform: [{ translateX: 0 }, { translateY: 0 }] };
    const q = projectPoint(tip.x, tip.y, tip.z, v.frame);
    const x = cx + q.x * v.unit;
    const y = cy + q.y * v.unit;
    const tx = Math.min(width - NAME_W, Math.max(0, left ? x - NAME_GAP - NAME_W : x + NAME_GAP));
    return { opacity: 1, transform: [{ translateX: tx }, { translateY: y - 16 }] };
  });
  return (
    <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: NAME_W }, style]} pointerEvents="none" importantForAccessibility="no">
      <T size={11} color={NAME_COLOR} align={left ? 'right' : 'left'} numberOfLines={1}>{name}</T>
    </Animated.View>
  );
}

/** 部位の枝が左へ伸びるか（その部位の枝の先の候補の平均が、付け根より左） */
function isLeftPart(tips: Float32Array, pivots: Float32Array, part: number): boolean {
  let sum = 0;
  for (let k = 0; k < tips.length; k += TIP_STRIDE) if (tips[k] === part) sum += tips[k + 4] - pivots[part * 3];
  return sum < 0;
}

/** blur を渡したときだけ、中身を1枚の層にまとめてぼかす（渡さなければ、そのまま描く） */
function Layer({ blur, children }: { blur?: SharedValue<number>; children: ReactNode }) {
  if (!blur) return <>{children}</>;
  return <Group layer={<Paint><Blur blur={blur} mode="decal" /></Paint>}>{children}</Group>;
}

type OrbitProps = { orbit: Orbit; state: SatState; outer: number; cx: number; cy: number };

/** 軌道の線。衛星がいない（none）ときは点線 */
function OrbitLine({ orbit, state, outer, cx, cy }: OrbitProps) {
  const ax = outer * orbit.radius;
  const ay = ax * orbit.aspect;
  return (
    <Group transform={[{ rotate: orbit.tilt }]} origin={vec(cx, cy)}>
      <Oval rect={rect(cx - ax, cy - ay, ax * 2, ay * 2)} style="stroke" strokeWidth={1}
        color={withAlpha(SAT_COLORS[orbit.key], state === 'bright' ? 0.4 : state === 'dim' ? 0.24 : 0.32)}>
        {state === 'none' && <DashPathEffect intervals={[2, 5]} />}
      </Oval>
    </Group>
  );
}

/** 軌道の上をゆっくり回る衛星。形（丸・ひし形・輪）でも見分けられる。dim は薄く、bright は光をまとう */
function Satellite({ orbit, state, outer, cx, cy, seconds }: OrbitProps & { seconds: SharedValue<number> }) {
  const transform = useDerivedValue(() => {
    const p = orbitPoint(orbit, outer, seconds.get());
    return [{ translateX: cx + p.x }, { translateY: cy + p.y }];
  });
  if (state === 'none') return null;
  const color = SAT_COLORS[orbit.key];
  return (
    <Group transform={transform} opacity={state === 'bright' ? 1 : 0.4}>
      {state === 'bright' && (
        <Circle cx={0} cy={0} r={SAT_RADIUS * 1.6} color={withAlpha(color, 0.55)}>
          <BlurMask blur={6} style="normal" />
        </Circle>
      )}
      {orbit.mark === 'dot' && <Circle cx={0} cy={0} r={SAT_RADIUS - 0.5} color={color} />}
      {orbit.mark === 'diamond' && <Path path={DIAMOND} color={color} />}
      {orbit.mark === 'ring' && <Circle cx={0} cy={0} r={SAT_RADIUS - 1} color={color} style="stroke" strokeWidth={2} />}
    </Group>
  );
}

const DIAMOND = `M0 ${-SAT_RADIUS - 1}L${SAT_RADIUS + 1} 0L0 ${SAT_RADIUS + 1}L${-SAT_RADIUS - 1} 0Z`;

/** '#RRGGBB' を、透明度つきの rgba() に */
function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** 並んだ色（palette）の、t（0〜1）の位置の色。あいだはとなりの2色を混ぜる */
function mixPalette(palette: readonly string[], t: number, alpha: number): string {
  const pos = Math.min(1, Math.max(0, t)) * (palette.length - 1);
  const j = Math.min(palette.length - 2, Math.floor(pos));
  const a = rgb(palette[j]);
  const b = rgb(palette[j + 1]);
  const [r, g, bl] = a.map((v, i) => Math.round(v + (b[i] - v) * (pos - j)));
  return `rgba(${r},${g},${bl},${alpha})`;
}

function rgb(hex: string): number[] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}
