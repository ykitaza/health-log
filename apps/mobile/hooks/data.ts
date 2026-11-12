import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRepositories, Repositories } from '@/db';
import type { DateKey } from '@/lib/date';
import { loadGrowthData } from '@/lib/growthData';
import { onRemoteChange } from '@/lib/sync/events';

export function useRepos(): Repositories {
  const db = useSQLiteContext();
  return useMemo(() => createRepositories(db), [db]);
}

/**
 * 画面が前に出るたびに読み直す。key（日付など）が変わったときと、同期でサーバーの変更を当てはめたときも読み直す。
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
  useEffect(() => onRemoteChange(() => { reload(); }), [reload]);
  return { data, error, reload, repos };
}

/** その日を含む週（月〜日）の達成（lib/goals.ts の WeeklyAchievement）。date はその週のどの日でもよい */
export function useWeeklyAchievement(date: DateKey) {
  return useFocusData((r) => r.achievements.week(date), date);
}

/** その日の達成（lib/goals.ts の DailyAchievement） */
export function useDailyAchievement(date: DateKey) {
  return useFocusData((r) => r.achievements.day(date), date);
}

/**
 * まだ作っていないまとめ（lib/reports.ts の PendingReport の一覧）。dismiss で閉じると、もう出さない（端末だけに覚える）。
 * 時刻（21時を過ぎたか）は、画面が前に出たときと読み直したときに見る
 */
export function usePendingReports() {
  const q = useFocusData((r) => r.achievements.pending());
  const { repos, reload } = q;
  const dismiss = useCallback(async (key: string) => { await repos.reports.dismissPending(key); await reload(); }, [repos, reload]);
  return { ...q, dismiss };
}

/** 「記録で育つ形」に要る全期間の記録（lib/growthData.ts の GrowthData）。today を渡し、日をまたいだら読み直す */
export function useGrowthData(today: DateKey) {
  return useFocusData((r) => loadGrowthData(r, today), today);
}
