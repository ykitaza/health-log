// ケガの画面の 3D の場面（components/bodyScene.ts）を、本物の GLB を読み込んで動かす。
// 描画（GL）はしないが、読み込み・材質付け・ケガの印・毎コマの処理・押した所の判定までを通す。
// 2026-11-13：部品をたどりながら子を足して終わらなくなり、実機で体が映らなかった（React の #520）。その再発を止める
import { readFileSync } from 'fs';
import { join } from 'path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BodyScene, Mark } from '@/components/bodyScene';
import { anchorFor, CAMERA, facingOf, partsFor } from '@/lib/bodyModel';

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
    scene.frame(camera(348, 380), 348, 380, 0.5, 1 / 60);
    const glow = scene.glowGroup.children[0] as THREE.Mesh;
    expect(scene.glowGroup.children).toHaveLength(1);
    expect(glow.scale.x).toBeCloseTo(0.26 + 0.08 * (0.5 + 0.5 * Math.sin(0.5 * Math.PI)));
    expect((glow.material as THREE.ShaderMaterial).uniforms.uOpacity.value).toBeCloseTo(0.25 + 0.45 * (0.5 + 0.5 * Math.sin(0.5 * Math.PI)));
  });

  test('回復マップ：明るさの表で光り、ケガの印は部品の色を変えずに小さなにじみだけ。画面から部品を選べる', async () => {
    const scene = new BodyScene();
    let picked: string | null | undefined;
    const marks = [mark('a', 'chest', 'right', true)];
    // 読み込む前に渡しても、読み込んだあとに付く
    scene.configure({ marks, reduced: false, tipMarks: [], onPick: (p) => { picked = p; }, onTips: () => {}, levels: { pec_r: 1, quad_l: 0.5, nope: 1 }, quietMarks: true });
    scene.select(['biceps_r', 'biceps_l', 'skin']);
    scene.setModel(await loadBody());
    const all = meshesIn(scene.body);
    const u = (name: string) => (all.find((m) => m.name === name)!.material as THREE.ShaderMaterial).uniforms;
    expect([u('pec_r').uBase.value, u('pec_r').uRim.value]).toEqual([0.55, 2.4]);
    expect(u('quad_l').uBase.value).toBeCloseTo(0.34);
    expect(u('quad_l').uRim.value).toBeCloseTo(1.8);
    expect([u('quad_r').uBase.value, u('quad_r').uRim.value]).toEqual([0.13, 1.2]);
    // 直している途中の胸は、緑の回復の光のまま（脈打たない）
    expect(u('pec_r').uColor.value.g).toBeGreaterThan(u('pec_r').uColor.value.r);
    expect(u('pec_r').uPulse.value).toBe(0);
    // 選んだ部品（皮膚は選ばない）
    expect([u('biceps_r').uSel.value, u('biceps_l').uSel.value, u('skin').uSel.value]).toEqual([1, 1, 0]);

    const cam = camera(348, 380);
    scene.frame(cam, 348, 380, 0.5, 1 / 60);
    const glow = scene.glowGroup.children[0] as THREE.Mesh;
    expect(glow.scale.x).toBeCloseTo((0.26 + 0.08) * 0.6);
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
});
