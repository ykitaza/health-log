import { dropSlot, EDGE_MAX_STEP, EDGE_ZONE, edgeScrollStep, movedMessage, moveTargets, rowActions, slotOfAction, SlotBox } from '../mealMove';

// 食事を同じ日の別の区分へ移す（#328）の計算。画面の操作は e2e/meal-move.spec.ts
const boxes: SlotBox[] = [
  { slot: 'breakfast', top: 100, bottom: 200 }, { slot: 'lunch', top: 200, bottom: 300 },
  { slot: 'dinner', top: 300, bottom: 450 }, { slot: 'snack', top: 450, bottom: 520 },
];

describe('指の下の区分（受け皿）', () => {
  test('ほかの区分の上なら、その区分', () => {
    expect(dropSlot(460, boxes, 'dinner')).toBe('snack');
    expect(dropSlot(100, boxes, 'dinner')).toBe('breakfast');
    expect(dropSlot(299, boxes, 'dinner')).toBe('lunch');
  });
  test('今の区分の上・どの区分の上でもないなら null（離しても移さない）', () => {
    expect(dropSlot(350, boxes, 'dinner')).toBeNull();
    expect(dropSlot(50, boxes, 'dinner')).toBeNull();
    expect(dropSlot(520, boxes, 'dinner')).toBeNull();
  });
});

describe('画面の端の自動スクロール', () => {
  const viewport = { top: 50, height: 800 };
  test('端の帯の外は 0。上の端は上へ、下の端は下へ、端に近いほど速い', () => {
    expect(edgeScrollStep(400, viewport)).toBe(0);
    expect(edgeScrollStep(50 + EDGE_ZONE, viewport)).toBe(0);
    expect(edgeScrollStep(50, viewport)).toBe(-EDGE_MAX_STEP);
    expect(edgeScrollStep(850, viewport)).toBe(EDGE_MAX_STEP);
    const near = edgeScrollStep(845, viewport);
    const far = edgeScrollStep(850 - EDGE_ZONE + 10, viewport);
    expect(near).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(0);
  });
  test('見えている範囲をまだ測っていなければ動かさない', () => {
    expect(edgeScrollStep(0, null)).toBe(0);
  });
});

describe('メニューと読み上げの操作', () => {
  test('移せるのは今の区分のほかの 3 つ（朝・昼・夕・間食の順）', () => {
    expect(moveTargets('dinner')).toEqual(['breakfast', 'lunch', 'snack']);
  });
  test('読み上げの操作は、開くと「〜へ移す」。操作の名前から区分に戻せる', () => {
    expect(rowActions('dinner')).toEqual([
      { name: 'activate' },
      { name: 'move-breakfast', label: '朝食へ移す' }, { name: 'move-lunch', label: '昼食へ移す' }, { name: 'move-snack', label: '間食へ移す' },
    ]);
    expect(rowActions('dinner').slice(1).map((a) => slotOfAction(a.name))).toEqual(['breakfast', 'lunch', 'snack']);
    expect(slotOfAction('activate')).toBeNull();
    expect(slotOfAction('move-brunch')).toBeNull();
  });
  test('移したあとの知らせ', () => {
    expect(movedMessage('ナッツ', 'snack')).toBe('「ナッツ」を間食へ移しました');
  });
});
