import { MIGRATIONS, migrate } from '../migrations';
import { toPushChange } from '../repositories/sync';
import { SEED_BODY_PARTS, SEED_EXERCISES } from '../seed';
import { createFakeSyncServer } from '@/test-utils/fakeSyncServer';
import { memoryDb, repos, testDeps } from '@/test-utils/nodeDb';
import { device } from '@/test-utils/syncHarness';
import { createApiClient } from '@/lib/api';
import { createSyncEngine, MAX_PUSH_BYTES, utf8Length } from '@/lib/sync/engine';
import { fakeAccessToken } from '@/test-utils/fakeToken';

const BENCH = SEED_EXERCISES[0].id;
const SQUAT = SEED_EXERCISES.find((e) => e.name === 'スクワット')!.id;
const CHEST = SEED_BODY_PARTS[0].id;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const sets = (...s: [number | null, number][]) => s.map(([weightKg, reps]) => ({ weightKg, reps, memo: '', done: false }));

describe('outbox（端末の変更の記録）', () => {
  test('入れたばかりの端末は、何も積まない（初期の部位と種目は送らない）。端末の ID を作る', async () => {
    const d = await device();
    expect(d.outbox()).toEqual([]);
    expect(await d.store.deviceId()).toMatch(UUID);
  });

  test('記録・編集・削除のたびに、項目ごとの変更を積む（change_id は UUID、changed_at は変えた時刻）', async () => {
    const d = await device();
    const entryId = await d.r.workouts.saveEntry({ date: '2026-11-08', exerciseId: BENCH, sets: sets([80, 8], [85, 5]) });
    let rows = d.outbox();
    expect(rows.map((r) => [r.entity_type, r.op])).toEqual([
      ['workout_entry', 'create'], ['workout_set', 'create'], ['workout_set', 'create'],
    ]);
    expect(rows.every((r) => UUID.test(r.change_id as string))).toBe(true);
    expect(rows[0].changed_at).toBe('2026-11-08T00:00:00.000Z');
    expect(JSON.parse(rows[1].fields as string)).toEqual({
      entry_id: entryId, set_index: 0, weight_kg: 80, reps: 8, memo: '', done: 0,
    });

    // 2つ目のセットの回数だけを変える → その項目だけ
    d.deps.advance(60_000);
    const entry = (await d.r.workouts.getEntry(entryId))!;
    await d.r.workouts.saveEntry({
      id: entryId, date: '2026-11-08', exerciseId: BENCH,
      sets: entry.sets.map((s, i) => ({ ...s, reps: i === 1 ? 6 : s.reps })),
    });
    rows = d.outbox();
    expect(rows.slice(3).map((r) => [r.entity_type, r.op, JSON.parse(r.fields as string)])).toEqual([
      ['workout_set', 'update', { reps: 6 }],
    ]);
    expect(rows[3].changed_at).toBe('2026-11-08T00:01:00.000Z');

    // 種目を外す → 種目とセットの delete
    d.deps.advance(60_000);
    await d.r.workouts.deleteEntry(entryId);
    expect(d.outbox().slice(4).map((r) => [r.entity_type, r.op, r.fields, r.changed_at])).toEqual([
      ['workout_entry', 'delete', null, '2026-11-08T00:02:00.000Z'],
      ['workout_set', 'delete', null, '2026-11-08T00:02:00.000Z'],
      ['workout_set', 'delete', null, '2026-11-08T00:02:00.000Z'],
    ]);
  });

  test('真偽値は true/false で送り、delete・restore には fields を付けない', async () => {
    const d = await device();
    await d.r.catalog.setExerciseHidden(BENCH, true);
    await d.r.settings.update({ weightUnit: 'lb' });
    d.db.raw.prepare(`UPDATE settings SET deleted_at = ?, updated_at = ? WHERE id = 'weight_unit'`).run('2026-11-08T00:00:01.000Z', '2026-11-08T00:00:01.000Z');
    // 消えた設定を書き直す（settings.update の upsert と同じ形）→ restore と update
    d.db.raw.prepare(`UPDATE settings SET value = 'kg', deleted_at = NULL, updated_at = ? WHERE id = 'weight_unit'`).run('2026-11-08T00:00:02.000Z');
    const changes = d.outbox().map((r) => toPushChange(r as never));
    expect(changes.map((c) => [c.entity_type, c.entity_id, c.op, c.fields])).toEqual([
      ['exercise', BENCH, 'update', { hidden: true }],
      ['setting', 'weight_unit', 'create', { value: 'lb' }],
      ['setting', 'weight_unit', 'delete', undefined],
      ['setting', 'weight_unit', 'restore', undefined],
      ['setting', 'weight_unit', 'update', { value: 'kg' }],
    ]);
    expect(changes.every((c) => c.origin === 'app' && !('fields' in c && c.fields === undefined))).toBe(true);
  });

  test('値が変わらない書き込み（updated_at だけ）は積まない', async () => {
    const d = await device();
    const id = await d.r.workouts.saveEntry({ date: '2026-11-08', exerciseId: BENCH, sets: sets([80, 8]) });
    const before = d.outbox().length;
    const entry = (await d.r.workouts.getEntry(id))!;
    d.deps.advance(1000);
    await d.r.workouts.saveEntry({ id, date: '2026-11-08', exerciseId: BENCH, sets: entry.sets });
    expect(d.outbox()).toHaveLength(before);
  });
});

