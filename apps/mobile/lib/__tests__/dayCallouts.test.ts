import { calloutSet, CalloutOptions, dayFigureLabel, exerciseNumber, layoutCallouts, partAnchor, PlacedCallout } from '../dayCallouts';
import { FIGURE_PIECES, MUSCLE_PARTS, pairFigureFor, partsAt } from '../muscleFigure';
import { SEED_BODY_PARTS } from '@/db/seed';

// 記録の画面の図（66×132、下に「前・後ろ」の行 20）と、札（高さ 48、あいだ 4、片側 4 つ）
const OPT: CalloutOptions = { figureHeight: 132, minHeight: 152, slot: 48, gap: 4, perSide: 4 };

const inBox = (view: 'front' | 'back', muscle: string, p: { x: number; y: number }) =>
  FIGURE_PIECES[view].some((pc) => pc.muscle === muscle && p.x >= pc.box.x0 && p.x <= pc.box.x1 && p.y >= pc.box.y0 && p.y <= pc.box.y1);

describe('partAnchor（種目の部位 → 図の向きと点）', () => {
  test('初期の部位はすべて点がある。背中と上腕三頭筋は後ろの図、ほかは前の図', () => {
    for (const { name } of SEED_BODY_PARTS) {
      const a = partAnchor(name)!;
      expect(a).not.toBeNull();
      expect(a.view).toBe(name === '背中' || name === '上腕三頭筋' ? 'back' : 'front');
      expect(inBox(a.view, a.muscle, a.point)).toBe(true);
    }
  });

  test('点は札の側の片：前の図は画面の左（本人の右）、後ろの図は画面の右。背中は広背筋、腹筋はまん中', () => {
    expect(partAnchor('胸')).toMatchObject({ view: 'front', muscle: 'pecs' });
    expect(partAnchor('胸')!.point.x).toBeLessThan(50);
    expect(partAnchor('肩')!.point.x).toBeLessThan(50);
    expect(partAnchor('背中')).toMatchObject({ view: 'back', muscle: 'lats' });
    expect(partAnchor('背中')!.point.x).toBeGreaterThan(50);
    expect(partAnchor('腹筋')!.point.x).toBeCloseTo(50, 0);
  });

  test('上腕三頭筋は後ろの図の三頭筋（札は右、点は画面の右の腕）。名前の前後の空白は無視', () => {
    expect(partAnchor('上腕三頭筋')).toMatchObject({ view: 'back', muscle: 'triceps' });
    expect(partAnchor('上腕三頭筋')!.point.x).toBeGreaterThan(50);
    expect(partAnchor(' 上腕三頭筋 ')).toEqual(partAnchor('上腕三頭筋'));
    expect(partAnchor(' 胸 ')).toEqual(partAnchor('胸'));
  });

  test('知らない部位・空の部位は点がない', () => {
    expect(partAnchor('首')).toBeNull();
    expect(partAnchor('')).toBeNull();
  });
});

const entries = (parts: string[]) => parts.map((part, i) => ({ key: `e${i + 1}`, no: i + 1, part }));
const nos = (cs: PlacedCallout[]) => cs.map((c) => (c.kind === 'entry' ? c.no : `+${c.nos.join(',')}`));
const noOverlap = (cs: PlacedCallout[], height: number) => {
  for (const [i, c] of cs.entries()) {
    expect(c.top).toBeGreaterThanOrEqual(0);
    expect(c.top + OPT.slot).toBeLessThanOrEqual(height);
    if (i > 0) expect(c.top).toBeGreaterThanOrEqual(cs[i - 1].top + OPT.slot + OPT.gap);
  }
};

