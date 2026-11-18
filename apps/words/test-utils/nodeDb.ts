// テスト用：Node の node:sqlite（メモリー上）で Db の形を作る（KARADA の test-utils/nodeDb.ts と同じ）
import { DatabaseSync } from 'node:sqlite';
import { createRepositories } from '@/db';
import { migrate } from '@/db/migrations';
import type { Bind, Db, Deps } from '@/db/types';

const plain = <T>(row: unknown): T => ({ ...(row as object) }) as T;

export function memoryDb(): Db & { raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  return {
    raw,
    async execAsync(sql) { raw.exec(sql); },
    async runAsync(sql, params: Bind[]) { return raw.prepare(sql).run(...params); },
    async getAllAsync<T>(sql: string, params: Bind[]) { return raw.prepare(sql).all(...params).map((r) => plain<T>(r)); },
    async getFirstAsync<T>(sql: string, params: Bind[]) {
      const r = raw.prepare(sql).get(...params);
      return r === undefined ? null : plain<T>(r);
    },
    async withTransactionAsync(task) {
      raw.exec('BEGIN');
      try { await task(); raw.exec('COMMIT'); } catch (e) { raw.exec('ROLLBACK'); throw e; }
    },
  };
}

/** 時刻を進められる時計と、連番の ID（UUID の形） */
export function testDeps(start = '2026-11-18T01:00:00.000Z'): Deps & { advance: (ms: number) => void; set: (iso: string) => void } {
  let t = new Date(start).getTime();
  let n = 0;
  return {
    now: () => new Date(t),
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    advance: (ms) => { t += ms; },
    set: (iso) => { t = new Date(iso).getTime(); },
  };
}

/** マイグレーションを当てた DB とリポジトリ */
export async function setup(start?: string) {
  const db = memoryDb();
  const deps = testDeps(start);
  await migrate(db, deps.now);
  return { db, deps, repos: createRepositories(db, deps) };
}

export async function outbox(db: Db) {
  return (await db.getAllAsync<{ entity_type: string; entity_id: string; op: string; fields: string | null }>(
    'SELECT entity_type, entity_id, op, fields FROM sync_outbox ORDER BY seq', [],
  )).map((r) => ({ ...r, fields: r.fields ? JSON.parse(r.fields) as Record<string, unknown> : null }));
}
