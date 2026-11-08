// Health Connect の取り込み（lib/healthConnect/importer.ts、db/repositories/healthConnect.ts）。
// Health Connect は偽物（test-utils/fakeHealthConnect.ts）、サーバーは偽の同期サーバー（当てはめの決まりはサーバーと同じ）
import { migrate, MIGRATIONS } from '../migrations';
import { HC_META, healthConnectStore } from '../repositories/healthConnect';
import { toPushChange } from '../repositories/sync';
import { importedId, importHealthConnect, INITIAL_DAYS } from '@/lib/healthConnect/importer';
import { uuid5 } from '@/lib/uuid5';
import { bodyFat, fakeHealthConnect as hc, leanMass, weight } from '@/test-utils/fakeHealthConnect';
import { memoryDb, testDeps } from '@/test-utils/nodeDb';
import { Device, device } from '@/test-utils/syncHarness';

jest.mock('react-native-health-connect', () => require('@/test-utils/fakeHealthConnect').module);

beforeEach(() => hc.reset());

/** 取り込みを1回動かす */
const runImport = (d: Device) => importHealthConnect(healthConnectStore(d.db, d.deps), d.deps.now);
const bodyRows = (d: Device) => d.db.raw.prepare(
  `SELECT id, date, measured_at, weight_kg, body_fat_pct, lean_mass_kg, source, external_id, origin_package, deleted_at
   FROM body_records ORDER BY measured_at, external_id`,
).all() as Record<string, unknown>[];
const outbox = (d: Device) => d.outbox().map((r) => ({ type: r.entity_type, id: r.entity_id, op: r.op, origin: r.origin, fields: r.fields ? JSON.parse(r.fields as string) : null }));

describe('ID の作り方', () => {
  test('uuid5（固定の名前空間、"hc:" + Health Connect の ID）。同じ記録はいつも同じ ID', () => {
    expect(importedId('abc')).toBe(uuid5('08e139e3-1bcd-47c7-af17-1a18a473f1c3', 'hc:abc'));
    expect(importedId('abc')).toBe(importedId('abc'));
    expect(importedId('abc')).not.toBe(importedId('abd'));
  });
});

