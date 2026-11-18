/**
 * アプリの同期のつなぎ（hooks/sync.tsx の SyncProvider が使う）。同期の1回分（engine）と、いつ動かすか（scheduler）をつなぎ、
 * サーバーの変更を当てはめたら開いている画面に知らせる（notifyRemoteChange → useFocusData が読み直す）。
 * React を使わずに jest で確かめられるように、ここに分けている（lib/__tests__/sync-app.test.ts）
 */
import type { ApiClient } from '@/lib/api';
import type { SyncStore } from '@/db/repositories/sync';
import { createSyncEngine, SyncOutcome } from './engine';
import { notifyRemoteChange } from './events';
import { createSyncScheduler, SchedulerDeps } from './scheduler';

export type AppSyncDeps = {
  store: SyncStore;
  api: ApiClient;
  now?: () => Date;
  onStart?: () => void;
  onDone?: (outcome: SyncOutcome) => void;
} & Pick<SchedulerDeps, 'debounceMs' | 'baseDelayMs' | 'maxDelayMs' | 'random' | 'setTimer' | 'clearTimer'>;

export function createAppSync({ store, api, now, onStart, onDone, ...timing }: AppSyncDeps) {
  const engine = createSyncEngine({ store, api, now });
  const scheduler = createSyncScheduler({
    ...timing,
    run: () => engine.run(),
    onStart,
    onDone: (outcome) => {
      if (outcome.ok && outcome.applied > 0) notifyRemoteChange();
      onDone?.(outcome);
    },
  });
  return {
    scheduler,
    /** AppState の変化。前面に戻ったら（MCP で記録してアプリに戻ったときなど）すぐ同期する */
    appStateChanged(state: string) {
      if (state === 'active') scheduler.request('foreground');
    },
  };
}
