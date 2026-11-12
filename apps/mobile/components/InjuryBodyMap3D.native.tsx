// ケガの画面の体の図（3D）。BodyParts3D を軽くした体（assets/models/body.glb）を、ホログラムのように光らせて回す。
// 直している途中の部位は琥珀色で脈打ち、直せた部位は控えめな緑。吹き出しは体が正面を向いたときの位置で止めておき、
// 引き出し線の先だけが回る部位を追う（2026-11-12 ユーザーの要望）。左右になぞると回り、押すと部位の名前が出る。
// web（e2e）では読まない（InjuryBodyMap3D.tsx が null を出し、2D の図を使う）
/* eslint-disable react/no-unknown-property -- R3F の <primitive object> は three.js の物を渡す決まりの属性（DOM の属性ではない） */
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber/native';
import { useFocusEffect } from 'expo-router';
import { Component, ReactNode, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, SharedValue, useAnimatedProps, useReducedMotion, useSharedValue } from 'react-native-reanimated';
import Svg, { Circle, Line } from 'react-native-svg';
import { GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import MODEL from '@/assets/models/body.glb';
import type { Injury } from '@/db/repositories/injuries';
import { anchorFor, CALLOUT_H, CAMERA, facingOf, layoutCallouts, partsFor, siteOfPart } from '@/lib/bodyModel';
import { siteLabel } from '@/lib/injuries';
import { ensureTextDecoder } from '@/lib/utf8';
import { colors, space } from '@/theme';
import { InjuryBodyMap, Mono, ScanFrame, SideCallout } from './injuries';
import { INJURY_AMBER } from './MuscleFigure';
import { BodyScene, Mark } from './bodyScene';
import { T } from './Text';

// GLTFLoader は GLB の見出しを TextDecoder で読む。無い JS エンジンに備える
ensureTextDecoder();

/** 出典のリンク（BodyParts3D のライセンスと元のデータ） */
const LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/';
const SOURCE_URL = 'https://dbarchive.biosciencedbc.jp/en/bodyparts3d/desc.html';
/** 図の高さ（px） */
const STAGE_H = 380;
/** 吹き出しの幅（px） */
const CALLOUT_W = 96;

/** 引き出し線の先（画面の px）と、表を向いているか。吹き出しごとに x, y, facing（1 / 0）の3つずつ */
type Tips = SharedValue<number[]>;

/** Canvas の中：体を読み込み、毎コマ BodyScene を進める */
function Scene({ scene }: { scene: BodyScene }) {
  // MODEL は require の番号（R3F の native の読み込みが expo-asset で開く）。1つだけ読むので配列にはならない
  const gltf = useLoader(GLTFLoader, MODEL as unknown as string) as GLTF;
  const { camera, size } = useThree();
  scene.setModel(gltf.scene);
  useEffect(() => { camera.lookAt(...CAMERA.target); }, [camera]);
  useFrame((state, delta) => scene.frame(camera, size.width, size.height, state.clock.elapsedTime, delta));
  return (
    <>
      <primitive object={scene.body} />
      <primitive object={scene.deck} />
      <primitive object={scene.scanRing} />
      <primitive object={scene.glowGroup} />
    </>
  );
}

const ALine = Animated.createAnimatedComponent(Line);
const ACircle = Animated.createAnimatedComponent(Circle);

/** 吹き出しの横から、印へのびる引き出し線（先だけが毎コマ動く。React の描き直しはしない） */
function Leader({ tips, index, from, toRight, color }: { tips: Tips; index: number; from: { x: number; y: number }; toRight: boolean; color: string }) {
  const kx = from.x + (toRight ? 14 : -14);
  const line = useAnimatedProps(() => {
    const v = tips.value;
    const f = v[index * 3 + 2] ?? 0;
    return { x2: v[index * 3] ?? from.x, y2: v[index * 3 + 1] ?? from.y, strokeOpacity: f ? 0.85 : 0.35 };
  });
  const dot = useAnimatedProps(() => {
    const v = tips.value;
    const f = v[index * 3 + 2] ?? 0;
    return { cx: v[index * 3] ?? from.x, cy: v[index * 3 + 1] ?? from.y, r: f ? 3 : 2, fillOpacity: f ? 1 : 0 };
  });
  return (
    <>
      <Line x1={from.x} y1={from.y} x2={kx} y2={from.y} stroke={color} strokeWidth={1} strokeOpacity={0.85} />
      <ALine animatedProps={line} x1={kx} y1={from.y} stroke={color} strokeWidth={1} />
      <ACircle animatedProps={dot} fill={color} stroke={color} strokeWidth={1} />
    </>
  );
}

/** 3D が描けないとき（GL を作れない、形を読めない）は、2D の図に戻す */
class Fallback extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/**
 * 一覧の上の体の図（BODY MAP // SCAN、3D）。左右になぞると回り、押すと部位の名前が出る。
 * 吹き出しは左右それぞれ2つまで（直している途中を先に、痛めた日の新しい順）。読み上げでは件数だけを読む
 */
function BodyMap3D({ injuries, numbers }: { injuries: Injury[]; numbers: Map<string, string> }) {
  const [width, setWidth] = useState(0);
  const [focused, setFocused] = useState(true);
  const [picked, setPicked] = useState<string | null>(null);
  const reduced = useReducedMotion();
  const [scene] = useState(() => new BodyScene());
  const active = injuries.filter((i) => i.status === 'fixing').length;
  const cleared = injuries.length - active;

  // 画面から離れたら描くのを止める（電池）
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));

  const marks = useMemo<Mark[]>(() => injuries.flatMap((i) => {
    const anchor = anchorFor(i.site, i.side);
    if (!anchor) return [];
    return [{ id: i.id, parts: partsFor(i.site, i.side), anchor, facing: facingOf(i.site, i.side), fixing: i.status === 'fixing' }];
  }), [injuries]);
  const places = useMemo(() => (width > 0 ? layoutCallouts(injuries.flatMap((i) => {
    const m = marks.find((k) => k.id === i.id);
    return m ? [{ id: i.id, anchor: m.anchor, facing: m.facing, fixing: m.fixing, occurredOn: i.occurredOn }] : [];
  }), width, STAGE_H) : []), [injuries, marks, width]);
  const tips = useSharedValue<number[]>([]);
  // 光らせるのはすべてのケガ、引き出し線の先は吹き出しを出すケガの分だけ
  useEffect(() => {
    scene.configure({
      marks, reduced, tipMarks: places.map((p) => marks.find((m) => m.id === p.id)!),
      onPick: setPicked, onTips: (v) => tips.set(v),
    });
  }, [scene, marks, places, reduced, tips]);

  const pickedLabel = picked ? (() => { const s = siteOfPart(picked); return s ? siteLabel(s.site, s.side) : null; })() : null;

  return (
    <ScanFrame strong style={{ paddingHorizontal: space.l, paddingTop: space.l, paddingBottom: space.m }} testID="injury-map">
      <View accessible accessibilityLabel={`体の図。直している途中 ${active}件、直せた ${cleared}件`} style={{ gap: space.s }}>
        <View style={s.mapHead}>
          <Mono color={colors.accent}>BODY MAP // SCAN</Mono>
          <Mono>{`ACTIVE ${String(active).padStart(2, '0')} / CLEARED ${String(cleared).padStart(2, '0')}`}</Mono>
        </View>
        <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height: STAGE_H, marginHorizontal: -space.l }}>
          {width > 0 && (
            <>
              <Canvas
                style={StyleSheet.absoluteFill}
                frameloop={focused ? 'always' : 'never'}
                camera={{ fov: CAMERA.fov, position: CAMERA.position, near: CAMERA.near, far: CAMERA.far }}
                gl={{ antialias: true }}
              >
                <Suspense fallback={null}>
                  <Scene scene={scene} />
                </Suspense>
              </Canvas>
              <Svg width={width} height={STAGE_H} style={StyleSheet.absoluteFill} pointerEvents="none">
                {places.map((p, i) => {
                  const fixing = injuries.find((j) => j.id === p.id)!.status === 'fixing';
                  const x = p.side === 'left' ? space.l + CALLOUT_W + 4 : width - space.l - CALLOUT_W - 4;
                  return <Leader key={p.id} tips={tips} index={i} from={{ x, y: p.top + 9 }} toRight={p.side === 'left'} color={fixing ? INJURY_AMBER : colors.sub} />;
                })}
              </Svg>
              {places.map((p) => {
                const injury = injuries.find((i) => i.id === p.id)!;
                return (
                  <SideCallout key={p.id} injury={injury} number={numbers.get(p.id) ?? ''} align={p.side === 'left' ? 'right' : 'left'}
                    style={{ [p.side]: space.l, top: p.top, width: CALLOUT_W, maxHeight: CALLOUT_H }} />
                );
              })}
              {/* なぞる・押すを受ける面（図の上いっぱい） */}
              <View style={StyleSheet.absoluteFill} {...scene.pan.panHandlers} />
              {pickedLabel && (
                <Animated.View entering={reduced ? undefined : FadeIn.duration(250)} exiting={reduced ? undefined : FadeOut.duration(150)} style={s.pick} pointerEvents="none">
                  <Mono color={colors.accent}>SELECT //</Mono>
                  <T variant="labelL">{pickedLabel}</T>
                </Animated.View>
              )}
            </>
          )}
        </View>
        <View style={s.mapHead}>
          <Mono>DRAG ROTATE · TAP SELECT</Mono>
          {active > 0 && <Mono color={INJURY_AMBER}>{`▲ ${active} ALERT`}</Mono>}
        </View>
      </View>
      {/* 出典。読み上げでリンクを選べるよう、件数をまとめて読む枠の外に置く（CC BY 4.0 の決まり：作者・ライセンスとそのリンク・改変したこと。文言は公式のライセンスのページの指定どおり） */}
      <T size={11} color={colors.sub} style={{ marginTop: space.s }}>
        BodyParts3D, © The Database Center for Life Science licensed under{' '}
        <T size={11} color={colors.accent} accessibilityRole="link" onPress={() => Linking.openURL(LICENSE_URL)}>CC Attribution 4.0 International</T>
        （形を軽くして使用。
        <T size={11} color={colors.accent} accessibilityRole="link" onPress={() => Linking.openURL(SOURCE_URL)}>元のデータ</T>
        ）
      </T>
    </ScanFrame>
  );
}

/** 3D の体の図。描けないときは 2D の図 */
export function InjuryBodyMap3D(props: { injuries: Injury[]; numbers: Map<string, string> }) {
  return (
    <Fallback fallback={<InjuryBodyMap {...props} />}>
      <BodyMap3D {...props} />
    </Fallback>
  );
}

const s = StyleSheet.create({
  mapHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pick: {
    position: 'absolute', left: space.l, bottom: space.s, flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: 28,
    backgroundColor: 'rgba(14,16,19,0.8)', borderWidth: 1, borderColor: colors.accentMuted, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 2,
  },
});
