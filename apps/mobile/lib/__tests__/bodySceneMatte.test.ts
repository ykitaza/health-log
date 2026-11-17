// クラシックのつや消しの体（components/bodyScene.ts の matte）：本物の GLB を読み込み、材質の差し替え・光・色・ケガの印・選ぶ・押す・
// 引き出し線の先・材質を捨てるまでを通す（描画（GL）はしない。実機ではまだ見ていない）
import { readFileSync } from 'fs';
import { join } from 'path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BodyScene, Mark, matteFor, SKIN_PUSH_GLSL } from '@/components/bodyScene';
import { BODY_COLOR_SETS } from '@/lib/bodyColors';
import { anchorFor, CAMERA, facingOf, partsFor } from '@/lib/bodyModel';
import { MATTE, MATTE_RECOVERED, matteRecovering, matteVolume, mixLinear } from '@/theme/matte';

async function loadBody(): Promise<THREE.Object3D> {
  const buf = readFileSync(join(__dirname, '../../assets/models/body.glb'));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const gltf = await new Promise<{ scene: THREE.Object3D }>((res, rej) => new GLTFLoader().parse(ab, './', res, rej));
  return gltf.scene;
}

const mark = (id: string, site: string, side: 'right' | 'left' | null, fixing: boolean): Mark =>
  ({ id, parts: partsFor(site, side), anchor: anchorFor(site, side)!, facing: facingOf(site, side), fixing });
const meshesIn = (o: THREE.Object3D) => { const out: THREE.Mesh[] = []; o.traverse((m) => { if (m instanceof THREE.Mesh) out.push(m); }); return out; };
const hex = (c: THREE.Color) => `#${c.getHexString().toUpperCase()}`;

function camera() {
  const c = new THREE.PerspectiveCamera(CAMERA.fov, 348 / 380, CAMERA.near, CAMERA.far);
  c.position.set(...CAMERA.position);
  c.lookAt(...CAMERA.target);
  c.updateMatrixWorld();
  return c;
}

describe('色の混ぜ方（three.js の Color.lerp と同じ線形の色空間）', () => {
  test('three.js と同じ色になる', () => {
    for (const [a, b, t] of [[MATTE.plaster, MATTE.recovering, 0.8], [MATTE.plaster, MATTE.recovered, 0.5], ['#000000', '#FFFFFF', 0.3]] as const) {
      expect(mixLinear(a, b, t)).toBe(hex(new THREE.Color(a).lerp(new THREE.Color(b), t)));
    }
  });
  test('回復中は石膏と橙を 0.2 + 0.8k、回復済みは緑を半分、部位の量は 0〜5 段', () => {
    expect(matteRecovering(1)).toBe(MATTE.recovering);
    expect(matteRecovering(0.75)).toBe(mixLinear(MATTE.plaster, MATTE.recovering, 0.8));
    expect(MATTE_RECOVERED).toBe(mixLinear(MATTE.plaster, MATTE.recovered, 0.5));
    expect([0, 1, 2, 3, 4, 5].map(matteVolume)).toEqual(['#EAE3D4', '#CBDBEA', '#A8C5E2', '#86ACD6', '#3A76B4', '#1F63A0']);
  });
  test('つや消しの体の色：その日の部位は部位の量のいちばん濃い青、ほかは石膏。ケガは赤', () => {
    const m = BODY_COLOR_SETS.matte;
    expect(m.trained).toBe('#1F63A0');
    expect(m.neutral).toBe(MATTE.plaster);
    expect(m.idle).toBe(MATTE.plaster);
    expect(m.injury).toBe('#C2302A');
    expect(m.volume(1)).toBe('#1F63A0');
    expect(m.volume(0)).toBe(MATTE.plaster);
  });
});

