import { shapeBuild, SHAPES } from '@/components/growth/shapes';
import {
  attractorLayout, attractorPoints, MAX_POINTS, MIN_POINTS, pointTints, SEED_RAMP_DAYS, VOLUME_SCALE_KG,
} from '../shapes/attractor';
import { DOT_FULL_UNIT, DOT_MIN_SCALE, dotStyle, PERSPECTIVE, shapeExtent, shapeUnit, ShapeLayout } from '../shapes/common';
import { GALAXY_POINTS, galaxyLayout, galaxyPoints, galaxyTints } from '../shapes/galaxy';
import { orbitPoint, ORBITS, outerOrbitRadius, SAT_RADIUS } from '../shapes/orbits';
import { TREE_POINTS, treeLayout, treeShape } from '../shapes/tree';
import { SHAPE_KINDS } from '../shapes/types';
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

/** 点の並びの検査：数・-1〜1 に収まる・数でない値がない */
function expectUnitPoints(pts: Float32Array, n: number) {
  expect(pts).toHaveLength(n * 3);
  for (const v of pts) {
    expect(Number.isFinite(v)).toBe(true);
    expect(Math.abs(v)).toBeLessThanOrEqual(1);
  }
}

/** 値 → 点の数・広がり・光の、どの形にも共通の決まり（点の軌跡と同じ考え方） */
function describeLayout(name: string, layout: (p: GrowthParams) => ShapeLayout, max: number) {
  describe(`${name}：値から点の数・広がり・光`, () => {
    test('0 日目は点を出さない（種だけ）。数日で最小の点の数に届く', () => {
      expect(layout({ volumeKg: 50_000, foodDays: 10, sleepDays: 10, days: 0 }).count).toBe(0);
      expect(layout({ ...base, days: 1 }).count).toBeCloseTo(MIN_POINTS / SEED_RAMP_DAYS);
      expect(layout({ ...base, days: SEED_RAMP_DAYS }).count).toBe(MIN_POINTS);
    });

    test('筋トレが増えると点の数は減らず、上限を超えない', () => {
      let prev = 0;
      for (let v = 0; v <= 3_000_000; v += 10_000) {
        const c = layout({ ...base, volumeKg: v }).count;
        expect(c).toBeGreaterThanOrEqual(prev);
        expect(c).toBeLessThanOrEqual(max);
        prev = c;
      }
      expect(prev).toBeGreaterThan(max - 1);
    });

    test('広がりは食事、光は睡眠で増える（0.55〜1、0.35〜1）', () => {
      const l0 = layout(base);
      expect(l0.spread).toBeCloseTo(0.55);
      expect(l0.glow).toBeCloseTo(0.35);
      expect(layout({ ...base, foodDays: 60 }).spread).toBeGreaterThan(l0.spread);
      expect(layout({ ...base, sleepDays: 60 }).glow).toBeGreaterThan(l0.glow);
      const top = layout({ ...base, foodDays: 1e6, sleepDays: 1e6 });
      expect(top.spread).toBeCloseTo(1);
      expect(top.glow).toBeCloseTo(1);
    });

    test('値が少し変わっても形は飛ばない（増えても減っても、変化は小さい）', () => {
      for (let v = 0; v < 2_000_000; v += 5_000) {
        const a = layout({ ...base, volumeKg: v, foodDays: v / 10_000, sleepDays: v / 10_000 });
        const b = layout({ ...base, volumeKg: v + 5_000, foodDays: v / 10_000 + 1, sleepDays: v / 10_000 + 1 });
        expect(Math.abs(b.count - a.count)).toBeLessThan(200);
        expect(Math.abs(b.spread - a.spread)).toBeLessThan(0.01);
        expect(Math.abs(b.glow - a.glow)).toBeLessThan(0.015);
        (b.fills ?? []).forEach((f, i) => expect(Math.abs(f - (a.fills ?? [])[i])).toBeLessThan(0.015));
      }
    });

    test('負の値や数でない値は 0 として扱う', () => {
      const l = layout({ volumeKg: -100, foodDays: NaN, sleepDays: -1, days: NaN });
      expect(l.count).toBe(0);
      expect(l.spread).toBeCloseTo(0.55);
      expect(l.glow).toBeCloseTo(0.35);
    });
  });
}

/** 並びの中心から横（x, z）の距離 */
const radial = (pts: Float32Array, i: number) => Math.hypot(pts[i * 3], pts[i * 3 + 2]);

