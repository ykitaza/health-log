// 同期の保存先（outbox、受け取りの位置、受け取った状態の当てはめ）。KARADA の db/repositories/sync.ts を写し、ことばの種類にした。
// 当てはめたら、表現の search_key（端末だけの列）を作り直す
import type { EntityState, PushChange } from '@/lib/api';
import { backfillOutbox, insertSeeds } from '../migrations';
import { oneAtATime } from '../serial';
import { ENTITIES, EntitySpec, q, SPEC_BY_TYPE, SyncType, toApiFields, toDbFields } from '../syncSpec';
import type { Db } from '../types';
import { rebuildSearchKeys } from './searchKeys';

export type OutboxRow = {
  seq: number;
  change_id: string;
  entity_type: string;
  entity_id: string;
  parent_id: string | null;
  op: PushChange['op'];
  fields: string | null;
  changed_at: string;
  origin: 'app' | 'import';
};

/** outbox の1行を、送る形にする（真偽値を true/false に。delete・restore には fields を付けない） */
export function toPushChange(row: OutboxRow): PushChange {
  const spec = SPEC_BY_TYPE.get(row.entity_type as SyncType);
  const base: PushChange = {
    change_id: row.change_id, entity_type: row.entity_type, entity_id: row.entity_id,
    op: row.op, changed_at: row.changed_at, origin: row.origin,
  };
  if (row.op === 'delete' || row.op === 'restore' || !row.fields || !spec) return base;
  return { ...base, fields: toApiFields(spec, JSON.parse(row.fields)) };
}

type Applied = 'applied' | 'held' | 'skipped';

/**
 * 前と違うアカウントでログインしたときの選び方（KARADA と同じ）
 * - send：この端末の記録を、新しいアカウントに送る
 * - replace：端末の記録を消し、新しいアカウントから受け取り直す
 */
export type AccountSwitch = 'send' | 'replace';

const ACCOUNT_KEY = 'account';

/** 表現の search_key に関わる種類（当てはめたら作り直す） */
const SEARCH_TYPES = new Set(['expression', 'encounter', 'expression_tag']);

