import { createApiClient } from '@/lib/api';
import { createSyncEngine } from '@/lib/sync/engine';
import { createFakeSyncServer } from '@/test-utils/fakeSyncServer';
import { fakeAccessToken } from '@/test-utils/fakeToken';
import { outbox, setup } from '@/test-utils/nodeDb';
import { syncStore, toPushChange } from '../repositories/sync';
import { expressionTagId } from '../repositories/words';
import { SEED_SOURCES, SEED_TAGS } from '../seed';
import { ENRICH_FIELDS, ENTITIES, SCHEDULE_FIELDS, sendableOf } from '../syncSpec';

const AUDIBLE = SEED_SOURCES[0].id;
const CHEER = SEED_TAGS[0].id;

describe('種類の対応（docs/words-design.md の API の約束）', () => {
  it('7つの種類を、親が先の順で持つ（サーバーの ENTITY_TYPES と同じ種類）', () => {
    expect(ENTITIES.map((s) => s.type)).toEqual(['source', 'tag', 'expression', 'expression_tag', 'encounter', 'usage', 'listen_session']);
  });

  it('補った項目（意味・ニュアンス・言い換え・役立ち度）はアプリから送らない。例文は本人も書くので送る', () => {
    const expr = ENTITIES.find((s) => s.type === 'expression')!;
    for (const f of ENRICH_FIELDS) {
      expect(expr.columns[f]).toBeDefined();
      expect(sendableOf(expr)).not.toContain(f);
    }
    expect(sendableOf(expr)).toEqual(expect.arrayContaining(['text', 'scene', 'note', 'use_note', 'star', 'reading', 'register', 'register_by', 'examples', ...SCHEDULE_FIELDS]));
  });

  it('場所とタグは消さずに隠す（delete を送らない）。使えたと聞いたは追記だけ（create と delete）', () => {
    const ops = Object.fromEntries(ENTITIES.map((s) => [s.type, s.ops ?? 'all']));
    expect(ops).toEqual({
      source: ['create', 'update', 'restore'], tag: ['create', 'update', 'restore'], expression: 'all', expression_tag: 'all', encounter: 'all',
      usage: ['create', 'delete'], listen_session: ['create', 'delete'],
    });
  });
});

describe('outbox に積むもの', () => {
  it('拾うと、表現・出会い・タグのつながりを create で積む（補った項目は入れない。真偽値は true/false で送る）', async () => {
    const { db, repos } = await setup();
    const { id } = await repos.words.capture({ text: '肩の荷が下りる', sourceId: AUDIBLE, tagIds: [CHEER] });
    const rows = await outbox(db);
    expect(rows.map((r) => [r.entity_type, r.op])).toEqual([['expression', 'create'], ['encounter', 'create'], ['expression_tag', 'create']]);
    const expr = rows[0].fields!;
    expect(expr).toMatchObject({ text: '肩の荷が下りる', normalized_key: '肩の荷が下りる', place: 'collected', source_id: AUDIBLE, star: 0, interval_days: 1 });
    for (const f of ENRICH_FIELDS) expect(expr).not.toHaveProperty(f);
    expect(expr).not.toHaveProperty('search_key');
    expect(rows[2]).toMatchObject({ entity_id: expressionTagId(id, CHEER), fields: { expression_id: id, tag_id: CHEER, added_by: 'user', status: 'confirmed' } });
    const pushed = toPushChange((await syncStore(db).pending(1))[0]);
    expect(pushed).toMatchObject({ entity_type: 'expression', op: 'create', origin: 'app', fields: { star: false } });
  });

  it('間隔の項目は、1つ変わっても組で送る。使えたは usage を create で積む', async () => {
    const { db, repos } = await setup();
    const { id } = await repos.words.capture({ text: '腑に落ちる', sourceId: null });
    await db.runAsync('DELETE FROM sync_outbox', []);
    await repos.words.recordUse(id); // 拾ったにあるので、回数と日だけが変わる
    const [upd, usage] = await outbox(db);
    expect(upd.op).toBe('update');
    expect(Object.keys(upd.fields!).sort()).toEqual([...SCHEDULE_FIELDS].sort());
    expect(upd.fields).toMatchObject({ use_count: 1, last_used_on: '2026-11-18', stage: null });
    expect(usage).toMatchObject({ entity_type: 'usage', op: 'create', fields: { expression_id: id, used_on: '2026-11-18', scene: '', note: '' } });
  });

  it('手札に入れると、置き場所の組と間隔の組を一緒に送る（手札なら段階あり、ほかは null）', async () => {
    const { db, repos } = await setup();
    const { id } = await repos.words.capture({ text: '腑に落ちる', sourceId: null });
    await db.runAsync('DELETE FROM sync_outbox', []);
    await repos.words.move(id, 'hand');
    const [upd] = await outbox(db);
    expect(upd.fields).toMatchObject({ place: 'hand', stage: 'understood', hand_since: '2026-11-18', interval_days: 1, due_on: '2026-11-19' });
  });

  it('★だけを変えたら ★だけ。探す文字（search_key）を作り直しても積まない', async () => {
    const { db, repos } = await setup();
    const { id } = await repos.words.capture({ text: '筋がいい', sourceId: null });
    await db.runAsync('DELETE FROM sync_outbox', []);
    await repos.words.setStar(id, true);
    expect(await outbox(db)).toEqual([{ entity_type: 'expression', entity_id: id, op: 'update', fields: { star: 1 } }]);
  });

  it('場所を隠すのは update（delete は積まない）。名前を変えると初期の行も update で送る', async () => {
    const { db, repos } = await setup();
    await repos.catalog.updateSource(SEED_SOURCES[4].id, { hidden: true });
    await repos.catalog.updateSource(SEED_SOURCES[1].id, { name: 'Kindle 本' });
    expect(await outbox(db)).toEqual([
      { entity_type: 'source', entity_id: SEED_SOURCES[4].id, op: 'update', fields: { hidden: 1 } },
      { entity_type: 'source', entity_id: SEED_SOURCES[1].id, op: 'update', fields: { name: 'Kindle 本' } },
    ]);
  });

  it('表現を消すと、表現の delete だけを送る（出会い・振り返り・タグはサーバーが一緒に消す）', async () => {
    const { db, repos } = await setup();
    const { id } = await repos.words.capture({ text: '筋がいい', sourceId: null, tagIds: [CHEER] });
    await repos.words.recordUse(id);
    await db.runAsync('DELETE FROM sync_outbox', []);
    await repos.words.remove(id);
    expect((await outbox(db)).map((r) => [r.entity_type, r.op])).toEqual([['expression', 'delete']]);
    expect(await db.getAllAsync('SELECT id FROM encounters WHERE deleted_at IS NULL', [])).toEqual([]);
    expect(await db.getFirstAsync(`SELECT value FROM sync_meta WHERE key = 'applying'`, [])).toBeNull();
  });
});

