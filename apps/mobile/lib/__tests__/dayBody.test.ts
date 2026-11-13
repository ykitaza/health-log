import { projectFront } from '../bodyModel';
import { dayBodyCallouts, dayBodyEntries, dayBodyGlow, partsOfMesh } from '../dayBody';

const W = 328, H = 328;
const opts = { perSide: 3, height: 44, gap: 4, top: 70, bottom: H - 70 };

describe('その日の体の札', () => {
  test('記録から札とその日の部位を作る（セットのない種目は外し、番号は詰める）', () => {
    const r = dayBodyEntries([
      { id: 'a', exerciseName: 'ベンチプレス', bodyPartName: '胸', sets: [{ weightKg: 80, reps: 8 }, { weightKg: 85, reps: 5 }] },
      { id: 'b', exerciseName: '空', bodyPartName: '肩', sets: [] },
      { id: 'c', exerciseName: '懸垂', bodyPartName: '背中', sets: [{ weightKg: null, reps: 10 }] },
    ], 'kg');
    expect(r.entries).toEqual([
      { key: 'a', no: 1, name: 'ベンチプレス', set: '85kg × 5', part: '胸' },
      { key: 'c', no: 2, name: '懸垂', set: '10回', part: '背中' },
    ]);
    expect(r.parts).toEqual(['胸']);
  });

  test('胸の日でも、番号の順に左右へ分ける。付け根はその側の片。帯の中に収める', () => {
    const { placed, more, moreTop } = dayBodyCallouts([
      { key: 'a', no: 1, part: '胸' }, { key: 'b', no: 2, part: '胸' }, { key: 'c', no: 3, part: '上腕三頭筋' },
    ], W, H, opts);
    expect(more).toEqual([]);
    expect(moreTop).toBeNull();
    expect(new Set(placed.map((p) => p.side)).size).toBe(2);
    for (const p of placed) {
      const x = projectFront(p.anchor, W, H).x;
      expect(p.side === 'left' ? x <= W / 2 + 1 : x >= W / 2 - 1).toBe(true);
      expect(p.top).toBeGreaterThanOrEqual(opts.top);
      expect(p.top + opts.height).toBeLessThanOrEqual(opts.bottom);
    }
  });

  test('あふれたら「+N」。右の下に 1 つ分の場所を空け、右の札はその上に収める（重ならない）', () => {
    const items = Array.from({ length: 7 }, (_, i) => ({ key: `k${i}`, no: i + 1, part: '脚' }));
    const { placed, more, moreTop } = dayBodyCallouts([...items, { key: 'x', no: 8, part: 'ふくらはぎ' }], W, H, opts);
    // 左 3・右 2（もう 1 つは +N の場所）
    expect(placed.filter((p) => p.side === 'left')).toHaveLength(3);
    expect(placed.filter((p) => p.side === 'right')).toHaveLength(2);
    expect(more).toEqual([6, 7, 8]);
    expect(moreTop).toBe(opts.bottom - opts.height);
    for (const p of placed.filter((q) => q.side === 'right')) expect(p.top + opts.height + opts.gap).toBeLessThanOrEqual(moreTop!);
    for (const side of ['left', 'right'] as const) {
      const tops = placed.filter((p) => p.side === side).map((p) => p.top).sort((a, b) => a - b);
      for (let i = 1; i < tops.length; i++) expect(tops[i] - tops[i - 1]).toBeGreaterThanOrEqual(opts.height + opts.gap);
    }
  });

  test('知らない部位だけ（線を引けない）なら、全部「+N」', () => {
    const r = dayBodyCallouts([{ key: 'x', no: 1, part: 'ふくらはぎ' }], W, H, opts);
    expect(r.placed).toEqual([]);
    expect(r.more).toEqual([1]);
  });
});

describe('その日の体の光らせ方と、押した部品', () => {
  test('部位はミント（明るさ 1）、回復中の部品は回復の明るさで暖色（ミントより優先）。回復済み（0）はミントのまま', () => {
    const { levels, warm } = dayBodyGlow(['胸', '上腕三頭筋'], { pec_r: 0.67, pec_l: 0.67, triceps_r: 0, quad_r: 0.5 });
    expect(levels.pec_r).toBe(0.67);
    expect(levels.triceps_r).toBe(1);
    expect(levels.triceps_l).toBe(1);
    expect(levels.quad_r).toBe(0.5);
    expect([...warm].sort()).toEqual(['pec_l', 'pec_r', 'quad_r']);
  });

  test('部位がなく回復もなければ光らない', () => {
    expect(dayBodyGlow([], {})).toEqual({ levels: {}, warm: new Set() });
  });

  test('押した部品の部位（チップの並びのまま）。前腕は腕の部位すべて、知らない部品は空', () => {
    const chips = [{ id: '1', name: '胸' }, { id: '2', name: '上腕二頭筋' }, { id: '3', name: '上腕三頭筋' }, { id: '4', name: '脚' }];
    expect(partsOfMesh('pec_l', chips).map((c) => c.id)).toEqual(['1']);
    expect(partsOfMesh('forearm_r', chips).map((c) => c.id)).toEqual(['2', '3']);
    expect(partsOfMesh('skin', chips)).toEqual([]);
  });
});