export function syncStore(db: Db) {
  const meta = async (key: string) =>
    (await db.getFirstAsync<{ value: string | null }>('SELECT value FROM sync_meta WHERE key = ?', [key]))?.value ?? null;
  const putMeta = (key: string, value: string | null) => db.runAsync(
    'INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', [key, value],
  );

  const hold = (state: EntityState) => db.runAsync(
    `INSERT INTO sync_held (entity_type, entity_id, seq, state) VALUES (?, ?, ?, ?)
     ON CONFLICT (entity_type, entity_id) DO UPDATE SET seq = excluded.seq, state = excluded.state WHERE excluded.seq > sync_held.seq`,
    [state.entity_type, state.entity_id, state.seq, JSON.stringify(state)],
  );

  const exists = async (table: string, id: string) =>
    (await db.getFirstAsync<{ id: string }>(`SELECT id FROM ${table} WHERE id = ?`, [id])) != null;

  const markSeen = (state: EntityState) => db.runAsync(
    `INSERT INTO sync_seen (entity_type, entity_id, seq) VALUES (?, ?, ?)
     ON CONFLICT (entity_type, entity_id) DO UPDATE SET seq = excluded.seq`, [state.entity_type, state.entity_id, state.seq],
  );

  const forget = async (state: EntityState, seq: number): Promise<Applied> => {
    await db.runAsync('DELETE FROM sync_held WHERE entity_type = ? AND entity_id = ? AND seq <= ?', [state.entity_type, state.entity_id, seq]);
    return 'skipped';
  };

  /** 1つの状態を当てはめる。端末でまだ送っていない変更がある項目と削除は、端末の値を残す */
  async function applyOne(spec: EntitySpec, state: EntityState): Promise<Applied> {
    const seen = await db.getFirstAsync<{ seq: number }>(
      'SELECT seq FROM sync_seen WHERE entity_type = ? AND entity_id = ?', [state.entity_type, state.entity_id],
    );
    if (seen && seen.seq >= state.seq) return forget(state, seen.seq);
    const pending = await db.getAllAsync<{ op: string; fields: string | null }>(
      `SELECT op, fields FROM sync_outbox WHERE status = 'pending' AND entity_type = ? AND entity_id = ? ORDER BY seq`,
      [state.entity_type, state.entity_id],
    );
    const localFields = new Set(pending.flatMap((p) => (p.fields ? Object.keys(JSON.parse(p.fields)) : [])));
    const localDeletion = pending.some((p) => p.op === 'delete' || p.op === 'restore');
    const values = toDbFields(spec, state.fields ?? {});
    for (const k of localFields) delete values[k];
    const row = await db.getFirstAsync<{ id: string }>(`SELECT id FROM ${spec.table} WHERE id = ?`, [state.entity_id]);
    if (!row && spec.required.some((k) => values[k] == null)) {
      if (state.deleted) return markSeen(state).then(() => forget(state, state.seq));
      return hold(state).then(() => 'held');
    }
    for (const [k, table] of Object.entries(spec.refs ?? {})) {
      const ref = values[k];
      if (typeof ref === 'string' && !(await exists(table, ref))) return hold(state).then(() => 'held');
    }
    const deletedAt = state.deleted ? state.deleted_at ?? state.updated_at : null;
    const cols = Object.keys(values);
    if (row) {
      const sets = [...cols.map((c) => `${q(c)} = ?`), 'updated_at = MAX(updated_at, ?)', ...(localDeletion ? [] : ['deleted_at = ?'])];
      await db.runAsync(`UPDATE ${spec.table} SET ${sets.join(', ')} WHERE id = ?`,
        [...cols.map((c) => values[c]), state.updated_at, ...(localDeletion ? [] : [deletedAt]), state.entity_id]);
    } else {
      const all = ['id', ...cols, 'created_at', 'updated_at', 'deleted_at'];
      await db.runAsync(`INSERT INTO ${spec.table} (${all.map(q).join(', ')}) VALUES (${all.map(() => '?').join(', ')})`,
        [state.entity_id, ...cols.map((c) => values[c]), state.created_at, state.updated_at, deletedAt]);
    }
    await markSeen(state);
    await forget(state, state.seq);
    return 'applied';
  }

  async function tryApply(state: EntityState): Promise<Applied> {
    const spec = SPEC_BY_TYPE.get(state.entity_type as SyncType);
    if (!spec) return 'skipped';
    try {
      return await applyOne(spec, state);
    } catch {
      await hold(state);
      return 'held';
    }
  }

  return {
    async deviceId(): Promise<string> {
      const id = await meta('device_id');
      if (!id) throw new Error('device_id がありません');
      return id;
    },

    getMeta: meta,
    setMeta: (key: string, value: string | null) => oneAtATime(db, () => putMeta(key, value)),

    pending: (limit: number) => db.getAllAsync<OutboxRow>(
      `SELECT seq, change_id, entity_type, entity_id, parent_id, op, fields, changed_at, origin FROM sync_outbox
       WHERE status = 'pending' ORDER BY seq LIMIT ?`, [limit],
    ),

    settle: (sent: string[], rejected: { changeId: string; code: string }[]) => oneAtATime(db, () => db.withTransactionAsync(async () => {
      for (const id of sent) await db.runAsync('DELETE FROM sync_outbox WHERE change_id = ?', [id]);
      for (const r of rejected) {
        await db.runAsync(`UPDATE sync_outbox SET status = 'rejected', error_code = ? WHERE change_id = ?`, [r.code, r.changeId]);
      }
    })),

    async counts(): Promise<{ pending: number; rejected: number }> {
      const rows = await db.getAllAsync<{ status: string; n: number }>('SELECT status, COUNT(*) AS n FROM sync_outbox GROUP BY status', []);
      const n = (s: string) => rows.find((r) => r.status === s)?.n ?? 0;
      return { pending: n('pending'), rejected: n('rejected') };
    },

    account: () => meta(ACCOUNT_KEY),
    rememberAccount: (sub: string) => oneAtATime(db, () => putMeta(ACCOUNT_KEY, sub)),

    switchAccount: (sub: string, mode: AccountSwitch, nowIso: string) => oneAtATime(db, () => db.withTransactionAsync(async () => {
      await putMeta('applying', '1');
      try {
        for (const t of ['sync_outbox', 'sync_seen', 'sync_held']) await db.runAsync(`DELETE FROM ${t}`, []);
        await db.runAsync(`DELETE FROM sync_meta WHERE key IN ('cursor', 'last_synced_at')`, []);
        if (mode === 'replace') {
          for (const spec of [...ENTITIES].reverse()) await db.runAsync(`DELETE FROM ${spec.table}`, []);
          await db.runAsync('DELETE FROM local_events', []);
          await insertSeeds(db, nowIso);
        } else {
          await backfillOutbox(db);
        }
        await putMeta(ACCOUNT_KEY, sub);
      } finally {
        await db.runAsync(`DELETE FROM sync_meta WHERE key = 'applying'`, []);
      }
    })),

    /** 受け取った状態を当てはめる。当てはめた件数を返す */
    applyStates: (states: EntityState[], metaUpdates: Record<string, string> = {}) => oneAtATime(db, async () => {
      let applied = 0;
      const touched = new Set<string>();
      let all = false;
      const note = (s: EntityState) => {
        if (s.entity_type === 'tag' || s.entity_type === 'source') all = true;
        else if (s.entity_type === 'expression') touched.add(s.entity_id);
        else if (SEARCH_TYPES.has(s.entity_type) && typeof s.fields?.expression_id === 'string') touched.add(s.fields.expression_id);
        else if (SEARCH_TYPES.has(s.entity_type)) all = true;
      };
      await db.withTransactionAsync(async () => {
        await putMeta('applying', '1');
        try {
          for (const state of states) if ((await tryApply(state)) === 'applied') { applied++; note(state); }
          let heldLeft = (await db.getAllAsync<{ state: string }>('SELECT state FROM sync_held ORDER BY seq', []))
            .map((h) => JSON.parse(h.state) as EntityState);
          for (let progress = true; progress && heldLeft.length > 0;) {
            progress = false;
            const remaining: EntityState[] = [];
            for (const state of heldLeft) {
              const result = await tryApply(state);
              if (result === 'applied') { applied++; progress = true; note(state); } else if (result === 'held') remaining.push(state);
            }
            heldLeft = remaining;
          }
          if (all || touched.size > 0) await rebuildSearchKeys(db, all ? undefined : [...touched]);
          for (const [k, v] of Object.entries(metaUpdates)) await putMeta(k, v);
        } finally {
          await db.runAsync(`DELETE FROM sync_meta WHERE key = 'applying'`, []);
        }
      });
      return applied;
    }),
  };
}

export type SyncStore = ReturnType<typeof syncStore>;
