// 形「銀河」：6本の腕（対数らせん）の渦巻き銀河。まん中に明るいふくらみ（核）、まわりに薄い円盤。
// 6本の腕は部位（lib/partBalance.ts の BALANCE_PARTS。ホームの「部位のバランス」のレーダーと同じ並びで、画面の上で時計回り）で、
// その部位の累計セット数が多い腕ほど先まで伸び（腕の先の半径 0.42〜1）、星が集まる（0.45〜1 倍）。細かい差より、大きな偏りが見える程度。
// 円盤は XZ 面（y が厚み）に置くので、Y 軸まわりに回すと円盤がその面の中で回る。
// 点の並びは中心から外への順（少し混ぜる）。「先頭から N 個を出す」だけで、核から腕が外へ伸びていく。
// 腕と円盤の星には部位（parts）と、出る最小の育ち具合（partMin）を付ける。
// 乱数は種を固定する（同じ値なら毎回同じ形）。galaxyLayout は UI スレッドで毎フレーム呼ぶので worklet
import { BALANCE_PARTS } from '../partBalance';
import { FOOD_SCALE_DAYS, MIN_POINTS, SEED_RAMP_DAYS, SLEEP_SCALE_DAYS, VOLUME_SCALE_KG } from './attractor';
import { gaussian, grow, partGrowth, seededRandom, seedRamp, ShapeLayout, smoothstep } from './common';
import type { GrowthParams } from './types';

/** 点の数の上限。ふくらみ・腕・円盤の内訳 */
export const GALAXY_POINTS = 6000;
const BULGE_POINTS = 800;
const DISC_POINTS = 1200;
const ARM_POINTS = GALAXY_POINTS - BULGE_POINTS - DISC_POINTS;

/** 腕の数（部位の数） */
const ARMS = BALANCE_PARTS.length;
/** 円盤の星が比べる育ち具合の番号（layout の parts の最後。いちばん育った腕。円盤はその腕の先まで広がる） */
const DISC_PART = ARMS;
/** 腕の巻き方（対数らせん r = ARM_START・e^(PITCH・θ)）。PITCH が小さいほどきつく巻く（6本なので、2本のときより緩める） */
export const PITCH = 0.7;
export const ARM_START = 0.1;
/** 腕の先の半径（育っていない腕 → 育った腕は 1）と、星の数の倍率（育っていない腕 → 育った腕は 1） */
const MIN_REACH = 0.42;
const MIN_DENSITY = 0.45;
/** 腕の太さ（中心からの距離に対する割合）と、円盤の厚み */
const ARM_WIDTH = 0.05;
const THICKNESS = 0.025;
/** ふくらみの半径と、円盤の広がり（指数分布の長さ） */
const BULGE_RADIUS = 0.09;
const DISC_SCALE = 0.32;
/** 並びの順を「中心からの距離」から少しだけ混ぜる幅（輪が1本ずつ現れて見えないように） */
const ORDER_JITTER = 0.06;
const SEED = 20261111;

export type GalaxyShape = {
  /** 点の並び（x, y, z の順に3つずつ、-1〜1）。中心に近い順（少し混ぜる） */
  points: Float32Array;
  /** 点ごとの部位（腕は BALANCE_PARTS の番号、円盤は DISC_PART、ふくらみは -1） */
  parts: Float32Array;
  /** 点ごとの、出る最小の育ち具合（0〜1） */
  partMin: Float32Array;
};

/** 半径 r の星が出る最小の育ち具合（腕の先の半径 MIN_REACH + (1 − MIN_REACH)・g が r に届いたら） */
function reachMin(r: number): number {
  return Math.min(1, Math.max(0, (r - MIN_REACH) / (1 - MIN_REACH)));
}

/**
 * 点の並び・部位。中心に近い順（少し混ぜる）なので、先頭からどこで切っても核と、そこから伸びた腕の内側が出る
 */
