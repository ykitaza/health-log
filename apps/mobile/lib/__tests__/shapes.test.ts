import { ShapeBuild, shapeBuild, SHAPES } from '@/components/growth/shapes';
import {
  attractorLayout, attractorPoints, MAX_POINTS, MIN_POINTS, pointTints, SEED_RAMP_DAYS, VOLUME_SCALE_KG,
} from '../shapes/attractor';
import {
  DOT_FULL_UNIT, DOT_MIN_SCALE, dotStyle, PART_SCALE_SETS, partGrowth, PERSPECTIVE, placePoint, pointShown, shapeExtent, ShapeLayout, shapeUnit,
  swayExtent, swayX,
} from '../shapes/common';
import { GALAXY_POINTS, galaxyLayout, galaxyPoints, galaxyTints } from '../shapes/galaxy';
import { orbitPoint, ORBITS, outerOrbitRadius, SAT_RADIUS } from '../shapes/orbits';
import { BALANCE_PARTS } from '../partBalance';
import { MIN_BRANCH_SCALE, partTip, TIP_STRIDE, TREE_POINTS, treeBranchSlot, treeLayout, treeShape } from '../shapes/tree';
import { SHAPE_KINDS } from '../shapes/types';
import type { GrowthParams } from '../shapes/types';

const base: GrowthParams = { volumeKg: 0, foodDays: 0, sleepDays: 0, days: 30, partSets: [0, 0, 0, 0, 0, 0] };

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
    expect(attractorLayout({ volumeKg: 50_000, foodDays: 10, sleepDays: 10, days: 0, partSets: [0, 0, 0, 0, 0, 0] }).count).toBe(0);
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
    const l = attractorLayout({ volumeKg: -100, foodDays: NaN, sleepDays: -1, days: NaN, partSets: [-5, NaN, 0, 0, 0, 0] });
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
      expect(layout({ volumeKg: 50_000, foodDays: 10, sleepDays: 10, days: 0, partSets: [0, 0, 0, 0, 0, 0] }).count).toBe(0);
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
      // 部位の育ち具合も、1 セットでは飛ばない
      for (let n = 0; n < 1000; n += 10) {
        const a = layout({ ...base, partSets: [n, n, n, n, n, n] });
        const b = layout({ ...base, partSets: [n + 1, n + 1, n + 1, n + 1, n + 1, n + 1] });
        (b.parts ?? []).forEach((g, i) => expect(Math.abs(g - (a.parts ?? [])[i])).toBeLessThan(0.01));
      }
    });

    test('負の値や数でない値は 0 として扱う', () => {
      const l = layout({ volumeKg: -100, foodDays: NaN, sleepDays: -1, days: NaN, partSets: [-5, NaN, 0, 0, 0, 0] });
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
  const { points: pts, gates, tints, seedY, parts, partMin, pivots, tips } = tree;

  test('毎回同じ並び（種を固定した乱数）で、どの点も -1〜1 に収まる', () => {
    expect(treeShape()).toEqual(tree);
    expectUnitPoints(pts, TREE_POINTS);
    for (const a of [tints, gates, parts, partMin]) expect(a).toHaveLength(TREE_POINTS);
    expect(pivots).toHaveLength(BALANCE_PARTS.length * 3);
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
    expect(firstLeaf).toBeGreaterThan(TREE_POINTS * 0.1);
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
    expect(meanIndex((g) => g >= 0)).toBeGreaterThan(meanIndex((g) => g < 0) * 1.3);
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

  test('太い枝は6本で、部位はレーダーと同じ並び：左の上から 胸・腹・脚、右の上から 肩・背中・腕', () => {
    // 部位ごとの点の重心と、付け根の高さ
    const center = BALANCE_PARTS.map((_, p) => {
      let x = 0;
      let n = 0;
      for (let i = 0; i < TREE_POINTS; i++) {
        if (parts[i] !== p) continue;
        x += pts[i * 3];
        n++;
      }
      expect(n).toBeGreaterThan(300);
      return { x: x / n, rootY: pivots[p * 3 + 1] };
    });
    const at = (name: (typeof BALANCE_PARTS)[number]) => center[BALANCE_PARTS.indexOf(name)];
    for (const name of ['胸', '腹', '脚'] as const) expect(at(name).x).toBeLessThan(-0.1);
    for (const name of ['肩', '背中', '腕'] as const) expect(at(name).x).toBeGreaterThan(0.1);
    // 付け根は上の段ほど高い（y は下が正）
    expect(at('胸').rootY).toBeLessThan(at('腹').rootY);
    expect(at('腹').rootY).toBeLessThan(at('脚').rootY);
    expect(at('肩').rootY).toBeLessThan(at('背中').rootY);
    expect(at('背中').rootY).toBeLessThan(at('腕').rootY);
    expect(BALANCE_PARTS.map((_, i) => treeBranchSlot(i))).toEqual([
      { tier: 0, side: -1 }, { tier: 0, side: 1 }, { tier: 1, side: 1 }, { tier: 2, side: 1 }, { tier: 2, side: -1 }, { tier: 1, side: -1 },
    ]);
    // 幹と根は部位なし。名前を置く枝の先の候補は、どれも部位がある
    expect(parts.filter((p) => p < 0).length).toBeGreaterThan(100);
    for (let k = 0; k < tips.length; k += TIP_STRIDE) expect(tips[k]).toBeGreaterThanOrEqual(0);
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

describe('部位の育ち具合（累計セット数）', () => {
  test('0 セットで 0、PART_SCALE_SETS で約 0.63、増えるほど 1 に近づく。負の値や数でない値は 0', () => {
    expect(partGrowth(0)).toBe(0);
    expect(partGrowth(PART_SCALE_SETS)).toBeCloseTo(1 - Math.exp(-1));
    expect(partGrowth(1e6)).toBeCloseTo(1);
    expect(partGrowth(-5)).toBe(0);
    expect(partGrowth(NaN)).toBe(0);
    let prev = 0;
    for (let n = 0; n <= 600; n += 5) {
      expect(partGrowth(n)).toBeGreaterThanOrEqual(prev);
      prev = partGrowth(n);
    }
  });
});

/** その部位の、いま出ている点の番号（count は上限まで） */
function shownOfPart(b: ShapeBuild, l: ShapeLayout, p: number, pick: (i: number) => boolean = () => true): number[] {
  const out: number[] = [];
  const n = b.points.length / 3;
  for (let i = 0; i < n; i++) {
    if (b.parts![i] !== p || !pick(i)) continue;
    if (pointShown(i, 1e9, b.gates ?? new Float32Array(0), l.fills ?? [], b.parts!, b.partMin!, l.parts ?? []) > 0) out.push(i);
  }
  return out;
}

describe('木：部位ごとに枝が育つ', () => {
  const b = shapeBuild('tree');
  const full = { ...base, volumeKg: 1e9, foodDays: 1e6, sleepDays: 1e6 };
  const withSets = (sets: number[]) => treeLayout({ ...full, partSets: sets });
  const isLeaf = (i: number) => (b.gates?.[i] ?? -1) >= 0;
  /** 部位 p の、出ている枝（葉を除く）の付け根からいちばん遠い所（長さの倍率をかけたあと） */
  const reach = (l: ShapeLayout, p: number) => {
    const s = l.partScale![p];
    let far = 0;
    for (const i of shownOfPart(b, l, p, (i) => !isLeaf(i))) {
      far = Math.max(far, Math.hypot(b.points[i * 3] - b.pivots![p * 3], b.points[i * 3 + 1] - b.pivots![p * 3 + 1]) * s);
    }
    return far;
  };
  const leaves = (l: ShapeLayout, p: number) => shownOfPart(b, l, p, isLeaf).length;

  test('長さの倍率：0 セットで 0.5（最低限の長さ）、増えると 1 に近づく。部位ごとに別々', () => {
    const l = withSets([0, 110, 1e6, 0, 0, 0]);
    expect(l.partScale![0]).toBeCloseTo(MIN_BRANCH_SCALE);
    expect(l.partScale![1]).toBeCloseTo(MIN_BRANCH_SCALE + (1 - MIN_BRANCH_SCALE) * (1 - Math.exp(-1)));
    expect(l.partScale![2]).toBeCloseTo(1);
    expect(l.parts).toEqual([0, partGrowth(110), partGrowth(1e6), 0, 0, 0]);
    // 数でない値・負の値は、最低限
    const bad = treeLayout({ ...full, partSets: [NaN, -3, 0, 0, 0, 0] });
    expect(bad.partScale!.slice(0, 2)).toEqual([MIN_BRANCH_SCALE, MIN_BRANCH_SCALE]);
  });

  test('0 セットの枝も、はだかにならず最低限は出る（段数 3 までの枝と、その先の葉）', () => {
    const l = withSets([0, 0, 0, 0, 0, 0]);
    for (let p = 0; p < BALANCE_PARTS.length; p++) {
      expect(reach(l, p)).toBeGreaterThan(0.1);
      expect(leaves(l, p)).toBeGreaterThan(20);
    }
  });

  test('セット数が多い部位ほど、枝が長く・よく分かれて・葉が多い。ほかの部位には左右されない', () => {
    const others = reach(withSets([0, 0, 0, 0, 0, 0]), 1);
    let prev = { reach: 0, leaves: 0, branches: 0 };
    for (const n of [0, 25, 60, 110, 180, 400]) {
      const l = withSets([n, 0, 0, 0, 0, 0]);
      const now = { reach: reach(l, 0), leaves: leaves(l, 0), branches: shownOfPart(b, l, 0, (i) => !isLeaf(i)).length };
      expect(now.reach).toBeGreaterThan(prev.reach);
      // 葉は分かれた枝の先まで伸びてから出るので、段ごとに増える（減らない）
      expect(now.leaves).toBeGreaterThanOrEqual(prev.leaves);
      expect(now.branches).toBeGreaterThan(prev.branches);
      prev = now;
      expect(reach(l, 1)).toBeCloseTo(others);
    }
    // いちばん育った枝は、最低限の枝の2倍を超えて伸び、葉は3倍を超える（大きな偏りが見える）
    expect(reach(withSets([1e6, 0, 0, 0, 0, 0]), 0)).toBeGreaterThan(reach(withSets([0, 0, 0, 0, 0, 0]), 0) * 2);
    expect(leaves(withSets([1e6, 0, 0, 0, 0, 0]), 0)).toBeGreaterThan(leaves(withSets([0, 0, 0, 0, 0, 0]), 0) * 3);
  });

  test('値が少し変わっても、枝は飛ばない（1 セットで出る点の変化は小さい）', () => {
    for (let n = 0; n < 400; n += 7) {
      const a = shownOfPart(b, withSets([n, 0, 0, 0, 0, 0]), 0).length;
      const c = shownOfPart(b, withSets([n + 1, 0, 0, 0, 0, 0]), 0).length;
      expect(Math.abs(c - a)).toBeLessThan(40);
    }
  });

  test('部位の名前の位置：まだ点が出ていなければ null。育つほど付け根から遠く、出ている枝の先の近く', () => {
    const tips = b.tips!;
    const pivots = b.pivots!;
    expect(partTip(tips, pivots, 0, 0, 0, MIN_BRANCH_SCALE)).toBeNull();
    let prev = 0;
    for (const n of [0, 60, 180, 400]) {
      const l = withSets([n, 0, 0, 0, 0, 0]);
      const t = partTip(tips, pivots, 0, 1e9, l.parts![0], l.partScale![0])!;
      const d = Math.hypot(t.x - pivots[0], t.y - pivots[1]);
      expect(d).toBeGreaterThan(prev);
      // 出ている枝の点のいちばん遠い所の近く（点は枝の太さの中に散らばり、枝の先ちょうどにはないので、少しずれる）
      expect(Math.abs(reach(l, 0) - d)).toBeLessThan(0.05);
      prev = d;
    }
    // 胸は左、肩は右へ伸びる
    expect(partTip(tips, pivots, 0, 1e9, 1, 1)!.x).toBeLessThan(0);
    expect(partTip(tips, pivots, 1, 1e9, 1, 1)!.x).toBeGreaterThan(0);
  });

  test('揺れ：根元より上ほど横へずれ、根元より下（根）と揺れ 0 のときは動かない。揺れるのは木だけ', () => {
    expect(swayX(0.3, 0.5, 0.5, 0.1)).toBe(0.3);
    expect(swayX(0.3, 0.8, 0.5, 0.1)).toBe(0.3);
    expect(swayX(0.3, -0.5, 0.5, 0)).toBe(0.3);
    expect(swayX(0.3, -0.5, 0.5, 0.1)).toBeCloseTo(0.4);
    expect(SHAPES.tree.sway).toBeGreaterThan(0);
    expect(SHAPES.galaxy.sway).toBeUndefined();
    expect(SHAPES.attractor.sway).toBeUndefined();
  });
});

describe('形を箱に収める', () => {
  /**
   * 描くときと同じ計算（placePoint）で、画面の上で届く横・縦（形の半径を 1 としたとき）。回す形は1周を細かく回し、
   * 揺れる形は揺れの端と途中で、部位の長さの倍率（いちばん育った・最低限・ばらばら）も変えて確かめる
   */
  const reachOf = (kind: (typeof SHAPE_KINDS)[number]) => {
    const def = SHAPES[kind];
    const b = def.build();
    const parts = b.parts ?? new Float32Array(0);
    const pivots = b.pivots ?? new Float32Array(0);
    const sway = def.sway ?? 0;
    const angles = sway > 0 ? [0] : Array.from({ length: 180 }, (_, k) => (k / 180) * Math.PI * 2);
    const bends = sway > 0 ? [-1, -0.5, 0, 0.5, 1].map((k) => k * sway) : [0];
    const scales = parts.length > 0 ? [[1, 1, 1, 1, 1, 1], [0.5, 0.5, 0.5, 0.5, 0.5, 0.5], [1, 0.5, 0.7, 1, 0.5, 0.9]] : [[]];
    let x = 0;
    let y = 0;
    for (const a of angles) {
      for (const bend of bends) {
        for (const scale of scales) {
          const f = { cos: Math.cos(a), sin: Math.sin(a), tiltCos: Math.cos(def.tilt), tiltSin: Math.sin(def.tilt), bend, rootY: b.seedY ?? 0 };
          for (let i = 0; i < b.points.length / 3; i++) {
            const q = placePoint(b.points, i, parts, pivots, scale, f);
            x = Math.max(x, Math.abs(q.x));
            y = Math.max(y, Math.abs(q.y));
          }
        }
      }
    }
    return { x, y };
  };
  const reach = Object.fromEntries(SHAPE_KINDS.map((k) => [k, reachOf(k)]));

  test.each(SHAPE_KINDS.flatMap((k) => [
    [k, 380, 140, true], [k, 380, 172, true], [k, 320, 140, true], [k, 412, 440, false], [k, 360, 440, false],
  ] as const))('%s は %i×%i（衛星 %s）の箱から、どう回しても・揺れてもはみ出さない', (kind, w, h, sats) => {
    const unit = shapeUnit(w, h, SHAPES[kind].extent, sats, 2.5);
    expect(unit).toBeGreaterThan(Math.min(w, h) * 0.3);
    expect(reach[kind].x * unit).toBeLessThanOrEqual(w / 2 - 2.5 + 0.01);
    expect(reach[kind].y * unit).toBeLessThanOrEqual(h / 2 - 2.5 + 0.01);
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
  test('shapeExtent（揺れる形は swayExtent）の計算と合う（切り上げた値で、0.001 以内。Mac と Linux で三角関数の丸めが少しちがう）。点の並びか tilt・sway を変えたら、ここに出る値に置き換える', () => {
    for (const kind of ['attractor', 'tree', 'galaxy'] as const) {
      const def = SHAPES[kind];
      const b = def.build();
      const e = def.sway ? swayExtent(b.points, def.tilt, PERSPECTIVE, b.seedY ?? 0, def.sway) : shapeExtent(b.points, def.tilt, PERSPECTIVE);
      // 置いた値は計算より小さくない（形が箱からはみ出さない）、かつ大きすぎない
      expect(def.extent.x).toBeGreaterThanOrEqual(e.x);
      expect(def.extent.y).toBeGreaterThanOrEqual(e.y);
      expect(def.extent.x - e.x).toBeLessThan(0.001);
      expect(def.extent.y - e.y).toBeLessThan(0.001);
    }
  });
  test('点の並びは形ごとに1回だけ作る', () => {
    expect(shapeBuild('tree')).toBe(shapeBuild('tree'));
  });
});
