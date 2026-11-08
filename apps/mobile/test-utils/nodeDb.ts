// テスト用：Node の node:sqlite（メモリー上）で Db の形を作る
import { DatabaseSync } from 'node:sqlite';
import { bodyRepository } from '@/db/repositories/body';
import { catalogRepository } from '@/db/repositories/catalog';
import { healthRepository } from '@/db/repositories/health';
import { mealRepository } from '@/db/repositories/meals';
import { settingsRepository } from '@/db/repositories/settings';
import { workoutRepository } from '@/db/repositories/workouts';
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

/** 時刻を進められる時計と、連番の ID */
export function testDeps(start = '2026-11-08T00:00:00.000Z'): Deps & { advance: (ms: number) => void } {
  let t = new Date(start).getTime();
  let n = 0;
  return {
    now: () => new Date(t),
    newId: () => `id-${++n}`,
    advance: (ms) => { t += ms; },
  };
}

export function repos(db: Db, deps: Deps) {
  return {
    settings: settingsRepository(db, deps),
    catalog: catalogRepository(db, deps),
    workouts: workoutRepository(db, deps),
    body: bodyRepository(db, deps),
    meals: mealRepository(db, deps),
    health: healthRepository(db),
  };
}