describe('つや消しの体（クラシック）', () => {
  test('クラシックはつや消し、HUD はホログラム', () => {
    expect(matteFor('classic')).toBe(true);
    expect(matteFor('hud')).toBe(false);
  });

  test('材質を差し替え、光と影を出し、台・走査の輪・奥行きの板・皮膚の線を隠す。読み込む前に渡しても効く', async () => {
    const scene = new BodyScene();
    scene.configure({ marks: [], reduced: false, tipMarks: [], onPick: () => {}, onTips: () => {}, look: 'classic' });
    scene.setModel(await loadBody());
    const parts = meshesIn(scene.body).filter((m) => !(m.parent instanceof THREE.Mesh));
    expect(parts).toHaveLength(36);
    for (const m of parts) {
      const mat = m.material as THREE.MeshStandardMaterial;
      expect(mat).toBeInstanceOf(THREE.MeshStandardMaterial);
      expect(mat.roughness).toBe(0.85);
      expect(mat.metalness).toBe(0);
      expect(mat.flatShading).toBe(true);
      expect(mat.side).toBe(THREE.DoubleSide);
      expect(mat.toneMapped).toBe(false);
      expect(mat.transparent).toBe(false);
      for (const c of m.children) expect(c.visible).toBe(false);
    }
    // 皮膚は奥へ押す（頂点のシェーダーに差し込む）
    const skin = parts.find((m) => m.name === 'skin')!.material as THREE.MeshStandardMaterial;
    expect(skin.customProgramCacheKey()).toBe('matte-skin-push');
    const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: 'void main(){\n#include <project_vertex>\n}' } as unknown as THREE.WebGLProgramParametersWithUniforms;
    skin.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.uniforms.uPush.value).toBe(0.035);
    expect(shader.vertexShader).toContain(SKIN_PUSH_GLSL.split('\n')[1].trim());
    expect(shader.vertexShader.startsWith('uniform float uPush;')).toBe(true);
    // 光：半球の光と、向きのある光 2 つ（影の地図は使わない）
    expect(scene.matteStage.visible).toBe(true);
    const lights = scene.matteStage.children.filter((c): c is THREE.Light => c instanceof THREE.Light);
    expect(lights.map((l) => [l.type, l.intensity])).toEqual([['HemisphereLight', 2], ['DirectionalLight', 2.6], ['DirectionalLight', 0.9]]);
    expect(lights.every((l) => !l.castShadow)).toBe(true);
    expect(scene.deck.visible).toBe(false);
    expect(scene.scanRing.visible).toBe(false);
  });

  test('色：回復の明るさ・空いている部品・ケガ（部品の赤と、関節の刷った点）。選んだ部品は墨へ寄せる', async () => {
    const scene = new BodyScene();
    scene.setModel(await loadBody());
    const marks = [mark('a', 'shoulder_joint', 'right', true)];
    const colors = BODY_COLOR_SETS.matte;
    scene.configure({
      marks, reduced: false, tipMarks: marks, onPick: () => {}, onTips: () => {}, look: 'classic', quietMarks: true,
      levels: { quad_r: 0.75 }, baseColor: colors.rest, levelColor: colors.recovering, injuryColor: colors.injury, idle: ['abs'], idleColor: colors.idle,
    });
    const color = (name: string) => hex((meshesIn(scene.body).find((m) => m.name === name)!.material as THREE.MeshStandardMaterial).color);
    expect(color('quad_r')).toBe(hex(new THREE.Color(matteRecovering(0.75))));
    expect(color('pec_r')).toBe(hex(new THREE.Color(MATTE_RECOVERED)));
    expect(color('abs')).toBe(hex(new THREE.Color(MATTE.plaster)));
    expect(color('skin')).toBe(hex(new THREE.Color(MATTE.plaster)));
    // 肩の関節のケガ：関節には部品がないので、付け根の手前に刷った点（奥行きを見ない、紙の色の輪つき）。部品は塗らない
    expect(partsFor('shoulder_joint', 'right')).toEqual([]);
    expect(color('delt_front_r')).toBe(hex(new THREE.Color(MATTE_RECOVERED)));
    const dots = scene.glowGroup.children as THREE.Mesh[];
    expect(dots).toHaveLength(1);
    expect((dots[0].material as THREE.MeshBasicMaterial).depthTest).toBe(false);
    expect(hex((dots[0].material as THREE.MeshBasicMaterial).color)).toBe('#C2302A');
    expect(hex(((dots[0].children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).color)).toBe('#F5F2EA');

    const before = color('biceps_l');
    scene.select(['biceps_l']);
    expect(color('biceps_l')).not.toBe(before);
    scene.select([]);
    expect(color('biceps_l')).toBe(before);

    // 毎コマ：点は大きさを変えず、カメラに向く。引き出し線の先は図の中
    const tips: number[][] = [];
    scene.configure({ marks, reduced: false, tipMarks: marks, onPick: () => {}, onTips: (v) => tips.push(v), look: 'classic', quietMarks: true, injuryColor: colors.injury });
    const cam = camera();
    for (let i = 0; i < 3; i++) scene.frame(cam, 348, 380, i / 2, 1 / 60);
    const dot = scene.glowGroup.children[0];
    expect(dot.scale.x).toBe(1);
    expect(dot.quaternion.equals(cam.quaternion)).toBe(true);
    const last = tips[tips.length - 1];
    expect(last[0]).toBeGreaterThan(0); expect(last[0]).toBeLessThan(348);
  });

  test('ケガの画面：直している途中・直せたの色を渡せる。押すと部品を選べる', async () => {
    const scene = new BodyScene();
    scene.setModel(await loadBody());
    let picked: string | null | undefined;
    const marks = [mark('a', 'shoulder_front', 'right', true), mark('b', 'lower_back', null, false)];
    scene.configure({
      marks, reduced: false, tipMarks: [], onPick: (p) => { picked = p; }, onTips: () => {}, look: 'classic',
      baseColor: MATTE.plaster, fixingColor: '#C2302A', fixedColor: MATTE_RECOVERED,
    });
    const color = (name: string) => hex((meshesIn(scene.body).find((m) => m.name === name)!.material as THREE.MeshStandardMaterial).color);
    expect(color('delt_front_r')).toBe('#C2302A');
    expect(color('erector_low_r')).toBe(hex(new THREE.Color(MATTE_RECOVERED)));
    expect(color('delt_front_l')).toBe(hex(new THREE.Color(MATTE.plaster)));
    const cam = camera();
    scene.frame(cam, 348, 380, 0, 1 / 60);
    scene.tapAt(174, 150);
    scene.frame(cam, 348, 380, 0.1, 1 / 60);
    expect(typeof picked).toBe('string');
  });

  test('部位の量の見方：段のない部品は石膏で、回復済みの緑にならない', async () => {
    const scene = new BodyScene();
    scene.setModel(await loadBody());
    const colors = BODY_COLOR_SETS.matte;
    scene.configure({
      marks: [], reduced: false, tipMarks: [], onPick: () => {}, onTips: () => {}, look: 'classic', quietMarks: true,
      levels: { pec_r: 0.8, pec_l: 0.8 }, baseColor: colors.neutral, levelColor: colors.volume, idle: ['abs'], idleColor: colors.volume(0),
    });
    const green = hex(new THREE.Color(MATTE_RECOVERED));
    const parts = meshesIn(scene.body).filter((m) => !(m.parent instanceof THREE.Mesh));
    for (const m of parts) expect(hex((m.material as THREE.MeshStandardMaterial).color)).not.toBe(green);
    expect(hex((parts.find((m) => m.name === 'pec_r')!.material as THREE.MeshStandardMaterial).color)).toBe(hex(new THREE.Color(matteVolume(4))));
  });

  test('閉じたあと（dispose）にもう一度 configure しても、つや消しの材質と色が付く', async () => {
    const scene = new BodyScene();
    scene.setModel(await loadBody());
    const base = { marks: [], reduced: false, tipMarks: [], onPick: () => {}, onTips: () => {}, look: 'classic' as const, levels: { quad_r: 1 }, levelColor: BODY_COLOR_SETS.matte.recovering };
    scene.configure(base);
    scene.dispose();
    expect(meshesIn(scene.body).every((m) => !(m.material instanceof THREE.MeshStandardMaterial))).toBe(true);
    scene.configure(base);
    const quad = meshesIn(scene.body).find((m) => m.name === 'quad_r')!.material as THREE.MeshStandardMaterial;
    expect(quad).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(hex(quad.color)).toBe(hex(new THREE.Color(matteRecovering(1))));
  });

  test('ホログラムに戻すと、つや消しの材質を捨てる（何度切り替えても材質は増えない）', async () => {
    const scene = new BodyScene();
    scene.setModel(await loadBody());
    const base = { marks: [mark('a', 'knee', 'left', true)], reduced: false, tipMarks: [], onPick: () => {}, onTips: () => {} };
    scene.configure({ ...base, look: 'classic' });
    const mats = meshesIn(scene.body).filter((m) => !(m.parent instanceof THREE.Mesh)).map((m) => m.material as THREE.MeshStandardMaterial);
    const disposed = mats.map((m) => jest.spyOn(m, 'dispose'));
    scene.configure({ ...base, look: 'hud' });
    for (const d of disposed) expect(d).toHaveBeenCalledTimes(1);
    expect(meshesIn(scene.body).every((m) => !(m.material instanceof THREE.MeshStandardMaterial))).toBe(true);
    expect(scene.matteStage.visible).toBe(false);
    expect(scene.deck.visible).toBe(true);
    scene.configure({ ...base, look: 'classic' });
    scene.dispose();
    expect(scene.glowGroup.children).toHaveLength(0);
  });
});
