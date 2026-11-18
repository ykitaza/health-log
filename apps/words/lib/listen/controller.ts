/**
 * 聞くの再生の土台（端末と web で共通）。並び・位置・聞いたの数え方・知らせを持ち、音を出す部分（Output）だけを差し替える。
 * jest では偽の Output で確かめる
 */
import { countsAsListened } from './queue';
import { EngineState, IDLE_STATE, ListenEngine, Track } from './types';

/** 音を出す部分。1つの表現を鳴らし、終わったら onEnd を呼ぶ */
export interface Output {
  /** i 番目を鳴らす準備（音声を取る・写しを読む）。鳴らせなければ false（飛ばす） */
  prepare(track: Track, i: number): Promise<boolean>;
  start(track: Track, i: number, events: {
    onProgress: (position: number, duration: number) => void;
    onEnd: () => void;
    /** 鳴らせなかった（理由を画面に出して止まる） */
    onError?: (message: string) => void;
  }): void;
  pause(): void;
  resume(): void;
  stop(): void;
  /** 先に取っておく（いまの位置の次から） */
  prefetch?(tracks: Track[], from: number): void;
  /** ロック画面の表示 */
  nowPlaying?(track: Track, index: number, length: number, playing: boolean): void;
  mode: EngineState['mode'];
  destroy?(): void;
}

export function createController(output: Output): ListenEngine {
  let tracks: Track[] = [];
  let state: EngineState = IDLE_STATE;
  let counted = new Set<number>();
  let token = 0;
  const listeners = new Set<(s: EngineState) => void>();
  const listened = new Set<(id: string, seconds: number) => void>();

  const set = (patch: Partial<EngineState>) => {
    state = { ...state, ...patch };
    for (const l of listeners) l(state);
  };

  const count = (i: number, finished: boolean) => {
    if (counted.has(i) || !tracks[i]) return;
    if (!countsAsListened(state.position, state.duration, finished)) return;
    counted.add(i);
    for (const l of listened) l(tracks[i].id, finished ? state.duration : state.position);
  };

  /** i 番目から、鳴らせるものを探して鳴らす（dir の向きに飛ばす） */
  async function go(i: number, dir: 1 | -1, autoplay: boolean) {
    const my = ++token;
    output.stop();
    let j = i;
    set({ loading: true, playing: autoplay, position: 0, duration: 0, error: null });
    while (j >= 0 && j < tracks.length) {
      const ok = await output.prepare(tracks[j], j).catch(() => false);
      if (my !== token) return;
      if (ok) break;
      j += dir;
    }
    if (j < 0 || j >= tracks.length) {
      set({ loading: false, playing: false, index: Math.min(Math.max(i, 0), Math.max(tracks.length - 1, 0)) });
      return;
    }
    set({ index: j, loading: false, mode: output.mode });
    output.prefetch?.(tracks, j + 1);
    output.nowPlaying?.(tracks[j], j, tracks.length, autoplay);
    if (!autoplay) return;
    output.start(tracks[j], j, {
      onProgress: (position, duration) => { if (my === token) set({ position, duration }); },
      onEnd: () => {
        if (my !== token) return;
        count(j, true);
        if (j + 1 < tracks.length) void go(j + 1, 1, true);
        else set({ playing: false });
      },
      onError: (message) => {
        if (my !== token) return;
        set({ playing: false, loading: false, error: message });
      },
    });
  }

  return {
    async load(next, start) {
      tracks = next;
      counted = new Set();
      set({ ...IDLE_STATE, length: next.length, index: Math.min(start, Math.max(next.length - 1, 0)) });
      if (next.length > 0) await go(state.index, 1, false);
    },
    play() {
      if (tracks.length === 0) return;
      if (state.playing) return;
      if (state.position > 0 && state.position < state.duration) {
        output.resume();
        set({ playing: true });
        output.nowPlaying?.(tracks[state.index], state.index, tracks.length, true);
      } else void go(state.index, 1, true);
    },
    pause() {
      output.pause();
      set({ playing: false });
      if (tracks[state.index]) output.nowPlaying?.(tracks[state.index], state.index, tracks.length, false);
    },
    next() {
      count(state.index, false);
      if (state.index + 1 < tracks.length) void go(state.index + 1, 1, true);
    },
    previous() {
      // 少し聞いていたら、同じものの頭に戻る（車のボタンと同じ）
      if (state.position > 3) void go(state.index, 1, true);
      else if (state.index > 0) void go(state.index - 1, -1, true);
      else void go(0, 1, true);
    },
    getState: () => state,
    subscribe(l) { listeners.add(l); return () => { listeners.delete(l); }; },
    onListened(l) { listened.add(l); return () => { listened.delete(l); }; },
    destroy() {
      token++;
      output.stop();
      output.destroy?.();
      listeners.clear();
      listened.clear();
    },
  };
}