describe('layoutCallouts（札の並べ方）', () => {
  test('前の図の札は左、後ろの図の札は右。段の高さは図と同じ。札は点の高さにそろえる', () => {
    const l = layoutCallouts(entries(['胸', '背中']), OPT);
    expect(nos(l.left)).toEqual([1]);
    expect(nos(l.right)).toEqual([2]);
    expect(l.height).toBe(152);
    const chestY = partAnchor('胸')!.point.y * (132 / 200);
    expect(l.left[0].top + OPT.slot / 2).toBeCloseTo(chestY);
  });

  test('札は上から点の高さの順。重ならず、段に収まる（同じ筋肉の種目は同じ点へ）', () => {
    const l = layoutCallouts(entries(['脚', '胸', '肩', '胸']), OPT);
    expect(nos(l.left)).toEqual([3, 2, 4, 1]);
    noOverlap(l.left, l.height);
    const [a, b] = l.left.filter((c) => c.kind === 'entry' && (c.no === 2 || c.no === 4));
    expect(a.kind === 'entry' && b.kind === 'entry' && a.anchor).toEqual(b.kind === 'entry' && b.anchor);
    // 4 つは図の高さに収まらないので、段を伸ばす
    expect(l.height).toBe(4 * 48 + 3 * 4);
  });

  test('片側が多い日（胸 4・肩・二頭）：3 つと「+3」。まず筋肉ごとに 1 つ、残りは番号の順。三頭は後ろの図の札（右）', () => {
    const l = layoutCallouts(entries(['胸', '胸', '胸', '胸', '肩', '上腕二頭筋']), OPT);
    expect(l.right).toEqual([]);
    // 肩・胸・腕の点に 1 つずつ（上から点の順）、出せなかった 2〜4 は下の「+3」
    expect(nos(l.left)).toEqual([5, 1, 6, '+2,3,4']);
    const t = layoutCallouts(entries(['胸', '肩', '上腕三頭筋']), OPT);
    expect([nos(t.left), nos(t.right)]).toEqual([[2, 1], [3]]);
    noOverlap(l.left, l.height);
    expect(l.height).toBe(4 * 48 + 3 * 4);
  });

  test('筋肉の種類が枠より多いときは番号の小さい順。前と後ろで別に数える', () => {
    const l = layoutCallouts(entries(['胸', '肩', '脚', '上腕二頭筋', '腹筋', '背中', '背中']), OPT);
    expect(nos(l.left).at(-1)).toBe('+4,5');
    expect(l.left.filter((c) => c.kind === 'entry').map((c) => c.kind === 'entry' && c.no).sort()).toEqual([1, 2, 3]);
    expect(nos(l.right)).toEqual([6, 7]);
  });

  test('知らない部位は左の下に、線のない札（点がない）', () => {
    const l = layoutCallouts(entries(['首', '胸']), OPT);
    expect(nos(l.left)).toEqual([2, 1]);
    expect(l.left[1]).toMatchObject({ kind: 'entry', anchor: null });
    expect(l.left[1].top).toBe(152 - 48);
  });

  test('点が下のほう（脚）でも、札は段の中に収める', () => {
    const l = layoutCallouts(entries(['脚', '脚', '脚']), OPT);
    noOverlap(l.left, l.height);
    expect(l.left.at(-1)!.top).toBe(152 - 48);
  });
});

describe('札の文字と読み上げ', () => {
  test('番号は EX-01（2 桁）', () => {
    expect([exerciseNumber(1), exerciseNumber(12)]).toEqual(['EX-01', 'EX-12']);
  });

  test('セットはいちばん重いセット。回数だけなら回数、回数がなければセット数', () => {
    expect(calloutSet([{ weightKg: 70, reps: 10 }, { weightKg: 80, reps: 8 }, { weightKg: 80, reps: 6 }], 'kg')).toBe('80kg × 8');
    expect(calloutSet([{ weightKg: null, reps: 12 }, { weightKg: null, reps: 15 }], 'kg')).toBe('15回');
    expect(calloutSet([{ weightKg: 100, reps: 5 }], 'lb')).toBe('220.46lb × 5');
    expect(calloutSet([{ weightKg: null, reps: null }, { weightKg: null, reps: null }], 'kg')).toBe('2セット');
  });

  test('読み上げは番号・種目・部位の並び（部位が空なら名前だけ）', () => {
    expect(dayFigureLabel('鍛えた部位の図', [{ name: 'ベンチプレス', part: '胸' }, { name: 'ショルダープレス', part: '肩' }, { name: 'プランク', part: '' }]))
      .toBe('鍛えた部位の図。1 ベンチプレス 胸、2 ショルダープレス 肩、3 プランク');
    expect(dayFigureLabel('体の図', [])).toBe('体の図');
  });
});

describe('partsAt・MUSCLE_PARTS（図の筋肉を押して部位を選ぶ）', () => {
  test('塗る図の逆：初期の部位の筋肉は、その部位を候補に持つ。どの筋肉にも部位がある', () => {
    for (const { name } of SEED_BODY_PARTS) {
      for (const m of pairFigureFor(name).muscles) expect(MUSCLE_PARTS[m]).toContain(name);
    }
    for (const view of ['front', 'back'] as const) for (const p of FIGURE_PIECES[view]) expect(MUSCLE_PARTS[p.muscle].length).toBeGreaterThan(0);
  });

  test('札の点を押すと、その部位がいちばん近い候補', () => {
    for (const { name } of SEED_BODY_PARTS) {
      const a = partAnchor(name)!;
      expect(partsAt(a.view, a.point)[0]).toBe(name);
    }
  });

  test('後ろの三頭筋は上腕三頭筋、前腕は二頭と三頭の両方、もも裏は脚。近い筋肉も候補（胸のまん中寄りは胸と肩）', () => {
    const center = (view: 'front' | 'back', muscle: string) => {
      const b = FIGURE_PIECES[view].find((p) => p.muscle === muscle)!.box;
      return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
    };
    expect(partsAt('back', center('back', 'triceps'))[0]).toBe('上腕三頭筋');
    expect(partsAt('front', center('front', 'forearm')).slice(0, 2)).toEqual(['上腕二頭筋', '上腕三頭筋']);
    expect(partsAt('back', center('back', 'hamstrings'))).toEqual(['脚']);
    expect(partsAt('front', center('front', 'pecs')).slice(0, 2)).toEqual(['胸', '肩']);
  });

  test('体の外は候補なし', () => {
    expect(partsAt('front', { x: 2, y: 190 })).toEqual([]);
    expect(partsAt('back', { x: 98, y: 5 })).toEqual([]);
  });
});
