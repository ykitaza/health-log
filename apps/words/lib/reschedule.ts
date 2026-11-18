/**
 * 通知を予約し直す（前面・裏に回したとき、同期のあと、聞いたあと）。予約は常に1つだけ。
 * 端末の通知（Notifier）と記録の読み書きは外から渡し、jest で確かめる
 */
import { planNotification, NOTIFY_TITLE, NotifyPlan, OPEN_WINDOW_DAYS } from './notifyPlan';

export interface Notifier {
  permitted(): Promise<boolean>;
  request(): Promise<boolean>;
  schedule(at: Date, title: string, body: string): Promise<void>;
  cancel(): Promise<void>;
  /** 通知を押してアプリを開いたとき。止める関数を返す */
  onOpen(listener: () => void): () => void;
}

export type RescheduleDeps = {
  now: () => Date;
  notifier: Notifier;
  handDue: () => Promise<(string | null)[]>;
  opens: (sinceMs: number) => Promise<Date[]>;
  notified: (sinceMs: number) => Promise<Date[]>;
  recordNotified: (at: Date) => Promise<unknown>;
  selfListens: (sinceIso: string) => Promise<Date[]>;
  planned: () => Promise<string | null>;
  setPlanned: (iso: string | null) => Promise<unknown>;
};

/** 直近の記録を読む長さ（週の回数・48時間の間・自分で振り返った週を見るのに足りる長さ） */
const RECENT_MS = 14 * 86_400_000;

export async function reschedule(d: RescheduleDeps): Promise<NotifyPlan> {
  const now = d.now();
  // 前に予約した時刻を過ぎていれば、送ったものとして数える（ローカル通知は、送ったことをアプリが知れないため）
  const planned = await d.planned();
  if (planned && Date.parse(planned) <= now.getTime()) {
    await d.recordNotified(new Date(planned));
    await d.setPlanned(null);
  }
  const permitted = await d.notifier.permitted().catch(() => false);
  const plan = planNotification({
    now,
    permitted,
    handDue: await d.handDue(),
    opens: await d.opens(now.getTime() - OPEN_WINDOW_DAYS * 86_400_000),
    sent: await d.notified(now.getTime() - RECENT_MS),
    selfListens: await d.selfListens(new Date(now.getTime() - RECENT_MS).toISOString()),
  });
  if (!plan) {
    await d.notifier.cancel().catch(() => {});
    await d.setPlanned(null);
    return null;
  }
  await d.notifier.schedule(plan.at, NOTIFY_TITLE, plan.body);
  await d.setPlanned(plan.at.toISOString());
  return plan;
}