describe('初めての取り込み', () => {
  test('先にトークンを取り、過去30日を全ページ読む。1件を1行に（体重・体脂肪率・除脂肪体重は別の行）、origin = import で積む', async () => {
    const d = await device(); // 今は 2026-11-08T00:00Z
    hc.put(weight('w-old', '2026-10-01T22:00:00Z', 72)); // 30日より前：読まない
    hc.put(weight('w1', '2026-11-01T22:00:00Z', 70.2)); // 日本時間 11/2 の朝
    hc.put(weight('w2', '2026-11-05T22:00:00Z', 69.8));
    hc.put(weight('w3', '2026-11-06T22:00:00Z', 69.6));
    hc.put(bodyFat('f1', '2026-11-06T22:00:00Z', 18.4));
    hc.put(leanMass('l1', '2026-11-06T22:00:00Z', 56.8));

    const result = await runImport(d);
    expect(result.written).toBe(5);
    // トークンを先に取ってから読む（読んでいるあいだの変更は、次の差分で届く）
    const order = hc.calls.filter((c) => c.fn !== 'revokeAllPermissions').map((c) => c.fn);
    expect(order.slice(0, 3)).toEqual(['getChanges', 'readRecords', 'readRecords']); // 体重は3件 → 2ページ
    const read = hc.calls.find((c) => c.fn === 'readRecords')!.args[1] as { timeRangeFilter: { startTime: string } };
    expect(read.timeRangeFilter.startTime).toBe(new Date(Date.parse('2026-11-08T00:00:00Z') - INITIAL_DAYS * 86_400_000).toISOString());

    const rows = bodyRows(d);
    expect(rows.map((r) => [r.external_id, r.date, r.weight_kg, r.body_fat_pct, r.lean_mass_kg])).toEqual([
      ['w1', '2026-11-02', 70.2, null, null],
      ['w2', '2026-11-06', 69.8, null, null],
      ['f1', '2026-11-07', null, 18.4, null],
      ['l1', '2026-11-07', null, null, 56.8],
      ['w3', '2026-11-07', 69.6, null, null],
    ]);
    for (const r of rows) {
      expect(r).toMatchObject({ id: importedId(r.external_id as string), source: 'health_connect', origin_package: 'com.example.scale', deleted_at: null });
    }
    expect(outbox(d).map((c) => [c.op, c.origin])).toEqual(Array(5).fill(['create', 'import']));
    // 送る形にも origin が入る
    expect(toPushChange(d.outbox()[0] as never).origin).toBe('import');
    // 型ごとのトークンと、最後に取り込んだ時刻
    const meta = (k: string) => healthConnectStore(d.db, d.deps).getMeta(k);
    expect(await meta(HC_META.token('Weight'))).toBe('Weight:4');
    expect(await meta(HC_META.lastImportAt)).toBe('2026-11-08T00:00:00.000Z');
    // 画面の1日の値：取り込みの印
    expect(await d.r.body.getDay('2026-11-07')).toEqual({
      date: '2026-11-07', weightKg: 69.6, bodyFatPct: 18.4, musclePct: null, waistCm: null, memo: '', imported: ['weightKg', 'bodyFatPct'],
    });
  });

  test('範囲の外の値（lib/limits.ts とサーバーの範囲）は取り込まない', async () => {
    const d = await device();
    hc.put(weight('w-low', '2026-11-06T22:00:00Z', 25));
    hc.put(weight('w-high', '2026-11-06T22:10:00Z', 301));
    hc.put(bodyFat('f-bad', '2026-11-06T22:00:00Z', 120));
    hc.put(weight('w-ok', '2026-11-06T22:20:00Z', 30));
    await runImport(d);
    expect(bodyRows(d).map((r) => r.external_id)).toEqual(['w-ok']);
  });

  test('権限のない型は読まない', async () => {
    const d = await device();
    hc.grant(['BodyFat']);
    hc.put(weight('w1', '2026-11-06T22:00:00Z', 70));
    hc.put(bodyFat('f1', '2026-11-06T22:00:00Z', 18));
    expect((await runImport(d)).types).toEqual(['BodyFat']);
    expect(bodyRows(d).map((r) => r.external_id)).toEqual(['f1']);
  });
});

