import * as fs from 'fs';
import * as path from 'path';
import { migrate, MIGRATIONS } from '../migrations';
import { toPushChange } from '../repositories/sync';
import { SEED_EXERCISES } from '../seed';
import { changeAmount, ItemInput, templateId } from '@/lib/meals';
import { createFakeSyncServer } from '@/test-utils/fakeSyncServer';
import { memoryDb, testDeps } from '@/test-utils/nodeDb';
import { device } from '@/test-utils/syncHarness';

const rice: ItemInput = { name: '白米', amount: 200, unit: 'g', kcal: 312, protein_g: 5, fat_g: 0.6, carbs_g: 74 };
const chicken: ItemInput = { name: '鶏むね肉', amount: 100, unit: 'g', kcal: 108, protein_g: 22, fat_g: 1.5, carbs_g: 0 };
const soup: ItemInput = { name: 'みそ汁', amount: 1, unit: '杯', kcal: 46, protein_g: 4, fat_g: 2, carbs_g: 3 };
const DAY = '2026-11-08';

const outboxOf = (rows: Record<string, unknown>[]) =>
  rows.map((r) => [r.entity_type, r.op, r.parent_id ?? null, r.fields ? JSON.parse(r.fields as string) : null]);

describe('食事の記録・修正・削除・複製', () => {
  test('記録すると、食事と品目の create を積む（品目には親の食事の ID）。一覧は区分と記録の順', async () => {
    const d = await device();
    const lunch = await d.r.meals.record({ date: DAY, slot: 'lunch', source: 'text', items: [rice, chicken] });
    d.deps.advance(1000);
    const breakfast = await d.r.meals.record({ date: DAY, slot: 'breakfast', source: 'numbers', items: [soup] });
    expect((await d.r.meals.listDay(DAY)).map((m) => [m.id, m.slot, m.items.map((i) => i.name)])).toEqual([
      [breakfast, 'breakfast', ['みそ汁']], [lunch, 'lunch', ['白米', '鶏むね肉']],
    ]);
    const rows = d.outbox();
    expect(outboxOf(rows).slice(0, 2)).toEqual([
      ['meal', 'create', null, { date: DAY, slot: 'lunch', time: null, description: '', source: 'text' }],
      ['meal_item', 'create', lunch, { ...rice, confidence: 'high', sort_order: 0 }],
    ]);
    expect(toPushChange(rows[1] as never)).toMatchObject({ entity_type: 'meal_item', parent_id: lunch, fields: { name: '白米' } });
    expect(toPushChange(rows[0] as never)).not.toHaveProperty('parent_id');
  });

  test('直す：量（栄養も同じ割合）、品目の追加・削除、日付と区分。変わった項目だけを積む', async () => {
    const d = await device();
    const id = await d.r.meals.record({ date: DAY, slot: 'lunch', source: 'text', items: [rice, chicken] });
    const meal = (await d.r.meals.getMeal(id))!;
    const before = d.outbox().length;
    d.deps.advance(60_000);
    await d.r.meals.update(id, { date: '2026-11-07', slot: 'dinner', items: [changeAmount(meal.items[0], 150), soup] });
    const after = (await d.r.meals.getMeal(id))!;
    expect([after.date, after.slot, after.items.map((i) => [i.name, i.amount, i.kcal])]).toEqual(
      ['2026-11-07', 'dinner', [['白米', 150, 234], ['みそ汁', 1, 46]]]);
    expect(outboxOf(d.outbox().slice(before))).toEqual([
      ['meal', 'update', null, { date: '2026-11-07', slot: 'dinner' }],
      // SQLite の json_object は小数を15桁で書くので、0.6 × 0.75（0.44999999999999996）は 0.45 で積まれる
      ['meal_item', 'update', id, { amount: 150, kcal: 234, protein_g: 3.75, fat_g: 0.45, carbs_g: 55.5 }],
      ['meal_item', 'create', id, { ...soup, confidence: 'high', sort_order: 1 }],
      ['meal_item', 'delete', id, null],
    ]);
    await expect(d.r.meals.update(id, { date: DAY, slot: 'lunch', items: [] })).rejects.toThrow('品目が1つもありません');
    const many = Array.from({ length: 51 }, () => soup);
    await expect(d.r.meals.record({ date: DAY, slot: 'lunch', source: 'text', items: many })).rejects.toThrow('品目は1回の食事に50件までです');
  });

  test('消すと、食事の delete だけを積み、一覧と合計から消える', async () => {
    const d = await device();
    const id = await d.r.meals.record({ date: DAY, slot: 'lunch', source: 'text', items: [rice] });
    const before = d.outbox().length;
    await d.r.meals.remove(id);
    expect(outboxOf(d.outbox().slice(before))).toEqual([['meal', 'delete', null, null]]);
    expect(await d.r.meals.listDay(DAY)).toEqual([]);
    expect((await d.r.meals.summaries(DAY, DAY)).days[0].total).toEqual({ kcal: 0, protein_g: 0, fat_g: 0, carbs_g: 0 });
  });

  test('昨日と同じ：別の日・区分に複製する。品目の ID は元のまま（別の食事なので、両方残る）', async () => {
    const d = await device();
    const id = await d.r.meals.record({ date: '2026-11-07', slot: 'breakfast', description: '朝', source: 'text', items: [rice, chicken] });
    const copy = await d.r.meals.copy(id, { date: DAY, slot: 'lunch' });
    const [a, b] = [await d.r.meals.getMeal(id), await d.r.meals.getMeal(copy)];
    expect(b).toMatchObject({ date: DAY, slot: 'lunch', source: 'copy', description: '朝', time: null });
    expect(b!.items.map((i) => i.id)).toEqual(a!.items.map((i) => i.id));
    // もう1台の端末に、両方の食事がそろって届く
    const server = d.server;
    await d.engine.run();
    const other = await device(server);
    await other.engine.run();
    expect((await other.r.meals.listRange('2026-11-07', DAY)).map((m) => [m.id, m.items.length])).toEqual([[id, 2], [copy, 2]]);
  });
});

