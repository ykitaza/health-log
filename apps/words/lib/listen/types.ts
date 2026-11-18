/** 聞くの再生の部品の形（端末は engine.ts、web は engine.web.ts） */
export type Track = {
  id: string;
  /** 表現（ロック画面の題） */
  title: string;
  reading: string;
  /** 読み上げる文 */
  speech: string;
};

/** audio：一時ファイルを再生の並びで鳴らす（端末の読み上げか自然な声）。speech：その場で読む（iOS・書き出せないとき）。idle：まだ */
export type EngineMode = 'audio' | 'speech' | 'idle';

export type EngineState = {
  /** いま聞いている表現の位置（並びの中） */
  index: number;
  length: number;
  playing: boolean;
  /** 秒 */
  position: number;
  duration: number;
  mode: EngineMode;
  loading: boolean;
};

export const IDLE_STATE: EngineState = { index: 0, length: 0, playing: false, position: 0, duration: 0, mode: 'idle', loading: false };

/** サーバーの音声（MP3）を取る。自然な声がオフ・つながらない・まだ同期していないときは null（端末の読み上げにする） */
export type FetchAudio = (id: string) => Promise<ArrayBuffer | null>;

export interface ListenEngine {
  load(tracks: Track[], start: number): Promise<void>;
  play(): void;
  pause(): void;
  next(): void;
  previous(): void;
  getState(): EngineState;
  subscribe(listener: (s: EngineState) => void): () => void;
  /** 1つ聞き終えた（最後まで、または 6 割以上聞いて次へ） */
  onListened(listener: (id: string, seconds: number) => void): () => void;
  destroy(): void;
}
