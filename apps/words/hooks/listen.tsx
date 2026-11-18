import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ListItem } from '@/db/repositories/words';
import type { ApiClient } from '@/lib/api';
import { apiBaseUrl } from '@/lib/auth/config';
import { reviewDay } from '@/lib/date';
import { createEngine } from '@/lib/listen/engine';
import { EngineState, IDLE_STATE, Track } from '@/lib/listen/types';
import { listenQueue } from '@/lib/schedule';
import { buildScript, spokenText } from '@/lib/speech';
import { useAuth } from './auth';
import { useRepos } from './data';
import { useNotifications } from './notifications';

/**
 * 聞く（運転中に耳で聞く）の再生をアプリ全体で持つ。タブを移っても・画面を消しても鳴らし続けるため、画面ではなくここに置く。
 * 1つ流し終えたら表現の listened_at・listen_count（と手札の間隔）を書き、止めたとき・最後まで流したときに、
 * 聞いた1回（listen_session：流した秒と数）を残す
 */
type Value = {
  state: EngineState;
  queue: ListItem[];
  /** 並びを作り直す（鳴らしていないときだけ） */
  rebuild: () => Promise<void>;
  play: () => void;
  pause: () => void;
  next: () => void;
  previous: () => void;
};

const Ctx = createContext<Value | null>(null);

/**
 * 自然な声（Polly）：設定でオンにして、ログインしていて同期の先があるときだけサーバー（POST /v1/audio）から取る。
 * ほかは端末の読み上げ（既定）
 */
const audioSource: { online: boolean; polly: boolean; api: ApiClient | null } = { online: false, polly: false, api: null };
const fetchAudio = async (id: string) => {
  if (!audioSource.polly || !audioSource.online || !audioSource.api) return null;
  try {
    return await audioSource.api.audio(id);
  } catch {
    return null;
  }
};

export function ListenProvider({ children }: { children: ReactNode }) {
  const repos = useRepos();
  const { status, api } = useAuth();
  const notifications = useNotifications();
  const [state, setState] = useState<EngineState>(IDLE_STATE);
  const [queue, setQueue] = useState<ListItem[]>([]);
  useEffect(() => {
    audioSource.online = status === 'signedIn' && apiBaseUrl !== '';
    audioSource.api = api;
  }, [status, api]);
  const [engine] = useState(() => createEngine(fetchAudio));
  /** いま聞いている1回（流し始めた時刻・流した秒・流し終えた数） */
  const session = useRef<{ startedAt: Date; seconds: number; items: number } | null>(null);

  const flush = useCallback(async () => {
    const s = session.current;
    session.current = null;
    if (!s) return;
    await repos.words.recordListenSession(s.startedAt, s.seconds, s.items).catch(() => {});
    void notifications.reschedule();
  }, [repos, notifications]);

  useEffect(() => {
    let wasPlaying = false;
    const off = engine.subscribe((s) => {
      setState(s);
      if (s.playing && !session.current) session.current = { startedAt: new Date(), seconds: 0, items: 0 };
      // 止めた（一時停止・最後まで流した）ところで、聞いた1回を残す
      if (wasPlaying && !s.playing && !s.loading) void flush();
      wasPlaying = s.playing;
    });
    const offListened = engine.onListened((id, seconds) => {
      if (session.current) { session.current.seconds += seconds; session.current.items += 1; }
      void repos.words.recordListen(id).catch(() => {});
    });
    return () => { off(); offListened(); };
  }, [engine, repos, flush]);
  useEffect(() => () => engine.destroy(), [engine]);

  const rebuild = useCallback(async () => {
    if (engine.getState().playing) return;
    audioSource.polly = await repos.local.naturalVoice().catch(() => false);
    const all = await repos.words.listAll();
    const q = listenQueue(all, reviewDay(new Date())).map((x) => x.expression);
    const tracks: Track[] = [];
    for (const e of q) {
      const tags = (await repos.words.tagsOf(e.id)).map((t) => ({ kind: t.kind, name: t.name, status: t.status }));
      tracks.push({ id: e.id, title: e.text, reading: e.reading, speech: spokenText(buildScript(e, tags)) });
    }
    setQueue(q);
    await engine.load(tracks, 0);
  }, [engine, repos]);

  const value = useMemo(() => ({
    state, queue, rebuild,
    play: () => engine.play(), pause: () => engine.pause(), next: () => engine.next(), previous: () => engine.previous(),
  }), [state, queue, rebuild, engine]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useListen(): Value {
  const v = useContext(Ctx);
  if (!v) throw new Error('ListenProvider の外では使えません');
  return v;
}
