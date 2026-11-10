// サーバー（services/training/tests）と同じテストのデータ（testdata/sync/*.json）で、同期を確かめる。
// - conflicts.json：衝突の決まり。偽のサーバーと、端末を通したもの（端末で変えて送り、受け取った状態）の両方で、サーバーと同じ結果になる
// - app_push.json：アプリが送る本文。ここで作ったものと同じであることを確かめ、サーバーの pytest がそれを本物の API に送って、MCP から見えることを確かめる
// - mcp_pull.json：MCP で記録したあとにサーバーが返す受け取りのページ（pytest が本物のサーバーで作ったもの）。端末に当てはめて、画面のリポジトリから見えることを確かめる
// 作り直すとき：UPDATE_TESTDATA=1 npx jest db/__tests__/sync-shared.test.ts（mcp_pull.json は pytest 側で作る）
import * as fs from 'fs';
import * as path from 'path';
import { healthConnectStore } from '../repositories/healthConnect';
import { SEED_EXERCISES } from '../seed';
import { SPEC_BY_TYPE, SyncType, toApiFields, toDbFields } from '../syncSpec';
import type { Bind } from '../types';
import { importHealthConnect } from '@/lib/healthConnect/importer';
import { fakeHealthConnect as hc, heartRate, restingHeartRate, sleep, weight } from '@/test-utils/fakeHealthConnect';
import { createFakeSyncServer, Origin } from '@/test-utils/fakeSyncServer';
import { Device, device } from '@/test-utils/syncHarness';

jest.mock('react-native-health-connect', () => require('@/test-utils/fakeHealthConnect').module);

const DIR = path.join(__dirname, '..', '..', '..', '..', 'testdata', 'sync');
const load = (name: string) => JSON.parse(fs.readFileSync(path.join(DIR, name), 'utf8'));

type CaseChange = {
  origin: Origin; op: 'create' | 'update' | 'delete' | 'restore'; entity_type: string; entity_id: string;
  fields?: Record<string, unknown>; changed_at: string; received_at: string;
};
type Case = {
  name: string;
  changes: CaseChange[];
  expected: { entity_type: string; entity_id: string; fields: Record<string, unknown>; deleted: boolean }[];
};
const cases: Case[] = load('conflicts.json').cases;

const serverChange = (c: CaseChange) => ({
  change_id: crypto.randomUUID(), entity_type: c.entity_type, entity_id: c.entity_id, parent_id: null, op: c.op,
  fields: c.fields ?? null, changed_at: c.origin === 'mcp' ? c.received_at : c.changed_at, origin: c.origin, device_id: null,
});

describe('conflicts.json：偽のサーバー', () => {
  test.each(cases)('$name', ({ changes, expected }) => {
    const server = createFakeSyncServer();
    for (const c of changes) {
      server.setClock(() => c.received_at);
      server.append([serverChange(c)]);
    }
    for (const e of expected) {
      const s = server.state(e.entity_type, e.entity_id)!;
      expect({ fields: s.fields, deleted: s.deleted }).toEqual({ fields: e.fields, deleted: e.deleted });
    }
  });
});

/**
 * 端末の表を、画面の書き込みと同じように直接変える（トリガーが outbox に積む）。
 * 取り込み（import）は、取り込みと同じく sync_meta に importing を置いて書く（origin = import で積まれる）
 */
