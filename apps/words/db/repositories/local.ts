// 端末だけに置くもの（同期しない）：アプリを前面にした時刻、通知を送った時刻、小さな設定（sync_meta）
import { isChatApp, type ChatApp } from '@/lib/chat';
import { ListenPace, parsePace, serializePace } from '@/lib/listen/pace';
import { oneAtATime } from '../serial';
import type { Db, Deps } from '../types';

const KEYS = {
  lastChatApp: 'chat.last_app',
  /** 予約している通知の時刻（過ぎていたら「送った」に数える） */
  plannedNotification: 'notify.planned_at',
  /** 通知の許可をもう聞いたか（初めて手札に入れたときに1回だけ聞く） */
  notifyAsked: 'notify.asked',
  /** 聞くの「自然な声（Polly）」。既定はオフ（端末の読み上げ） */
  naturalVoice: 'listen.natural_voice',
  /** 聞くの読み方（速さ・くり返し・間。JSON）。既定は 1.0 倍・1 回・ふつう */
  listenPace: 'listen.pace',
  /** 初めの画面（ログインするか、ログインせずに使うか）を済ませたか */
  welcomed: 'welcome.done',
} as const;

/** アプリを前面にした時刻は、通知の時刻を決めるのに直近14日だけ使う。古いものは消す */
const KEEP_MS = 30 * 86_400_000;

export function localRepository(db: Db, deps: Deps) {
  const meta = async (key: string) =>
    (await db.getFirstAsync<{ value: string | null }>('SELECT value FROM sync_meta WHERE key = ?', [key]))?.value ?? null;
  const put = (key: string, value: string | null) => oneAtATime(db, () => db.runAsync(
    'INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', [key, value],
  ));
  const events = async (kind: 'open' | 'notified', sinceMs: number) => (await db.getAllAsync<{ at: string }>(
    'SELECT at FROM local_events WHERE kind = ? AND at >= ? ORDER BY at', [kind, new Date(sinceMs).toISOString()],
  )).map((r) => new Date(r.at));

  return {
    async lastChatApp(): Promise<ChatApp | null> {
      const v = await meta(KEYS.lastChatApp);
      return isChatApp(v) ? v : null;
    },
    setLastChatApp: (app: ChatApp) => put(KEYS.lastChatApp, app),

    async welcomed() { return (await meta(KEYS.welcomed)) === '1'; },
    setWelcomed: () => put(KEYS.welcomed, '1'),

    async naturalVoice() { return (await meta(KEYS.naturalVoice)) === '1'; },
    setNaturalVoice: (on: boolean) => put(KEYS.naturalVoice, on ? '1' : '0'),

    async listenPace(): Promise<ListenPace> { return parsePace(await meta(KEYS.listenPace)); },
    setListenPace: (pace: ListenPace) => put(KEYS.listenPace, serializePace(pace)),

    async notifyAsked() { return (await meta(KEYS.notifyAsked)) === '1'; },
    setNotifyAsked: () => put(KEYS.notifyAsked, '1'),

    plannedNotification: () => meta(KEYS.plannedNotification),
    setPlannedNotification: (iso: string | null) => put(KEYS.plannedNotification, iso),

    /** アプリを前面にした（1分以内に続けて来たものは1回に数える） */
    recordOpen: () => oneAtATime(db, async () => {
      const now = deps.now();
      const last = await db.getFirstAsync<{ at: string }>(`SELECT at FROM local_events WHERE kind = 'open' ORDER BY at DESC LIMIT 1`, []);
      if (last && now.getTime() - Date.parse(last.at) < 60_000) return;
      await db.runAsync(`INSERT INTO local_events (kind, at) VALUES ('open', ?)`, [now.toISOString()]);
      await db.runAsync(`DELETE FROM local_events WHERE at < ?`, [new Date(now.getTime() - KEEP_MS).toISOString()]);
    }),
    opens: (sinceMs: number) => events('open', sinceMs),

    recordNotified: (at: Date) => oneAtATime(db, () => db.runAsync(`INSERT INTO local_events (kind, at) VALUES ('notified', ?)`, [at.toISOString()])),
    notified: (sinceMs: number) => events('notified', sinceMs),
  };
}

export type LocalRepository = ReturnType<typeof localRepository>;