describe('差分', () => {
  test('直したら update、消えたら delete（どちらも origin = import）。変わっていなければ何も積まない。同じ回に足して消えたものは書かない', async () => {
    const d = await device();
    hc.put(weight('w1', '2026-11-06T22:00:00Z', 70));
    await runImport(d);
    await d.engine.run();
    expect(outbox(d)).toEqual([]);

    expect((await runImport(d)).written).toBe(0); // 変更なし
    expect(outbox(d)).toEqual([]);

    d.deps.advance(60_000);
    hc.put(weight('w1', '2026-11-06T22:00:00Z', 69.4));
    hc.put(weight('w2', '2026-11-07T22:00:00Z', 69.1));
    hc.put(weight('w3', '2026-11-07T23:00:00Z', 69.0));
    hc.remove('w3');
    await runImport(d); // 4件の変更 → 2ページ
    expect(outbox(d)).toEqual([
      { type: 'body_record', id: importedId('w1'), op: 'update', origin: 'import', fields: { weight_kg: 69.4 } },
      { type: 'body_record', id: importedId('w2'), op: 'create', origin: 'import', fields: expect.objectContaining({ weight_kg: 69.1 }) },
    ]);
    expect(await healthConnectStore(d.db, d.deps).getMeta(HC_META.token('Weight'))).toBe('Weight:5');
    await d.engine.run();

    hc.remove('w2');
    await runImport(d);
    expect(outbox(d)).toEqual([{ type: 'body_record', id: importedId('w2'), op: 'delete', origin: 'import', fields: null }]);
    expect(bodyRows(d).find((r) => r.external_id === 'w2')!.deleted_at).not.toBeNull();
  });

  test('アプリで消した取り込みの記録は、Health Connect で直されても戻らない', async () => {
    const d = await device();
    hc.put(weight('w1', '2026-11-06T22:00:00Z', 70));
    await runImport(d);
    await d.r.body.clearField('2026-11-07', 'weightKg'); // 体組成の画面の ×
    expect(await d.r.body.getDay('2026-11-07')).toBeNull();
    hc.put(weight('w1', '2026-11-06T22:00:00Z', 70.5));
    await runImport(d);
    expect(bodyRows(d)).toMatchObject([{ external_id: 'w1', weight_kg: 70, deleted_at: expect.any(String) }]);
    // 消したのは本人の操作なので origin = app
    expect(outbox(d).map((c) => [c.op, c.origin])).toEqual([['create', 'import'], ['delete', 'app']]);
  });

  test('トークンが切れていたら、最後に読んだ時刻から読み直す', async () => {
    const d = await device();
    hc.put(weight('w1', '2026-11-06T22:00:00Z', 70));
    await runImport(d); // 読んだ時刻 2026-11-08T00:00Z
    d.deps.advance(3 * 86_400_000);
    hc.put(weight('w2', '2026-11-09T22:00:00Z', 69.5));
    hc.expireTokens('Weight');
    hc.calls.length = 0;
    await runImport(d);
    const read = hc.calls.filter((c) => c.fn === 'readRecords' && c.args[0] === 'Weight')
      .map((c) => (c.args[1] as { timeRangeFilter: { startTime: string } }).timeRangeFilter.startTime);
    expect(read).toEqual(['2026-11-08T00:00:00.000Z']);
    expect(bodyRows(d).map((r) => r.external_id)).toEqual(['w1', 'w2']);
    expect(await healthConnectStore(d.db, d.deps).getMeta(HC_META.token('Weight'))).toBe('Weight:2');
  });

  test('読めなかったら、トークンは進めない（次は同じところから読む）', async () => {
    const d = await device();
    hc.put(weight('w1', '2026-11-06T22:00:00Z', 70));
    await runImport(d);
    hc.put(weight('w2', '2026-11-07T22:00:00Z', 69));
    const getChanges = hc.module.getChanges;
    hc.module.getChanges = async () => { throw new Error('読めない'); };
    try {
      await expect(runImport(d)).rejects.toThrow('読めない');
    } finally {
      hc.module.getChanges = getChanges;
    }
    expect(await healthConnectStore(d.db, d.deps).getMeta(HC_META.token('Weight'))).toBe('Weight:1');
    await runImport(d);
    expect(bodyRows(d).map((r) => r.external_id)).toEqual(['w1', 'w2']);
  });
});

describe('手入力が先', () => {
  test('同じ日に手入力と取り込みがあれば、取り込みが新しくても手入力を出す（取り込みは手入力がない項目だけ）', async () => {
    const d = await device(undefined, '2026-11-07T10:00:00.000Z'); // 日本時間 19:00
    await d.r.body.saveManual('2026-11-07', { weightKg: 69 });
    d.deps.advance(3_600_000);
    hc.put(weight('w1', '2026-11-07T10:30:00Z', 68.5)); // 手入力よりあと
    hc.put(bodyFat('f1', '2026-11-07T10:30:00Z', 17.2));
    await runImport(d);
    expect(await d.r.body.getDay('2026-11-07')).toMatchObject({ weightKg: 69, bodyFatPct: 17.2, imported: ['bodyFatPct'] });
    // × で消すと、手入力の値と、その項目の取り込みの行の両方が消える
    await d.r.body.clearField('2026-11-07', 'weightKg');
    expect(await d.r.body.getDay('2026-11-07')).toMatchObject({ weightKg: null, bodyFatPct: 17.2 });
  });

  test('取り込んだ記録を手（MCP）で直した値は、次の取り込みで負けない（同期のあとも手の値）', async () => {
    const d = await device();
    hc.put(weight('w1', '2026-11-06T22:00:00Z', 70));
    await runImport(d);
    expect(await d.engine.run()).toMatchObject({ ok: true, sent: 1 });
    // MCP で直す（サーバーが受け付けた時刻で、手入力の強さ）
    d.server.setClock(() => '2026-11-08T00:10:00.000Z');
    d.server.append([{
      change_id: crypto.randomUUID(), entity_type: 'body_record', entity_id: importedId('w1'), parent_id: null, op: 'update',
      fields: { weight_kg: 69.5 }, changed_at: '2026-11-08T00:10:00.000Z', origin: 'mcp', device_id: null,
    }]);
    await d.engine.run();
    expect(bodyRows(d)[0].weight_kg).toBe(69.5);
    // 体重計の値が直される（あとの時刻）。取り込みは端末の値を書き換えて送るが、サーバーで手の値に負ける
    d.deps.advance(3_600_000);
    d.server.setClock(() => '2026-11-08T01:00:00.000Z');
    hc.put(weight('w1', '2026-11-06T22:00:00Z', 71));
    await runImport(d);
    expect(await d.engine.run()).toMatchObject({ ok: true, rejected: 0 });
    expect(bodyRows(d)[0].weight_kg).toBe(69.5);
    expect(d.server.state('body_record', importedId('w1'))!.fields.weight_kg).toBe(69.5);
  });
});

