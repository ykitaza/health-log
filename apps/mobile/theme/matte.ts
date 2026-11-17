/**
 * クラシック（紙の記録帳）の 3D の体：紙の上のつや消しの体（石膏の像）の値。three.js の場面は components/bodyScene.ts。
 * 値は試作（three r187 で描いて Figma「クラシック（大胆版）」に載せたもの。/private/tmp/claude-501/matte-body/params.md）のまま。
 * 色の混ぜ方も試作と同じく、three.js の Color.lerp と同じ線形の色空間で混ぜる（mixLinear）。
 * このファイルは何も import しない（theme/index.ts と components/bodyScene.ts の両方から読む）
 */
export const MATTE = {
  /** MeshStandardMaterial の粗さ・金属らしさ。面ごとの法線（flatShading）：GLB の法線と面の向きがそろっていないので、なめらかにすると皮膚に黒いしみが出る */
  roughness: 0.85,
  metalness: 0,
  flatShading: true,
  /** 石膏の色（皮膚と、色を付けない筋肉） */
  plaster: '#EAE3D4',
  /** 皮膚を奥へ押す量（m）。皮膚の下 3.5cm までの筋肉が、奥行きの比べで皮膚に勝って色が見える。頭・手・足・関節は皮膚のまま */
  skinPush: 0.035,
  /** 光（世界の座標。体が回っても光は動かない）。影の地図は使わない */
  hemi: { sky: '#FFFDF7', ground: '#B9AE98', intensity: 2.0 },
  key: { color: '#FFF6E8', intensity: 2.6, position: [-0.9, 4.5, 1.4] as [number, number, number] },
  fill: { color: '#E8EEF5', intensity: 0.9, position: [2.2, 1.2, 1.8] as [number, number, number] },
  /** 部位の量の 0〜5 段の色（0 は石膏。3 と 4 は前と後ろで明るさが近いので 4 を濃くした） */
  volume: ['#EAE3D4', '#CBDBEA', '#A8C5E2', '#86ACD6', '#3A76B4', '#1F63A0'] as readonly string[],
  /** 回復中：石膏と橙を t = min + (1 − min) × k で混ぜる（k は回復の明るさ。鍛えた日が 1） */
  recovering: '#B04A0C',
  recoveringMin: 0.2,
  /** 回復済み：石膏と緑を半分ずつ（回復中より静か） */
  recovered: '#1E6B47',
  recoveredMix: 0.5,
  /** ケガの部位の塗りと、関節のケガの印の点 */
  injury: '#C2302A',
  /** 関節のケガの印：半径 0.024 の点（奥行きを見ない）と、カメラに向けた紙の色の輪（半径の 1.25〜1.6 倍）。付け根から手前へ 0.06 */
  dot: { r: 0.024, z: 0.06, ring: [1.25, 1.6] as [number, number], ringColor: '#F5F2EA' },
  /** 足元の影：影の地図の代わりに、ぼかした丸を床に置く（0.5 × 0.25 m、右奥へずらす、濃さ 0.14） */
  shadow: { width: 0.5, depth: 0.25, offset: [0.12, -0.06] as [number, number], opacity: 0.14, color: '#1B1916' },
} as const;

const toLinear = (c: number) => (c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4));
const toSrgb = (c: number) => (c < 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 0.41666) - 0.055);
const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

/** 2 つの色を線形の色空間で混ぜる（three.js の new Color(a).lerp(new Color(b), t) と同じ）。#RRGGBB を返す */
export function mixLinear(a: string, b: string, t: number): string {
  const x = channels(a).map(toLinear), y = channels(b).map(toLinear);
  const k = Math.min(1, Math.max(0, t));
  return `#${x.map((v, i) => Math.round(Math.min(1, Math.max(0, toSrgb(v + (y[i] - v) * k))) * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/** 回復中の色（k は回復の明るさ 0〜1） */
export const matteRecovering = (k: number) => mixLinear(MATTE.plaster, MATTE.recovering, MATTE.recoveringMin + (1 - MATTE.recoveringMin) * Math.min(1, Math.max(0, k)));
/** 回復済みの色 */
export const MATTE_RECOVERED = mixLinear(MATTE.plaster, MATTE.recovered, MATTE.recoveredMix);
/** 部位の量の段（0〜5）の色 */
export const matteVolume = (level: number) => MATTE.volume[Math.min(MATTE.volume.length - 1, Math.max(0, Math.round(level)))];
