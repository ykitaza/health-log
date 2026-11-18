#!/usr/bin/env node
// 3D の体（apps/karada/assets/models/body.glb）に、あとから入れた手直しを、元の GLB から同じように作り直すためのスクリプト。
// 依存なし（node だけ）。部品の名前・並び・頂点の数と並び（皮膚）・材質のない作りはそのまま。
//
//   node tools/body-model/edit-body-glb.mjs <入力の body.glb> <出力の body.glb>
//
// 入力は、手直しの前の body.glb（git の 2f6f7cc の apps/mobile/assets/models/body.glb）。
// 何をするかは apps/karada/assets/models/README.md の「手を入れたこと」にも書く。
//
// 1. 皮膚（skin）の性器をなくす：股の前の範囲（GENITALS）の頂点だけを動かし、まわりの皮膚は動かさずに、
//    範囲の中を「曲がり方がいちばん少ない面」（双調和の面。範囲の外の 2 周の頂点が縁の形と傾きを決める）に置き直す。
//    頂点と三角形は消さない（穴も、縫い目もできない）。動かした頂点とその隣の法線は、面の向きから作り直す（外向き）。
// 2. 腹筋（abs）の上の縁を、大胸筋（pec_r・pec_l）の下の縁の丸い形に合わせる：腹筋は皮膚の形から四角く切り出した代わりの部品で、
//    上の端が大胸筋の下の部分の前に重なり、胸の下の縁が四角く削れて見えていた。大胸筋の下の縁（左右の x ごとの、前の面のいちばん下）
//    より上（余白 ABS_GAP）にある腹筋の三角形を消す。
import { readFileSync, writeFileSync } from 'fs';

/** 性器の範囲（体の座標、メートル。上が +y、前が +z）：この楕円体の中の皮膚の頂点を置き直す */
const GENITALS = { center: [0, 0.805, 0.045], radius: [0.05, 0.065, 0.07] };
/** 法線の外向きを決める、骨盤の中の点 */
const PELVIS = [0, 0.86, -0.01];
/** 腹筋の上の縁を、大胸筋の下の縁からどれだけ下げるか（m） */
const ABS_GAP = 0.004;
/**
 * 腹筋のいちばん上（m）。大胸筋の下の縁は胸骨へ向かって 1.30 まで上がるので、縁に合わせるだけだと、左右の大胸筋のあいだに
 * 腹筋がとがって伸びる。腹直筋の上の端（みぞおち）はそれより下なので、大胸筋の下の縁が x = ±0.045 で 1.235 になる高さで止める
 */
const ABS_TOP = 1.235;

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: node tools/body-model/edit-body-glb.mjs <in body.glb> <out body.glb>');
  process.exit(1);
}

// ---------- GLB を読む ----------
const file = readFileSync(input);
if (file.readUInt32LE(0) !== 0x46546c67) throw new Error('GLB ではない');
const jsonLen = file.readUInt32LE(12);
const gltf = JSON.parse(file.subarray(20, 20 + jsonLen).toString('utf8'));
const binStart = 20 + jsonLen + 8;
const bin = Buffer.from(file.subarray(binStart, binStart + file.readUInt32LE(20 + jsonLen)));