function localWrite(d: Device, c: CaseChange) {
  const spec = SPEC_BY_TYPE.get(c.entity_type as SyncType)!;
  const values = toDbFields(spec, c.fields ?? {});
  const cols = Object.keys(values);
  const run = (sql: string, params: Bind[]) => d.db.raw.prepare(sql).run(...params);
  if (c.origin === 'import') {
    run(`INSERT INTO sync_meta (key, value) VALUES ('importing', '1')`, []);
    try {
      localWrite(d, { ...c, origin: 'app' });
    } finally {
      run(`DELETE FROM sync_meta WHERE key = 'importing'`, []);
    }
    return;
  }
  if (c.op === 'create') {
    run(`INSERT INTO ${spec.table} (id, ${cols.join(', ')}, created_at, updated_at) VALUES (?, ${cols.map(() => '?').join(', ')}, ?, ?)`,
      [c.entity_id, ...cols.map((k) => values[k]), c.changed_at, c.changed_at]);
  } else if (c.op === 'update') {
    run(`UPDATE ${spec.table} SET ${cols.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
      [...cols.map((k) => values[k]), c.changed_at, c.entity_id]);
  } else {
    run(`UPDATE ${spec.table} SET deleted_at = ?, updated_at = ? WHERE id = ?`,
      [c.op === 'delete' ? c.changed_at : null, c.changed_at, c.entity_id]);
  }
}

describe('conflicts.json：端末を通す（端末の変更と取り込みは端末で記録して送り、MCP は直接サーバーへ。最後に受け取った端末の表がサーバーと同じ）', () => {
  test.each(cases)('$name', async ({ changes, expected }) => {
    const server = createFakeSyncServer();
    const d = await device(server);
    await d.engine.run();
    for (let i = 0; i < changes.length;) {
      const c = changes[i];
      server.setClock(() => c.received_at);
      // 端末に行がある記録の取り込みの create（消した記録をもう一度取り込む）は、端末の取り込みは書かないので（消した行は戻さない）、
      // ほかの端末の取り込みとして直接サーバーへ送る
      const exists = (x: CaseChange) => d.db.raw.prepare(`SELECT 1 FROM ${SPEC_BY_TYPE.get(x.entity_type as SyncType)!.table} WHERE id = ?`).get(x.entity_id);
      const local = (x: CaseChange) => x.origin === 'app' || (x.origin === 'import' && !(x.op === 'create' && exists(x)));
      if (!local(c)) {
        server.append([serverChange(c)]);
        i++;
        continue;
      }
      // 同じ時刻に届いた端末の変更は、つながらないあいだにまとめて記録したもの。記録する前に、それまでの変更を受け取る
      expect(await d.engine.run()).toMatchObject({ ok: true, sent: 0 });
      for (; i < changes.length && local(changes[i]) && changes[i].received_at === c.received_at; i++) localWrite(d, changes[i]);
      expect(await d.engine.run()).toMatchObject({ ok: true, rejected: 0 });
    }
    await d.engine.run();
    expect(d.outbox()).toEqual([]);
    for (const e of expected) {
      const spec = SPEC_BY_TYPE.get(e.entity_type as SyncType)!;
      const row = d.db.raw.prepare(`SELECT * FROM ${spec.table} WHERE id = ?`).get(e.entity_id) as Record<string, Bind>;
      const fields = toApiFields(spec, Object.fromEntries(Object.keys(e.fields).map((k) => [k, row[k]])));
      expect({ fields, deleted: row.deleted_at != null }).toEqual({ fields: e.fields, deleted: e.deleted });
    }
  });
});

const BENCH = SEED_EXERCISES[0].id;
const PULLUP = SEED_EXERCISES.find((e) => e.name === '懸垂')!.id;
const SQUAT = SEED_EXERCISES.find((e) => e.name === 'スクワット')!.id;
const LEGS = SEED_EXERCISES.find((e) => e.name === 'スクワット')!.bodyPartId;

/** アプリで記録して送った本文（change_id と device_id は毎回変わるので置き換える） */
async function appPushes() {
  const server = createFakeSyncServer({ clock: () => '2026-11-08T03:00:00.000Z' });
  const d = await device(server, '2026-11-08T03:00:00.000Z');
  await d.r.workouts.saveEntry({
    date: '2026-11-08', exerciseId: BENCH,
    sets: [{ weightKg: 80, reps: 8, memo: '', done: true }, { weightKg: 82.5, reps: 6, memo: '最後は補助あり', done: false }],
  });
  await d.r.workouts.saveEntry({ date: '2026-11-08', exerciseId: PULLUP, sets: [{ weightKg: null, reps: 10, memo: '', done: true }] });
  // スクワットの代わりに BIG3 のスクワットにする（名前で決めていたベンチプレス・デッドリフトの役も保存して送る）。フォームの動画のリンクも
  const custom = await d.r.catalog.createExercise({
    name: 'ブルガリアンスクワット', bodyPartId: LEGS, recordType: 'weight_reps', big3: 'squat', formVideoUrl: 'https://youtu.be/bss',
  });
  await d.r.workouts.saveEntry({ date: '2026-11-08', exerciseId: custom, sets: [{ weightKg: 20, reps: 12, memo: '', done: false }] });
  await d.r.catalog.setExerciseHidden(SQUAT, true);
  await d.r.body.saveManual('2026-11-08', { weightKg: 70.4, bodyFatPct: 18.2 });
  await d.r.settings.update({ weightUnit: 'lb', heightCm: 172 });
  // Health Connect の取り込み（origin = import）：11/7 の体重計、11/8 の手入力よりあとの体重計（手入力が先）、11/8 に起きた睡眠
  hc.reset();
  d.deps.advance(3_600_000);
  hc.put(weight('hc-w1', '2026-11-06T22:00:00Z', 70.1));
  hc.put(weight('hc-w2', '2026-11-08T03:30:00Z', 69.9));
  hc.put(sleep('hc-s1', '2026-11-07T14:40:00Z', '2026-11-07T21:55:00Z', [['2026-11-07T18:00:00Z', '2026-11-07T18:15:00Z', 1]]));
  // 心拍：11/7 のサンプル3つと安静時心拍（日のまとめだけを送る。日付は端末の暦なので、どの時差でも同じ日になる時刻にする）
  hc.put(heartRate('hc-h1', [['2026-11-07T03:00:00Z', 62], ['2026-11-07T03:10:00Z', 88], ['2026-11-07T09:00:00Z', 131]]));
  hc.put(restingHeartRate('hc-r1', '2026-11-07T01:00:00Z', 54));
  await importHealthConnect(healthConnectStore(d.db, d.deps), d.deps.now);
  expect(await d.engine.run()).toMatchObject({ ok: true, rejected: 0 });
  return server.requests.filter((q) => q.method === 'POST').map((q) => {
    const body = q.body as { device_id: string; changes: { change_id: string }[] };
    return { device_id: '<device_id>', changes: body.changes.map((c) => ({ ...c, change_id: '<change_id>' })) };
  });
}

describe('app_push.json：アプリが送る本文（サーバーの pytest が本物の API に送り、MCP から見えることを確かめる）', () => {
  test('同じ本文になる', async () => {
    const pushes = await appPushes();
    if (process.env.UPDATE_TESTDATA) {
      fs.writeFileSync(path.join(DIR, 'app_push.json'), `${JSON.stringify({
        description: 'アプリで記録した筋トレ・種目・体組成・設定と、Health Connect から取り込んだ体重・睡眠・心拍の日のまとめを送る本文（apps/mobile/db/__tests__/sync-shared.test.ts が作る）。'
          + 'services/training/tests/test_app_sync.py が change_id を UUID にして本物の API に送り、MCP のツールから見えることを確かめる。',
        pushes,
      }, null, 2)}\n`);
    }
    expect(pushes).toEqual(load('app_push.json').pushes);
  });
});

describe('mcp_pull.json：MCP で記録したもの（サーバーの pytest が作った受け取りのページ）が端末に出る', () => {
  test('筋トレと体組成が、画面のリポジトリから見える', async () => {
    const page = load('mcp_pull.json').page;
    const server = createFakeSyncServer();
    // スナップショットは空、変更は mcp_pull.json のページを返す
    server.fail.next = (method, url) => {
      const u = new URL(url);
      if (u.pathname === '/v1/sync/snapshot') return { status: 200, body: { states: [], cursor: 0, next_page_token: null } };
      if (u.pathname === '/v1/sync/changes' && u.searchParams.get('after') === '0') return { status: 200, body: page };
      return { status: 200, body: { entries: [], next_cursor: page.next_cursor, has_more: false } };
    };
    const d = await device(server);
    expect(await d.engine.run()).toMatchObject({ ok: true });
    const day = await d.r.workouts.getDay('2026-11-07');
    expect(day.map((e) => [e.exerciseName, e.sets.map((s) => [s.weightKg, s.reps])])).toEqual([
      ['ベンチプレス', [[100, 5], [100, 4]]],
      ['懸垂', [[null, 12]]],
    ]);
    expect(await d.r.body.getDay('2026-11-07')).toMatchObject({ weightKg: 71.3, bodyFatPct: 17.5 });
    expect(d.outbox()).toEqual([]);
  });
});