describe('銀河：点の並び', () => {
  const pts = galaxyPoints();

  test('毎回同じ並び（種を固定した乱数）で、どの点も -1〜1 に収まる', () => {
    expect(galaxyPoints()).toEqual(pts);
    expectUnitPoints(pts, GALAXY_POINTS);
  });

  test('並びは中心寄りから始まる（点を増やすと、核から腕が外へ伸びる）', () => {
    const mean = (from: number, to: number) => {
      let s = 0;
      for (let i = from; i < to; i++) s += radial(pts, i);
      return s / (to - from);
    };
    for (let i = 0; i < 200; i++) expect(radial(pts, i)).toBeLessThan(0.2);
    expect(mean(0, 1000)).toBeLessThan(mean(2000, 3000));
    expect(mean(2000, 3000)).toBeLessThan(mean(5000, 6000));
  });

  test('薄い円盤：厚みは広がりよりずっと小さい', () => {
    let maxY = 0;
    let maxR = 0;
    for (let i = 0; i < GALAXY_POINTS; i++) {
      maxY = Math.max(maxY, Math.abs(pts[i * 3 + 1]));
      maxR = Math.max(maxR, radial(pts, i));
    }
    expect(maxY).toBeLessThan(maxR * 0.25);
  });

  test('色：中心は紫（0）、腕と外側は緑（1）', () => {
    const t = galaxyTints(pts);
    expect(t[0]).toBe(0);
    expect(t[GALAXY_POINTS - 1]).toBe(1);
  });
});

describeLayout('銀河', galaxyLayout, GALAXY_POINTS);

describe('木：点の並び', () => {
  const tree = treeShape();
  const { points: pts, gates, tints, seedY } = tree;

  test('毎回同じ並び（種を固定した乱数）で、どの点も -1〜1 に収まる', () => {
    expect(treeShape()).toEqual(tree);
    expectUnitPoints(pts, TREE_POINTS);
    expect(tints).toHaveLength(TREE_POINTS);
    expect(gates).toHaveLength(TREE_POINTS);
  });

  test('並びは幹（根元のまん中、下）から始まり、葉と光の粒は枝のあと', () => {
    expect(seedY).toBeGreaterThan(0.5);
    for (let i = 0; i < 100; i++) {
      expect(radial(pts, i)).toBeLessThan(0.15);
      expect(pts[i * 3 + 1]).toBeGreaterThan(0.3);
    }
    // 根元からの道のりの順なので、先頭の点ほど下（y が大きい）にある
    const meanY = (from: number, to: number) => {
      let s = 0;
      for (let i = from; i < to; i++) s += pts[i * 3 + 1];
      return s / (to - from);
    };
    expect(meanY(0, 300)).toBeGreaterThan(meanY(300, 1200));
    expect(meanY(300, 1200)).toBeGreaterThan(meanY(TREE_POINTS - 1500, TREE_POINTS));
    const firstLeaf = gates.findIndex((g) => g >= 0);
    expect(firstLeaf).toBeGreaterThan(TREE_POINTS * 0.2);
    // 枝先の葉は、その枝先まで伸びてから出る（葉の順位の平均は、枝の順位の平均よりあと）
    const meanIndex = (pick: (g: number) => boolean) => {
      let s = 0;
      let n = 0;
      gates.forEach((g, i) => {
        if (pick(g)) {
          s += i;
          n++;
        }
      });
      return s / n;
    };
    expect(meanIndex((g) => g >= 0)).toBeGreaterThan(meanIndex((g) => g < 0) * 1.5);
  });

  test('組：葉は 0〜1、光の粒は 1〜2、枝と根は -1。光の粒は紫（色の位置 0）', () => {
    let leaves = 0;
    let sparks = 0;
    gates.forEach((g, i) => {
      if (g >= 1) {
        sparks++;
        expect(g).toBeLessThan(2);
        expect(tints[i]).toBe(0);
      } else if (g >= 0) {
        leaves++;
        expect(tints[i]).toBeGreaterThan(0.6);
      } else {
        expect(g).toBe(-1);
      }
    });
    expect(leaves).toBeGreaterThan(1000);
    expect(sparks).toBeGreaterThan(200);
  });

  test('幹が Y 軸の上に立つ（回すと幹を軸に回る）。樹冠は四方に広がる', () => {
    let minX = 0;
    let maxX = 0;
    let minZ = 0;
    let maxZ = 0;
    for (let i = 0; i < TREE_POINTS; i++) {
      minX = Math.min(minX, pts[i * 3]);
      maxX = Math.max(maxX, pts[i * 3]);
      minZ = Math.min(minZ, pts[i * 3 + 2]);
      maxZ = Math.max(maxZ, pts[i * 3 + 2]);
    }
    for (const v of [-minX, maxX, -minZ, maxZ]) expect(v).toBeGreaterThan(0.4);
  });
});

describeLayout('木', treeLayout, TREE_POINTS);

