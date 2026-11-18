import { randomUUID } from 'expo-crypto';
import { catalogRepository } from './repositories/catalog';
import { localRepository } from './repositories/local';
import { wordsRepository } from './repositories/words';
import type { Db, Deps } from './types';

export const defaultDeps: Deps = { now: () => new Date(), newId: () => randomUUID() };

export function createRepositories(db: Db, deps: Deps = defaultDeps) {
  return {
    words: wordsRepository(db, deps),
    catalog: catalogRepository(db, deps),
    local: localRepository(db, deps),
  };
}

export type Repositories = ReturnType<typeof createRepositories>;
export { migrate } from './migrations';
export type { Db } from './types';

/** 端末の DB のファイルの名前（KARADA の torelog.db とは別のアプリなので、名前が同じでもぶつからないが、分けておく） */
export const DB_NAME = 'kotoba.db';
