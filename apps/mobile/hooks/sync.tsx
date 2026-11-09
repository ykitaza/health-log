import { useSQLiteContext } from 'expo-sqlite';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, AppState } from 'react-native';
import { AccountSwitch, syncStore } from '@/db/repositories/sync';
import { onLocalWrite } from '@/db/serial';
import { createAppSync } from '@/lib/sync/app';
import type { SyncErrorCode } from '@/lib/sync/engine';
import { notifyRemoteChange } from '@/lib/sync/events';
import { PULL_DONE, PULL_SYNCING, startPull, SYNC_FAILED } from '@/lib/sync/status';
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
  /** 続けて失敗した回数（成功したら 0）。ホームの知らせを出すかに使う */
  failures: number;
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
  const [failures, setFailures] = useState(0);

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
      void refresh();
    },
  }), [store, api, refresh]);
  const scheduler = app.scheduler;

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
      setFailures(0);
      return;
    }
    scheduler.request('start');
    const sub = AppState.addEventListener('change', app.appStateChanged);
    return () => { sub.remove(); scheduler.stop(); };
  }, [status, scheduler, app]);

  const syncNow = useCallback(() => { if (status === 'signedIn') scheduler.request('manual'); }, [status, scheduler]);

  const switchAccount = useCallback(async (mode: AccountSwitch) => {
    const sub = await api.account();
    if (!sub) throw new Error('アクセストークンに sub がありません');
    await store.switchAccount(sub, mode, new Date().toISOString());
    // 端末の記録が変わった（replace）ので、画面を読み直す
    if (mode === 'replace') notifyRemoteChange();
    setError(null);
    setFailures(0);
    await refresh();
    if (status === 'signedIn') scheduler.request('manual');
  }, [api, store, status, scheduler, refresh]);

  const value = useMemo(
    () => ({ syncing, lastSyncedAt, pending: counts.pending, rejected: counts.rejected, error, failures, syncNow, switchAccount }),
    [syncing, lastSyncedAt, counts, error, failures, syncNow, switchAccount],
  );
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncStatus {
  const v = useContext(SyncContext);
  if (!v) throw new Error('SyncProvider の外では使えません');
  return v;
}

/** 知らせ（スナックバー）を出しておく長さ */
const NOTICE_MS = 4_000;

/** 引っぱったあとの知らせ（スナックバー）。retry なら「やり直す」を添える */
export type PullNotice = { message: string; retry: boolean };

/**
 * 下に引っぱって同期する（タブの画面の Screen が使う）。ログインしていれば同期し、終わるまで refreshing を true にする（マークを出す）。
 * 終わったら、変わったものがなくても開いている画面を読み直す。ログインしていないときと失敗したときは notice に短い知らせを入れる。
 * 読み上げ：始めに「同期しています」、終わったら「同期しました」か、失敗の知らせ
 */
export function usePullToSync() {
  const { status } = useAuth();
  const { syncing, error, syncNow } = useSync();
  const [pulling, setPulling] = useState(false);
  const [notice, setNotice] = useState<PullNotice | null>(null);

  const show = useCallback((message: string, retry = false) => {
    setNotice({ message, retry });
    AccessibilityInfo.announceForAccessibility(message);
  }, []);

  // syncNow は同じ処理の中で syncing を true にする（scheduler の onStart）ので、pulling と一緒に描かれる。
  // そのあと syncing が false に戻ったら、引っぱった分の同期が終わった
  useEffect(() => {
    if (!pulling || syncing) return;
    setPulling(false);
    notifyRemoteChange();
    if (error) show(SYNC_FAILED, error !== 'accountChanged');
    else AccessibilityInfo.announceForAccessibility(PULL_DONE);
  }, [pulling, syncing, error, show]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice]);

  const onRefresh = useCallback(() => {
    if (!startPull(status, syncNow, show)) return;
    setNotice(null);
    setPulling(true);
    AccessibilityInfo.announceForAccessibility(PULL_SYNCING);
  }, [status, syncNow, show]);

  return { refreshing: pulling, onRefresh, notice };
}
