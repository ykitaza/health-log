// ケガの画面の 3D の場面（components/bodyScene.ts）を、本物の GLB を読み込んで動かす。
// 描画（GL）はしないが、読み込み・材質付け・ケガの印・毎コマの処理・押した所の判定までを通す。
// 2026-11-13：部品をたどりながら子を足して終わらなくなり、実機で体が映らなかった（React の #520）。その再発を止める
import { readFileSync } from 'fs';
import { join } from 'path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BodyScene, Mark } from '@/components/bodyScene';
import { anchorFor, CAMERA, facingOf, partsFor } from '@/lib/bodyModel';
import { colors, toneColors } from '@/theme';

async function loadBody(): Promise<THREE.Object3D> {
  const buf = readFileSync(join(__dirname, '../../assets/models/body.glb'));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const gltf = await new Promise<{ scene: THREE.Object3D }>((res, rej) => new GLTFLoader().parse(ab, './', res, rej));
  return gltf.scene;
}

function camera(w: number, h: number) {
  const c = new THREE.PerspectiveCamera(CAMERA.fov, w / h, CAMERA.near, CAMERA.far);
  c.position.set(...CAMERA.position);
  c.lookAt(...CAMERA.target);
  c.updateMatrixWorld();
  return c;
}

const mark = (id: string, site: string, side: 'right' | 'left' | null, fixing: boolean): Mark =>
  ({ id, parts: partsFor(site, side), anchor: anchorFor(site, side)!, facing: facingOf(site, side), fixing });

const meshesIn = (o: THREE.Object3D) => { const out: THREE.Mesh[] = []; o.traverse((m) => { if (m instanceof THREE.Mesh) out.push(m); }); return out; };