describe('例文と聞いた', () => {
  it('例文は表現の examples（一覧）として送る。聞いたは間隔の組で送り、聞いた1回は listen_session を create で積む', async () => {
    const { db, repos } = await setup();
    const { id } = await repos.words.capture({ text: '腑に落ちる', sourceId: null, examples: ['ようやく腑に落ちた。', ' '] });
    const [expr] = await outbox(db);
    const pushed = toPushChange((await syncStore(db).pending(1))[0]);
    expect(pushed.fields?.examples).toEqual([
      { text: 'ようやく腑に落ちた。', origin: 'user', confirmed: true, created_at: '2026-11-18T01:00:00.000Z', updated_at: '2026-11-18T01:00:00.000Z' },
    ]);
    expect(expr.entity_type).toBe('expression');
    await db.runAsync('DELETE FROM sync_outbox', []);
    await repos.words.recordListen(id);
    await repos.words.recordListenSession(new Date('2026-11-18T00:50:00.000Z'), 42.4, 1);
    const [upd, session] = await outbox(db);
    expect(upd).toMatchObject({ entity_type: 'expression', op: 'update', fields: { listened_at: '2026-11-18T01:00:00.000Z', listen_count: 1 } });
    expect(session).toMatchObject({ entity_type: 'listen_session', op: 'create', fields: { started_at: '2026-11-18T00:50:00.000Z', listened_on: '2026-11-18', seconds: 42, items: 1 } });
  });
});

