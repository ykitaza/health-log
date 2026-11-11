// 形「銀河」：2本の腕（対数らせん）の渦巻き銀河。まん中に明るいふくらみ（核）、まわりに薄い円盤。
// 円盤は XZ 面（y が厚み）に置くので、Y 軸まわりに回すと円盤がその面の中で回る。
// 点の並びは中心から外への順（少し混ぜる）。「先頭から N 個を出す」だけで、核から腕が外へ伸びていく。
// 乱数は種を固定する（同じ値なら毎回同じ形）。galaxyLayout は UI スレッドで毎フレーム呼ぶので worklet
import { FOOD_SCALE_DAYS, MIN_POINTS, SEED_RAMP_DAYS, SLEEP_SCALE_DAYS, VOLUME_SCALE_KG } from './attractor';
import { gaussian, grow, seededRandom, seedRamp, ShapeLayout, smoothstep } from './common';
import type { GrowthParams } from './types';

/** 点の数の上限。ふくらみ・腕・円盤の内訳 */
export const GALAXY_POINTS = 6000;
const BULGE_POINTS = 800;
const DISC_POINTS = 1200;
const ARM_POINTS = GALAXY_POINTS - BULGE_POINTS - DISC_POINTS;

/** 腕の巻き方（対数らせん r = ARM_START・e^(PITCH・θ)）。PITCH が小さいほどきつく巻く */
const PITCH = 0.36;
const ARM_START = 0.1;
/** 腕の太さ（中心からの距離に対する割合）と、円盤の厚み */
const ARM_WIDTH = 0.07;
const THICKNESS = 0.025;
/** ふくらみの半径と、円盤の広がり（指数分布の長さ） */
const BULGE_RADIUS = 0.09;
const DISC_SCALE = 0.32;
/** 並びの順を「中心からの距離」から少しだけ混ぜる幅（輪が1本ずつ現れて見えないように） */
const ORDER_JITTER = 0.06;
const SEED = 20261111;

/**
 * 点の並び（x, y, z の順に3つずつ、-1〜1）。中心に近い順（少し混ぜる）なので、先頭からどこで切っても
 * 核と、そこから伸びた腕の内側が出る
 */
export function galaxyPoints(): Float32Array {
  const rand = seededRandom(SEED);
  const items: { key: number; x: number; y: number; z: number }[] = [];
  const push = (x: number, y: number, z: number) => {
    items.push({ key: Math.hypot(x, z) + rand() * ORDER_JITTER, x, y, z });
  };
  // ふくらみ：少しつぶれた丸い玉
  for (let i = 0; i < BULGE_POINTS; i++) {
    const r = BULGE_RADIUS * Math.abs(gaussian(rand));
    const a = rand() * Math.PI * 2;
    const u = rand() * 2 - 1;
    const h = Math.sqrt(1 - u * u);
    push(r * h * Math.cos(a), r * u * 0.6, r * h * Math.sin(a));
  }
  // 腕：2本の対数らせん。外ほど太く、まばらに
  for (let i = 0; i < ARM_POINTS; i++) {
    const arm = i % 2;
    // 中心からの距離を一様に選ぶ（点を増やすと、腕の先が一定の速さで外へ伸びる）
    const r = ARM_START + (1 - ARM_START) * rand();
    const theta = Math.log(r / ARM_START) / PITCH;
    const a = theta + arm * Math.PI;
    const w = ARM_WIDTH * r;
    const dx = gaussian(rand) * w;
    const dz = gaussian(rand) * w;
    push(r * Math.cos(a) + dx, gaussian(rand) * THICKNESS, r * Math.sin(a) + dz);
  }
  // 円盤：腕のあいだの薄い星
  for (let i = 0; i < DISC_POINTS; i++) {
    const r = Math.min(1, -DISC_SCALE * Math.log(1 - rand() * 0.95));
    const a = rand() * Math.PI * 2;
    push(r * Math.cos(a), gaussian(rand) * THICKNESS * 0.7, r * Math.sin(a));
  }
  items.sort((p, q) => p.key - q.key);
  let max = 0;
  for (const p of items) max = Math.max(max, Math.hypot(p.x, p.y, p.z));
  const out = new Float32Array(items.length * 3);
  items.forEach((p, i) => {
    out[i * 3] = p.x / max;
    out[i * 3 + 1] = p.y / max;
    out[i * 3 + 2] = p.z / max;
  });
  return out;
}

/** 点ごとの色の混ぜ具合。0＝紫（中心に近い）、1＝緑（腕と外側） */
export function galaxyTints(points: Float32Array): Float32Array {
  const n = points.length / 3;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = smoothstep(0.08, 0.4, Math.hypot(points[i * 3], points[i * 3 + 2]));
  return out;
}

/**
 * 記録の値から、点の数（筋トレ：腕が外へ伸びて濃くなる）・広がり（食事）・光の強さ（睡眠）を決める。
 * 点の軌跡と同じく、days が 0 なら点は出さず（種だけ）、SEED_RAMP_DAYS 日かけて最小の点の数に届く
 */
export function galaxyLayout(p: GrowthParams): ShapeLayout {
  'worklet';
  const spread = 0.55 + 0.45 * grow(p.foodDays, FOOD_SCALE_DAYS);
  const glow = 0.35 + 0.65 * grow(p.sleepDays, SLEEP_SCALE_DAYS);
  const count = (MIN_POINTS + (GALAXY_POINTS - MIN_POINTS) * grow(p.volumeKg, VOLUME_SCALE_KG)) * seedRamp(p.days, SEED_RAMP_DAYS);
  return { count, spread, glow };
}