describe('いつもの', () => {
  test('保存（ID は名前から）、同じ名前は上書き、いつもので記録（説明は「いつもの：名前」、品目の ID はいつもののまま）', async () => {
    const d = await device();
    await d.r.meals.saveTemplate(' 朝の定番 ', (await recordAndGet(d, [rice])).items);
    const id = await d.r.meals.record({ date: DAY, slot: 'breakfast', source: 'text', items: [rice, soup] });
    await d.r.meals.saveTemplateFromMeal(id, '朝の定番');
    const templates = await d.r.meals.listTemplates();
    expect(templates.map((t) => [t.id, t.name, t.items.map((i) => i.name)])).toEqual([[templateId('朝の定番'), '朝の定番', ['白米', 'みそ汁']]]);
    const mealId = await d.r.meals.recordTemplate(templates[0].id, { date: '2026-11-09', slot: 'breakfast' });
    const meal = (await d.r.meals.getMeal(mealId))!;
    expect(meal).toMatchObject({ description: 'いつもの：朝の定番', source: 'template' });
    expect(meal.items.map((i) => i.id)).toEqual(templates[0].items.map((i) => i.item_id));
    // 送る形：品目の一覧は JSON の文字列ではなく、配列
    const created = d.outbox().filter((r) => r.entity_type === 'meal_template');
    expect(created.map((r) => r.op)).toEqual(['create', 'update']);
    expect(toPushChange(created[1] as never).fields?.items).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'みそ汁' })]));
  });
});

async function recordAndGet(d: Awaited<ReturnType<typeof device>>, items: ItemInput[]) {
  return (await d.r.meals.getMeal(await d.r.meals.record({ date: DAY, slot: 'snack', source: 'text', items })))!;
}

