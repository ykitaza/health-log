// レポート（版7）：同期で受け取って読む、消すと delete だけを送る、積み直さない。食事の推定の根拠も
import { LATEST_VERSION, migrate, MIGRATIONS } from '../migrations';
import { ItemInput } from '@/lib/meals';
import { memoryDb, testDeps } from '@/test-utils/nodeDb';
import { device, Device } from '@/test-utils/syncHarness';

const rice: ItemInput = { name: '白米', amount: 200, unit: 'g', kcal: 312, protein_g: 5, fat_g: 0.6, carbs_g: 74 };
const WEEK = 'aaaaaaaa-0000-4000-8000-000000000001';
const MONTH = 'aaaaaaaa-0000-4000-8000-000000000002';

/** MCP の save_report が書いたもの（サーバーが受け付けた時刻 at） */
function saveReport(d: Device, id: string, at: string, fields: Record<string, unknown>) {
  d.server.setClock(() => at);
  d.server.append([{
    change_id: crypto.randomUUID(), entity_type: 'report', entity_id: id, parent_id: null, op: 'create',
    fields: { body: '', kind: 'other', period_start: null, period_end: null, ...fields }, changed_at: at, origin: 'mcp', device_id: null,
  }]);
}

const WEEKLY = {
  title: '今週のまとめ', kind: 'weekly', period_start: '2026-11-02', period_end: '2026-11-08', overall_tone: 'good',
  headline: '脚の日が増えた', body: '## 筋トレ\n- **12.45 t**',
  highlights: [
    { area: 'training', tone: 'good', text: '脚の日が2回', metric: { label: '合計負荷量', value: 12.45, unit: 't', delta: 1.3, delta_good: true } },
    { area: 'sleep', tone: 'caution', text: '睡眠が短い' },
  ],
  next_steps: ['夕食の揚げ物を週2回までに'],
};

describe('レポート', () => {
  test('同期で受け取ると、一覧（新しい順）・最新・1件で読める。構造のない前の形は steady で指標なし', async () => {
    const d = await device();
    saveReport(d, MONTH, '2026-11-01T01:00:00.000Z', { title: '10月のまとめ', kind: 'monthly', body: '本文だけ' });
    saveReport(d, WEEK, '2026-11-09T01:00:00.000Z', WEEKLY);
    expect(await d.engine.run()).toMatchObject({ ok: true });
    expect((await d.r.reports.list()).map((r) => r.id)).toEqual([WEEK, MONTH]);
    expect((await d.r.reports.latest())?.id).toBe(WEEK);
    const week = (await d.r.reports.get(WEEK))!;
    expect(week).toMatchObject({
      title: '今週のまとめ', kind: 'weekly', tone: 'good', headline: '脚の日が増えた', periodStart: '2026-11-02', periodEnd: '2026-11-08',
      nextSteps: ['夕食の揚げ物を週2回までに'], createdAt: '2026-11-09T01:00:00.000Z',
    });
    expect(week.highlights[0].metric).toEqual({ label: '合計負荷量', value: 12.45, unit: 't', delta: 1.3, deltaGood: true });
    expect(week.highlights[1].metric).toBeNull();
    expect(await d.r.reports.get(MONTH)).toMatchObject({ tone: 'steady', highlights: [], nextSteps: [], headline: '' });
    expect(d.outbox()).toEqual([]); // 受け取っただけでは何も送らない
  });

  test('消すと一覧から消え、delete だけを送る。サーバーでも消える', async () => {
    const d = await device();
    saveReport(d, WEEK, '2026-11-09T01:00:00.000Z', WEEKLY);
    await d.engine.run();
    await d.r.reports.remove(WEEK);
    expect(await d.r.reports.list()).toEqual([]);
    expect(d.outbox().map((r) => [r.entity_type, r.op, r.fields])).toEqual([['report', 'delete', null]]);
    expect(await d.engine.run()).toMatchObject({ ok: true, sent: 1, rejected: 0 });
    expect(d.server.state('report', WEEK)!.deleted).toBe(true);
  });

  test('ほかの端末や MCP で消したら、受け取って消える', async () => {
    const d = await device();
    saveReport(d, WEEK, '2026-11-09T01:00:00.000Z', WEEKLY);
    await d.engine.run();
    d.server.append([{
      change_id: crypto.randomUUID(), entity_type: 'report', entity_id: WEEK, parent_id: null, op: 'delete', fields: null,
      changed_at: '2026-11-09T02:00:00.000Z', origin: 'mcp', device_id: null,
    }]);
    await d.engine.run();
    expect(await d.r.reports.latest()).toBeNull();
  });

  test('アカウントを変えて「この端末の記録を送る」ときも、レポートは積まない', async () => {
    const d = await device();
    saveReport(d, WEEK, '2026-11-09T01:00:00.000Z', WEEKLY);
    await d.engine.run();
    await d.store.switchAccount('user-b', 'send', '2026-11-09T05:00:00.000Z');
    expect(d.outbox().filter((r) => r.entity_type === 'report')).toEqual([]);
  });

  test('壊れた値（知らない調子、JSON でない highlights）でも落ちず、前の形と同じに読む', async () => {
    const d = await device();
    saveReport(d, WEEK, '2026-11-09T01:00:00.000Z', { title: 'x', overall_tone: 'great', highlights: 'nope', next_steps: [1, ''] });
    await d.engine.run();
    expect(await d.r.reports.get(WEEK)).toMatchObject({ tone: 'steady', highlights: [], nextSteps: [] });
  });
});

