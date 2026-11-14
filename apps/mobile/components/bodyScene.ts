// 3D の体の場面（体・台・走査の輪・にじみ）と、回す・押す・引き出し線の先の計算。ケガの画面と、からだのタブの回復マップで使う。
// three.js の物を毎コマ書き換えるので React の外に置く。React と R3F は使わない（jest で GLB を読み込んで確かめる：lib/__tests__/bodyScene.test.ts）
import { PanResponder } from 'react-native';
import * as THREE from 'three';
import { facingOf, siteOfPart, type Vec3 } from '@/lib/bodyModel';
import { colors, toneColors } from '@/theme';

const GREEN = new THREE.Color(colors.accent);
/** 直している途中の色（components/MuscleFigure.tsx の INJURY_AMBER と同じ） */
const AMBER = new THREE.Color(toneColors.caution.accent);
/** 自動で回る速さ（rad/s）と、触ってから自動で回り始めるまで（ms） */
const AUTO_SPEED = 0.25;
const AUTO_DELAY = 2500;
/** 最初の向き（少し斜め） */
const START_YAW = 0.35;

/** 回復の光：明るさ 1（いちばん強い）のときの部品の光の強さ。0 はふだんの光（RECOVERY_IDLE）。間はまっすぐ混ぜる */
const RECOVERY_IDLE = { base: 0.13, rim: 1.2 };
const RECOVERY_FULL = { base: 0.55, rim: 2.4 };
/** 回復マップのケガの印：部品をケガの色で塗って脈打たせ（脈の深さ）、にじみはケガの画面の 0.8 倍 */
const QUIET_MARK = { base: 0.45, rim: 1.9, pulse: 0.5 };
const QUIET_GLOW = 0.8;
/**
 * 回復マップの走査の帯と輪の強さ（ケガの画面を 1 として）。加算合成なので、暖色の部位の上を帯が通ると白く飛んで
 * ちらついて見える。回復マップは色で状態を伝えるので、帯は控えめにする
 */
const QUIET_SCAN = 0.35;
/**
 * 透視の写し（光っている部品が体の裏にあっても見えるように、奥行きを見ずに上から重ねる。2026-11-14 #212）の、いちばん強いときの強さ（元の光を 1 として。写しは両面を描くので、手前と奥の2枚が重なって約2倍になる）。
 * 部品の表がカメラから向こうを向くほど強くし、こちらを向いているときは出さない（表が見えているので要らない。重ねるとうるさい）。
 * 向きの値（部品の外向き × カメラへの向き）が XRAY_FROM 以上で 0、XRAY_FULL 以下で XRAY_GAIN
 */
const XRAY_GAIN = 0.25;
const XRAY_FROM = 0.15;
const XRAY_FULL = -0.45;

