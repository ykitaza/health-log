// 同期で受け取った記録の件数（ホームの「食事を2件、筋トレを1件取り込みました」）
import type { EntityState } from '@/lib/api';
import { countReceived, NOTHING_RECEIVED, receivedMessage, receivedTarget } from '../sync/received';
import { device } from '@/test-utils/syncHarness';

const ME = 'device-me';

function entry(entity_type: string, op: string, device_id: string | null, fields: Record<string, unknown>, deleted = false) {
  const state: EntityState = {
    entity_type, entity_id: crypto.randomUUID(), parent_id: null, fields, deleted,
    created_at: '2026-11-08T10:00:00.000Z', updated_at: '2026-11-08T10:00:00.000Z', deleted_at: deleted ? '2026-11-08T10:00:00.000Z' : null, seq: 1,
  };
  return { change: { op, device_id, entity_type }, state };
}

describe('countReceived', () => {
  test('MCP とほかの端末で作った食事と筋トレを数え、自分の端末・直し・消えたもの・ほかの種類は数えない', () => {
    const r = countReceived([
      entry('meal', 'create', null, { date: '2026-11-08' }),
      entry('meal', 'create', 'device-other', { date: '2026-11-07' }),
      entry('meal', 'create', ME, { date: '2026-11-08' }),
      entry('meal', 'update', null, { date: '2026-11-09' }),
      entry('meal', 'create', null, { date: '2026-11-09' }, true),
      entry('meal_item', 'create', null, { name: '鮭' }),
      entry('body_record', 'create', null, { date: '2026-11-08' }),
    ], ME);
    expect(r).toEqual({ meals: 2, training: 0, mealDate: '2026-11-08', trainingDate: null });
  });

  test('筋トレは日ごとに数える（1日に何種目あっても1件）', () => {
    const r = countReceived([
      entry('workout_entry', 'create', null, { date: '2026-11-08' }),
      entry('workout_entry', 'create', null, { date: '2026-11-08' }),
      entry('workout_entry', 'create', null, { date: '2026-11-06' }),
      entry('workout_set', 'create', null, { reps: 5 }),
    ], ME);
    expect(r).toEqual({ meals: 0, training: 2, mealDate: null, trainingDate: '2026-11-08' });
  });
});

describe('知らせの文と「見る」の行き先', () => {
  test('種類ごとの件数。0件なら出さない', () => {
    expect(receivedMessage({ meals: 2, training: 1, mealDate: '2026-11-08', trainingDate: '2026-11-08' })).toBe('食事を2件、筋トレを1件取り込みました');
    expect(receivedMessage({ meals: 0, training: 1, mealDate: null, trainingDate: '2026-11-07' })).toBe('筋トレを1件取り込みました');
    expect(receivedMessage(NOTHING_RECEIVED)).toBeNull();
  });

  test('食事を受け取っていれば食事、なければ筋トレの日', () => {
    expect(receivedTarget({ meals: 1, training: 1, mealDate: '2026-11-08', trainingDate: '2026-11-07' })).toEqual({ kind: 'meals', date: '2026-11-08' });
    expect(receivedTarget({ meals: 0, training: 1, mealDate: null, trainingDate: '2026-11-07' })).toEqual({ kind: 'training', date: '2026-11-07' });
    expect(receivedTarget(NOTHING_RECEIVED)).toBeNull();
  });
});

describe('同期の1回分が返す件数', () => {
  test('初めてのスナップショットは数えず、そのあとの MCP の記録を数える。自分の端末から送った分は数えない', async () => {
    const d = await device();
    const at = '2026-11-08T10:00:00.000Z';
    d.server.setClock(() => at);
    d.server.append([{ change_id: crypto.randomUUID(), entity_type: 'meal', entity_id: crypto.randomUUID(), parent_id: null, op: 'create', changed_at: at, origin: 'mcp', device_id: null,
      fields: { date: '2026-11-07', slot: 'lunch', time: null, description: '前からある', source: 'text', basis: null } }]);
    expect(await d.engine.run()).toMatchObject({ ok: true, received: NOTHING_RECEIVED });

    // MCP で夕食を記録し、同じころに端末でも食事を記録した
    d.server.append([{ change_id: crypto.randomUUID(), entity_type: 'meal', entity_id: crypto.randomUUID(), parent_id: null, op: 'create', changed_at: at, origin: 'mcp', device_id: null,
      fields: { date: '2026-11-08', slot: 'dinner', time: null, description: '鮭定食', source: 'text', basis: null } }]);
    await d.r.meals.record({ date: '2026-11-08', slot: 'breakfast', source: 'numbers', items: [{ name: 'パン', amount: 1, unit: '個', kcal: 200, protein_g: 6, fat_g: 3, carbs_g: 35 }] });
    expect(await d.engine.run()).toMatchObject({ ok: true, sent: 2, received: { meals: 1, training: 0, mealDate: '2026-11-08', trainingDate: null } });
    expect(await d.engine.run()).toMatchObject({ ok: true, received: NOTHING_RECEIVED });
  });
});
