import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ListItem } from '@/db/repositories/words';
import { apiBaseUrl } from '@/lib/auth/config';
import { reviewDay } from '@/lib/date';
import { createEngine } from '@/lib/listen/engine';
import { EngineState, IDLE_STATE, Track } from '@/lib/listen/types';
import { createAudioFetcher, VoiceNote, voiceNoteText, VoiceSource } from '@/lib/listen/voice';
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
  /** 設定の「自然な声（Polly）」 */
  naturalVoice: boolean;
  setNaturalVoice: (on: boolean) => Promise<void>;
  /** いまの声の一文（自然な声で読めた・端末の声に戻した理由）。自然な声がオフ・まだ読んでいないときは null */
  voice: string | null;
};

const Ctx = createContext<Value | null>(null);

/**
 * 自然な声（Polly）：設定でオンにして、ログインしていて同期の先があるときだけサーバー（POST /v1/audio）から取る。
 * ほかは端末の読み上げ（既定）。取るたびにここを読むので、設定を変えると次に書き出す表現から効く
 */
const audioSource: VoiceSource = { polly: false, signedIn: false, configured: apiBaseUrl !== '', api: null };

export function ListenProvider({ children }: { children: ReactNode }) {
  const repos = useRepos();
  const { status, api } = useAuth();
  const notifications = useNotifications();
  const [state, setState] = useState<EngineState>(IDLE_STATE);
  const [queue, setQueue] = useState<ListItem[]>([]);
  /** 並びを作れなかった理由（画面に出す） */
  const [rebuildError, setRebuildError] = useState<string | null>(null);
  /** 設定の「自然な声」（設定の画面と聞くで同じ値を見る） */
  const [naturalVoice, setNaturalVoiceState] = useState(false);
  /** いまの声（自然な声で読めた・端末の声に戻した理由） */
  const [voice, setVoice] = useState<VoiceNote>(null);
  useEffect(() => {
    audioSource.signedIn = status === 'signedIn';
    audioSource.api = api;
  }, [status, api]);
  /** 端末に残した「自然な声」を1回だけ読む（読み終える前に切り替えたら、切り替えた値を使う） */
  const voiceLoad = useRef<Promise<void> | null>(null);
  const touched = useRef(false);
  const loadVoice = useCallback(() => {
    voiceLoad.current ??= repos.local.naturalVoice()
      .then((v) => { if (!touched.current) { audioSource.polly = v; setNaturalVoiceState(v); } })
      .catch(() => {});
    return voiceLoad.current;
  }, [repos]);
  useEffect(() => { void loadVoice(); }, [loadVoice]);
  const [engine] = useState(() => createEngine(createAudioFetcher(() => audioSource, setVoice)));

  /** 設定で「自然な声」を切り替える。すぐに効かせ（次に書き出す表現から）、端末に残す。残せなければ戻す */
  const setNaturalVoice = useCallback(async (on: boolean) => {
    touched.current = true;
    const before = audioSource.polly;
    audioSource.polly = on;
    setNaturalVoiceState(on);
    setVoice(null);
    try {
      await repos.local.setNaturalVoice(on);
    } catch {
      audioSource.polly = before;
      setNaturalVoiceState(before);
    }
  }, [repos]);
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
    try {
      await loadVoice();
      setVoice(null);
      const all = await repos.words.listAll();
      const q = listenQueue(all, reviewDay(new Date())).map((x) => x.expression);
      const tracks: Track[] = [];
      for (const e of q) {
        const tags = (await repos.words.tagsOf(e.id)).map((t) => ({ kind: t.kind, name: t.name, status: t.status }));
        tracks.push({ id: e.id, title: e.text, reading: e.reading, speech: spokenText(buildScript(e, tags)) });
      }
      setQueue(q);
      setRebuildError(null);
      await engine.load(tracks, 0);
    } catch (e) {
      // 握りつぶさず、画面に理由を出す
      setRebuildError(`聞く準備に失敗しました：${e instanceof Error ? e.message : String(e)}`);
    }
  }, [engine, repos, loadVoice]);

  const shown = useMemo(() => (rebuildError && !state.error ? { ...state, error: rebuildError } : state), [state, rebuildError]);
  const value = useMemo(() => ({
    state: shown, queue, rebuild, naturalVoice, setNaturalVoice, voice: voiceNoteText(voice),
    play: () => engine.play(), pause: () => engine.pause(), next: () => engine.next(), previous: () => engine.previous(),
  }), [shown, queue, rebuild, naturalVoice, setNaturalVoice, voice, engine]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useListen(): Value {
  const v = useContext(Ctx);
  if (!v) throw new Error('ListenProvider の外では使えません');
  return v;
}