describe('目標・日の種類・1日のまとめ', () => {
  test('日の種類：本人が決めた日 → 筋トレの記録（セット）がある日 → 休みの日。目標は日の種類で選ぶ', async () => {
    const d = await device();
    await d.r.meals.saveGoal({
      policy: 'bulk', body_weight_kg: 70, protein_per_kg: 2, eating_style: null, target_weight_kg: null,
      targets: { training_day: { kcal: 2600, fat_g: 72, carbs_g: 340 }, rest_day: { kcal: 2200, fat_g: 61, carbs_g: 280 } },
    });
    await d.r.workouts.saveEntry({ date: '2026-11-07', exerciseId: SEED_EXERCISES[0].id, sets: [{ weightKg: 60, reps: 10, memo: '', done: false }] });
    await d.r.workouts.saveEntry({ date: '2026-11-06', exerciseId: SEED_EXERCISES[0].id, sets: [{ weightKg: 60, reps: 10, memo: '', done: false }] });
    await d.r.meals.setDayType('2026-11-06', 'rest');
    await d.r.meals.setDayType(DAY, 'training');
    await d.r.meals.record({ date: DAY, slot: 'lunch', source: 'text', items: [rice] });
    const { days } = await d.r.meals.summaries('2026-11-05', DAY);
    expect(days.map((x) => [x.date, x.dayType, x.target?.kcal])).toEqual([
      ['2026-11-05', 'rest', 2200], ['2026-11-06', 'rest', 2200], ['2026-11-07', 'training', 2600], [DAY, 'training', 2600],
    ]);
    expect(days[3].remaining).toEqual({ kcal: 2600 - 312, protein_g: 140 - 5, fat_g: 72 - 0.6, carbs_g: 340 - 74 });
    // 目標と日の種類の変更も積む（目標の targets は送るときに JSON の値にする）
    const goal = d.outbox().find((r) => r.entity_type === 'nutrition_goal')!;
    expect(toPushChange(goal as never).fields?.targets).toEqual({ training_day: { kcal: 2600, fat_g: 72, carbs_g: 340 }, rest_day: { kcal: 2200, fat_g: 61, carbs_g: 280 } });
    expect(d.outbox().filter((r) => r.entity_type === 'day_type').map((r) => [r.entity_id, JSON.parse(r.fields as string)])).toEqual([
      ['2026-11-06', { day_type: 'rest' }], [DAY, { day_type: 'training' }],
    ]);
    // 同じ値の保存は積まない
    const n = d.outbox().length;
    await d.r.meals.setDayType(DAY, 'training');
    expect(d.outbox().length).toBe(n);
  });
});

describe('同期', () => {
  test('ほかの端末（や MCP）で直した品目の量が、もう1台に届く', async () => {
    const server = createFakeSyncServer({ clock: () => '2026-11-08T03:00:00.000Z' });
    const a = await device(server);
    const b = await device(server);
    const id = await a.r.meals.record({ date: DAY, slot: 'lunch', source: 'text', items: [rice] });
    await a.engine.run();
    await b.engine.run();
    const meal = (await b.r.meals.getMeal(id))!;
    await b.r.meals.update(id, { date: DAY, slot: 'lunch', items: [changeAmount(meal.items[0], 100)] });
    await b.engine.run();
    await a.engine.run();
    expect((await a.r.meals.getMeal(id))!.items.map((i) => [i.amount, i.kcal])).toEqual([[100, 156]]);
  });

  test('summaries.json の状態（サーバーが当てはめたもの）を端末に当てはめると、サーバーと同じ1日のまとめになる', async () => {
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'testdata', 'meals', 'summaries.json'), 'utf8'));
    const d = await device();
    // 筋トレの日は、筋トレの記録から求める（testdata の training_days）
    for (const date of data.training_days) {
      await d.r.workouts.saveEntry({ date, exerciseId: SEED_EXERCISES[0].id, sets: [{ weightKg: 60, reps: 10, memo: '', done: false }] });
    }
    await d.store.applyStates(data.states.map((s: { created_at: string; deleted: boolean }, i: number) => ({
      ...s, updated_at: s.created_at, deleted_at: s.deleted ? s.created_at : null, seq: i + 1,
    })));
    const { days } = await d.r.meals.summaries('2026-11-02', data.last_day);
    expect(days.map((x) => ({ date: x.date, day_type: x.dayType, meal_ids: x.meals.map((m) => m.id), total: x.total, target: x.target, remaining: x.remaining })))
      .toEqual(data.expected.daily.map((x: { date: string; day_type: string; meals: { meal_id: string }[]; total: unknown; target: unknown; remaining: unknown }) =>
        ({ date: x.date, day_type: x.day_type, meal_ids: x.meals.map((m) => m.meal_id), total: x.total, target: x.target, remaining: x.remaining })));
  });

  test('別のアカウントに送る（send）と、食事も積み直す（品目には親の ID。消した食事とその品目は積まない）。消す（replace）と、食事の表も空になる', async () => {
    const d = await device();
    const kept = await d.r.meals.record({ date: DAY, slot: 'lunch', source: 'text', items: [rice, chicken] });
    const gone = await d.r.meals.record({ date: DAY, slot: 'snack', source: 'text', items: [soup] });
    await d.r.meals.remove(gone);
    await d.r.meals.saveTemplateFromMeal(kept, '昼');
    await d.r.meals.setDayType(DAY, 'rest');
    await d.store.switchAccount('new-sub', 'send', '2026-11-08T00:00:00.000Z');
    expect(outboxOf(d.outbox()).map(([t, op, parent]) => [t, op, parent])).toEqual([
      ['meal', 'create', null], ['meal_item', 'create', kept], ['meal_item', 'create', kept],
      ['meal_template', 'create', null], ['day_type', 'create', null],
    ]);
    expect(toPushChange(d.outbox()[3] as never).fields?.items).toHaveLength(2);
    await d.store.switchAccount('other-sub', 'replace', '2026-11-08T00:00:00.000Z');
    expect(await d.r.meals.listDay(DAY)).toEqual([]);
    expect(await d.r.meals.listTemplates()).toEqual([]);
  });

  test('版2の端末は、版3で受け取りの位置を消して、スナップショットを取り直す', async () => {
    const db = memoryDb();
    const deps = testDeps();
    const v3 = MIGRATIONS.splice(2);
    try {
      await migrate(db, deps.now);
    } finally {
      MIGRATIONS.push(...v3);
    }
    await db.runAsync(`INSERT INTO sync_meta (key, value) VALUES ('cursor', '42')`, []);
    await migrate(db, deps.now);
    expect(db.raw.prepare(`SELECT value FROM sync_meta WHERE key = 'cursor'`).get()).toBeUndefined();
  });
});

