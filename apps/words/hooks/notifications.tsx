import { router } from 'expo-router';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { notifier } from '@/lib/notifier';
import type { NotifyPlan } from '@/lib/notifyPlan';
import { reschedule as run } from '@/lib/reschedule';
import { onRemoteChange } from '@/lib/sync/events';
import { useRepos } from './data';

/**
 * ローカル通知（docs/words-design.md の「通知」）。予約し直すのは、前面・裏に回したとき、同期のあと、聞いたあと。
 * 前面にした時刻を端末に覚え（通知の時刻を決める）、通知を押して開いたら聞くを開く
 */
type Value = {
  permitted: boolean | null;
  plan: NotifyPlan;
  reschedule: () => Promise<void>;
  /** 初めて手札に入れたときに1回だけ許可を聞く */
  askOnce: () => Promise<void>;
  /** 設定の画面から許可を聞く */
  request: () => Promise<boolean>;
};

const Ctx = createContext<Value | null>(null);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const repos = useRepos();
  const [permitted, setPermitted] = useState<boolean | null>(null);
  const [plan, setPlan] = useState<NotifyPlan>(null);
  const running = useRef<Promise<void> | null>(null);

  const reschedule = useCallback(async () => {
    // 続けて呼ばれたら、前の回が終わるのを待ってから1回だけ
    await running.current?.catch(() => {});
    const task = (async () => {
      setPermitted(await notifier.permitted().catch(() => false));
      const p = await run({
        now: () => new Date(),
        notifier,
        handDue: async () => (await repos.words.hand()).map((e) => e.due_on),
        opens: repos.local.opens,
        notified: repos.local.notified,
        recordNotified: repos.local.recordNotified,
        // その週に自分で聞いたら送らない（聞いた1回 listen_session）
        selfListens: async (since) => (await repos.words.listenSessions(since)).map((x) => new Date(x.started_at)),
        planned: repos.local.plannedNotification,
        setPlanned: repos.local.setPlannedNotification,
      });
      setPlan(p);
    })();
    running.current = task;
    await task.catch(() => {});
  }, [repos]);

  useEffect(() => {
    void repos.local.recordOpen().then(reschedule);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void repos.local.recordOpen().then(reschedule);
      else if (state === 'background') void reschedule();
    });
    const off = onRemoteChange(() => { void reschedule(); });
    const offOpen = notifier.onOpen(() => router.push('/listen'));
    return () => { sub.remove(); off(); offOpen(); };
  }, [repos, reschedule]);

  const request = useCallback(async () => {
    const ok = await notifier.request().catch(() => false);
    await repos.local.setNotifyAsked();
    setPermitted(ok);
    await reschedule();
    return ok;
  }, [repos, reschedule]);

  const askOnce = useCallback(async () => {
    if (await repos.local.notifyAsked()) return;
    await request();
  }, [repos, request]);

  const value = useMemo(() => ({ permitted, plan, reschedule, askOnce, request }), [permitted, plan, reschedule, askOnce, request]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNotifications(): Value {
  const v = useContext(Ctx);
  if (!v) throw new Error('NotificationsProvider の外では使えません');
  return v;
}