describe('同期の1回分（偽のサーバー）', () => {
  const engineFor = async () => {
    const env = await setup();
    const server = createFakeSyncServer({ clock: () => '2026-11-18T02:00:00.000Z' });
    const api = createApiClient({
      baseUrl: 'https://words.example',
      getAccessToken: async () => fakeAccessToken('user-a'),
      fetch: (async (url: string, init?: RequestInit) => {
        const res = server.handle(init?.method ?? 'GET', url, init?.body ? JSON.parse(String(init.body)) : undefined);
        return new Response(JSON.stringify(res.body), { status: res.status, headers: { 'Content-Type': 'application/json' } });
      }) as typeof fetch,
    });
    const store = syncStore(env.db);
    return { ...env, server, store, engine: createSyncEngine({ store, api, now: env.deps.now }) };
  };

  it('送って、受け取る。MCP が拾った表現（補った項目つき）が端末に入り、探せる', async () => {
    const { repos, server, engine, store } = await engineFor();
    await repos.words.capture({ text: '肩の荷が下りる', sourceId: AUDIBLE });
    const exprId = '11111111-1111-4111-8111-111111111111';
    const encId = '22222222-2222-4222-8222-222222222222';
    server.append([
      {
        change_id: 'c1', entity_type: 'expression', entity_id: exprId, parent_id: null, op: 'create', changed_at: '2026-11-18T01:30:00Z', origin: 'mcp', device_id: null,
        fields: {
          text: '腑に落ちる', source_id: SEED_SOURCES[1].id, normalized_key: '腑に落ちる', scene: '先輩の説明を聞いて', note: '', star: false, place: 'hand',
          stage: 'understood', moved_at: '2026-11-18T01:30:00Z', hand_since: '2026-11-18', interval_days: 1, due_on: '2026-11-19',
          listened_at: null, listen_count: 0, use_count: 0, last_used_on: null,
          reading: 'ふにおちる', use_note: '', register: 'spoken', register_by: 'claude', meaning: '心から納得する', nuance: '',
          examples: [{ text: 'ようやく腑に落ちた。', origin: 'claude', confirmed: false, created_at: '2026-11-18T01:30:00Z', updated_at: '2026-11-18T01:30:00Z' }],
          similar: ['合点がいく'], usefulness: 3, usefulness_reason: '発表で', usefulness_until: '2026-12-01', enriched_at: '2026-11-18T01:30:00Z',
        },
      },
      {
        change_id: 'c2', entity_type: 'encounter', entity_id: encId, parent_id: null, op: 'create', changed_at: '2026-11-18T01:30:00Z', origin: 'mcp', device_id: null,
        fields: { expression_id: exprId, source_id: SEED_SOURCES[1].id, title: '舟を編む', locator: 'No.1824', met_on: null, time_hint: '', scene: '',
          surrounding_text: '彼はようやく腑に落ちたという顔をした。', wording: '腑に落ちた', captured_via: 'mcp', note: '' },
      },
      {
        change_id: 'c3', entity_type: 'expression_tag', entity_id: expressionTagId(exprId, CHEER), parent_id: null, op: 'create', changed_at: '2026-11-18T01:30:00Z',
        origin: 'mcp', device_id: null, fields: { expression_id: exprId, tag_id: CHEER, added_by: 'claude', status: 'proposed', confirmed_at: null },
      },
    ]);
    const out = await engine.run();
    expect(out).toMatchObject({ ok: true, sent: 2, rejected: 0 });
    expect(server.requests.filter((r) => r.method === 'POST')).toHaveLength(1);
    const e = await repos.words.get(exprId);
    expect(e).toMatchObject({ text: '腑に落ちる', place: 'hand', meaning: '心から納得する', usefulness: 3, register_by: 'claude' });
    expect(e?.examples).toMatchObject([{ text: 'ようやく腑に落ちた。', origin: 'claude', confirmed: false }]);
    expect(await repos.words.searchIds(['%ようやく腑に落ちた%'])).toEqual([exprId]);
    expect((await repos.words.tagsOf(exprId))[0]).toMatchObject({ name: '励ます', status: 'proposed', added_by: 'claude' });
    expect(await repos.words.searchIds(['%しんからなっとく%'])).toEqual([]);
    expect(await repos.words.searchIds(['%心から納得%'])).toEqual([exprId]);
    expect(await repos.words.searchIds(['%舟を編む%'])).toEqual([exprId]);
    expect(await store.counts()).toEqual({ pending: 0, rejected: 0 });

    // 2回目：ほかから届いた表現の数
    server.append([{
      change_id: 'c4', entity_type: 'expression', entity_id: '33333333-3333-4333-8333-333333333333', parent_id: null, op: 'create',
      changed_at: '2026-11-18T03:00:00Z', origin: 'mcp', device_id: null,
      fields: { text: '一目置く', normalized_key: '一目置く', place: 'collected', moved_at: '2026-11-18T03:00:00Z', interval_days: 1 },
    }]);
    expect(await engine.run()).toMatchObject({ ok: true, received: 1 });
  });

  it('端末でまだ送っていない項目は、受け取った値で上書きしない', async () => {
    const { repos, server, engine, db } = await engineFor();
    const { id } = await repos.words.capture({ text: '筋がいい', sourceId: null });
    await engine.run();
    await repos.words.setStar(id, true);
    server.append([{
      change_id: 'x', entity_type: 'expression', entity_id: id, parent_id: null, op: 'update', changed_at: '2026-11-18T01:00:00Z', origin: 'mcp',
      device_id: null, fields: { star: false, meaning: 'うまい' },
    }]);
    // 先に受け取りだけを当てはめる（送る前の状態）
    const page = (server.handle('GET', 'https://words.example/v1/sync/changes?after=0&limit=500').body as { entries: { state: never }[] }).entries;
    await syncStore(db).applyStates(page.map((x) => x.state));
    expect(await repos.words.get(id)).toMatchObject({ star: true, meaning: 'うまい' });
  });
});