/**
 * アプリで食事を記録・修正・複製し、いつもの・目標・日の種類を決めて送る本文。
 * services/meals/tests/sync/test_app_push.py が、これを本物の同期の API に送り、MCP の食事のツールから見えることを確かめる。
 * 作り直すとき：UPDATE_TESTDATA=1 npx jest db/__tests__/meals.test.ts
 */
describe('app_push.json：アプリが送る食事の本文', () => {
  test('同じ本文になる', async () => {
    const server = createFakeSyncServer({ clock: () => '2026-11-08T03:00:00.000Z' });
    const d = await device(server, '2026-11-08T03:00:00.000Z');
    const lunch = await d.r.meals.record({ date: '2026-11-07', slot: 'lunch', source: 'text', items: [rice, chicken] });
    d.deps.advance(60_000);
    const meal = (await d.r.meals.getMeal(lunch))!;
    await d.r.meals.update(lunch, { date: '2026-11-07', slot: 'lunch', items: [changeAmount(meal.items[0], 150), meal.items[1], soup] });
    d.deps.advance(60_000);
    await d.r.meals.copy(lunch, { date: DAY, slot: 'lunch' });
    await d.r.meals.saveTemplateFromMeal(lunch, '昼の定番');
    const removed = await d.r.meals.record({ date: DAY, slot: 'snack', source: 'numbers', items: [{ ...soup, name: 'kcal と PFC' }] });
    d.deps.advance(60_000);
    await d.r.meals.remove(removed);
    await d.r.meals.saveGoal({
      policy: 'bulk', body_weight_kg: 70, protein_per_kg: 2, eating_style: 'home_cooked', target_weight_kg: 74,
      targets: { training_day: { kcal: 2600, fat_g: 72, carbs_g: 340 }, rest_day: { kcal: 2200, fat_g: 61, carbs_g: 280 } },
    });
    await d.r.meals.setDayType(DAY, 'training');
    expect(await d.engine.run()).toMatchObject({ ok: true, rejected: 0 });
    const pushes = server.requests.filter((q) => q.method === 'POST').map((q) => {
      const body = q.body as { changes: { change_id: string }[] };
      return { device_id: '<device_id>', changes: body.changes.map((c) => ({ ...c, change_id: '<change_id>' })) };
    });
    const file = path.join(__dirname, '..', '..', '..', '..', 'testdata', 'meals', 'app_push.json');
    if (process.env.UPDATE_TESTDATA) {
      fs.writeFileSync(file, `${JSON.stringify({
        description: 'アプリで食事を記録・修正（量・品目の追加）・複製・削除し、いつもの・目標・日の種類を決めて送る本文（apps/mobile/db/__tests__/meals.test.ts が作る）。'
          + 'services/meals/tests/sync/test_app_push.py が change_id を UUID にして本物の API に送り、MCP の食事のツールから見えることを確かめる。',
        pushes,
      }, null, 2)}\n`);
    }
    expect(pushes).toEqual(JSON.parse(fs.readFileSync(file, 'utf8')).pushes);
  });
});