describe('食事の推定の根拠', () => {
  test('MCP が書いた basis を受け取って読む。アプリで記録した食事は null。複製は引き継ぐ', async () => {
    const d = await device();
    const mine = await d.r.meals.record({ date: '2026-11-08', slot: 'lunch', source: 'text', items: [rice] });
    expect((await d.r.meals.getMeal(mine))!.basis).toBeNull();
    const id = 'bbbbbbbb-0000-4000-8000-000000000001';
    d.server.setClock(() => '2026-11-08T03:00:00.000Z');
    d.server.append([
      { change_id: crypto.randomUUID(), entity_type: 'meal', entity_id: id, parent_id: null, op: 'create', changed_at: '2026-11-08T03:00:00.000Z', origin: 'mcp', device_id: null,
        fields: { date: '2026-11-08', slot: 'dinner', time: null, description: '定食', source: 'photo', basis: 'ごはんは茶碗1杯 150g として' } },
      { change_id: crypto.randomUUID(), entity_type: 'meal_item', entity_id: 'i1', parent_id: id, op: 'create', changed_at: '2026-11-08T03:00:00.000Z', origin: 'mcp', device_id: null,
        fields: { ...rice, confidence: 'medium', sort_order: 0 } },
    ]);
    await d.engine.run();
    expect((await d.r.meals.getMeal(id))!.basis).toBe('ごはんは茶碗1杯 150g として');
    const copy = await d.r.meals.copy(id, { date: '2026-11-09', slot: 'lunch' });
    expect((await d.r.meals.getMeal(copy))!.basis).toBe('ごはんは茶碗1杯 150g として');
  });
});

describe('版7のマイグレーション', () => {
  test('版6の端末：受け取りの位置を消してスナップショットを取り直す。まだ送っていない食事の変更は残り、basis の列が増える', async () => {
    const db = memoryDb();
    const deps = testDeps();
    const v7 = MIGRATIONS.splice(6);
    try {
      await migrate(db, deps.now);
    } finally {
      MIGRATIONS.push(...v7);
    }
    db.raw.prepare(`INSERT INTO sync_meta (key, value) VALUES ('cursor', '42')`).run();
    db.raw.prepare(`INSERT INTO meals (id, date, slot, description, source, created_at, updated_at) VALUES ('m1', '2026-11-08', 'lunch', '', 'text', 'x', 'x')`).run();
    expect(await migrate(db, deps.now)).toBe(LATEST_VERSION);
    expect(db.raw.prepare(`SELECT value FROM sync_meta WHERE key = 'cursor'`).get()).toBeUndefined();
    expect(db.raw.prepare('SELECT op, entity_type FROM sync_outbox ORDER BY seq').all()).toEqual([{ op: 'create', entity_type: 'meal' }]);
    // 作り直したトリガーは basis も見る
    db.raw.prepare(`UPDATE meals SET description = '昼', updated_at = 'y' WHERE id = 'm1'`).run();
    const last = db.raw.prepare('SELECT fields FROM sync_outbox ORDER BY seq DESC LIMIT 1').get() as { fields: string };
    expect(JSON.parse(last.fields)).toEqual({ description: '昼' });
    db.raw.prepare(`INSERT INTO meals (id, date, slot, description, source, created_at, updated_at) VALUES ('m2', '2026-11-08', 'dinner', '', 'text', 'x', 'x')`).run();
    const created = db.raw.prepare('SELECT fields FROM sync_outbox ORDER BY seq DESC LIMIT 1').get() as { fields: string };
    expect(JSON.parse(created.fields)).toHaveProperty('basis', null);
  });
});
