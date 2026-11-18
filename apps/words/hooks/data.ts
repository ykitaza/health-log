import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { DependencyList, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRepositories, Repositories } from '@/db';
import { onLocalWrite } from '@/db/serial';
import { onRemoteChange } from '@/lib/sync/events';

export function useRepos(): Repositories {
  const db = useSQLiteContext();
  return useMemo(() => createRepositories(db), [db]);
}

/**
 * 画面を開いたとき・書いたとき・同期で受け取ったときに読み直す。
 * 読み込みが終わるまで data は null（前の値は残す）
 */
export function useData<T>(load: (repos: Repositories) => Promise<T>, deps: DependencyList = []): { data: T | null; reload: () => void } {
  const repos = useRepos();
  const db = useSQLiteContext();
  const [data, setData] = useState<T | null>(null);
  const loadRef = useRef(load);
  useLayoutEffect(() => { loadRef.current = load; });
  const seq = useRef(0);

  // 読み直すきっかけの値（画面の ID など）。変わったら読み直す
  const key = JSON.stringify(deps);
  const reload = useCallback(() => {
    const n = ++seq.current;
    loadRef.current(repos).then((v) => { if (n === seq.current) setData(v); }).catch(() => {});
    // key は読み直すきっかけのためだけに入れる
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repos, key]);

  useFocusEffect(reload);
  useEffect(() => onLocalWrite(db, reload), [db, reload]);
  useEffect(() => onRemoteChange(reload), [reload]);
  return { data, reload };
}