describe('マイグレーション：ログインの前の記録も、最初の同期で送る', () => {
  test('版1で作った記録を、版2で outbox に積む（初期のものは変えた項目だけ、消したものは積まない）', async () => {
    const db = memoryDb();
    const deps = testDeps();
    await db.withTransactionAsync(async () => {
      await MIGRATIONS[0].up(db, deps.now().toISOString());
      await db.execAsync('PRAGMA user_version = 1');
    });
    const r = repos(db, deps);
    deps.advance(60_000);
    // 版1の表には割合の列（版8）がないので、種目は SQL で足す（catalog.createExercise は今の表に書く）
    const exId = 'bulgarian';
    await db.runAsync(
      `INSERT INTO exercises (id, body_part_id, name, record_type, sort_order, hidden, created_at, updated_at)
       VALUES (?, ?, 'ブルガリアンスクワット', 'weight_reps', 5, 0, ?, ?)`, [exId, SEED_BODY_PARTS[3].id, deps.now().toISOString(), deps.now().toISOString()],
    );
    const keep = await r.workouts.saveEntry({ date: '2026-11-01', exerciseId: exId, sets: sets([40, 10]) });
    const gone = await r.workouts.saveEntry({ date: '2026-11-01', exerciseId: SQUAT, sets: sets([100, 5]) });
    await r.workouts.deleteEntry(gone);
    await r.catalog.setExerciseHidden(BENCH, true);
    await r.body.saveManual('2026-11-01', { weightKg: 70.5 });
    await r.settings.update({ heightCm: 172 });

    await migrate(db, deps.now);
    const rows = db.raw.prepare('SELECT entity_type, entity_id, op, fields, changed_at FROM sync_outbox ORDER BY seq').all() as {
      entity_type: string; entity_id: string; op: string; fields: string; changed_at: string;
    }[];
    expect(rows.map((x) => [x.entity_type, x.op])).toEqual([
      ['exercise', 'update'], ['exercise', 'create'], ['workout_entry', 'create'], ['workout_set', 'create'],
      ['body_record', 'create'], ['setting', 'create'],
    ]);
    expect(JSON.parse(rows[0].fields)).toEqual({ hidden: 1 });
    expect(rows[0].entity_id).toBe(BENCH);
    expect(rows[2].entity_id).toBe(keep);
    expect(JSON.parse(rows[4].fields)).toMatchObject({ weight_kg: 70.5, source: 'manual', memo: '' });
    expect(rows.every((x) => x.changed_at === '2026-11-08T00:01:00.000Z')).toBe(true);

    // そのあとの書き込みは、トリガーが積む
    await r.settings.update({ heightCm: 173 });
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM sync_outbox').get()).toEqual({ n: 7 });
  });
});

