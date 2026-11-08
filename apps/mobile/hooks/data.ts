import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { DependencyList, useCallback, useMemo, useState } from 'react';
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
  const reload = useCallback(async () => {
    try {
      setData(await load(repos));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    }
  }, [repos, ...deps]);
  useFocusEffect(useCallback(() => { reload(); }, [reload]));
  return { data, error, reload, repos };
}