describe('3D の体の場面', () => {
  test('読み込んだ体が場面に入る。部品ごとに奥行きの板が1枚だけ付き、皮膚には線が付く。読み込んだ元の形は変えない', async () => {
    const loaded = await loadBody();
    const scene = new BodyScene();
    scene.setModel(loaded);
    const all = meshesIn(scene.body);
    // 36 部品 ＋ 皮膚以外の 35 部品に奥行きの板
    expect(all).toHaveLength(36 + 35);
    const muscle = all.find((m) => m.name === 'delt_front_r')!;
    expect(muscle.children.filter((c) => c instanceof THREE.Mesh)).toHaveLength(1);
    expect(all.find((m) => m.name === 'skin')!.children.some((c) => c instanceof THREE.LineSegments)).toBe(true);
    // 元（useLoader が持ち回る形）には子を足さない
    expect(meshesIn(loaded)).toHaveLength(36);
    // 2回呼んでも二重にしない
    scene.setModel(loaded);
    expect(meshesIn(scene.body)).toHaveLength(71);
  });

  test('ケガの印・毎コマの処理・押した所の判定・引き出し線の先', async () => {
    const scene = new BodyScene();
    const tips: number[][] = [];
    let picked: string | null | undefined;
    const marks = [mark('a', 'shoulder_front', 'right', true), mark('b', 'lower_back', null, false), mark('c', 'knee', 'left', true)];
    // 読み込む前に印を渡しても、読み込んだあとに付く
    scene.configure({ marks, reduced: false, tipMarks: marks, onPick: (p) => { picked = p; }, onTips: (v) => tips.push(v) });
    scene.setModel(await loadBody());
    const all = meshesIn(scene.body);
    const color = (name: string) => (all.find((m) => m.name === name)!.material as THREE.ShaderMaterial).uniforms.uColor.value as THREE.Color;
    // 直している途中の右肩は琥珀色、左肩は緑のまま。左右の分からない腰の筋肉は両方とも直せたの緑
    expect(color('delt_front_r').r).toBeGreaterThan(color('delt_front_r').g);
    expect(color('delt_front_r').equals(color('delt_front_l'))).toBe(false);
    expect(color('erector_low_r').equals(color('erector_low_l'))).toBe(true);

    const cam = camera(348, 380);
    for (let i = 0; i < 5; i++) scene.frame(cam, 348, 380, i / 60, 1 / 60);
    const last = tips[tips.length - 1];
    expect(last).toHaveLength(9);
    for (const v of last) expect(Number.isFinite(v)).toBe(true);
    // 付け根は図の中
    for (let i = 0; i < 3; i++) {
      expect(last[i * 3]).toBeGreaterThan(0); expect(last[i * 3]).toBeLessThan(348);
      expect(last[i * 3 + 1]).toBeGreaterThan(0); expect(last[i * 3 + 1]).toBeLessThan(380);
    }

    // 体のまん中を押すと部品を選び、外を押すと選ぶのをやめる
    scene.tapAt(174, 150);
    scene.frame(cam, 348, 380, 0.1, 1 / 60);
    expect(typeof picked).toBe('string');
    scene.tapAt(5, 5);
    scene.frame(cam, 348, 380, 0.2, 1 / 60);
    expect(picked).toBeNull();
  });

  test('ケガの画面の光り方は変えない（ふだん・直せた・直している途中の強さと、にじみの大きさ）', async () => {
    const scene = new BodyScene();
    scene.configure({ marks: [mark('a', 'chest', 'right', true), mark('b', 'biceps', 'left', false)], reduced: false, tipMarks: [], onPick: () => {}, onTips: () => {} });
    scene.setModel(await loadBody());
    const all = meshesIn(scene.body);
    const u = (name: string) => (all.find((m) => m.name === name)!.material as THREE.ShaderMaterial).uniforms;
    const pick = (name: string) => [u(name).uBase.value, u(name).uRim.value, u(name).uPulse.value];
    expect(pick('quad_r')).toEqual([0.13, 1.2, 0]);
    expect(pick('biceps_l')).toEqual([0.32, 1.8, 0]);
    expect(pick('pec_r')).toEqual([0.7, 2.2, 1]);
    expect(scene.shared.uScanAmp.value).toBe(1);
    // 色：ふだんと台・皮膚は緑、直している途中とにじみは琥珀色
    const green = new THREE.Color(colors.accent).getHexString();
    const amber = new THREE.Color(toneColors.caution.accent).getHexString();
    expect((u('quad_r').uColor.value as THREE.Color).getHexString()).toBe(green);
    expect((u('skin').uColor.value as THREE.Color).getHexString()).toBe(green);
    expect((u('pec_r').uColor.value as THREE.Color).getHexString()).toBe(amber);
    const deckLine = scene.deck.children.find((c) => c instanceof THREE.LineLoop) as THREE.LineLoop;
    expect((deckLine.material as THREE.LineBasicMaterial).color.getHexString()).toBe(green);
    scene.frame(camera(348, 380), 348, 380, 0.5, 1 / 60);
    const glow = scene.glowGroup.children[0] as THREE.Mesh;
    expect(scene.glowGroup.children).toHaveLength(1);
    expect(glow.scale.x).toBeCloseTo(0.26 + 0.08 * (0.5 + 0.5 * Math.sin(0.5 * Math.PI)));
    expect((glow.material as THREE.ShaderMaterial).uniforms.uOpacity.value).toBeCloseTo(0.25 + 0.45 * (0.5 + 0.5 * Math.sin(0.5 * Math.PI)));
    expect(((glow.material as THREE.ShaderMaterial).uniforms.uColor.value as THREE.Color).getHexString()).toBe(amber);
  });

  test('回復マップ：土台の色・明るさの表の色と強さ・ケガの色を渡せる。台と皮膚も土台の色。走査の帯は控えめ。画面から部品を選べる', async () => {
    const scene = new BodyScene();
    let picked: string | null | undefined;
    const marks = [mark('a', 'chest', 'right', true)];
    // 読み込む前に渡しても、読み込んだあとに付く
    scene.configure({
      marks: [...marks, mark('b', 'biceps', 'left', false)], reduced: false, tipMarks: [], onPick: (p) => { picked = p; }, onTips: () => {},
      levels: { pec_r: 1, pec_l: 1, quad_l: 0.5, nope: 1 }, quietMarks: true,
      baseColor: '#0000FF', levelColor: (k) => (k >= 1 ? '#FF8000' : '#FFFF00'), injuryColor: '#FF0000',
      idle: ['calf_r', 'pec_l'], idleColor: '#808080',
    });
    scene.select(['biceps_r', 'biceps_l', 'skin']);
    scene.setModel(await loadBody());
    const all = meshesIn(scene.body);
    const u = (name: string) => (all.find((m) => m.name === name)!.material as THREE.ShaderMaterial).uniforms;
    const hexOf = (name: string) => (u(name).uColor.value as THREE.Color).getHexString();
    // 土台の色（縁の光はケガの画面のふだんと同じ強さ）、回復中は明るさの色と強さ
    expect([hexOf('quad_r'), u('quad_r').uBase.value, u('quad_r').uRim.value]).toEqual(['0000ff', 0.13, 1.2]);
    expect([hexOf('pec_l'), u('pec_l').uBase.value, u('pec_l').uRim.value]).toEqual(['ff8000', 0.55, 2.4]);
    expect(hexOf('quad_l')).toBe('ffff00');
    expect(u('quad_l').uBase.value).toBeCloseTo(0.34);
    expect(u('quad_l').uRim.value).toBeCloseTo(1.8);
    // 空いている部品はふだんの強さのまま空いている色。回復の光があればそちらが先（左胸）
    expect([hexOf('calf_r'), u('calf_r').uBase.value, u('calf_r').uRim.value]).toEqual(['808080', 0.13, 1.2]);
    expect(hexOf('calf_l')).toBe('0000ff');
    // 直している途中の右胸はケガの赤で脈打つ。直せたケガ（左の二頭筋）は印を付けない
    expect([hexOf('pec_r'), u('pec_r').uBase.value, u('pec_r').uRim.value, u('pec_r').uPulse.value]).toEqual(['ff0000', 0.45, 1.9, 0.5]);
    // 走査の帯は控えめ（ケガの画面は 1）
    expect(scene.shared.uScanAmp.value).toBe(0.35);
    expect([hexOf('biceps_l'), u('biceps_l').uBase.value]).toEqual(['0000ff', 0.13]);
    // 皮膚と台も土台の色
    expect(hexOf('skin')).toBe('0000ff');
    const deckLine = scene.deck.children.find((c) => c instanceof THREE.LineLoop) as THREE.LineLoop;
    expect((deckLine.material as THREE.LineBasicMaterial).color.getHexString()).toBe('0000ff');
    // 選んだ部品（皮膚は選ばない）
    expect([u('biceps_r').uSel.value, u('biceps_l').uSel.value, u('skin').uSel.value]).toEqual([1, 1, 0]);

    const cam = camera(348, 380);
    scene.frame(cam, 348, 380, 0.5, 1 / 60);
    const glow = scene.glowGroup.children[0] as THREE.Mesh;
    expect(glow.scale.x).toBeCloseTo((0.26 + 0.08) * 0.8);
    expect(((glow.material as THREE.ShaderMaterial).uniforms.uColor.value as THREE.Color).getHexString()).toBe('ff0000');
    // 選んだ部品の1つを押すと、まとめて選ぶのをやめる
    scene.select(['pec_r', 'pec_l']);
    scene.tapAt(174, 150);
    scene.frame(cam, 348, 380, 0.6, 1 / 60);
    // 押した所が胸なら選ぶのをやめ（null）、ほかの部品ならその部品だけを選ぶ。どちらでも左胸は選んでいない
    expect(u('pec_l').uSel.value).toBe(0);
    if (picked != null) expect(u(picked).uSel.value).toBe(1);
    scene.select([]);
    expect(all.filter((m) => (m.material as THREE.ShaderMaterial).uniforms?.uSel?.value === 1)).toHaveLength(0);
    // 明るさの表を外すと、ふだんの光に戻る
    scene.configure({ marks: [], reduced: false, tipMarks: [], onPick: () => {}, onTips: () => {} });
    expect([u('pec_r').uBase.value, u('pec_r').uRim.value]).toEqual([0.13, 1.2]);
    // 空いている部品も外すと緑に戻る（土台の色を渡さなければ緑）
    expect(hexOf('calf_r')).toBe(hexOf('quad_r'));
  });

  test('透視の写し（#212）：光っている部品にだけ付き、部品の裏がカメラを向いたときだけ出る。光らなくなったら外す', async () => {
    const scene = new BodyScene();
    const loaded = await loadBody();
    scene.setModel(loaded);
    const xraysOf = () => meshesIn(scene.body).filter((m) => m.name.endsWith('#xray'));
    // 何も光っていなければ写しはない
    expect(xraysOf()).toHaveLength(0);
    // 胸（前）と腰の筋肉（後ろ）を光らせる。直せたケガは控えめな印では光らないので写しもない
    scene.configure({
      marks: [mark('a', 'lower_back', 'right', true), mark('b', 'biceps', 'left', false)], reduced: true, tipMarks: [], onPick: () => {}, onTips: () => {},
      levels: { pec_r: 1, pec_l: 0.5, quad_l: 0 }, quietMarks: true,
    });
    const names = xraysOf().map((x) => x.parent!.name).sort();
    expect(names).toEqual(['erector_low_r', 'pec_l', 'pec_r']);
    const all = meshesIn(scene.body);
    const part = (n: string) => all.find((m) => m.name === n)!;
    const xray = (n: string) => part(n).children.find((c) => c.name === `${n}#xray`) as THREE.Mesh;
    const mat = (n: string) => xray(n).material as THREE.ShaderMaterial;
    // 形は元の部品と共有（三角形は増やさない）。奥行きを見ずに、皮膚より後に重ねる。押しても当たらない
    expect(xray('pec_r').geometry).toBe(part('pec_r').geometry);
    expect([mat('pec_r').depthTest, mat('pec_r').depthWrite, xray('pec_r').renderOrder]).toEqual([false, false, 3]);
    // 色と強さは元の部品と同じ値。走査の帯と選んだ光は写さない
    const u = (part('pec_r').material as THREE.ShaderMaterial).uniforms;
    expect(mat('pec_r').uniforms.uColor).toBe(u.uColor);
    expect(mat('pec_r').uniforms.uBase).toBe(u.uBase);
    expect([mat('pec_r').uniforms.uScanAmp.value, mat('pec_r').uniforms.uSel.value]).toEqual([0, 0]);

    const cam = camera(348, 380);
    const inner = scene as unknown as { yaw: number };
    // 正面：胸は表が見えているので写しを出さない。後ろの腰は出す（裏から透かす）
    inner.yaw = 0;
    scene.frame(cam, 348, 380, 0, 1 / 60);
    expect([xray('pec_r').visible, xray('erector_low_r').visible]).toEqual([false, true]);
    // 元の光より弱い（写しは両面で2枚重なるので、半分より弱く）
    expect(mat('erector_low_r').uniforms.uFade.value).toBeGreaterThan(0.15);
    expect(mat('erector_low_r').uniforms.uFade.value).toBeLessThan(0.5);
    // 背中から：胸の写しが出る（元の光より弱い）、腰は出さない
    inner.yaw = Math.PI;
    scene.frame(cam, 348, 380, 0.1, 1 / 60);
    expect([xray('pec_r').visible, xray('pec_l').visible, xray('erector_low_r').visible]).toEqual([true, true, false]);
    expect(mat('pec_r').uniforms.uFade.value).toBeGreaterThan(0.15);
    expect(mat('pec_r').uniforms.uFade.value).toBeLessThan(0.5);
    // 横から（胸の外向きとカメラがほぼ直角）は弱い
    inner.yaw = Math.PI / 2;
    scene.frame(cam, 348, 380, 0.2, 1 / 60);
    expect(mat('pec_r').uniforms.uFade.value).toBeLessThan(0.1);

    // 光らなくなったら外す。元の部品の形は捨てない
    scene.configure({ marks: [], reduced: true, tipMarks: [], onPick: () => {}, onTips: () => {} });
    expect(xraysOf()).toHaveLength(0);
    expect(meshesIn(scene.body)).toHaveLength(71);
    expect(part('pec_r').geometry.attributes.position.count).toBeGreaterThan(0);
  });

  test('透視の写しの向き：どの部品も外向きが決まる（三角筋の中部は横）', async () => {
    const scene = new BodyScene();
    scene.setModel(await loadBody());
    const faces = (scene as unknown as { faces: Record<string, { out: THREE.Vector3 }> }).faces;
    expect(Object.keys(faces)).toHaveLength(35);
    for (const [n, f] of Object.entries(faces)) {
      expect(f.out.length()).toBeCloseTo(1);
      if (n.startsWith('pec') || n === 'abs' || n.startsWith('quad') || n.startsWith('biceps')) expect(f.out.z).toBeGreaterThan(0);
      if (n.startsWith('erector') || n.startsWith('glute') || n.startsWith('ham') || n.startsWith('lat') || n.startsWith('triceps')) expect(f.out.z).toBeLessThan(0);
    }
    expect(faces.delt_mid_r.out.z).toBe(0);
    expect(Math.sign(faces.delt_mid_r.out.x)).toBe(-Math.sign(faces.delt_mid_l.out.x));
  });

  test('最初のコマを描いたことを1回だけ知らせる。体を読み込む前は知らせない。あとから受けてもすぐ知らせる', async () => {
    const scene = new BodyScene();
    const cam = camera(348, 380);
    let n = 0;
    scene.onFirstFrame(() => { n += 1; });
    scene.frame(cam, 348, 380, 0, 1 / 60);
    scene.frame(cam, 348, 380, 0.1, 1 / 60);
    expect(n).toBe(0);
    scene.setModel(await loadBody());
    scene.frame(cam, 348, 380, 0.2, 1 / 60);
    expect(n).toBe(0);
    scene.frame(cam, 348, 380, 0.3, 1 / 60);
    expect(n).toBe(1);
    scene.frame(cam, 348, 380, 0.4, 1 / 60);
    expect(n).toBe(1);
    let late = 0;
    scene.onFirstFrame(() => { late += 1; });
    expect(late).toBe(1);
  });

  test('描く回数を減らしてよいのは、最初のコマを描いたあとで、触っていないとき（なぞる・惰性で回る・押した所を選ぶ前は毎コマ描く）', async () => {
    const scene = new BodyScene();
    const cam = camera(348, 380);
    scene.setModel(await loadBody());
    expect(scene.idle()).toBe(false);
    scene.frame(cam, 348, 380, 0, 1 / 60);
    scene.frame(cam, 348, 380, 0.1, 1 / 60);
    expect(scene.idle()).toBe(true);
    scene.tapAt(174, 150);
    expect(scene.idle()).toBe(false);
    scene.frame(cam, 348, 380, 0.2, 1 / 60);
    expect(scene.idle()).toBe(true);
    // 指を離した直後の惰性（なぞる操作の中で入る値を、直接入れて確かめる）
    const inner = scene as unknown as { vYaw: number; dragging: boolean };
    inner.vYaw = 3;
    expect(scene.idle()).toBe(false);
    for (let i = 0; i < 200 && !scene.idle(); i++) scene.frame(cam, 348, 380, 0.3 + i / 60, 1 / 60);
    expect(scene.idle()).toBe(true);
    inner.dragging = true;
    expect(scene.idle()).toBe(false);
  });
});