describe('同期の1回分（送る → 受け取る → 当てはめる）', () => {
  test('端末の記録を送り、サーバーに同じ記録ができる。outbox は空になる', async () => {
    const d = await device();
    const id = await d.r.workouts.saveEntry({ date: '2026-11-08', exerciseId: BENCH, sets: sets([80, 8], [85, 5]) });
    await d.r.body.saveManual('2026-11-08', { weightKg: 70.2, bodyFatPct: 18 });
    const out = await d.engine.run();
    expect(out).toMatchObject({ ok: true, sent: 4, rejected: 0 });
    expect(d.outbox()).toEqual([]);
    expect(d.server.state('workout_entry', id)?.fields).toEqual({ date: '2026-11-08', exercise_id: BENCH, sort_order: 0 });
    const setStates = d.server.states('workout_set').map((s) => s.fields);
    expect(setStates).toEqual(expect.arrayContaining([expect.objectContaining({ entry_id: id, weight_kg: 80, reps: 8, done: false })]));
    expect(await d.store.getMeta('last_synced_at')).toBe('2026-11-08T00:00:00.000Z');
    // 送った本文には、ログインの情報や利用者の ID を入れない
    const push = d.server.requests.find((q) => q.method === 'POST')!;
    expect(Object.keys(push.body as object).sort()).toEqual(['changes', 'device_id']);
  });

  test('25件ずつ、本文が上限を超えないように分けて送る', async () => {
    const d = await device();
    const memo = 'あ'.repeat(1000);
    for (let i = 0; i < 3; i++) {
      await d.r.workouts.saveEntry({
        date: `2026-11-0${i + 1}`, exerciseId: BENCH,
        sets: Array.from({ length: 10 }, () => ({ weightKg: 60, reps: 10, memo, done: false })),
      });
    }
    expect(d.outbox()).toHaveLength(33);
    expect(await d.engine.run()).toMatchObject({ ok: true, sent: 33 });
    const pushes = d.server.requests.filter((q) => q.method === 'POST');
    for (const p of pushes) {
      const body = p.body as { changes: unknown[] };
      expect(body.changes.length).toBeLessThanOrEqual(25);
      expect(utf8Length(JSON.stringify(body))).toBeLessThanOrEqual(MAX_PUSH_BYTES);
    }
    // 1件 3KB ほどなので、25件は入らない
    expect((pushes[0].body as { changes: unknown[] }).changes.length).toBeLessThan(25);
    expect(d.server.states('workout_set')).toHaveLength(30);
  });

  test('応答を受け取れなかったら、同じ change_id のまま送り直す。2回目は duplicate で、二重にならない', async () => {
    const d = await device();
    await d.r.body.saveManual('2026-11-08', { weightKg: 70 });
    d.server.fail.next = (method, url, body) => {
      d.server.fail.next = undefined;
      d.server.handle(method, url, body); // サーバーは受け付けたが、返事が届かない
      return new TypeError('Network request failed');
    };
    expect(await d.engine.run()).toEqual({ ok: false, error: 'network', retry: true });
    expect(d.outbox()).toHaveLength(1);
    expect(d.server.log).toHaveLength(1);
    expect(await d.engine.run()).toMatchObject({ ok: true, sent: 1 });
    expect(d.server.log).toHaveLength(1);
    expect(d.outbox()).toEqual([]);
  });

  test('サーバーが断った変更は印を付けて飛ばし、ほかは送る。本文ごと断られたら1件ずつ送って、悪いものだけを飛ばす', async () => {
    const d = await device();
    await d.r.settings.update({ weightUnit: 'lb' });
    await d.r.settings.update({ heightCm: 170 });
    await d.r.settings.update({ goalWeightKg: 65 });
    const [first, second] = d.outbox().map((r) => r.change_id as string);
    d.server.fail.next = (method, url, body) => {
      if (method !== 'POST') return undefined;
      const changes = (body as { changes: { change_id: string }[] }).changes;
      if (changes.some((c) => c.change_id === first)) return { status: 413, body: {} };
      if (changes.some((c) => c.change_id === second)) {
        const rest = changes.filter((c) => c.change_id !== second);
        const results = rest.length ? (d.server.handle(method, url, { ...(body as object), changes: rest }).body as { results: unknown[] }).results : [];
        return { status: 200, body: { results: [{ change_id: second, status: 'rejected', seq: null, error: { code: 'invalid_fields', message: 'x' } }, ...results], cursor: 0 } };
      }
      return undefined;
    };
    expect(await d.engine.run()).toMatchObject({ ok: true, sent: 1, rejected: 2 });
    expect(await d.store.counts()).toEqual({ pending: 0, rejected: 2 });
    expect(d.outbox().map((r) => [r.status, r.error_code])).toEqual([['rejected', 'http_413'], ['rejected', 'invalid_fields']]);
    expect(d.server.state('setting', 'goal_weight_kg')?.fields).toEqual({ value: '65' });
    // 次の同期では、断られたものは送らない
    d.server.fail.next = undefined;
    const before = d.server.requests.length;
    await d.engine.run();
    expect(d.server.requests.slice(before).some((q) => q.method === 'POST')).toBe(false);
  });

  test('401 はログインの層に任せる（やり直さない）。つながらない・混んでいる・サーバーの不具合はやり直す', async () => {
    const d = await device();
    await d.r.settings.update({ weightUnit: 'lb' });
    for (const [status, error, retry] of [[401, 'signedOut', false], [429, 'throttled', true], [503, 'server', true], [403, 'forbidden', true]] as const) {
      d.server.fail.next = () => ({ status, body: {} });
      expect(await d.engine.run()).toEqual({ ok: false, error, retry });
      expect(d.outbox()).toHaveLength(1);
    }
  });

  test('MCP で記録したものを受け取り、端末に出る（初めての端末はスナップショットから）', async () => {
    const server = createFakeSyncServer({ clock: () => '2026-11-08T03:00:00.000Z' });
    server.append([
      mcp('workout_entry', 'e-mcp', 'create', { date: '2026-11-08', exercise_id: BENCH, sort_order: 0 }),
      mcp('workout_set', 's-mcp-1', 'create', { entry_id: 'e-mcp', set_index: 0, weight_kg: 100, reps: 3, memo: '', done: false }),
      mcp('body_record', 'b-mcp', 'create', { date: '2026-11-08', measured_at: '2026-11-08T03:00:00.000Z', weight_kg: 71.5, body_fat_pct: null, muscle_pct: null, waist_cm: null, memo: '', source: 'manual' }),
      mcp('exercise', SQUAT, 'update', { hidden: true }),
    ]);
    const d = await device(server);
    expect(await d.engine.run()).toMatchObject({ ok: true, applied: 4 });
    expect(server.requests.map((q) => q.path)).toEqual(['/v1/sync/snapshot?limit=500', '/v1/sync/changes?after=4&limit=500']);
    const [entry] = await d.r.workouts.getDay('2026-11-08');
    expect([entry.exerciseName, entry.sets.map((s) => [s.weightKg, s.reps])]).toEqual(['ベンチプレス', [[100, 3]]]);
    expect((await d.r.body.getDay('2026-11-08'))?.weightKg).toBe(71.5);
    expect((await d.r.catalog.listExercises()).some((e) => e.id === SQUAT)).toBe(false);
    // 当てはめたものは outbox に積まない（送り返さない）
    expect(d.outbox()).toEqual([]);

    // 2回目からは、続きの変更だけ
    server.append([mcp('workout_set', 's-mcp-1', 'update', { reps: 4 })]);
    expect(await d.engine.run()).toMatchObject({ ok: true, applied: 1 });
    expect((await d.r.workouts.getDay('2026-11-08'))[0].sets[0].reps).toBe(4);
    expect(server.requests.at(-1)!.path).toBe('/v1/sync/changes?after=4&limit=500');
  });

  test('子が親より先に届いても、親が届いたら当てはめる。消された記録は作らない', async () => {
    const server = createFakeSyncServer({ clock: () => '2026-11-08T03:00:00.000Z' });
    const d = await device(server);
    await d.engine.run(); // スナップショットを済ませる
    server.append([mcp('workout_set', 's1', 'create', { entry_id: 'e1', set_index: 0, weight_kg: 50, reps: 10, memo: '', done: false })]);
    await d.engine.run();
    expect(d.db.raw.prepare('SELECT COUNT(*) AS n FROM workout_sets').get()).toEqual({ n: 0 });
    server.append([mcp('workout_entry', 'e1', 'create', { date: '2026-11-07', exercise_id: BENCH, sort_order: 0 })]);
    server.append([mcp('workout_set', 'x', 'update', { reps: 1 }), mcp('workout_set', 'x', 'delete')]);
    await d.engine.run();
    expect((await d.r.workouts.getDay('2026-11-07'))[0].sets.map((s) => s.reps)).toEqual([10]);
    expect(d.db.raw.prepare('SELECT COUNT(*) AS n FROM sync_held').get()).toEqual({ n: 0 });
  });

  test('受け取るあいだに端末で変えた項目は、サーバーの状態で上書きせずに残し、次に送る', async () => {
    const server = createFakeSyncServer({ clock: () => '2026-11-08T03:00:00.000Z' });
    const d = await device(server);
    await d.r.body.saveManual('2026-11-08', { weightKg: 70, memo: '朝' });
    await d.engine.run();
    const id = (d.db.raw.prepare('SELECT id FROM body_records').get() as { id: string }).id;
    server.append([mcp('body_record', id, 'update', { weight_kg: 69, memo: 'MCP' })]);
    // 受け取りの返事が届く前に、端末でメモを変える
    d.server.fail.next = (method, url) => {
      if (method === 'GET') {
        d.server.fail.next = undefined;
        d.db.raw.prepare('UPDATE body_records SET memo = ?, updated_at = ? WHERE id = ?').run('端末', '2026-11-08T03:30:00.000Z', id);
      }
      return undefined;
    };
    await d.engine.run();
    expect(await d.r.body.getDay('2026-11-08')).toMatchObject({ weightKg: 69, memo: '端末' });
    expect(d.outbox().map((r) => [r.op, JSON.parse(r.fields as string)])).toEqual([['update', { memo: '端末' }]]);
    await d.engine.run();
    expect(server.state('body_record', id)?.fields).toMatchObject({ weight_kg: 69, memo: '端末' });
  });

  test('食事の変更も当てはめる（品目が食事より先に届いたら、食事が届くまで取っておく）', async () => {
    const server = createFakeSyncServer({ clock: () => '2026-11-08T03:00:00.000Z' });
    const d = await device(server);
    await d.engine.run();
    server.append([
      { ...mcp('meal_item', 'i1', 'create', {
        name: '白米', amount: 200, unit: 'g', kcal: 312, protein_g: 5, fat_g: 0.6, carbs_g: 74, confidence: 'medium', sort_order: 0,
      }), parent_id: 'm1' },
    ]);
    await d.engine.run();
    expect(d.db.raw.prepare('SELECT COUNT(*) AS n FROM sync_held').get()).toEqual({ n: 1 });
    server.append([mcp('meal', 'm1', 'create', { date: '2026-11-08', slot: 'lunch', time: null, description: '', source: 'text' })]);
    await d.engine.run();
    expect(d.db.raw.prepare('SELECT COUNT(*) AS n FROM sync_held').get()).toEqual({ n: 0 });
    expect((await d.r.meals.listDay('2026-11-08')).map((m) => [m.id, m.items.map((i) => [i.id, i.kcal])])).toEqual([['m1', [['i1', 312]]]]);
  });

  test('ほかの端末の記録も、同じサーバーを通して届く（初期の種目を隠したのも）', async () => {
    const server = createFakeSyncServer({ clock: () => '2026-11-08T03:00:00.000Z' });
    const a = await device(server);
    const b = await device(server);
    await a.r.catalog.setExerciseHidden(BENCH, true);
    const id = await a.r.workouts.saveEntry({ date: '2026-11-08', exerciseId: SQUAT, sets: sets([120, 3]) });
    await a.engine.run();
    await b.engine.run();
    expect((await b.r.workouts.getEntry(id))?.sets.map((s) => [s.weightKg, s.reps])).toEqual([[120, 3]]);
    expect((await b.r.catalog.listExercises()).some((e) => e.id === BENCH)).toBe(false);
    expect((await b.r.catalog.listBodyParts()).map((p) => p.id)).toContain(CHEST);
  });
});

