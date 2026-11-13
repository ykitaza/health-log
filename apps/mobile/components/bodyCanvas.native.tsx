// 3D の体の図の共通の部品（ケガの画面の体の図と、からだのタブの回復マップ）：Canvas と体の読み込み、読み込み中の表示、
// 描けないときに 2D の図へ戻す枠、出典。web（e2e）では読まない（three と expo-gl を web の束に入れない）
/* eslint-disable react/no-unknown-property -- R3F の <primitive object> は three.js の物を渡す決まりの属性（DOM の属性ではない） */
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber/native';
import { useFocusEffect } from 'expo-router';
import { Component, ReactNode, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, View, ViewInstance } from 'react-native';
import Animated, {
  cancelAnimation, Easing, FadeOut, SharedValue, useAnimatedProps, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming,
} from 'react-native-reanimated';
import { Circle, Line } from 'react-native-svg';
import { GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import MODEL from '@/assets/models/body.glb';
import { useOnScreen } from '@/hooks/useOnScreen';
import { CAMERA } from '@/lib/bodyModel';
import { bodyRunning } from '@/lib/onScreen';
import { ensureTextDecoder } from '@/lib/utf8';
import { colors, space } from '@/theme';
import { BodyScene } from './bodyScene';
import { Mono } from './injuries';
import { T } from './Text';

// GLTFLoader は GLB の見出しを TextDecoder で読む。無い JS エンジンに備える
ensureTextDecoder();

/** 出典のリンク（BodyParts3D のライセンスと元のデータ） */
const LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/';
const SOURCE_URL = 'https://dbarchive.biosciencedbc.jp/en/bodyparts3d/desc.html';

/**
 * Canvas の中：体を読み込み、毎コマ BodyScene を進めて描く。
 * 触っていない（自動で回っている・止まっている）あいだは、1コマおきに描く（30fps。描く量を半分に）。
 * 描かないコマは前のコマが残る。なぞっている・指を離して惰性で回っている・押した直後は毎コマ描く
 */
function Scene({ scene }: { scene: BodyScene }) {
  // MODEL は require の番号（R3F の native の読み込みが expo-asset で開く）。1つだけ読むので配列にはならない
  const gltf = useLoader(GLTFLoader, MODEL as unknown as string) as GLTF;
  const { camera, size } = useThree();
  scene.setModel(gltf.scene);
  useEffect(() => { camera.lookAt(...CAMERA.target); }, [camera]);
  // 飛ばしたコマの時間をためて、次に描くコマで進める
  const skip = useRef({ odd: false, delta: 0 });
  // 優先度 1 の useFrame は、R3F の自動の描画を止める（描くのはここで呼ぶ gl.render だけ）
  useFrame((state, delta) => {
    const k = skip.current;
    k.delta += delta;
    k.odd = !k.odd;
    if (scene.idle() && k.odd) return;
    scene.frame(camera, size.width, size.height, state.clock.elapsedTime, k.delta);
    k.delta = 0;
    state.gl.render(state.scene, camera);
  }, 1);
  return (
    <>
      <primitive object={scene.body} />
      <primitive object={scene.deck} />
      <primitive object={scene.scanRing} />
      <primitive object={scene.glowGroup} />
    </>
  );
}

/**
 * 3D の体を描く面（親の大きさいっぱい）。画面から離れたとき・スクロールして見えないときは描くのを止める（電池・軽さ）。
 * 体を読み込んで最初のコマを描くまでは、読み込み中の表示を重ねる（消すのは1回の state の変更だけ）
 */
export function BodyCanvas({ scene }: { scene: BodyScene }) {
  const [focused, setFocused] = useState(true);
  const [ready, setReady] = useState(false);
  const box = useRef<ViewInstance>(null);
  const view = useOnScreen(box);
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  useEffect(() => { scene.onFirstFrame(() => setReady(true)); }, [scene]);
  const running = bodyRunning(focused, view.onScreen, ready);
  // GL が例外を出さずに描けないとき、読み込み中のまま残らないよう、しばらく描けなければ 2D の図へ戻す（外の Fallback が受ける）
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (ready || !focused) return;
    const t = setTimeout(() => setTimedOut(true), LOAD_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [ready, focused]);
  if (timedOut && !ready) throw new Error('3D の体を描けませんでした（時間切れ）');
  return (
    <View ref={box} onLayout={view.onLayout} collapsable={false} style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Canvas
        style={StyleSheet.absoluteFill}
        frameloop={running ? 'always' : 'never'}
        camera={{ fov: CAMERA.fov, position: CAMERA.position, near: CAMERA.near, far: CAMERA.far }}
        gl={{ antialias: true }}
      >
        <Suspense fallback={null}>
          <Scene scene={scene} />
        </Suspense>
      </Canvas>
      {!ready && <BodyLoading />}
    </View>
  );
}

/** 体を描けるまで待つ時間（ms）。過ぎたら 2D の図へ戻す */
const LOAD_TIMEOUT_MS = 15000;

/** 引き出し線の先（画面の px）と、表を向いているか。吹き出しごとに x, y, facing（1 / 0）の3つずつ */
export type Tips = SharedValue<number[]>;

const ALine = Animated.createAnimatedComponent(Line);
const ACircle = Animated.createAnimatedComponent(Circle);

/** 吹き出しの横から、印へのびる引き出し線（先だけが毎コマ動く。React の描き直しはしない）。ケガの画面と回復マップで使う */
export function Leader({ tips, index, from, toRight, color }: { tips: Tips; index: number; from: { x: number; y: number }; toRight: boolean; color: string }) {
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

/** 走査の線が上下に動く幅（px。図の高さのまん中から上下へ） */
const SWEEP = 48;

/**
 * 読み込み中の表示（LOADING // BODY MODEL）。図の高さのまん中で、緑の細い走査の線が上下に動く（1.2 秒で片道、ease-in-out）。
 * 画面に出す文字は英字の1行だけ（日本語の行は出さない。読み上げでは日本語で、読み込み中であることを読む）。
 * 動きを減らす設定では線を出さず、文だけ。消えるときは 150ms で薄く消える
 */
function BodyLoading() {
  const reduced = useReducedMotion();
  const y = useSharedValue(-SWEEP);
  useEffect(() => {
    if (reduced) return;
    y.set(withRepeat(withTiming(SWEEP, { duration: 1200, easing: Easing.inOut(Easing.quad) }), -1, true));
    return () => cancelAnimation(y);
  }, [reduced, y]);
  const line = useAnimatedStyle(() => ({ transform: [{ translateY: y.get() }] }));
  return (
    <Animated.View
      exiting={reduced ? undefined : FadeOut.duration(150)} style={[StyleSheet.absoluteFill, s.loading]} pointerEvents="none"
      accessible accessibilityLabel="体の図を読み込んでいます" accessibilityLiveRegion="polite" testID="body-loading"
    >
      {!reduced && <Animated.View style={[s.sweep, line]} />}
      <Mono color={colors.accent}>LOADING // BODY MODEL</Mono>
    </Animated.View>
  );
}

/** 3D が描けないとき（GL を作れない、形を読めない）は、2D の図に戻す（読み込み中の表示も一緒に消える） */
export class Fallback extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/**
 * 出典。読み上げでリンクを選べるよう、まとめて読む枠の外に置く（CC BY 4.0 の決まり：作者・ライセンスとそのリンク・改変したこと。
 * 文言は公式のライセンスのページの指定どおり）
 */
export function BodyAttribution() {
  return (
    <T size={11} color={colors.sub} style={{ marginTop: space.s }}>
      BodyParts3D, © The Database Center for Life Science licensed under{' '}
      <T size={11} color={colors.accent} accessibilityRole="link" onPress={() => Linking.openURL(LICENSE_URL)}>CC Attribution 4.0 International</T>
      （形を軽くして使用。
      <T size={11} color={colors.accent} accessibilityRole="link" onPress={() => Linking.openURL(SOURCE_URL)}>元のデータ</T>
      ）
    </T>
  );
}

const s = StyleSheet.create({
  loading: { alignItems: 'center', justifyContent: 'center', gap: space.xs },
  sweep: { position: 'absolute', left: '15%', right: '15%', top: '50%', height: 1, backgroundColor: colors.accent, opacity: 0.7 },
});
