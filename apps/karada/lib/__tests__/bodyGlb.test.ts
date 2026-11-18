// 3D の体（assets/models/body.glb）に入れた手直し（tools/body-model/edit-body-glb.mjs。assets/models/README.md の「手を入れたこと」）が
// 残っていること：皮膚に性器がない（股の前が出っ張らない）。腹筋の上の縁が大胸筋の下の縁より下にある（胸の下の丸い縁を四角く隠さない）
import { readFileSync } from 'fs';
import { join } from 'path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

async function meshes(): Promise<Record<string, THREE.Mesh>> {
  const buf = readFileSync(join(__dirname, '../../assets/models/body.glb'));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const gltf = await new Promise<{ scene: THREE.Object3D }>((res, rej) => new GLTFLoader().parse(ab, './', res, rej));
  const out: Record<string, THREE.Mesh> = {};
  gltf.scene.traverse((o) => { if (o instanceof THREE.Mesh) out[o.name] = o; });
  return out;
}

/** 三角形が使っている頂点（使っていない頂点は数えない） */
function usedPoints(m: THREE.Mesh): THREE.Vector3[] {
  const pos = m.geometry.attributes.position;
  const idx = m.geometry.index!;
  const seen = new Set<number>();
  for (let i = 0; i < idx.count; i++) seen.add(idx.getX(i));
  return [...seen].map((v) => new THREE.Vector3().fromBufferAttribute(pos, v));
}

describe('3D の体の手直し', () => {
  test('皮膚に性器がない：股の前（まん中の 3cm・高さ 0.74〜0.85m）の皮膚は 7.5cm より前に出ない。皮膚の頂点と三角形の数は元のまま', async () => {
    const skin = (await meshes()).skin;
    const front = usedPoints(skin).filter((p) => Math.abs(p.x) < 0.03 && p.y > 0.74 && p.y < 0.85);
    expect(front.length).toBeGreaterThan(20);
    // 手直しの前は 10.2cm まで出ていた（40 頂点が 7.5cm より前）
    expect(Math.max(...front.map((p) => p.z))).toBeLessThan(0.075);
    expect(skin.geometry.attributes.position.count).toBe(9801);
    expect(skin.geometry.index!.count / 3).toBe(29941);
  });

  test('腹筋の上の縁は大胸筋の下の縁より下（x ごとに）。いちばん上はみぞおち（1.235m）', async () => {
    const all = await meshes();
    const pec = [...usedPoints(all.pec_r), ...usedPoints(all.pec_l)];
    const abs = usedPoints(all.abs);
    expect(Math.max(...abs.map((p) => p.y))).toBeLessThanOrEqual(1.2351);
    // x を 5mm ごとに区切って比べる（手直しのスクリプトと同じ区切り）
    const bin = (x: number) => Math.round(x / 0.005);
    const pecBottom = new Map<number, number>();
    for (const p of pec) pecBottom.set(bin(p.x), Math.min(pecBottom.get(bin(p.x)) ?? Infinity, p.y));
    for (const a of abs) {
      const b = pecBottom.get(bin(a.x));
      if (b != null) expect(a.y).toBeLessThan(b);
    }
    // 腹筋の下の方は元のまま（へそから下は削らない）
    expect(Math.min(...abs.map((p) => p.y))).toBeLessThan(1.025);
  });
});
