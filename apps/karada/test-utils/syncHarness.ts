// テスト用：メモリーの DB（マイグレーション済み）、偽の同期サーバー、API のクライアント、同期の1回分をまとめて作る
import { migrate } from '@/db/migrations';
import { syncStore } from '@/db/repositories/sync';
import { createApiClient } from '@/lib/api';
import { createSyncEngine } from '@/lib/sync/engine';
import { createFakeSyncServer, FakeSyncServer } from './fakeSyncServer';
import { fakeAccessToken } from './fakeToken';
import { memoryDb, repos, testDeps } from './nodeDb';

export async function device(server: FakeSyncServer = createFakeSyncServer(), start?: string) {
  const db = memoryDb();
  const deps = testDeps(start);
  await migrate(db, deps.now);
  const store = syncStore(db);
  // ログインしているアカウント。sub を変えると、別のアカウントでログインし直したことになる
  const login = { sub: 'user-a' };
  const api = createApiClient({ baseUrl: 'https://api.example.test', getAccessToken: async () => fakeAccessToken(login.sub), fetch: server.fetch });
  const engine = createSyncEngine({ store, api, now: deps.now });
  const outbox = () => db.raw.prepare('SELECT * FROM sync_outbox ORDER BY seq').all() as Record<string, unknown>[];
  return { db, deps, r: repos(db, deps), store, api, engine, server, outbox, login };
}

export type Device = Awaited<ReturnType<typeof device>>;