describe('別のアカウントでログインし直したとき（docs/sync-design.md の「アカウントが変わったとき」）', () => {
  /** 新しいアカウント（user-b）のサーバーにつなぐ同期 */
  const engineFor = (d: Awaited<ReturnType<typeof device>>, server: ReturnType<typeof createFakeSyncServer>) => createSyncEngine({
    store: d.store, now: d.deps.now,
    api: createApiClient({ baseUrl: 'https://api.example.test', getAccessToken: async () => fakeAccessToken('user-b'), fetch: server.fetch }),
  });

  test('初めて同期したアカウントを覚え、同じアカウントなら今までどおり同期する（ログアウトしてもそのまま）', async () => {
    const d = await device();
    expect(await d.store.account()).toBeNull();
    expect(await d.engine.run()).toMatchObject({ ok: true });
    expect(await d.store.account()).toBe('user-a');
    await d.r.settings.update({ weightUnit: 'lb' });
    expect(await d.engine.run()).toMatchObject({ ok: true, sent: 1 });
  });

  test('違うアカウントなら、送らず受け取らずに止める。送っていない変更と受け取りの位置は残す', async () => {
    const d = await device();
    await d.r.settings.update({ weightUnit: 'lb' });
    await d.engine.run();
    await d.r.body.saveManual('2026-11-08', { weightKg: 70 });
    const cursor = await d.store.getMeta('cursor');
    const before = d.server.requests.length;
    d.login.sub = 'user-b';
    expect(await d.engine.run()).toEqual({ ok: false, error: 'accountChanged', retry: false });
    expect(await d.engine.run()).toEqual({ ok: false, error: 'accountChanged', retry: false });
    expect(d.server.requests.length).toBe(before);
    expect(d.outbox()).toHaveLength(1);
    expect(await d.store.getMeta('cursor')).toBe(cursor);
    expect(await d.store.account()).toBe('user-a');
    // 前のアカウントに戻れば、続きから同期する
    d.login.sub = 'user-a';
    expect(await d.engine.run()).toMatchObject({ ok: true, sent: 1 });
  });

  test('「新しいアカウントに送る」：端末の今の記録（前のアカウントから受け取ったものも）を送り、新しいアカウントの記録を受け取る', async () => {
    const serverA = createFakeSyncServer({ clock: () => '2026-11-08T03:00:00.000Z' });
    serverA.append([mcp('body_record', 'b-mcp', 'create', { date: '2026-11-07', measured_at: '2026-11-07T03:00:00.000Z', weight_kg: 71.5, memo: '', source: 'manual' })]);
    const d = await device(serverA);
    const id = await d.r.workouts.saveEntry({ date: '2026-11-08', exerciseId: BENCH, sets: sets([80, 8]) });
    await d.engine.run();
    await d.r.settings.update({ weightUnit: 'lb' }); // 前のアカウントに送っていない変更

    const serverB = createFakeSyncServer({ clock: () => '2026-11-08T04:00:00.000Z' });
    serverB.append([mcp('body_record', 'b-other', 'create', { date: '2026-11-06', measured_at: '2026-11-06T03:00:00.000Z', weight_kg: 60, memo: '', source: 'manual' })]);
    await d.store.switchAccount('user-b', 'send', '2026-11-08T05:00:00.000Z');
    expect(await d.store.account()).toBe('user-b');
    expect(await d.store.getMeta('cursor')).toBeNull();
    // 初期の部位と種目は送らない（変えていないので）
    expect(d.outbox().map((o) => o.entity_type).sort()).toEqual(['body_record', 'setting', 'workout_entry', 'workout_set']);

    expect(await engineFor(d, serverB).run()).toMatchObject({ ok: true, sent: 4 });
    expect(serverB.state('workout_entry', id)?.fields.exercise_id).toBe(BENCH);
    expect(serverB.state('body_record', 'b-mcp')?.fields.weight_kg).toBe(71.5);
    expect((await d.r.body.getDay('2026-11-06'))?.weightKg).toBe(60);
    expect(await d.store.getMeta('cursor')).toBe(String(serverB.head));
    // 前のアカウントのサーバーには、何も足さない
    expect(serverA.states('setting')).toEqual([]);
  });

  test('「消して受け取り直す」：端末の記録と送っていない変更を消し、新しいアカウントの記録だけにする（初期の種目は残す）', async () => {
    const d = await device();
    await d.r.workouts.saveEntry({ date: '2026-11-08', exerciseId: BENCH, sets: sets([80, 8]) });
    await d.engine.run();
    await d.r.body.saveManual('2026-11-08', { weightKg: 70 });
    await d.r.settings.update({ weightUnit: 'lb' });
    await d.r.settings.setProfile({ sex: 'male', birthYear: 1990 });
    await d.r.settings.setAutoGoalWeight(70);
    await d.r.settings.setAccountProfile({ displayName: 'たろう', photoUri: 'file:///data/profile/photo-1.jpg' });

    const serverB = createFakeSyncServer({ clock: () => '2026-11-08T04:00:00.000Z' });
    serverB.append([
      mcp('workout_entry', 'e-b', 'create', { date: '2026-11-07', exercise_id: SQUAT, sort_order: 0 }),
      mcp('workout_set', 's-b', 'create', { entry_id: 'e-b', set_index: 0, weight_kg: 100, reps: 5, memo: '', done: false }),
    ]);
    await d.store.switchAccount('user-b', 'replace', '2026-11-08T05:00:00.000Z');
    expect(d.outbox()).toEqual([]);
    expect(await d.r.workouts.getDay('2026-11-08')).toEqual([]);
    expect(await d.r.body.getDay('2026-11-08')).toBeNull();
    expect((await d.r.settings.get()).weightUnit).toBe('kg');
    expect(await d.r.settings.profile()).toEqual({ sex: null, birthYear: null });
    expect(await d.r.settings.autoGoalWeight()).toBeNull();
    // 表示名と写真は端末の持ち主のものなので残す
    expect(await d.r.settings.accountProfile()).toEqual({ displayName: 'たろう', photoUri: 'file:///data/profile/photo-1.jpg' });
    expect((await d.r.catalog.listExercises()).length).toBe(SEED_EXERCISES.length);

    expect(await engineFor(d, serverB).run()).toMatchObject({ ok: true, sent: 0, applied: 2 });
    expect(serverB.requests.some((q) => q.method === 'POST')).toBe(false);
    const [entry] = await d.r.workouts.getDay('2026-11-07');
    expect([entry.exerciseName, entry.sets.map((s) => [s.weightKg, s.reps])]).toEqual(['スクワット', [[100, 5]]]);
  });
});

function mcp(entityType: string, entityId: string, op: 'create' | 'update' | 'delete', fields?: Record<string, unknown>) {
  return {
    change_id: `${Math.random().toString(16).slice(2).padEnd(8, '0').slice(0, 8)}-0000-4000-8000-${String(Date.now()).padStart(12, '0').slice(-12)}`,
    entity_type: entityType, entity_id: entityId, parent_id: null, op, fields: fields ?? null,
    changed_at: '2026-11-08T03:00:00.000Z', origin: 'mcp' as const, device_id: null,
  };
}
