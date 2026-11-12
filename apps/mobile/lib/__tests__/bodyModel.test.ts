import { readFileSync } from 'fs';
import { join } from 'path';
import { ALL_PARTS, anchorFor, boxOf, CALLOUT_H, facingOf, jointAnchor, layoutCallouts, partsFor, projectFront, siteOfPart } from '../bodyModel';
import { SITES } from '../injuries';

type Glb = {
  nodes: { name: string; mesh?: number }[];
  meshes: { primitives: { attributes: { POSITION: number } }[] }[];
  accessors: { min: number[]; max: number[] }[];
};
/** GLB の JSON の部分を読む */
function glb(): Glb {
  const buf = readFileSync(join(__dirname, '../../assets/models/body.glb'));
  const len = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + len).toString('utf8')) as Glb;
}
const glbNodeNames = () => glb().nodes.map((n) => n.name);

describe('3D の体の部品とケガの部位', () => {
  test('どの部位も、光らせる部品か関節の印のどちらかを持つ（左右とも）', () => {
    for (const [code, def] of Object.entries(SITES)) {
      for (const side of def.sided ? (['right', 'left', null] as const) : [null]) {
        const has = partsFor(code, side).length > 0 || jointAnchor(code, side) != null;
        expect({ code, side, has }).toEqual({ code, side, has: true });
      }
    }
  });

  test('部品の名前はすべて GLB にある', () => {
    const names = new Set(glbNodeNames());
    for (const p of ALL_PARTS) expect(names.has(p)).toBe(true);
  });

  test('部品の囲みは GLB の頂点の範囲と合う（左は右を反対にしたもので、1cm まで）。どの部位も付け根を持つ', () => {
    const g = glb();
    for (const p of ALL_PARTS) {
      const node = g.nodes.find((n) => n.name === p)!;
      const acc = g.accessors[g.meshes[node.mesh!].primitives[0].attributes.POSITION];
      const [lo, hi] = boxOf(p)!;
      for (let i = 0; i < 3; i++) {
        expect(Math.abs(lo[i] - acc.min[i])).toBeLessThan(0.01);
        expect(Math.abs(hi[i] - acc.max[i])).toBeLessThan(0.01);
      }
    }
    for (const [code, def] of Object.entries(SITES)) {
      for (const side of def.sided ? (['right', 'left', null] as const) : [null]) expect(anchorFor(code, side)).not.toBeNull();
    }
    // 前の部位は前の面、後ろの部位は後ろの面
    expect(anchorFor('chest', 'right')![2]).toBeGreaterThan(0.1);
    expect(anchorFor('lower_back', null)![2]).toBeLessThan(-0.1);
    expect(anchorFor('lower_back', null)![0]).toBeCloseTo(0, 5);
  });

  test('本人の右は _r（モデルの −x）、左は _l。左右が分からないときは両方', () => {
    expect(partsFor('shoulder_front', 'right')).toEqual(['delt_front_r']);
    expect(partsFor('lats', 'left')).toEqual(['lat_l']);
    expect(partsFor('lower_back', null)).toEqual(['erector_low_r', 'erector_low_l']);
    expect(partsFor('abs', null)).toEqual(['abs']);
  });

  test('関節の印：左右で x が反対、左右が分からないときはまん中、筋肉と知らないコードは null', () => {
    const r = jointAnchor('knee', 'right')!;
    const l = jointAnchor('knee', 'left')!;
    expect(r[0]).toBeLessThan(0);
    expect(l).toEqual([-r[0], r[1], r[2]]);
    expect(jointAnchor('knee', null)![0]).toBe(0);
    expect(jointAnchor('chest', 'right')).toBeNull();
    expect(jointAnchor('nope', null)).toBeNull();
    expect(partsFor('nope', null)).toEqual([]);
  });

  test('部品の名前から部位と左右に戻せる。部位のない部品は null', () => {
    for (const p of ALL_PARTS) {
      const s = siteOfPart(p)!;
      expect(partsFor(s.site, s.side)).toEqual([p]);
    }
    expect(siteOfPart('erector_low_r')).toEqual({ site: 'lower_back', side: 'right' });
    expect(siteOfPart('delt_mid_r')).toBeNull();
    expect(siteOfPart('skin')).toBeNull();
  });

  test('正面の画面の位置：まん中の点はまん中、本人の右（−x）は画面の左、上の点ほど上', () => {
    const c = projectFront([0, 0.84, 0], 300, 400);
    expect(c.x).toBeCloseTo(150, 5);
    expect(c.y).toBeCloseTo(200, 5);
    expect(projectFront([-0.2, 0.84, 0], 300, 400).x).toBeLessThan(150);
    expect(projectFront([0, 1.5, 0], 300, 400).y).toBeLessThan(projectFront([0, 0.5, 0], 300, 400).y);
  });

  test('吹き出し：右肩は左、左ひざは右、まん中は前なら左・後ろなら右。片側2つまで、重ならない', () => {
    const it = (id: string, anchor: [number, number, number], facing: 'front' | 'back', fixing = false, occurredOn = '2026-11-01') =>
      ({ id, anchor, facing, fixing, occurredOn });
    const out = layoutCallouts([
      it('rs', [-0.15, 1.36, 0.02], 'front', true),
      it('lk', [0.09, 0.44, 0.04], 'front'),
      it('abs', [0, 1.16, 0.12], 'front'),
      it('waist', [0, 1.0, -0.1], 'back'),
    ], 340, 360);
    const side = Object.fromEntries(out.map((o) => [o.id, o.side]));
    expect(side).toEqual({ rs: 'left', abs: 'left', lk: 'right', waist: 'right' });
    for (const s of ['left', 'right']) {
      const tops = out.filter((o) => o.side === s).map((o) => o.top);
      for (let i = 1; i < tops.length; i++) expect(tops[i] - tops[i - 1]).toBeGreaterThanOrEqual(CALLOUT_H);
    }
    // 3つ目は出さない（直している途中が先）
    const many = layoutCallouts([
      it('a', [-0.15, 1.3, 0], 'front', false, '2026-11-03'),
      it('b', [-0.15, 1.0, 0], 'front', true, '2026-10-01'),
      it('c', [-0.15, 0.5, 0], 'front', false, '2026-11-02'),
    ], 340, 360);
    expect(many.map((o) => o.id).sort()).toEqual(['a', 'b']);
  });

  test('前と後ろ：2D の図と同じ', () => {
    expect(facingOf('chest', 'right')).toBe('front');
    expect(facingOf('lower_back', 'left')).toBe('back');
    expect(facingOf('waist', null)).toBe('back');
  });
});