export function galaxyShape(): GalaxyShape {
  const rand = seededRandom(SEED);
  const items: { key: number; x: number; y: number; z: number; part: number; min: number }[] = [];
  const push = (x: number, y: number, z: number, part: number, min: number) => {
    items.push({ key: Math.hypot(x, z) + rand() * ORDER_JITTER, x, y, z, part, min });
  };
  // ふくらみ：少しつぶれた丸い玉
  for (let i = 0; i < BULGE_POINTS; i++) {
    const r = BULGE_RADIUS * Math.abs(gaussian(rand));
    const a = rand() * Math.PI * 2;
    const u = rand() * 2 - 1;
    const h = Math.sqrt(1 - u * u);
    push(r * h * Math.cos(a), r * u * 0.6, r * h * Math.sin(a), -1, 0);
  }
  // 腕：6本の対数らせん。外ほど太く、まばらに。腕 i は、画面の上で時計回りに 60° ずつ（XZ 面の角度は画面の上では向きが逆になる）
  for (let i = 0; i < ARM_POINTS; i++) {
    const arm = i % ARMS;
    // 中心からの距離（少し内寄り）。腕の先の半径が届いたら出る
    const r = ARM_START + (1 - ARM_START) * Math.pow(rand(), 1.15);
    const theta = Math.log(r / ARM_START) / PITCH;
    const a = theta - (arm * Math.PI * 2) / ARMS;
    const w = ARM_WIDTH * r;
    const dx = gaussian(rand) * w;
    const dz = gaussian(rand) * w;
    // 星の数の倍率：順位がこの倍率を超えない星だけ出す
    const rank = (rand() - MIN_DENSITY) / (1 - MIN_DENSITY);
    push(r * Math.cos(a) + dx, gaussian(rand) * THICKNESS, r * Math.sin(a) + dz, arm, Math.max(reachMin(r), Math.min(1, rank)));
  }
  // 円盤：腕のあいだの薄い星。いちばん伸びた腕の先まで
  for (let i = 0; i < DISC_POINTS; i++) {
    const r = Math.min(1, -DISC_SCALE * Math.log(1 - rand() * 0.95));
    const a = rand() * Math.PI * 2;
    push(r * Math.cos(a), gaussian(rand) * THICKNESS * 0.7, r * Math.sin(a), DISC_PART, reachMin(r / 0.95));
  }
  items.sort((p, q) => p.key - q.key);
  let max = 0;
  for (const p of items) max = Math.max(max, Math.hypot(p.x, p.y, p.z));
  const n = items.length;
  const points = new Float32Array(n * 3);
  const parts = new Float32Array(n);
  const partMin = new Float32Array(n);
  items.forEach((p, i) => {
    points[i * 3] = p.x / max;
    points[i * 3 + 1] = p.y / max;
    points[i * 3 + 2] = p.z / max;
    parts[i] = p.part;
    partMin[i] = p.min;
  });
  return { points, parts, partMin };
}

/** 点の並びだけ（x, y, z の順に3つずつ、-1〜1） */
export function galaxyPoints(): Float32Array {
  return galaxyShape().points;
}

/** 点ごとの色の混ぜ具合。0＝紫（中心に近い）、1＝緑（腕と外側） */
export function galaxyTints(points: Float32Array): Float32Array {
  const n = points.length / 3;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = smoothstep(0.08, 0.4, Math.hypot(points[i * 3], points[i * 3 + 2]));
  return out;
}

/**
 * 記録の値から、点の数（筋トレ：腕が外へ伸びて濃くなる）・広がり（食事）・光の強さ（睡眠）と、
 * 腕ごとの育ち具合（部位の累計セット数。最後は円盤の分で、いちばん育った腕）を決める。
 * 点の軌跡と同じく、days が 0 なら点は出さず（種だけ）、SEED_RAMP_DAYS 日かけて最小の点の数に届く
 */
export function galaxyLayout(p: GrowthParams): ShapeLayout {
  'worklet';
  const spread = 0.55 + 0.45 * grow(p.foodDays, FOOD_SCALE_DAYS);
  const glow = 0.35 + 0.65 * grow(p.sleepDays, SLEEP_SCALE_DAYS);
  const count = (MIN_POINTS + (GALAXY_POINTS - MIN_POINTS) * grow(p.volumeKg, VOLUME_SCALE_KG)) * seedRamp(p.days, SEED_RAMP_DAYS);
  const parts: number[] = [];
  let most = 0;
  for (let i = 0; i < ARMS; i++) {
    const g = partGrowth(p.partSets?.[i] ?? 0);
    parts.push(g);
    most = Math.max(most, g);
  }
  parts.push(most);
  return { count, spread, glow, parts };
}
