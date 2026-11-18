import { useSQLiteContext } from 'expo-sqlite';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { AccountSwitch, syncStore } from '@/db/repositories/sync';
import { onLocalWrite } from '@/db/serial';
import { apiBaseUrl } from '@/lib/auth/config';
import { createAppSync } from '@/lib/sync/app';
import type { SyncErrorCode } from '@/lib/sync/engine';
import { notifyRemoteChange } from '@/lib/sync/events';
import { useAuth } from './auth';

/**
 * 同期をアプリ全体で動かす（KARADA の hooks/sync.tsx と同じ作り）。ログインしていて、同期の先（apiUrl）があるときだけ動かす。
 * 起動したとき・前面に戻ったとき・記録を保存したあと（少し待ってまとめる）・「今すぐ同期」で動かす
 */
export type SyncStatus = {
  /** 同期の先があるか（ことばのアプリ用の API をまだデプロイしていなければ false） */
  configured: boolean;
  syncing: boolean;
  lastSyncedAt: string | null;
  pending: number;
  rejected: number;
  error: SyncErrorCode | null;
  failures: number;
  /** 最後に、ほかから表現を受け取った同期の件数。受け取るたびに id が増える */
  received: { id: number; count: number } | null;
  syncNow: () => void;
  switchAccount: (mode: AccountSwitch) => Promise<void>;
};

const SyncContext = createContext<SyncStatus | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const { status, api } = useAuth();
  const store = useMemo(() => syncStore(db), [db]);
  const configured = apiBaseUrl !== '';
  const active = status === 'signedIn' && configured;
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [counts, setCounts] = useState({ pending: 0, rejected: 0 });
  const [error, setError] = useState<SyncErrorCode | null>(null);
  const [failures, setFailures] = useState(0);
  const [received, setReceived] = useState<SyncStatus['received']>(null);

  const refresh = useCallback(async () => {
    try {
      const [c, last] = await Promise.all([store.counts(), store.getMeta('last_synced_at')]);
      setCounts(c);
      setLastSyncedAt(last);
    } catch {
      // 表示だけなので、読めなくても止めない
    }
  }, [store]);

  const app = useMemo(() => createAppSync({
    store,
    api,
    onStart: () => setSyncing(true),
    onDone: (outcome) => {
      setSyncing(false);
      setError(outcome.ok ? null : outcome.error);
      setFailures((n) => (outcome.ok ? 0 : n + 1));
      if (outcome.ok && outcome.received > 0) setReceived((prev) => ({ id: (prev?.id ?? 0) + 1, count: outcome.received }));
      void refresh();
    },
  }), [store, api, refresh]);
  const scheduler = app.scheduler;

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => onLocalWrite(db, () => {
    void refresh();
    if (active) scheduler.request('write');
  }), [db, active, scheduler, refresh]);

  useEffect(() => {
    if (!active) {
      scheduler.stop();
      setSyncing(false);
      setError(null);
      setFailures(0);
      return;
    }
    scheduler.request('start');
    const sub = AppState.addEventListener('change', app.appStateChanged);
    return () => { sub.remove(); scheduler.stop(); };
  }, [active, scheduler, app]);

  const syncNow = useCallback(() => { if (active) scheduler.request('manual'); }, [active, scheduler]);

  const switchAccount = useCallback(async (mode: AccountSwitch) => {
    const sub = await api.account();
    if (!sub) throw new Error('アクセストークンに sub がありません');
    await store.switchAccount(sub, mode, new Date().toISOString());
    if (mode === 'replace') notifyRemoteChange();
    setError(null);
    setFailures(0);
    await refresh();
    if (active) scheduler.request('manual');
  }, [api, store, active, scheduler, refresh]);

  const value = useMemo(
    () => ({ configured, syncing, lastSyncedAt, pending: counts.pending, rejected: counts.rejected, error, failures, received, syncNow, switchAccount }),
    [configured, syncing, lastSyncedAt, counts, error, failures, received, syncNow, switchAccount],
  );
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncStatus {
  const v = useContext(SyncContext);
  if (!v) throw new Error('SyncProvider の外では使えません');
  return v;
}
