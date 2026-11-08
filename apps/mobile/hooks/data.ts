import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { DependencyList, useCallback, useMemo, useRef, useState } from 'react';
import { createRepositories, Repositories } from '@/db';

export function useRepos(): Repositories {
  const db = useSQLiteContext();
  return useMemo(() => createRepositories(db), [db]);
}

/** 画面が前に出るたびに読み直す */
export function useFocusData<T>(load: (r: Repositories) => Promise<T>, deps: DependencyList = []) {
  const repos = useRepos();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  // 読み直しが重なったときは、最後に始めたものの結果だけを使う（先に始めた古い結果で上書きしない）
  const latest = useRef(0);
  const reload = useCallback(async () => {
    const n = ++latest.current;
    try {
      const next = await load(repos);
      if (n !== latest.current) return;
      setData(next);
      setError(null);
    } catch (e) {
      if (n !== latest.current) return;
      setError(e instanceof Error ? e : new Error(String(e)));
    }
  }, [repos, ...deps]);
  useFocusEffect(useCallback(() => { reload(); }, [reload]));
  return { data, error, reload, repos };
}