/** 印を付ける部位（ケガ1件） */
export type Mark = { id: string; parts: string[]; anchor: Vec3; facing: 'front' | 'back'; fixing: boolean };

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
  uniform float uTime; uniform float uScanY; uniform float uScanAmp; uniform float uSel; uniform float uFade;
  varying vec3 vN; varying vec3 vV; varying float vY;
  void main() {
    float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
    f = pow(f, 2.4);
    float pulse = mix(1.0, 0.45 + 0.55 * (0.5 + 0.5 * sin(uTime * 3.14159)), uPulse);
    float d = vY - uScanY;
    float scan = exp(-d * d / 0.0006) + 0.35 * exp(-max(-d, 0.0) * 9.0) * step(d, 0.0) * 0.4;
    float lines = 0.75 + 0.25 * step(0.5, fract(vY * 90.0));
    float a = (uBase + f * uRim) * pulse * lines + scan * 0.3 * uScanAmp + uSel * (0.4 + 0.9 * f);
    gl_FragColor = vec4(uColor, clamp(a * uFade, 0.0, 1.0));
  }`;
/** 琥珀色の光のにじみ（ポストエフェクトの代わり。中心から外へ薄くなる板） */
const GLOW_FRAG = `
  uniform vec3 uColor; uniform float uOpacity; varying vec2 vU;
  void main() { float d = distance(vU, vec2(0.5)) * 2.0; float a = pow(max(0.0, 1.0 - d), 2.0) * uOpacity; gl_FragColor = vec4(uColor, a); }`;
const UV_VERT = 'varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const DISC_FRAG = `
  uniform vec3 uColor; varying vec2 vU;
  void main(){ float d = distance(vU, vec2(.5)) * 2.0; float a = smoothstep(1.0, 0.0, d) * 0.18 + smoothstep(0.03, 0.0, abs(d - 0.7)) * 0.25; gl_FragColor = vec4(uColor, a); }`;

type Shared = { uTime: { value: number }; uScanY: { value: number }; uScanAmp: { value: number } };
function holoMat(shared: Shared, color: THREE.Color, base: number, rim: number, pulse = 0) {
  return new THREE.ShaderMaterial({
    vertexShader: HOLO_VERT, fragmentShader: HOLO_FRAG,
    uniforms: {
      uColor: { value: color.clone() }, uBase: { value: base }, uRim: { value: rim }, uPulse: { value: pulse },
      uSel: { value: 0 }, uFade: { value: 1 }, uTime: shared.uTime, uScanY: shared.uScanY, uScanAmp: shared.uScanAmp,
    },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}
/**
 * 透視の写しの材質（元の部品と同じシェーダー。奥行きを見ずに、元の部品と皮膚のあとに重ねる）。色・強さ・脈は元の部品の値をそのまま使う
 * （同じ値の入れ物を共有する）。走査の帯と、選んだときの光は元の部品だけに出す（二重にしない）。uFade で全体を弱める
 */
function xrayMat(src: THREE.ShaderMaterial) {
  const u = src.uniforms;
  return new THREE.ShaderMaterial({
    vertexShader: HOLO_VERT, fragmentShader: HOLO_FRAG,
    uniforms: {
      uColor: u.uColor, uBase: u.uBase, uRim: u.uRim, uPulse: u.uPulse, uTime: u.uTime, uScanY: u.uScanY,
      uScanAmp: { value: 0 }, uSel: { value: 0 }, uFade: { value: 0 },
    },
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
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
export class BodyScene {
  readonly shared: Shared = { uTime: { value: 1 }, uScanY: { value: -1 }, uScanAmp: { value: 1 } };
  readonly body = new THREE.Group();
  readonly deck: THREE.Group;
  private readonly ticks: THREE.Group;
  readonly scanRing = new THREE.LineLoop(circle(0.36, 64), lineMat(0));
  readonly glowGroup = new THREE.Group();
  private pickables: THREE.Mesh[] = [];
  private byName: Record<string, THREE.Mesh> = {};
  private glows: { mesh: THREE.Mesh; anchor: THREE.Vector3 }[] = [];
  /** 部品ごとの、まん中と外向き（体の座標。透視の写しを出すかを決める） */
  private faces: Record<string, { center: THREE.Vector3; out: THREE.Vector3 }> = {};
  /** 透視の写し（光っている部品 → その子の写し） */
  private xrays = new Map<THREE.Mesh, THREE.Mesh>();
  private selected: THREE.Mesh[] = [];
  /** 画面から選んだ部品（読み込む前に選んでも、読み込んだあとに付ける） */
  private selNames: string[] = [];
  /** 部品ごとの回復の光の明るさ（0〜1） */
  private levels: Record<string, number> = {};
  /** ケガの印を控えめにする（回復マップ） */
  private quiet = false;
  /** 土台の色（部品のふだんの光・皮膚・台・走査の輪）。ケガの画面は緑 */
  private base = GREEN.clone();
  /** 空いている部品（回復マップ：空いている・まだの部位）と、その色。ふだんの光の強さのまま、色だけを変える */
  private idleParts = new Set<string>();
  private idleTint = GREEN.clone();
  /** 明るさ k の色（mesh は部品の名前。部品ごとに色を変えるとき）。渡さなければ緑のまま強さだけを変える */
  private levelColor: ((k: number, mesh: string) => string) | null = null;
  /** ケガの印の色（回復マップの控えめな印と、にじみ）。ケガの画面は琥珀色 */
  private injury = AMBER.clone();
  /** 土台の色に寄せる、台・走査の輪・皮膚の材質 */
  private tinted: (THREE.LineBasicMaterial | THREE.ShaderMaterial)[] = [];
  private readonly tmpC = new THREE.Color();
  /** 最初のコマを描いたか（読み込み中の表示を消す） */
  private drawn = false;
  private onDrawn: (() => void) | null = null;
  private frames = 0;
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
  private horizontal = false;
  private lastDx = 0;
  private tap: { x: number; y: number } | null = null;
  private onPick: (part: string | null) => void = () => {};
  private onTips: (tips: number[]) => void = () => {};

  constructor() {
    const { deck, ticks } = makeDeck();
    this.deck = deck;
    this.ticks = ticks;
    deck.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (m instanceof THREE.LineBasicMaterial || m instanceof THREE.ShaderMaterial) this.tinted.push(m);
    });
    this.tinted.push(this.scanRing.material as THREE.LineBasicMaterial);
  }

  /** 台・走査の輪・皮膚を土台の色にする */
  private tint() {
    for (const m of this.tinted) {
      if (m instanceof THREE.LineBasicMaterial) m.color.copy(this.base);
      else m.uniforms.uColor.value = this.base.clone();
    }
  }

  /**
   * 読み込んだ体に材質を付ける（1回だけ）。読み込んだ形は画面を開き直しても使い回されるので、写しに付ける
   * （形のデータは写しと元で共有する）
   */
  setModel(loaded: THREE.Object3D) {
    if (this.loaded === loaded) return;
    const root = loaded.clone(true);
    const depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 4 });
    const skinWire = new THREE.LineBasicMaterial({ color: GREEN, transparent: true, opacity: 0.012, blending: THREE.AdditiveBlending, depthWrite: false });
    // 先に部品を集めてから手を入れる（たどりながら子を足すと、足した子もたどって終わらなくなる）
    const meshes: THREE.Mesh[] = [];
    root.traverse((o: THREE.Object3D) => { if (o instanceof THREE.Mesh) meshes.push(o); });
    for (const o of meshes) {
      if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
      const core = o.name === 'skin';
      o.material = core ? holoMat(this.shared, GREEN, 0.004, 0.32) : holoMat(this.shared, GREEN, 0.13, 1.2);
      if (core) {
        this.tinted.push(o.material as THREE.ShaderMaterial, skinWire);
        o.add(new THREE.LineSegments(new THREE.WireframeGeometry(o.geometry), skinWire));
        o.renderOrder = 2;
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
    }
    this.body.add(root);
    // 部品のまん中と外向き（体の座標）。外向きは引き出し線の先と同じ決め方（前の部位は前、後ろの部位は後ろ。腕・脚のように
    // まん中から離れた部品は横へも傾ける）。部位のない部品（三角筋の中部）は横だけ。面の法線は部品によって向きがそろっていないので使わない
    this.body.updateMatrixWorld(true);
    this.faces = {};
    for (const o of this.pickables) {
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const center = this.body.worldToLocal(o.localToWorld(o.geometry.boundingBox!.getCenter(new THREE.Vector3())));
      const site = siteOfPart(o.name);
      const z = site ? (facingOf(site.site, site.side) === 'front' ? 1 : -1) : 0;
      const x = Math.abs(center.x) > 0.12 || !site ? Math.sign(center.x) * (site ? 0.6 : 1) : 0;
      this.faces[o.name] = { center, out: new THREE.Vector3(x, 0, z).normalize() };
    }
    // 終わってから印を付ける（途中で失敗したら、次の描画でやり直す）
    this.loaded = loaded;
    this.tint();
    this.setMarks(this.marks);
    this.select(this.selNames);
  }

  private marks: Mark[] = [];

  /**
   * 画面から渡すもの（ケガの印・動きを減らす設定・引き出し線を出すケガ・押したとき・線の先が動いたとき）。
   * 回復マップは、部品ごとの回復の光の明るさ（levels。0〜1）と、ケガの印を控えめにする（quietMarks）、空いている部品とその色（idle・idleColor）も渡す
   */
  configure(o: {
    marks: Mark[]; reduced: boolean; tipMarks: Mark[]; onPick: (part: string | null) => void; onTips: (tips: number[]) => void;
    levels?: Record<string, number>; quietMarks?: boolean;
    baseColor?: string; levelColor?: (k: number, mesh: string) => string; injuryColor?: string;
    idle?: string[]; idleColor?: string;
  }) {
    this.reduced = o.reduced;
    this.levels = o.levels ?? {};
    this.quiet = o.quietMarks ?? false;
    this.shared.uScanAmp.value = this.quiet ? QUIET_SCAN : 1;
    this.base.set(o.baseColor ?? GREEN);
    this.levelColor = o.levelColor ?? null;
    this.idleParts = new Set(o.idle ?? []);
    this.idleTint.set(o.idleColor ?? GREEN);
    this.injury.set(o.injuryColor ?? AMBER);
    this.tint();
    this.tipMarks = o.tipMarks;
    this.onPick = o.onPick;
    this.onTips = o.onTips;
    this.marks = o.marks;
    this.setMarks(o.marks);
  }

  /** 画面から部品を選ぶ（回復マップ：押した部位の部品をまとめて光らせる）。空なら選ぶのをやめる */
  select(names: string[]) {
    this.selNames = names;
    for (const m of this.selected) (m.material as THREE.ShaderMaterial).uniforms.uSel.value = 0;
    this.selected = names.map((n) => this.byName[n]).filter((m): m is THREE.Mesh => m != null && this.pickables.includes(m));
    for (const m of this.selected) (m.material as THREE.ShaderMaterial).uniforms.uSel.value = 1;
  }

  /** 最初のコマを描いたら1回だけ呼ぶ。もう描いていたら、すぐ呼ぶ */
  onFirstFrame(cb: () => void) {
    if (this.drawn) { cb(); return; }
    this.onDrawn = cb;
  }

  /**
   * 光らせ方：ふだんの光（空いている部品は空いている色）→ 回復の光（明るさの表）→ ケガの印。
   * ケガの印は、直している途中（琥珀色で脈打つ）が、直せた（控えめな緑）より強い。にじみは直している途中の付け根ごと。
   * 控えめにするとき（回復マップ）は、部品の色は変えず、小さなにじみだけを脈打たせる
   */
  private setMarks(marks: Mark[]) {
    const lit = new Set<THREE.Mesh>();
    const set = (m: THREE.Mesh | undefined, color: THREE.Color, base: number, rim: number, pulse: number) => {
      if (!m) return;
      lit.add(m);
      const u = (m.material as THREE.ShaderMaterial).uniforms;
      u.uColor.value.copy(color); u.uBase.value = base; u.uRim.value = rim; u.uPulse.value = pulse;
    };
    for (const m of this.pickables) set(m, this.idleParts.has(m.name) ? this.idleTint : this.base, 0.13, 1.2, 0);
    lit.clear();
    for (const [p, v] of Object.entries(this.levels)) {
      const k = Math.min(1, Math.max(0, v));
      const lerp = (a: number, b: number) => a + (b - a) * k;
      const color = this.levelColor ? this.tmpC.set(this.levelColor(k, p)) : this.base;
      if (k > 0) set(this.byName[p], color, lerp(RECOVERY_IDLE.base, RECOVERY_FULL.base), lerp(RECOVERY_IDLE.rim, RECOVERY_FULL.rim), 0);
    }
    if (this.quiet) {
      for (const mk of marks.filter((k) => k.fixing)) {
        for (const p of mk.parts) set(this.byName[p], this.injury, QUIET_MARK.base, QUIET_MARK.rim, this.reduced ? 0 : QUIET_MARK.pulse);
      }
    } else {
      for (const mk of marks.filter((k) => !k.fixing)) for (const p of mk.parts) set(this.byName[p], GREEN, 0.32, 1.8, 0);
      for (const mk of marks.filter((k) => k.fixing)) for (const p of mk.parts) set(this.byName[p], AMBER, 0.7, 2.2, this.reduced ? 0 : 1);
    }
    this.setXrays(lit);
    for (const g of this.glows) { g.mesh.geometry.dispose(); (g.mesh.material as THREE.Material).dispose(); }
    this.glowGroup.clear();
    this.glows = marks.filter((m) => m.fixing).map((m) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
        uniforms: { uColor: { value: this.injury.clone() }, uOpacity: { value: 0.5 } }, vertexShader: UV_VERT, fragmentShader: GLOW_FRAG,
      }));
      this.glowGroup.add(mesh);
      return { mesh, anchor: new THREE.Vector3(...m.anchor) };
    });
  }

  /**
   * 透視の写しを、光っている部品（ふだんの光より強くした部品）にだけ付ける。形は元の部品と共有する（三角形のデータは増やさない）。
   * 光らなくなった部品の写しは外す（形は読み込んだ体と共有なので、材質だけを捨てる）
   */
  private setXrays(lit: Set<THREE.Mesh>) {
    for (const [m, x] of this.xrays) {
      if (lit.has(m)) continue;
      m.remove(x);
      (x.material as THREE.Material).dispose();
      this.xrays.delete(m);
    }
    for (const m of lit) {
      if (this.xrays.has(m)) continue;
      const x = new THREE.Mesh(m.geometry, xrayMat(m.material as THREE.ShaderMaterial));
      x.name = `${m.name}#xray`;
      x.renderOrder = 3;
      x.visible = false;
      x.raycast = () => {};
      m.add(x);
      this.xrays.set(m, x);
    }
  }

  /** なぞる・押すの受け口（図の上いっぱいの面に付ける） */
  readonly pan = PanResponder.create({
    // 押した（タップ）を受けるため、触れた時から受ける。ただし上下のスクロールは止めない（Android の ScrollView は、
    // 縦に動いたときだけ指を取る。横になぞる間は取らないので、回す操作はそのまま続く）
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy),
    onShouldBlockNativeResponder: () => false,
    // 横になぞり始めたら、ほかの JS の受け手には渡さない
    onPanResponderTerminationRequest: () => !this.horizontal,
    onPanResponderGrant: () => { this.lastDx = 0; this.moved = false; this.horizontal = false; this.dragging = true; this.vYaw = 0; },
    onPanResponderMove: (_, g) => {
      if (Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6) this.moved = true;
      if (Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy)) this.horizontal = true;
      this.yaw += (g.dx - this.lastDx) * 0.012;
      this.lastDx = g.dx;
      this.vYaw = g.vx * 12;
      this.lastInput = Date.now();
    },
    onPanResponderRelease: (e) => {
      this.dragging = false;
      this.lastInput = Date.now();
      if (!this.moved) this.tapAt(e.nativeEvent.locationX, e.nativeEvent.locationY);
    },
    onPanResponderTerminate: () => { this.dragging = false; },
  });

  /** 押した（図の中の px）。次のコマで部品を選ぶ */
  tapAt(x: number, y: number) { this.tap = { x, y }; }

  /**
   * 描く回数を減らしてよいか（触っていない：なぞっていない・惰性で回っていない・押した所を選ぶ前でない、最初のコマを描いたあと）。
   * そのあいだは自動の回転と走査の帯だけが動くので、30fps でも見た目はほとんど変わらない
   */
  idle() {
    return this.drawn && !this.dragging && Math.abs(this.vYaw) <= 0.01 && !this.tap;
  }

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
    (this.scanRing.material as THREE.LineBasicMaterial).opacity = sy >= 0 ? 0.55 * Math.sin(cyc * Math.PI) * this.shared.uScanAmp.value : 0;
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
    const q = this.quiet ? QUIET_GLOW : 1;
    for (const gl of this.glows) {
      gl.mesh.position.copy(gl.anchor);
      g.localToWorld(gl.mesh.position);
      gl.mesh.quaternion.copy(camera.quaternion);
      gl.mesh.scale.setScalar((reduced ? 0.3 : 0.26 + 0.08 * pul) * q);
      (gl.mesh.material as THREE.ShaderMaterial).uniforms.uOpacity.value = (reduced ? 0.5 : 0.25 + 0.45 * pul) * q;
    }

    // 透視の写し：部品の外向きがカメラから向こうを向くほど強く。こちらを向いているあいだは出さない
    for (const [m, x] of this.xrays) {
      const f = this.faces[m.name];
      if (!f) continue;
      this.tmp.copy(f.center);
      g.localToWorld(this.tmp);
      this.tmpN.copy(f.out).applyQuaternion(g.quaternion);
      this.camDir.copy(camera.position).sub(this.tmp).normalize();
      const k = Math.min(1, Math.max(0, (XRAY_FROM - this.tmpN.dot(this.camDir)) / (XRAY_FROM - XRAY_FULL)));
      (x.material as THREE.ShaderMaterial).uniforms.uFade.value = k * XRAY_GAIN;
      x.visible = k > 0;
    }

    // 押した所の部品を選ぶ（筋肉を先に。同じ部品・皮膚・外を押したら選ぶのをやめる）
    if (this.tap) {
      this.ray.setFromCamera(new THREE.Vector2((this.tap.x / width) * 2 - 1, -(this.tap.y / height) * 2 + 1), camera);
      this.tap = null;
      const hit = this.ray.intersectObjects(this.pickables, false)[0];
      const mesh = hit && !this.selected.includes(hit.object as THREE.Mesh) ? (hit.object as THREE.Mesh) : null;
      this.select(mesh ? [mesh.name] : []);
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

    // 最初のコマ：このコマは呼んだあとに描かれるので、次のコマで「描いた」とする（体を読み込んでから）
    if (!this.drawn && this.loaded) {
      if (this.frames++ >= 1) { this.drawn = true; this.onDrawn?.(); this.onDrawn = null; }
    }
  }
}
