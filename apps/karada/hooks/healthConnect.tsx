import { useSQLiteContext } from 'expo-sqlite';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { defaultDeps } from '@/db';
import { HC_META, healthConnectStore } from '@/db/repositories/healthConnect';
import * as hc from '@/lib/healthConnect/client';
import { importHealthConnect, requestReadPermissions } from '@/lib/healthConnect/importer';

/**
 * Health Connect の連携（Android だけ）。連携しているときだけ、アプリを開いたとき・前面に戻ったとき・「今すぐ取り込む」で取り込む。
 * バックグラウンドでは読まない（権限も求めない）
 */
export type HealthConnectError = 'unavailable' | 'updateRequired' | 'denied' | 'failed';

export type HealthConnectStatus = {
  /** この端末で使えるか（Android だけ） */
  supported: boolean;
  connected: boolean;
  importing: boolean;
  /** 最後に取り込みを終えた時刻（ISO 8601） */
  lastImportAt: string | null;
  error: HealthConnectError | null;
  /**
   * 歩数の許可があるか（最後の取り込みで分かったもの。まだ分からなければ null）。
   * 歩数はあとから足したので、前の APK（READ_STEPS がない）と、連携したあとに足した許可をまだ出していないときは false
   */
  stepsGranted: boolean | null;
  /** 権限を求めて連携する。連携しているときも使える（あとから足した歩数の許可を求める） */
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  importNow: () => void;
};

const Context = createContext<HealthConnectStatus | null>(null);

export function HealthConnectProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const store = useMemo(() => healthConnectStore(db, defaultDeps), [db]);
  const [connected, setConnected] = useState(false);
  const [importing, setImporting] = useState(false);
  const [lastImportAt, setLastImportAt] = useState<string | null>(null);
  const [error, setError] = useState<HealthConnectError | null>(null);
  const [stepsGranted, setStepsGranted] = useState<boolean | null>(null);
  const running = useRef(false);

  const refresh = useCallback(async () => {
    const [c, last] = await Promise.all([store.getMeta(HC_META.connected), store.getMeta(HC_META.lastImportAt)]);
    setConnected(c === '1');
    setLastImportAt(last);
    return c === '1';
  }, [store]);

  /** 使えるか確かめて、クライアントを用意する */
  const ready = useCallback(async (): Promise<boolean> => {
    const status = await hc.getSdkStatus();
    if (status === hc.SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) { setError('updateRequired'); return false; }
    if (status !== hc.SdkAvailabilityStatus.SDK_AVAILABLE) { setError('unavailable'); return false; }
    return hc.initialize();
  }, []);

  const run = useCallback(async () => {
    if (!hc.supported || running.current) return;
    running.current = true;
    setImporting(true);
    try {
      if (!(await refresh()) || !(await ready())) return;
      const result = await importHealthConnect(store);
      setStepsGranted(result.types.includes('Steps'));
      setError(null);
    } catch {
      setError('failed');
    } finally {
      running.current = false;
      setImporting(false);
      void refresh().catch(() => undefined);
    }
  }, [store, refresh, ready]);

  useEffect(() => {
    if (!hc.supported) return;
    void run();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void run(); });
    return () => sub.remove();
  }, [run]);

  const connect = useCallback(async () => {
    if (!hc.supported) return;
    setError(null);
    try {
      if (!(await ready())) return;
      // 前の APK で歩数を含めて求めて失敗したら、歩数を外して求め直す（ほかの取り込みを止めない）
      const granted = await requestReadPermissions(hc.requestPermission);
      if (!granted.some((p) => p.accessType === 'read')) { setError('denied'); return; }
      await store.setMeta(HC_META.connected, '1');
      await refresh();
    } catch {
      setError('failed');
      return;
    }
    void run();
  }, [ready, store, refresh, run]);

  const disconnect = useCallback(async () => {
    if (!hc.supported) return;
    // 権限の取り消しは、アプリを起動し直すまで効かない（Health Connect の決まり）。取り込みは、連携の印を消してすぐ止める
    try { await hc.revokeAllPermissions(); } catch { /* 取り消せなくても、こちらの連携は切る */ }
    await store.disconnect();
    setError(null);
    setStepsGranted(null);
    await refresh();
  }, [store, refresh]);

  const importNow = useCallback(() => { void run(); }, [run]);

  const value = useMemo(() => ({
    supported: hc.supported, connected, importing, lastImportAt, error, stepsGranted, connect, disconnect, importNow,
  }), [connected, importing, lastImportAt, error, stepsGranted, connect, disconnect, importNow]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useHealthConnect(): HealthConnectStatus {
  const v = useContext(Context);
  if (!v) throw new Error('HealthConnectProvider の外では使えません');
  return v;
}
