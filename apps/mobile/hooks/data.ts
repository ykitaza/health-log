import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRepositories, Repositories } from '@/db';

export function useRepos(): Repositories {
  const db = useSQLiteContext();
  return useMemo(() => createRepositories(db), [db]);
}

/**
 * 画面が前に出るたびに読み直す。key（日付など）が変わったときも読み直す。
 * load は描くたびに作り直されるので、最新のものを ref に持ち、読み直すときにそれを使う
 */
export function useFocusData<T>(load: (r: Repositories) => Promise<T>, key?: string) {
  const repos = useRepos();
  const loadRef = useRef(load);
  useLayoutEffect(() => { loadRef.current = load; });
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  // 読み直しが重なったときは、最後に始めたものの結果だけを使う（先に始めた古い結果で上書きしない）
  const latest = useRef(0);
  const reload = useCallback(async () => {
    const n = ++latest.current;
    try {
      const next = await loadRef.current(repos);
      if (n !== latest.current) return;
      setData(next);
      setError(null);
    } catch (e) {
      if (n !== latest.current) return;
      setError(e instanceof Error ? e : new Error(String(e)));
    }
    // key は中で使わないが、変わったときに reload を作り直し、下の useFocusEffect で読み直すために入れる
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repos, key]);
  useFocusEffect(useCallback(() => { reload(); }, [reload]));
  return { data, error, reload, repos };
}
