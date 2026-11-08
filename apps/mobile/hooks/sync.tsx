import { useSQLiteContext } from 'expo-sqlite';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { AccountSwitch, syncStore } from '@/db/repositories/sync';
import { onLocalWrite } from '@/db/serial';
import { createSyncEngine, SyncErrorCode } from '@/lib/sync/engine';
import { notifyRemoteChange } from '@/lib/sync/events';
import { createSyncScheduler } from '@/lib/sync/scheduler';
import { useAuth } from './auth';

/**
 * 同期をアプリ全体で動かす。ログインしているときだけ動かす。
 * 起動したとき・前面に戻ったとき・記録を保存したあと（少し待ってまとめる）・「今すぐ同期」で動かす
 */
export type SyncStatus = {
  syncing: boolean;
  /** 最後に同期を終えた時刻（ISO 8601）。まだなら null */
  lastSyncedAt: string | null;
  /** まだ送っていない変更の件数 */
  pending: number;
  /** サーバーに断られて、送るのをやめた変更の件数 */
  rejected: number;
  /** 最後の同期の失敗。成功したら null。accountChanged なら、switchAccount で選ぶまで同期しない */
  error: SyncErrorCode | null;
  syncNow: () => void;
  /** 前と違うアカウントでログインしたとき、端末の記録をどうするかを決めて、同期を始める */
  switchAccount: (mode: AccountSwitch) => Promise<void>;
};

const SyncContext = createContext<SyncStatus | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const { status, api } = useAuth();
  const store = useMemo(() => syncStore(db), [db]);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [counts, setCounts] = useState({ pending: 0, rejected: 0 });
  const [error, setError] = useState<SyncErrorCode | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [c, last] = await Promise.all([store.counts(), store.getMeta('last_synced_at')]);
      setCounts(c);
      setLastSyncedAt(last);
    } catch {
      // 表示だけなので、読めなくても止めない
    }
  }, [store]);

  const scheduler = useMemo(() => {
    const engine = createSyncEngine({ store, api });
    return createSyncScheduler({
      run: () => engine.run(),
      onStart: () => setSyncing(true),
      onDone: (outcome) => {
        setSyncing(false);
        setError(outcome.ok ? null : outcome.error);
        if (outcome.ok && outcome.applied > 0) notifyRemoteChange();
        void refresh();
      },
    });
  }, [store, api, refresh]);

  useEffect(() => { void refresh(); }, [refresh]);

  // 記録を保存したら、件数を出し直し、少し待って同期する
  useEffect(() => onLocalWrite(db, () => {
    void refresh();
    if (status === 'signedIn') scheduler.request('write');
  }), [db, status, scheduler, refresh]);

  useEffect(() => {
    if (status !== 'signedIn') {
      scheduler.stop();
      setSyncing(false);
      setError(null);
      return;
    }
    scheduler.request('start');
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') scheduler.request('foreground'); });
    return () => { sub.remove(); scheduler.stop(); };
  }, [status, scheduler]);

  const syncNow = useCallback(() => { if (status === 'signedIn') scheduler.request('manual'); }, [status, scheduler]);

  const switchAccount = useCallback(async (mode: AccountSwitch) => {
    const sub = await api.account();
    if (!sub) throw new Error('アクセストークンに sub がありません');
    await store.switchAccount(sub, mode, new Date().toISOString());
    // 端末の記録が変わった（replace）ので、画面を読み直す
    if (mode === 'replace') notifyRemoteChange();
    setError(null);
    await refresh();
    if (status === 'signedIn') scheduler.request('manual');
  }, [api, store, status, scheduler, refresh]);

  const value = useMemo(
    () => ({ syncing, lastSyncedAt, pending: counts.pending, rejected: counts.rejected, error, syncNow, switchAccount }),
    [syncing, lastSyncedAt, counts, error, syncNow, switchAccount],
  );
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncStatus {
  const v = useContext(SyncContext);
  if (!v) throw new Error('SyncProvider の外では使えません');
  return v;
}
