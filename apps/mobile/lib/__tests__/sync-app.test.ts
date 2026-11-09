// 前面に戻ったときの同期が、画面に届くか（ChatGPT で MCP から記録 → hlog に戻る、の流れ）。
// AppState の 'active' → 受け取り → notifyRemoteChange → 画面（useFocusData は onRemoteChange で読み直す）
import { createAppSync } from '../sync/app';
import { onRemoteChange } from '../sync/events';
import { device } from '@/test-utils/syncHarness';

const flush = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };
const MEAL = 'cccccccc-0000-4000-8000-000000000001';

/** MCP で記録した夕食（サーバーに届いたもの） */
function mcpDinner(d: Awaited<ReturnType<typeof device>>) {
  d.server.setClock(() => '2026-11-08T10:00:00.000Z');
  d.server.append([
    { change_id: crypto.randomUUID(), entity_type: 'meal', entity_id: MEAL, parent_id: null, op: 'create', changed_at: '2026-11-08T10:00:00.000Z', origin: 'mcp', device_id: null,
      fields: { date: '2026-11-08', slot: 'dinner', time: null, description: '鮭定食', source: 'text', basis: null } },
    { change_id: crypto.randomUUID(), entity_type: 'meal_item', entity_id: 'i1', parent_id: MEAL, op: 'create', changed_at: '2026-11-08T10:00:00.000Z', origin: 'mcp', device_id: null,
      fields: { name: '鮭', amount: 80, unit: 'g', kcal: 160, protein_g: 18, fat_g: 9, carbs_g: 0, confidence: 'medium', sort_order: 0 } },
  ]);
}

async function setup() {
  const d = await device();
  const done: boolean[] = [];
  const app = createAppSync({ store: d.store, api: d.api, now: d.deps.now, onDone: (o) => done.push(o.ok) });
  // 画面の代わり：知らせが来たら、その日の食事を読み直す
  const screen = { reloads: 0, meals: [] as string[] };
  const off = onRemoteChange(() => {
    screen.reloads++;
    void d.r.meals.summaries('2026-11-08', '2026-11-08').then((s) => { screen.meals = s.days[0]?.meals.map((m) => m.description ?? '') ?? []; });
  });
  return { d, app, done, screen, off };
}

describe('前面に戻ったときの同期', () => {
  test('MCP で記録してアプリに戻ると、受け取って画面が読み直し、記録が出る', async () => {
    const { d, app, done, screen, off } = await setup();
    try {
      // 起動したときの同期（まだサーバーに何もない）
      app.scheduler.request('start');
      await flush();
      expect(done).toEqual([true]);
      expect(screen.reloads).toBe(0);

      // ChatGPT に切り替えて（背景）、MCP で記録する
      app.appStateChanged('background');
      mcpDinner(d);
      await flush();
      expect(done).toHaveLength(1);

      // hlog に戻る
      app.appStateChanged('active');
      await flush();
      expect(done).toEqual([true, true]);
      expect(screen.reloads).toBe(1);
      expect(screen.meals).toEqual(['鮭定食']);
    } finally {
      off();
      app.scheduler.stop();
    }
  });

  test('戻っても変わったものがなければ、読み直さない（引っぱったときは usePullToSync が読み直す）', async () => {
    const { app, done, screen, off } = await setup();
    try {
      app.appStateChanged('active');
      await flush();
      expect(done).toEqual([true]);
      expect(screen.reloads).toBe(0);
    } finally {
      off();
      app.scheduler.stop();
    }
  });

  test('背景に回っただけ（inactive・background）では同期しない', async () => {
    const { app, done, off } = await setup();
    try {
      app.appStateChanged('inactive');
      app.appStateChanged('background');
      await flush();
      expect(done).toEqual([]);
    } finally {
      off();
      app.scheduler.stop();
    }
  });
});
