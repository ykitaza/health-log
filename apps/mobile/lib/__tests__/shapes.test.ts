import {
  attractorLayout, attractorPoints, MAX_POINTS, MIN_POINTS, pointTints, SEED_RAMP_DAYS, VOLUME_SCALE_KG,
} from '../shapes/attractor';
import { orbitPoint, ORBITS, outerOrbitRadius, SAT_RADIUS } from '../shapes/orbits';
import type { GrowthParams } from '../shapes/types';

const base: GrowthParams = { volumeKg: 0, foodDays: 0, sleepDays: 0, days: 30 };

describe('点の軌跡：点の並び', () => {
  test('同じ数なら毎回同じ並び（乱数を使わない）', () => {
    expect(attractorPoints(500)).toEqual(attractorPoints(500));
  });

  test('点を増やしても、先頭の並びは変わらない（先頭から N 個を出すだけで育つ）', () => {
    const small = attractorPoints(300);
    const large = attractorPoints(1000);
    // 大きさをそろえる割り算の分だけずれるので、向きと比で比べる
    const ratio = large[0] / small[0];
    for (let i = 0; i < small.length; i++) expect(large[i]).toBeCloseTo(small[i] * ratio, 5);
  });

  test('どの点も -1〜1 に収まり、数でない値がない', () => {
    const pts = attractorPoints(MAX_POINTS);
    expect(pts).toHaveLength(MAX_POINTS * 3);
    for (const v of pts) {
      expect(Number.isFinite(v)).toBe(true);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
    }
  });

  test('点は1か所に固まらず、広く散らばる', () => {
    const pts = attractorPoints(2000);
    const cells = new Set<string>();
    for (let i = 0; i < 2000; i++) cells.add(`${Math.floor(pts[i * 3] * 5)},${Math.floor(pts[i * 3 + 1] * 5)}`);
    expect(cells.size).toBeGreaterThan(20);
  });

  test('色：中心に近い点は紫寄り（0 に近い）、外側は緑（1）', () => {
    const pts = new Float32Array([0, 0, 0, 0.1, 0, 0, 0.9, 0, 0]);
    const t = pointTints(pts);
    expect(t[0]).toBe(0);
    expect(t[1]).toBe(0);
    expect(t[2]).toBe(1);
    // 全体では緑が主
    const all = pointTints(attractorPoints(MAX_POINTS));
    expect(all.filter((v) => v > 0.5).length).toBeGreaterThan(MAX_POINTS / 2);
  });
});

describe('点の軌跡：値から点の数・広がり・光', () => {
  test('記録がまだない（days が 0）ときは点を出さない（種だけ）', () => {
    expect(attractorLayout({ volumeKg: 50_000, foodDays: 10, sleepDays: 10, days: 0 }).count).toBe(0);
  });

  test('記録を始めてから数日で、最小の点の数に届く（最初でもまばらすぎない）', () => {
    expect(attractorLayout({ ...base, days: SEED_RAMP_DAYS }).count).toBe(MIN_POINTS);
    expect(attractorLayout({ ...base, days: 1 }).count).toBeCloseTo(MIN_POINTS / SEED_RAMP_DAYS);
  });

  test('点の数は筋トレの累計で増え、上限を超えない', () => {
    const a = attractorLayout({ ...base, volumeKg: 10_000 }).count;
    const b = attractorLayout({ ...base, volumeKg: VOLUME_SCALE_KG }).count;
    const c = attractorLayout({ ...base, volumeKg: 1e9 }).count;
    expect(a).toBeGreaterThan(MIN_POINTS);
    expect(b).toBeGreaterThan(a);
    expect(b).toBeCloseTo(MIN_POINTS + (MAX_POINTS - MIN_POINTS) * (1 - Math.exp(-1)));
    expect(c).toBeLessThanOrEqual(MAX_POINTS);
    expect(c).toBeGreaterThan(MAX_POINTS - 1);
  });

  test('広がりは食事、光は睡眠で増える。ほかの値には左右されない', () => {
    const l0 = attractorLayout(base);
    const food = attractorLayout({ ...base, foodDays: 60 });
    const sleep = attractorLayout({ ...base, sleepDays: 60 });
    expect(l0.spread).toBeCloseTo(0.55);
    expect(l0.glow).toBeCloseTo(0.35);
    expect(food.spread).toBeGreaterThan(l0.spread);
    expect(food.glow).toBe(l0.glow);
    expect(sleep.glow).toBeGreaterThan(l0.glow);
    expect(sleep.spread).toBe(l0.spread);
    const max = attractorLayout({ ...base, foodDays: 1e6, sleepDays: 1e6 });
    expect(max.spread).toBeCloseTo(1);
    expect(max.glow).toBeCloseTo(1);
  });

  test('値が少し変わっても形は飛ばない（増えても減っても、変化は小さい）', () => {
    for (let v = 0; v < 2_000_000; v += 5_000) {
      const a = attractorLayout({ ...base, volumeKg: v, foodDays: v / 10_000, sleepDays: v / 10_000 });
      const b = attractorLayout({ ...base, volumeKg: v + 5_000, foodDays: v / 10_000 + 1, sleepDays: v / 10_000 + 1 });
      expect(Math.abs(b.count - a.count)).toBeLessThan(200);
      expect(Math.abs(b.spread - a.spread)).toBeLessThan(0.01);
      expect(Math.abs(b.glow - a.glow)).toBeLessThan(0.015);
    }
  });

  test('負の値や数でない値は 0 として扱う', () => {
    const l = attractorLayout({ volumeKg: -100, foodDays: NaN, sleepDays: -1, days: NaN });
    expect(l).toEqual({ count: 0, spread: 0.55, glow: 0.35 });
  });
});

describe('今日の衛星の軌道', () => {
  test('内側から 筋トレ・食事・睡眠。傾き・縦の比・半径の比は決めたとおり', () => {
    expect(ORBITS.map((o) => o.key)).toEqual(['training', 'food', 'sleep']);
    expect(ORBITS.map((o) => o.mark)).toEqual(['dot', 'diamond', 'ring']);
    expect(ORBITS.map((o) => o.tilt)).toEqual([-0.6, -0.12, 0.38]);
    expect(ORBITS.map((o) => o.aspect)).toEqual([0.3, 0.34, 0.3]);
    expect(ORBITS.map((o) => o.radius)).toEqual([0.62, 0.82, 1.0]);
  });

  test.each([
    [360, 228, { x: 0, y: 0 }],
    [200, 228, { x: 0, y: 0 }],
    [360, 228, { x: 0, y: 40 }],
  ])('衛星は一周しても %i×%i の箱からはみ出さない', (w, h, center) => {
    const outer = outerOrbitRadius(w, h, center);
    expect(outer).toBeGreaterThan(0);
    for (const o of ORBITS) {
      for (let s = 0; s < o.period; s += o.period / 90) {
        const p = orbitPoint(o, outer, s);
        expect(Math.abs(center.x + p.x)).toBeLessThanOrEqual(w / 2 - SAT_RADIUS);
        expect(Math.abs(center.y + p.y)).toBeLessThanOrEqual(h / 2 - SAT_RADIUS);
      }
    }
  });

  test('衛星は軌道の上をゆっくり回り、1周で元の位置に戻る', () => {
    const o = ORBITS[0];
    const a = orbitPoint(o, 100, 0);
    const b = orbitPoint(o, 100, 1);
    const c = orbitPoint(o, 100, o.period);
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThan(30);
    expect(c.x).toBeCloseTo(a.x);
    expect(c.y).toBeCloseTo(a.y);
  });
});