describe('アカウントと連携', () => {
  test('アカウントを変えて「消して受け取り直す」と、トークンも消え、次は過去30日から取り込み直す。「送る」は取り込みを import で積む', async () => {
    const d = await device();
    hc.put(weight('w1', '2026-11-06T22:00:00Z', 70));
    await runImport(d);
    await d.engine.run();
    const store = healthConnectStore(d.db, d.deps);

    await d.store.switchAccount('user-b', 'send', d.deps.now().toISOString());
    expect(outbox(d).filter((c) => c.type === 'body_record').map((c) => [c.op, c.origin])).toEqual([['create', 'import']]);
    expect(await store.getMeta(HC_META.token('Weight'))).toBe('Weight:1');

    await d.store.switchAccount('user-c', 'replace', d.deps.now().toISOString());
    expect(bodyRows(d)).toEqual([]);
    expect(await store.getMeta(HC_META.token('Weight'))).toBeNull();
    expect(await store.getMeta(HC_META.readAt('Weight'))).toBeNull();
    await runImport(d);
    expect(bodyRows(d).map((r) => [r.id, r.deleted_at])).toEqual([[importedId('w1'), null]]);
  });

  test('連携を切ると、トークンと連携の印を消す（取り込んだ記録は残す）', async () => {
    const d = await device();
    const store = healthConnectStore(d.db, d.deps);
    await store.setMeta(HC_META.connected, '1');
    hc.put(weight('w1', '2026-11-06T22:00:00Z', 70));
    await runImport(d);
    await store.disconnect();
    for (const k of [HC_META.connected, HC_META.lastImportAt, HC_META.token('Weight'), HC_META.readAt('Weight')]) {
      expect(await store.getMeta(k)).toBeNull();
    }
    expect(bodyRows(d)).toHaveLength(1);
  });
});

describe('版4のマイグレーション', () => {
  test('版3の端末：まだ送っていない変更は origin = app のまま残り、そのあとの変更も app で積む', async () => {
    const db = memoryDb();
    const deps = testDeps();
    const v4 = MIGRATIONS.splice(3);
    try {
      await migrate(db, deps.now);
    } finally {
      MIGRATIONS.push(...v4);
    }
    db.raw.prepare(`INSERT INTO settings (id, value, created_at, updated_at) VALUES ('weight_unit', 'lb', 'x', 'x')`).run();
    expect(await migrate(db, deps.now)).toBe(4);
    db.raw.prepare(`UPDATE settings SET value = 'kg', updated_at = 'y' WHERE id = 'weight_unit'`).run();
    const rows = db.raw.prepare('SELECT op, origin FROM sync_outbox ORDER BY seq').all();
    expect(rows).toEqual([{ op: 'create', origin: 'app' }, { op: 'update', origin: 'app' }]);
  });
});
