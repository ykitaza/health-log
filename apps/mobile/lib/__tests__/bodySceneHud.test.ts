// HUD の 3D の体（ホログラム）が、クラシックのつや消しの体を足す前（main の components/bodyScene.ts）と同じであること。
// 本物の GLB を読み込み、印・回復の明るさ・選んだ部品・毎コマの処理まで通してから、場面の中の物（材質の種類・シェーダーのソース・
// uniform の値・重ね方・奥行き・描く順・見せるか）を書き出し、main で書き出したもの（__snapshots__）と比べる。
// クラシックのつや消しにしてから HUD に戻しても、同じに戻ることも見る
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

const mark = (id: string, site: string, side: 'right' | 'left' | null, fixing: boolean): Mark =>
  ({ id, parts: partsFor(site, side), anchor: anchorFor(site, side)!, facing: facingOf(site, side), fixing });

/** 値を書き出す（色は16進、数は小数 4 桁） */
function value(v: unknown): unknown {
  if (v instanceof THREE.Color) return `#${v.getHexString()}`;
  if (typeof v === 'number') return Math.round(v * 1e4) / 1e4;
  if (v instanceof THREE.Vector3) return [v.x, v.y, v.z].map((x) => Math.round(x * 1e4) / 1e4);
  return v;
}

/** シェーダーのソースは、同じものを 1 回だけ書き出す（物には番号だけ） */
let shaders: string[] = [];
const shaderId = (src: string) => {
  if (!shaders.includes(src)) shaders.push(src);
  return `shader#${shaders.indexOf(src)}`;
};

function material(m: THREE.Material) {
  const out: Record<string, unknown> = {
    type: m.type, transparent: m.transparent, depthWrite: m.depthWrite, depthTest: m.depthTest, side: m.side, blending: m.blending,
    opacity: value(m.opacity), colorWrite: m.colorWrite, polygonOffset: m.polygonOffset,
  };
  if (m instanceof THREE.ShaderMaterial) {
    out.vertexShader = shaderId(m.vertexShader);
    out.fragmentShader = shaderId(m.fragmentShader);
    out.uniforms = Object.fromEntries(Object.entries(m.uniforms).sort(([a], [b]) => a.localeCompare(b)).map(([k, u]) => [k, value(u.value)]));
  }
  if (m instanceof THREE.LineBasicMaterial || m instanceof THREE.MeshBasicMaterial) out.color = value(m.color);
  return out;
}

/** 場面の物を、たどった順に書き出す */
function dump(root: THREE.Object3D) {
  const out: unknown[] = [];
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | undefined;
    out.push({
      type: o.type, name: o.name, visible: o.visible, renderOrder: o.renderOrder,
      position: value(o.position), scale: value(o.scale),
      ...(m ? { material: material(m) } : {}),
    });
  });
  return out;
}

async function hudScene() {
  const scene = new BodyScene();
  const marks = [mark('a', 'shoulder_front', 'right', true), mark('b', 'lower_back', null, false), mark('c', 'knee', 'left', true)];
  scene.configure({ marks, reduced: false, tipMarks: marks, onPick: () => {}, onTips: () => {} });
  scene.setModel(await loadBody());
  return { scene, marks };
}

function frames(scene: BodyScene) {
  const cam = new THREE.PerspectiveCamera(CAMERA.fov, 348 / 380, CAMERA.near, CAMERA.far);
  cam.position.set(...CAMERA.position);
  cam.lookAt(...CAMERA.target);
  cam.updateMatrixWorld();
  for (let i = 0; i < 4; i++) scene.frame(cam, 348, 380, 1 + i / 60, 1 / 60);
}

const all = (scene: BodyScene) => {
  shaders = [];
  const out = { body: dump(scene.body), deck: dump(scene.deck), scanRing: dump(scene.scanRing), glow: dump(scene.glowGroup) };
  return { ...out, shaders };
};

describe('HUD の 3D の体は main と同じ', () => {
  test('ケガの画面（印・直せた・直している途中、毎コマのあと）', async () => {
    const { scene } = await hudScene();
    frames(scene);
    expect(all(scene)).toMatchSnapshot();
  });

  test('回復マップ（回復の明るさ・空いている部品・控えめな印・選んだ部品）', async () => {
    const { scene, marks } = await hudScene();
    scene.configure({
      marks, reduced: false, tipMarks: [], onPick: () => {}, onTips: () => {}, quietMarks: true,
      levels: { quad_r: 1, quad_l: 0.5, pec_r: 0.25 }, baseColor: '#5BE49B', levelColor: (k) => (k > 0.5 ? '#FF8A3D' : '#F5C94A'),
      injuryColor: '#FF5A4F', idle: ['abs'], idleColor: '#6E7580',
    });
    scene.select(['biceps_l']);
    frames(scene);
    expect(all(scene)).toMatchSnapshot();
  });

  test('クラシックのつや消しにしてから HUD に戻しても、同じ材質・同じ値に戻る', async () => {
    // 同じ回数だけ回す（体の向きでにじみの位置が変わる）
    const before = await hudScene();
    frames(before.scene);
    frames(before.scene);
    const expected = all(before.scene);

    const { scene, marks } = await hudScene();
    const base = { marks, reduced: false, tipMarks: marks, onPick: () => {}, onTips: () => {} };
    scene.configure({ ...base, look: 'classic', matte: true });
    scene.select(['biceps_l']);
    frames(scene);
    scene.select([]);
    scene.configure({ ...base, look: 'hud' });
    frames(scene);
    expect(all(scene)).toEqual(expected);
  });
});