describe('木：葉は食事、光の粒は睡眠で増える', () => {
  test('記録がなくても少しは出て、増えると 1 に近づく。ほかの値には左右されない', () => {
    const l0 = treeLayout(base);
    const [leaf0, spark0] = l0.fills ?? [];
    expect(leaf0).toBeGreaterThan(0);
    expect(spark0).toBeGreaterThan(0);
    const food = treeLayout({ ...base, foodDays: 60 }).fills ?? [];
    const sleep = treeLayout({ ...base, sleepDays: 60 }).fills ?? [];
    expect(food[0]).toBeGreaterThan(leaf0);
    expect(food[1]).toBe(spark0);
    expect(sleep[1]).toBeGreaterThan(spark0);
    expect(sleep[0]).toBe(leaf0);
    const top = treeLayout({ ...base, foodDays: 1e6, sleepDays: 1e6 }).fills ?? [];
    expect(top[0]).toBeCloseTo(1);
    expect(top[1]).toBeCloseTo(1);
  });
});

describe('形を箱に収める', () => {
  // 描くときと同じ回し方・倒し方・奥行き（components/growth/GrowthShape.tsx）で、1周を細かく回して確かめる
  const project = (pts: Float32Array, tilt: number, a: number, unit: number) => {
    let x = 0;
    let y = 0;
    const tc = Math.cos(tilt);
    const ts = Math.sin(tilt);
    for (let i = 0; i < pts.length; i += 3) {
      const x1 = pts[i] * Math.cos(a) + pts[i + 2] * Math.sin(a);
      const z1 = pts[i + 2] * Math.cos(a) - pts[i] * Math.sin(a);
      const p = 1 / (1 - (pts[i + 1] * ts + z1 * tc) * PERSPECTIVE);
      x = Math.max(x, Math.abs(x1 * unit * p));
      y = Math.max(y, Math.abs((pts[i + 1] * tc - z1 * ts) * unit * p));
    }
    return { x, y };
  };

  test.each(SHAPE_KINDS.flatMap((k) => [
    [k, 380, 140, true], [k, 380, 172, true], [k, 320, 140, true], [k, 412, 440, false], [k, 360, 440, false],
  ] as const))('%s は %i×%i（衛星 %s）の箱から、どう回してもはみ出さない', (kind, w, h, sats) => {
    const def = SHAPES[kind];
    const { points } = def.build();
    const unit = shapeUnit(w, h, shapeExtent(points, def.tilt, PERSPECTIVE), sats, 2.5);
    expect(unit).toBeGreaterThan(Math.min(w, h) * 0.3);
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 90) {
      const e = project(points, def.tilt, a, unit);
      expect(e.x).toBeLessThanOrEqual(w / 2 - 2.5 + 0.01);
      expect(e.y).toBeLessThanOrEqual(h / 2 - 2.5 + 0.01);
    }
  });

  test('木の軌道の中心は幹（形のまん中より下）、ほかは形のまん中', () => {
    expect(SHAPES.tree.orbitOffsetY).toBeGreaterThan(0);
    expect(SHAPES.attractor.orbitOffsetY).toBe(0);
    expect(SHAPES.galaxy.orbitOffsetY).toBe(0);
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
    // 木（軌道の中心を幹へ下げる）をホームの段の箱で
    [380, 140, { x: 0, y: 140 * SHAPES.tree.orbitOffsetY }],
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

describe('点の大きさと濃さ（形の大きさに合わせる）', () => {
  test('大きな形（成長を見る）はそのまま。小さい形ほど小さく・少し薄く。下限で止まる', () => {
    expect(dotStyle(DOT_FULL_UNIT)).toEqual({ size: 1, alpha: 1 });
    expect(dotStyle(400)).toEqual({ size: 1, alpha: 1 });
    const home = dotStyle(80);
    expect(home.size).toBeCloseTo(80 / DOT_FULL_UNIT);
    expect(home.alpha).toBeLessThan(1);
    expect(home.alpha).toBeGreaterThan(home.size);
    // 形を選ぶシートの小さな絵は、下限
    expect(dotStyle(20).size).toBe(DOT_MIN_SCALE);
    expect(dotStyle(0).size).toBe(DOT_MIN_SCALE);
  });
});

describe('形ごとに置いた「届く範囲」（extent）', () => {
  test('shapeExtent の計算と合う（切り上げた値で、0.0002 以内）。点の並びか tilt を変えたら、ここに出る値に置き換える', () => {
    for (const kind of ['attractor', 'tree', 'galaxy'] as const) {
      const def = SHAPES[kind];
      const e = shapeExtent(def.build().points, def.tilt, PERSPECTIVE);
      // 置いた値は計算より小さくない（形が箱からはみ出さない）、かつ大きすぎない
      expect(def.extent.x).toBeGreaterThanOrEqual(e.x);
      expect(def.extent.y).toBeGreaterThanOrEqual(e.y);
      expect(def.extent.x - e.x).toBeLessThan(0.0002);
      expect(def.extent.y - e.y).toBeLessThan(0.0002);
    }
  });
  test('点の並びは形ごとに1回だけ作る', () => {
    expect(shapeBuild('tree')).toBe(shapeBuild('tree'));
  });
});
