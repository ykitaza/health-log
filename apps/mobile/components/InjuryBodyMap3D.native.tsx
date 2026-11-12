// ケガの画面の体の図（3D）。BodyParts3D を軽くした体（assets/models/body.glb）を、ホログラムのように光らせて回す。
// 直している途中の部位は琥珀色で脈打ち、直せた部位は控えめな緑。吹き出しは体が正面を向いたときの位置で止めておき、
// 引き出し線の先だけが回る部位を追う（2026-11-12 ユーザーの要望）。左右になぞると回り、押すと部位の名前が出る。
// web（e2e）では読まない（InjuryBodyMap3D.tsx が null を出し、2D の図を使う）
/* eslint-disable react/no-unknown-property -- R3F の <primitive object> は three.js の物を渡す決まりの属性（DOM の属性ではない） */
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber/native';
import { useFocusEffect } from 'expo-router';
import { Component, ReactNode, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, SharedValue, useAnimatedProps, useReducedMotion, useSharedValue } from 'react-native-reanimated';
import Svg, { Circle, Line } from 'react-native-svg';
import * as THREE from 'three';
import { GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import MODEL from '@/assets/models/body.glb';
import type { Injury } from '@/db/repositories/injuries';
import { anchorFor, CALLOUT_H, CAMERA, facingOf, layoutCallouts, partsFor, siteOfPart, Vec3 } from '@/lib/bodyModel';
import { siteLabel } from '@/lib/injuries';
import { colors, space } from '@/theme';
import { Callout, InjuryBodyMap, Mono, ScanFrame } from './injuries';
import { INJURY_AMBER } from './MuscleFigure';
import { T } from './Text';

// GLTFLoader は GLB の見出しを TextDecoder で読む。無い環境に備えて UTF-8 だけを読む代わりを置く
if (typeof globalThis.TextDecoder === 'undefined') {
  (globalThis as { TextDecoder?: unknown }).TextDecoder = class {
    decode(input?: ArrayBuffer | ArrayBufferView) {
      if (!input) return '';
      const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return decodeURIComponent(escape(s));
    }
  };
}

const GREEN = new THREE.Color(colors.accent);
const AMBER = new THREE.Color(INJURY_AMBER);
/** 図の高さ（px） */
const STAGE_H = 380;
/** 吹き出しの幅（px） */
const CALLOUT_W = 96;
/** 自動で回る速さ（rad/s）と、触ってから自動で回り始めるまで（ms） */
const AUTO_SPEED = 0.25;
const AUTO_DELAY = 2500;
/** 最初の向き（少し斜め） */
const START_YAW = 0.35;

/** 引き出し線の先（画面の px）と、表を向いているか。吹き出しごとに x, y, facing（1 / 0）の3つずつ */
type Tips = SharedValue<number[]>;

/** 印を付ける部位（ケガ1件） */
type Mark = { id: string; parts: string[]; anchor: Vec3; facing: 'front' | 'back'; fixing: boolean };

// ---------- ホログラムのシェーダー（フレネルで縁を光らせる＋走査の帯＋細い横線） ----------
const HOLO_VERT = `
  varying vec3 vN; varying vec3 vV; varying float vY;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vY = wp.y;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vV = normalize(-mv.xyz);
    vN = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
  }`;
const HOLO_FRAG = `
  uniform vec3 uColor; uniform float uBase; uniform float uRim; uniform float uPulse;
  uniform float uTime; uniform float uScanY; uniform float uSel;
  varying vec3 vN; varying vec3 vV; varying float vY;
  void main() {
    float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
    f = pow(f, 2.4);
    float pulse = mix(1.0, 0.45 + 0.55 * (0.5 + 0.5 * sin(uTime * 3.14159)), uPulse);
    float d = vY - uScanY;
    float scan = exp(-d * d / 0.0006) + 0.35 * exp(-max(-d, 0.0) * 9.0) * step(d, 0.0) * 0.4;
    float lines = 0.75 + 0.25 * step(0.5, fract(vY * 90.0));
    float a = (uBase + f * uRim) * pulse * lines + scan * 0.3 + uSel * (0.4 + 0.9 * f);
    gl_FragColor = vec4(uColor, clamp(a, 0.0, 1.0));
  }`;
/** 琥珀色の光のにじみ（ポストエフェクトの代わり。中心から外へ薄くなる板） */
const GLOW_FRAG = `
  uniform vec3 uColor; uniform float uOpacity; varying vec2 vU;
  void main() { float d = distance(vU, vec2(0.5)) * 2.0; float a = pow(max(0.0, 1.0 - d), 2.0) * uOpacity; gl_FragColor = vec4(uColor, a); }`;
const UV_VERT = 'varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const DISC_FRAG = `
  uniform vec3 uColor; varying vec2 vU;
  void main(){ float d = distance(vU, vec2(.5)) * 2.0; float a = smoothstep(1.0, 0.0, d) * 0.18 + smoothstep(0.03, 0.0, abs(d - 0.7)) * 0.25; gl_FragColor = vec4(uColor, a); }`;

type Shared = { uTime: { value: number }; uScanY: { value: number } };
function holoMat(shared: Shared, color: THREE.Color, base: number, rim: number, pulse = 0) {
  return new THREE.ShaderMaterial({
    vertexShader: HOLO_VERT, fragmentShader: HOLO_FRAG,
    uniforms: {
      uColor: { value: color.clone() }, uBase: { value: base }, uRim: { value: rim }, uPulse: { value: pulse },
      uSel: { value: 0 }, uTime: shared.uTime, uScanY: shared.uScanY,
    },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}
const lineMat = (opacity: number) => new THREE.LineBasicMaterial({ color: GREEN, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
function circle(r: number, segs = 96) {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < segs; i++) { const a = (i / segs) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)); }
  return new THREE.BufferGeometry().setFromPoints(pts);
}

/** 足元のスキャンの台（輪・目盛り・切れた弧・光の円盤） */
function makeDeck() {
  const deck = new THREE.Group();
  for (const [r, op] of [[0.28, 0.35], [0.42, 0.5], [0.6, 0.25]]) deck.add(new THREE.LineLoop(circle(r), lineMat(op)));
  const ticks = new THREE.Group();
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < 90; i++) {
    const a = (i / 90) * Math.PI * 2, r0 = 0.47, r1 = i % 15 === 0 ? 0.56 : i % 5 === 0 ? 0.52 : 0.495;
    pts.push(new THREE.Vector3(Math.cos(a) * r0, 0, Math.sin(a) * r0), new THREE.Vector3(Math.cos(a) * r1, 0, Math.sin(a) * r1));
  }
  ticks.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), lineMat(0.45)));
  for (let j = 0; j < 4; j++) {
    const arc: THREE.Vector3[] = [];
    for (let i = 0; i <= 20; i++) { const a = j * Math.PI / 2 + 0.2 + (i / 20) * 1.0; arc.push(new THREE.Vector3(Math.cos(a) * 0.66, 0, Math.sin(a) * 0.66)); }
    ticks.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(arc), lineMat(0.4)));
  }
  deck.add(ticks);
  const disc = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uColor: { value: GREEN } }, vertexShader: UV_VERT, fragmentShader: DISC_FRAG,
  }));
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = -0.002;
  deck.add(disc);
  return { deck, ticks };
}

/**
 * 3D の場面の中身（体・台・走査の輪・にじみ）と、回す・押す・引き出し線の先の計算。
 * three.js の物は毎コマ書き換えるので、React の state にせず、このクラスの中だけで持つ
 */
class BodyScene {
  readonly shared: Shared = { uTime: { value: 1 }, uScanY: { value: -1 } };
  readonly body = new THREE.Group();
  readonly deck: THREE.Group;
  private readonly ticks: THREE.Group;
  readonly scanRing = new THREE.LineLoop(circle(0.36, 64), lineMat(0));
  readonly glowGroup = new THREE.Group();
  private pickables: THREE.Mesh[] = [];
  private skins: THREE.Mesh[] = [];
  private byName: Record<string, THREE.Mesh> = {};
  private glows: { mesh: THREE.Mesh; anchor: THREE.Vector3 }[] = [];
  private selected: THREE.Mesh | null = null;
  private loaded: THREE.Object3D | null = null;
  private readonly ray = new THREE.Raycaster();
  private readonly tmp = new THREE.Vector3();
  private readonly tmpN = new THREE.Vector3();
  private readonly camDir = new THREE.Vector3();
  /** 引き出し線の先を計算するケガ（吹き出しを出す分） */
  private tipMarks: Mark[] = [];
  private reduced = false;
  private yaw = START_YAW;
  private vYaw = 0;
  private dragging = false;
  private lastInput = -1e9;
  private moved = false;
  private lastDx = 0;
  private tap: { x: number; y: number } | null = null;
  private onPick: (part: string | null) => void = () => {};
  private onTips: (tips: number[]) => void = () => {};

  constructor() {
    const { deck, ticks } = makeDeck();
    this.deck = deck;
    this.ticks = ticks;
  }

  /** 読み込んだ体に材質を付ける（1回だけ） */
  setModel(root: THREE.Object3D) {
    if (this.loaded === root) return;
    this.loaded = root;
    const depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 4 });
    const skinWire = new THREE.LineBasicMaterial({ color: GREEN, transparent: true, opacity: 0.012, blending: THREE.AdditiveBlending, depthWrite: false });
    root.traverse((o: THREE.Object3D) => {
      if (!(o instanceof THREE.Mesh)) return;
      if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
      const core = o.name === 'skin';
      o.material = core ? holoMat(this.shared, GREEN, 0.004, 0.32) : holoMat(this.shared, GREEN, 0.13, 1.2);
      if (core) {
        o.add(new THREE.LineSegments(new THREE.WireframeGeometry(o.geometry), skinWire));
        o.renderOrder = 2;
        this.skins.push(o);
      } else {
        // 部品によって面の向きがそろっていないので両面。奥の筋肉が透けて重なると読めないので、
        // 先に筋肉の奥行きだけを書き、いちばん手前の筋肉の面だけを光らせる（皮膚は透ける）
        (o.material as THREE.ShaderMaterial).side = THREE.DoubleSide;
        const depth = new THREE.Mesh(o.geometry, depthOnly);
        depth.renderOrder = -1;
        depth.raycast = () => {};
        o.add(depth);
        o.renderOrder = 1;
        this.pickables.push(o);
      }
      this.byName[o.name] = o;
    });
    this.body.add(root);
    this.setMarks(this.marks);
  }

  private marks: Mark[] = [];

  /** 画面から渡すもの（ケガの印・動きを減らす設定・引き出し線を出すケガ・押したとき・線の先が動いたとき） */
  configure(o: { marks: Mark[]; reduced: boolean; tipMarks: Mark[]; onPick: (part: string | null) => void; onTips: (tips: number[]) => void }) {
    this.reduced = o.reduced;
    this.tipMarks = o.tipMarks;
    this.onPick = o.onPick;
    this.onTips = o.onTips;
    this.marks = o.marks;
    this.setMarks(o.marks);
  }

  /** ケガの印：直している途中（琥珀色で脈打つ）が、直せた（控えめな緑）より強い。にじみは直している途中の付け根ごと */
  private setMarks(marks: Mark[]) {
    const set = (m: THREE.Mesh | undefined, color: THREE.Color, base: number, rim: number, pulse: number) => {
      if (!m) return;
      const u = (m.material as THREE.ShaderMaterial).uniforms;
      u.uColor.value.copy(color); u.uBase.value = base; u.uRim.value = rim; u.uPulse.value = pulse;
    };
    for (const m of this.pickables) set(m, GREEN, 0.13, 1.2, 0);
    for (const mk of marks.filter((k) => !k.fixing)) for (const p of mk.parts) set(this.byName[p], GREEN, 0.32, 1.8, 0);
    for (const mk of marks.filter((k) => k.fixing)) for (const p of mk.parts) set(this.byName[p], AMBER, 0.7, 2.2, this.reduced ? 0 : 1);
    for (const g of this.glows) { g.mesh.geometry.dispose(); (g.mesh.material as THREE.Material).dispose(); }
    this.glowGroup.clear();
    this.glows = marks.filter((m) => m.fixing).map((m) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
        uniforms: { uColor: { value: AMBER }, uOpacity: { value: 0.5 } }, vertexShader: UV_VERT, fragmentShader: GLOW_FRAG,
      }));
      this.glowGroup.add(mesh);
      return { mesh, anchor: new THREE.Vector3(...m.anchor) };
    });
  }

  /** なぞる・押すの受け口（図の上いっぱいの面に付ける） */
  readonly pan = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy),
    // 横になぞり始めたら、上下のスクロールに渡さない
    onPanResponderTerminationRequest: () => !this.moved,
    onPanResponderGrant: () => { this.lastDx = 0; this.moved = false; this.dragging = true; this.vYaw = 0; },
    onPanResponderMove: (_, g) => {
      if (Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6) this.moved = true;
      this.yaw += (g.dx - this.lastDx) * 0.012;
      this.lastDx = g.dx;
      this.vYaw = g.vx * 12;
      this.lastInput = Date.now();
    },
    onPanResponderRelease: (e) => {
      this.dragging = false;
      this.lastInput = Date.now();
      if (!this.moved) this.tap = { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY };
    },
    onPanResponderTerminate: () => { this.dragging = false; },
  });

  /** 毎コマ */
  frame(camera: THREE.Camera, width: number, height: number, elapsed: number, delta: number) {
    const reduced = this.reduced;
    const dt = Math.min(delta, 0.05);
    const t = reduced ? 1 : elapsed;
    this.shared.uTime.value = t;
    // 走査：4.5 秒で足元から頭の上まで、少し休んでまた下から（動きを減らす設定では止める）
    const cyc = (t % 6) / 4.5;
    const sy = !reduced && cyc <= 1 ? cyc * 1.85 : -1;
    this.shared.uScanY.value = sy;
    this.scanRing.position.y = sy;
    (this.scanRing.material as THREE.LineBasicMaterial).opacity = sy >= 0 ? 0.55 * Math.sin(cyc * Math.PI) : 0;
    const rs = 0.36 - 0.12 * Math.max(0, (sy - 1.45) / 0.4);
    this.scanRing.scale.set(rs / 0.36, 1, (rs / 0.36) * 0.7);

    if (!this.dragging) {
      if (Math.abs(this.vYaw) > 0.01) { this.yaw += this.vYaw * dt; this.vYaw *= Math.pow(0.04, dt); }
      else if (!reduced && Date.now() - this.lastInput > AUTO_DELAY) this.yaw += AUTO_SPEED * dt;
    }
    const g = this.body;
    g.rotation.set(0, this.yaw, 0);
    g.updateMatrixWorld();
    if (!reduced) this.ticks.rotation.y = -t * 0.08;

    // にじみ：付け根に置き、カメラに向ける。2 秒で脈打つ
    const pul = 0.5 + 0.5 * Math.sin(t * Math.PI);
    for (const gl of this.glows) {
      gl.mesh.position.copy(gl.anchor);
      g.localToWorld(gl.mesh.position);
      gl.mesh.quaternion.copy(camera.quaternion);
      gl.mesh.scale.setScalar(reduced ? 0.3 : 0.26 + 0.08 * pul);
      (gl.mesh.material as THREE.ShaderMaterial).uniforms.uOpacity.value = reduced ? 0.5 : 0.25 + 0.45 * pul;
    }

    // 押した所の部品を選ぶ（筋肉を先に。同じ部品・皮膚・外を押したら選ぶのをやめる）
    if (this.tap) {
      this.ray.setFromCamera(new THREE.Vector2((this.tap.x / width) * 2 - 1, -(this.tap.y / height) * 2 + 1), camera);
      this.tap = null;
      const hit = this.ray.intersectObjects(this.pickables, false)[0];
      const mesh = hit && hit.object !== this.selected ? (hit.object as THREE.Mesh) : null;
      if (this.selected) (this.selected.material as THREE.ShaderMaterial).uniforms.uSel.value = 0;
      this.selected = mesh;
      if (mesh) (mesh.material as THREE.ShaderMaterial).uniforms.uSel.value = 1;
      this.onPick(mesh?.name ?? null);
    }

    // 引き出し線の先：付け根の画面の位置と、表を向いているか（付け根の向きとカメラの向き）
    const out: number[] = [];
    for (const m of this.tipMarks) {
      this.tmp.set(...m.anchor);
      g.localToWorld(this.tmp);
      this.tmpN.set(Math.abs(m.anchor[0]) > 0.12 ? Math.sign(m.anchor[0]) * 0.6 : 0, 0, m.facing === 'front' ? 1 : -1).normalize().applyQuaternion(g.quaternion);
      this.camDir.copy(camera.position).sub(this.tmp).normalize();
      const facing = this.tmpN.dot(this.camDir) > 0;
      this.tmp.project(camera);
      out.push((this.tmp.x * 0.5 + 0.5) * width, (-this.tmp.y * 0.5 + 0.5) * height, facing ? 1 : 0);
    }
    this.onTips(out);
  }
}

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
                  <Callout key={p.id} injury={injury} number={numbers.get(p.id) ?? ''} align={p.side === 'left' ? 'right' : 'left'}
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
        <T size={11} color={colors.sub}>BodyParts3D, © The Database Center for Life Science, CC BY 4.0（形を軽くして使用）</T>
      </View>
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
