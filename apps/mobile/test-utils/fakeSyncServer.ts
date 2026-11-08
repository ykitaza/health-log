/**
 * テスト用の偽の同期サーバー（jest と E2E で使う。本物の API には当てない）。
 * 当てはめの決まりは services/sync/sync/model.py・engine.py と同じにし、testdata/sync/conflicts.json で
 * サーバー（pytest）と同じ結果になることを確かめている。項目の形の確かめはしない（それは pytest で本物に当てて確かめる）。
 * E2E（Playwright）からも読むので、'@/…' の別名は使わない
 */

export type Origin = 'app' | 'import' | 'mcp' | 'migration';
export type Op = 'create' | 'update' | 'delete' | 'restore';

export type ServerChange = {
  change_id: string;
  entity_type: string;
  entity_id: string;
  parent_id: string | null;
  op: Op;
  fields: Record<string, unknown> | null;
  changed_at: string;
  origin: Origin;
  device_id: string | null;
  received_at: string;
  seq: number;
};

type Key = [number, string, number];
const greater = (a: Key, b: Key) => a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];

type State = {
  entity_type: string; entity_id: string; parent_id: string | null;
  values: Record<string, unknown>; keys: Record<string, Key>;
  deletion: [boolean, Key] | null; created_at: string; updated_at: string; seq: number;
};

/** RFC 3339 の時刻を、UTC のミリ秒までの形にそろえる（サーバーの to_timestamp と同じ） */
export const normalizeTime = (text: string) => new Date(text).toISOString();

export function createFakeSyncServer(opts: { clock?: () => string } = {}) {
  let clock = opts.clock ?? (() => new Date().toISOString());
  const log: { change: ServerChange; state: ReturnType<typeof view> }[] = [];
  const states = new Map<string, State>();
  const seen = new Map<string, number>();
  let head = 0;
  const requests: { method: string; path: string; body?: unknown }[] = [];

  function view(s: State) {
    const deleted = !!(s.deletion && s.deletion[0]);
    return {
      entity_type: s.entity_type, entity_id: s.entity_id, parent_id: s.parent_id, fields: { ...s.values }, deleted,
      created_at: s.created_at, updated_at: s.updated_at, deleted_at: deleted ? s.deletion![1][1] : null, seq: s.seq,
    };
  }

  /** 変更を送られた順に当てはめる。同じ change_id は2回目から duplicate */
  function append(changes: Omit<ServerChange, 'received_at' | 'seq'>[]) {
    const receivedAt = clock();
    return changes.map((c) => {
      const id = c.change_id.toLowerCase();
      const dup = seen.get(id);
      if (dup !== undefined) return { change_id: id, seq: dup, duplicate: true };
      const change: ServerChange = { ...c, change_id: id, changed_at: normalizeTime(c.changed_at), received_at: receivedAt, seq: ++head };
      const k = `${c.entity_type}#${c.entity_id}`;
      const s = states.get(k) ?? {
        entity_type: c.entity_type, entity_id: c.entity_id, parent_id: c.parent_id ?? null,
        values: {}, keys: {}, deletion: null, created_at: '', updated_at: '', seq: 0,
      };
      const at = change.changed_at < receivedAt ? change.changed_at : receivedAt;
      const key: Key = [change.origin === 'import' ? 0 : 1, at, change.seq];
      if (change.op === 'create' || change.op === 'update') {
        for (const [name, value] of Object.entries(change.fields ?? {})) {
          if (!(name in s.keys) || greater(key, s.keys[name])) { s.values[name] = value; s.keys[name] = key; }
        }
      } else if (s.deletion === null || greater(key, s.deletion[1])) {
        s.deletion = [change.op === 'delete', key];
      }
      s.created_at = s.created_at && s.created_at < at ? s.created_at : at;
      s.updated_at = s.updated_at > at ? s.updated_at : at;
      s.seq = Math.max(s.seq, change.seq);
      states.set(k, s);
      seen.set(id, change.seq);
      log.push({ change, state: view(s) });
      return { change_id: id, seq: change.seq, duplicate: false };
    });
  }

  type Res = { status: number; body: unknown };
  /** HTTP の入口（docs/api/app-api.yaml の同期の3つ） */
  function handle(method: string, url: string, body?: unknown): Res {
    const u = new URL(url, 'https://fake.invalid');
    requests.push({ method, path: u.pathname + u.search, body });
    if (method === 'POST' && u.pathname === '/v1/sync/changes') {
      const b = body as { device_id?: string; changes?: (Omit<ServerChange, 'received_at' | 'seq' | 'device_id'>)[] };
      if (!b || !Array.isArray(b.changes) || b.changes.length < 1 || b.changes.length > 25 || !b.device_id) {
        return { status: 400, body: { title: 'invalid-request' } };
      }
      const results = append(b.changes.map((c) => ({
        ...c, parent_id: c.parent_id ?? null, fields: c.fields ?? null, origin: c.origin ?? 'app', device_id: b.device_id!,
      })));
      return {
        status: 200,
        body: { results: results.map((r) => ({ change_id: r.change_id, status: r.duplicate ? 'duplicate' : 'accepted', seq: r.seq, error: null })), cursor: head },
      };
    }
    if (method === 'GET' && u.pathname === '/v1/sync/changes') {
      const after = Number(u.searchParams.get('after') ?? 0);
      const limit = Number(u.searchParams.get('limit') ?? 100);
      const rest = log.filter((e) => e.change.seq > after);
      const entries = rest.slice(0, limit);
      return {
        status: 200,
        body: { entries, next_cursor: entries.length ? entries[entries.length - 1].change.seq : after, has_more: rest.length > limit },
      };
    }
    if (method === 'GET' && u.pathname === '/v1/sync/snapshot') {
      const limit = Number(u.searchParams.get('limit') ?? 200);
      const start = Number(u.searchParams.get('page_token') ?? 0);
      const all = [...states.keys()].sort().map((k) => view(states.get(k)!));
      const page = all.slice(start, start + limit);
      return { status: 200, body: { states: page, cursor: head, next_page_token: start + limit < all.length ? String(start + limit) : null } };
    }
    return { status: 404, body: { title: 'not-found' } };
  }

  /** createApiClient に渡せる fetch。fail に関数を入れると、返事の代わりに使う（通信の失敗などを作る） */
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    const override = fail.next?.(method, String(input), body);
    if (override instanceof Error) throw override;
    const res = override ?? handle(method, String(input), body);
    return new Response(JSON.stringify(res.body), { status: res.status, headers: { 'content-type': 'application/json' } });
  };
  const fail: { next?: (method: string, url: string, body: unknown) => Res | Error | undefined } = {};

  return {
    append, handle, fetch, fail, requests, log,
    get head() { return head; },
    setClock(next: () => string) { clock = next; },
    /** 今の状態（API の EntityState の形）。なければ undefined */
    state(type: string, id: string) {
      const s = states.get(`${type}#${id}`);
      return s ? view(s) : undefined;
    },
    states(type?: string) {
      return [...states.values()].filter((s) => !type || s.entity_type === type).map(view);
    },
  };
}

export type FakeSyncServer = ReturnType<typeof createFakeSyncServer>;
