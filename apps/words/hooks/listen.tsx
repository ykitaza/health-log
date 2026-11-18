import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ListItem } from '@/db/repositories/words';
import { apiBaseUrl } from '@/lib/auth/config';
import { reviewDay } from '@/lib/date';
import { createEngine } from '@/lib/listen/engine';
import { DEFAULT_PACE, ListenPace } from '@/lib/listen/pace';
import { EngineState, IDLE_STATE, Track } from '@/lib/listen/types';
import { createAudioFetcher, VoiceNote, voiceNoteText, VoiceSource } from '@/lib/listen/voice';
import { listenQueue } from '@/lib/schedule';
import { buildScript, spokenSections, spokenText } from '@/lib/speech';
import { useAuth } from './auth';
import { useRepos } from './data';
import { useNotifications } from './notifications';

/**
 * 聞く（運転中に耳で聞く）の再生をアプリ全体で持つ。タブを移っても・画面を消しても鳴らし続けるため、画面ではなくここに置く。
 * 1つ流し終えたら表現の listened_at・listen_count（と手札の間隔）を書き、止めたとき・最後まで流したときに、
 * 聞いた1回（listen_session：流した秒と数）を残す
 */
/** 聞く並び。all：手札 → 期限 → ★ → 最近拾った（既定）。hand：手札だけ（手札の画面の「聞く」から） */
export type ListenScope = 'all' | 'hand';

type Value = {
  state: EngineState;
  queue: ListItem[];
  /** 並びを作り直す（鳴らしていないときだけ。聞くの画面を開いたとき） */
  rebuild: () => Promise<void>;
  /** いまの並び */
  scope: ListenScope;
  /**
   * 並びを選んで作り直す（鳴らしていても止めて作り直す）。autoplay なら作り終えたら鳴らす。
   * navigate：このあと聞くの画面へ移る（移ったときの作り直しを1回飛ばす。聞くの画面の中から呼ぶときは false）
   */
  start: (scope: ListenScope, autoplay: boolean, navigate?: boolean) => Promise<void>;
  play: () => void;
  pause: () => void;
  next: () => void;
  previous: () => void;
  /** 設定の「自然な声（Polly）」 */
  naturalVoice: boolean;
  setNaturalVoice: (on: boolean) => Promise<void>;
  /** いまの声の一文（自然な声で読めた・端末の声に戻した理由）。自然な声がオフ・まだ読んでいないときは null */
  voice: string | null;
  /** 設定の読み方（速さ・くり返し・間）。変えると次に準備する語から効く */
  pace: ListenPace;
  setPace: (patch: Partial<ListenPace>) => Promise<void>;
};

const Ctx = createContext<Value | null>(null);

/**
 * 自然な声（Polly）：設定でオンにして、ログインしていて同期の先があるときだけサーバー（POST /v1/audio）から取る。
 * ほかは端末の読み上げ（既定）。取るたびにここを読むので、設定を変えると次に書き出す表現から効く
 */
const audioSource: VoiceSource = {
  polly: false, signedIn: false, configured: apiBaseUrl !== '', api: null,
  // 区切りのあいだの間は、準備（取る）ごとに今の設定を読む
  get pause() { return paceSource.current.pause; },
};
/** 読み方。1つを書き出す（準備する）たびにここを読むので、設定を変えると次に準備する語から効く */
const paceSource: { current: ListenPace } = { current: DEFAULT_PACE };

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
  /** 読み方（設定の画面と聞くで同じ値を見る）。自然な声と同じく、読み終える前に変えたら変えた値を使う */
  const [pace, setPaceState] = useState<ListenPace>(DEFAULT_PACE);
  const paceLoad = useRef<Promise<void> | null>(null);
  const paceTouched = useRef(false);
  const loadPace = useCallback(() => {
    paceLoad.current ??= repos.local.listenPace()
      .then((v) => { if (!paceTouched.current) { paceSource.current = v; setPaceState(v); } })
      .catch(() => {});
    return paceLoad.current;
  }, [repos]);
  useEffect(() => { void loadPace(); }, [loadPace]);
  const [engine] = useState(() => createEngine(createAudioFetcher(() => audioSource, setVoice), () => paceSource.current));

  /** 設定で読み方を変える。すぐに効かせ（次に準備する語から）、端末に残す。残せなければ戻す */
  const setPace = useCallback(async (patch: Partial<ListenPace>) => {
    paceTouched.current = true;
    const before = paceSource.current;
    const next = { ...before, ...patch };
    paceSource.current = next;
    setPaceState(next);
    try {
      await repos.local.setListenPace(next);
    } catch {
      paceSource.current = before;
      setPaceState(before);
    }
  }, [repos]);

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

  const [scope, setScope] = useState<ListenScope>('all');
  const scopeRef = useRef<ListenScope>('all');
  /** start のあと聞くの画面へ移ったときの作り直しを1回飛ばす（作ったばかりの並びを、止めた並びで作り直さないように） */
  const skipNextRebuild = useRef(false);

  const load = useCallback(async (autoplay: boolean) => {
    try {
      await Promise.all([loadVoice(), loadPace()]);
      setVoice(null);
      const all = await repos.words.listAll();
      const today = reviewDay(new Date());
      const q = listenQueue(all, today)
        .filter((x) => scopeRef.current === 'all' || x.group === 'due' || x.group === 'hand')
        .map((x) => x.expression);
      const tracks: Track[] = [];
      for (const e of q) {
        const tags = (await repos.words.tagsOf(e.id)).map((t) => ({ kind: t.kind, name: t.name, status: t.status }));
        const script = buildScript(e, tags);
        tracks.push({ id: e.id, title: e.text, reading: e.reading, speech: spokenText(script), sections: spokenSections(script) });
      }
      setQueue(q);
      setRebuildError(null);
      await engine.load(tracks, 0);
      if (autoplay && tracks.length > 0) engine.play();
    } catch (e) {
      // 握りつぶさず、画面に理由を出す
      setRebuildError(`聞く準備に失敗しました：${e instanceof Error ? e.message : String(e)}`);
    }
  }, [engine, repos, loadVoice, loadPace]);

  const rebuild = useCallback(async () => {
    if (skipNextRebuild.current) { skipNextRebuild.current = false; return; }
    if (engine.getState().playing) return;
    await load(false);
  }, [engine, load]);

  const start = useCallback(async (next: ListenScope, autoplay: boolean, navigate = true) => {
    skipNextRebuild.current = navigate;
    scopeRef.current = next;
    setScope(next);
    if (engine.getState().playing) engine.pause();
    await load(autoplay);
  }, [engine, load]);

  const shown = useMemo(() => (rebuildError && !state.error ? { ...state, error: rebuildError } : state), [state, rebuildError]);
  const value = useMemo(() => ({
    state: shown, queue, rebuild, scope, start, naturalVoice, setNaturalVoice, voice: voiceNoteText(voice), pace, setPace,
    play: () => engine.play(), pause: () => engine.pause(), next: () => engine.next(), previous: () => engine.previous(),
  }), [shown, queue, rebuild, scope, start, naturalVoice, setNaturalVoice, voice, pace, setPace, engine]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useListen(): Value {
  const v = useContext(Ctx);
  if (!v) throw new Error('ListenProvider の外では使えません');
  return v;
}
