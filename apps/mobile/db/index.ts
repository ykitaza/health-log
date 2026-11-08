import { randomUUID } from 'expo-crypto';
import { bodyRepository } from './repositories/body';
import { catalogRepository } from './repositories/catalog';
import { settingsRepository } from './repositories/settings';
import { workoutRepository } from './repositories/workouts';
import type { Db, Deps } from './types';

export const defaultDeps: Deps = { now: () => new Date(), newId: () => randomUUID() };

export function createRepositories(db: Db, deps: Deps = defaultDeps) {
  return {
    settings: settingsRepository(db, deps),
    catalog: catalogRepository(db, deps),
    workouts: workoutRepository(db, deps),
    body: bodyRepository(db, deps),
  };
}

export type Repositories = ReturnType<typeof createRepositories>;
export { migrate } from './migrations';
export type { Db } from './types';