/** bufferView ごとの中身（書き換えたら差し替え、最後に詰め直す） */
const views = gltf.bufferViews.map((v) => Buffer.from(bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength)));
const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const ARRAYS = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array };
function read(i) {
  const a = gltf.accessors[i];
  const T = ARRAYS[a.componentType];
  const n = a.count * COMPONENTS[a.type];
  const buf = views[a.bufferView];
  const copy = Buffer.from(buf.subarray(a.byteOffset ?? 0, (a.byteOffset ?? 0) + n * T.BYTES_PER_ELEMENT));
  return new T(copy.buffer, copy.byteOffset, n);
}
function write(i, arr) {
  const a = gltf.accessors[i];
  if (a.byteOffset) throw new Error('byteOffset のある accessor は書かない');
  if (gltf.bufferViews.filter((_, k) => k === a.bufferView).length !== 1) throw new Error('bufferView がない');
  if (gltf.accessors.filter((x) => x.bufferView === a.bufferView).length !== 1) throw new Error('bufferView を共有する accessor は書かない');
  views[a.bufferView] = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
  gltf.bufferViews[a.bufferView].byteLength = arr.byteLength;
  a.count = arr.length / COMPONENTS[a.type];
}
function primitive(name) {
  const m = gltf.meshes.find((x) => x.name === name);
  if (!m || m.primitives.length !== 1) throw new Error(`部品 ${name} がない`);
  return m.primitives[0];
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// ---------- 1. 皮膚の性器をなくす ----------
{
  const prim = primitive('skin');
  const P = read(prim.attributes.POSITION);
  const N = read(prim.attributes.NORMAL);
  const I = read(prim.indices);
  const nv = P.length / 3;
  const pos = (v) => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
  // 隣の頂点（辺でつながる）
  const nb = Array.from({ length: nv }, () => new Set());
  for (let t = 0; t < I.length; t += 3) {
    for (let k = 0; k < 3; k++) { const a = I[t + k], b = I[t + (k + 1) % 3]; nb[a].add(b); nb[b].add(a); }
  }
  const adj = nb.map((s) => [...s]);
  const { center: c, radius: r } = GENITALS;
  const inside = (v) => ((P[v * 3] - c[0]) / r[0]) ** 2 + ((P[v * 3 + 1] - c[1]) / r[1]) ** 2 + ((P[v * 3 + 2] - c[2]) / r[2]) ** 2 < 1;
  const free = [];
  const slot = new Int32Array(nv).fill(-1);
  for (let v = 0; v < nv; v++) if (inside(v)) { slot[v] = free.length; free.push(v); }
  // ラプラシアン（一様な重み）L(u) = x_u − 平均(隣) を、動かす頂点とその隣のすべての u で 0 に近づける（最小二乗）。
  // 動かさない頂点は今の位置のまま。共役勾配法で、x・y・z を別々に解く
  const rows = new Set(free);
  for (const v of free) for (const w of adj[v]) rows.add(w);
  const rowList = [...rows].filter((u) => adj[u].length > 0);
  const n = free.length;
  const solve = (d) => {
    // A x = b の形：行 u ごとに、動かす頂点の係数と、動かさない頂点から来る定数
    const rowsA = rowList.map((u) => {
      const k = 1 / adj[u].length;
      const coef = new Map();
      let rhs = 0;
      const add = (v, a) => { if (slot[v] >= 0) coef.set(slot[v], (coef.get(slot[v]) ?? 0) + a); else rhs -= a * P[v * 3 + d]; };
      add(u, 1);
      for (const w of adj[u]) add(w, -k);
      return { coef: [...coef], rhs };
    });
    const Ax = (x) => rowsA.map((row) => row.coef.reduce((s, [j, a]) => s + a * x[j], 0));
    const ATy = (y) => { const out = new Float64Array(n); rowsA.forEach((row, i) => { for (const [j, a] of row.coef) out[j] += a * y[i]; }); return out; };
    const x = Float64Array.from(free, (v) => P[v * 3 + d]);
    const b = rowsA.map((row) => row.rhs);
    // 正規方程式 AᵀA x = Aᵀb を共役勾配法で
    const Ax0 = Ax(x);
    let res = ATy(b.map((bi, i) => bi - Ax0[i]));
    let p = Float64Array.from(res);
    let rr = dot2(res, res);
    for (let it = 0; it < 5000 && rr > 1e-24; it++) {
      const Ap = ATy(Ax(p));
      const alpha = rr / dot2(p, Ap);
      for (let i = 0; i < n; i++) { x[i] += alpha * p[i]; res[i] -= alpha * Ap[i]; }
      const rr2 = dot2(res, res);
      for (let i = 0; i < n; i++) p[i] = res[i] + (rr2 / rr) * p[i];
      rr = rr2;
    }
    return x;
  };
  function dot2(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
  const sol = [0, 1, 2].map(solve);
  let moved = 0, maxMove = 0;
  for (let i = 0; i < n; i++) {
    const v = free[i];
    const m = Math.hypot(sol[0][i] - P[v * 3], sol[1][i] - P[v * 3 + 1], sol[2][i] - P[v * 3 + 2]);
    if (m > 1e-6) moved++;
    maxMove = Math.max(maxMove, m);
    for (let d = 0; d < 3; d++) P[v * 3 + d] = sol[d][i];
  }
  // 法線：動かした頂点と、その隣の頂点。まわりの三角形の面の向き（面積の重み）を足す。この GLB は三角形の巡る向きがそろっていないので、
  // 足す前に、頂点のまわりでいちばん大きい三角形の向きに、ほかの三角形の向きの表裏を合わせる（そのまま足すと打ち消し合う）。
  // 最後に、骨盤の中から外へ向ける
  const touched = new Set(free);
  for (const v of free) for (const w of adj[v]) touched.add(w);
  const faces = new Map();
  for (let t = 0; t < I.length; t += 3) {
    const [a, b, cc] = [I[t], I[t + 1], I[t + 2]];
    if (!touched.has(a) && !touched.has(b) && !touched.has(cc)) continue;
    const f = cross(sub(pos(b), pos(a)), sub(pos(cc), pos(a)));
    for (const v of [a, b, cc]) if (touched.has(v)) { if (!faces.has(v)) faces.set(v, []); faces.get(v).push(f); }
  }
  for (const v of touched) {
    const fs = faces.get(v) ?? [];
    if (!fs.length) continue;
    const big = fs.reduce((m, f) => (Math.hypot(...f) > Math.hypot(...m) ? f : m));
    let nn = [0, 0, 0];
    for (const f of fs) { const s = dot(f, big) < 0 ? -1 : 1; nn = nn.map((x, d) => x + s * f[d]); }
    const l = Math.hypot(...nn);
    if (l === 0) continue;
    nn = nn.map((x) => x / l);
    if (dot(nn, sub(pos(v), PELVIS)) < 0) nn = nn.map((x) => -x);
    for (let d = 0; d < 3; d++) N[v * 3 + d] = nn[d];
  }
  write(prim.attributes.POSITION, P);
  write(prim.attributes.NORMAL, N);
  console.log(`skin: ${n} 頂点を置き直した（動いたのは ${moved}、いちばん大きく動いたのは ${(maxMove * 1000).toFixed(1)}mm）。法線を作り直したのは ${touched.size} 頂点。頂点と三角形は消していない`);
}

// ---------- 2. 腹筋の上の縁を、大胸筋の下の縁に合わせる ----------
{
  // 大胸筋の下の縁：x を 5mm ごとに区切り、前の面（法線が前を向く頂点）のいちばん下の y
  const BIN = 0.005;
  const lower = new Map();
  for (const name of ['pec_r', 'pec_l']) {
    const prim = primitive(name);
    const P = read(prim.attributes.POSITION);
    for (let v = 0; v < P.length / 3; v++) {
      const k = Math.round(P[v * 3] / BIN);
      lower.set(k, Math.min(lower.get(k) ?? Infinity, P[v * 3 + 1]));
    }
  }
  const keys = [...lower.keys()].sort((a, b) => a - b);
  /** x での大胸筋の下の縁（区切りの外・まん中のすき間は、いちばん近い区切りの値。まん中は左右の内側の低い方） */
  const pecBottom = (x) => {
    const k = Math.round(x / BIN);
    if (lower.has(k)) return lower.get(k);
    let best = null;
    for (const q of keys) if (best === null || Math.abs(q - k) < Math.abs(best - k) || (Math.abs(q - k) === Math.abs(best - k) && lower.get(q) < lower.get(best))) best = q;
    return lower.get(best);
  };
  const prim = primitive('abs');
  const P = read(prim.attributes.POSITION);
  const I = read(prim.indices);
  const keep = [];
  let removed = 0;
  for (let t = 0; t < I.length; t += 3) {
    const tri = [I[t], I[t + 1], I[t + 2]];
    const over = tri.some((v) => P[v * 3 + 1] > Math.min(pecBottom(P[v * 3]) - ABS_GAP, ABS_TOP));
    if (over) removed++; else keep.push(...tri);
  }
  // 使われなくなった頂点は残す（頂点の数と並び・POSITION の min・max を変えない。部品の囲みから決めるホログラムの値と
  // lib/bodyModel.ts の BOXES がそのまま使える）。下の囲みは、残った三角形の範囲を知らせるだけ
  const used = new Set(keep);
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const v of used) for (let d = 0; d < 3; d++) { mn[d] = Math.min(mn[d], P[v * 3 + d]); mx[d] = Math.max(mx[d], P[v * 3 + d]); }
  write(prim.indices, new (I.constructor)(keep));
  console.log(`abs: ${removed} 三角形を消した（${I.length / 3} → ${keep.length / 3}）。三角形が使う頂点 ${used.size} / ${P.length / 3}、y ${mn[1].toFixed(3)}〜${mx[1].toFixed(3)}`);
}

// ---------- 詰め直して書く ----------
let offset = 0;
const parts = [];
gltf.bufferViews.forEach((v, i) => {
  const pad = (4 - (offset % 4)) % 4;
  if (pad) { parts.push(Buffer.alloc(pad)); offset += pad; }
  v.byteOffset = offset;
  parts.push(views[i]);
  offset += views[i].length;
});
const binOut = Buffer.concat(parts, offset);
const binPad = Buffer.concat([binOut, Buffer.alloc((4 - (binOut.length % 4)) % 4)]);
gltf.buffers[0].byteLength = binOut.length;
gltf.asset.generator = `${gltf.asset.generator} + tools/body-model/edit-body-glb.mjs`;
let json = Buffer.from(JSON.stringify(gltf), 'utf8');
json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + json.length + 8 + binPad.length, 8);
const chunk = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
writeFileSync(output, Buffer.concat([header, chunk(json.length, 0x4e4f534a), json, chunk(binPad.length, 0x004e4942), binPad]));
console.log(`書いた：${output}`);
