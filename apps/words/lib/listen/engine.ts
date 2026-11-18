/**
 * 端末の聞く（Android）。声は端末の読み上げ（Pixel では Google の音声。無料で、つながらなくても使える）。
 *
 * 画面を消しても鳴らし続け、ロック画面・通知の操作と、車の Bluetooth の「次」「前」で動かすため、
 * 読み上げをその場で鳴らす（expo-speech）のではなく、いま聞くものと次のものだけを一時ファイル（WAV）に書き出し、
 * expo-audio の再生の並び（AudioPlaylist。メディアセッションと裏での再生を持つ）で鳴らす。
 * - 書き出すのは自前の小さなモジュール（modules/kotoba-tts。Android の TextToSpeech.synthesizeToFile）
 * - 一時ファイルは「いま」と「次」の2つまで。鳴らし終えたらすぐ消す。保存（キャッシュ）はしない。起動のときに一時フォルダを空にする
 * - 設定の「自然な声（Polly）」をオンにしたときだけ、サーバーの音声（POST /v1/audio の MP3）を同じ一時ファイルの作りで使う
 *
 * 並びは [しるし, いま, 次]。しるしは同梱の短い無音（assets/audio/marker.wav。一時ファイルではない）。
 * 車やロック画面の「前」は、並びの中で前（しるし）へ移るので、それを受けて前の表現を書き出し、並びを作り直す。
 * 「次」と、聞き終えて次へ進んだときは、終えたもののファイルを消し、さらに次を書き出して足す。
 *
 * 端末の読み上げのモジュールがない（iOS）・書き出せないときは、expo-speech でその場で読む（画面を開いているあいだの操作）
 */
import { AudioPlaylist, createAudioPlaylist, setAudioModeAsync } from 'expo-audio';
import { Directory, File, Paths } from 'expo-file-system';
import * as Speech from 'expo-speech';
import { KotobaTts } from '@/modules/kotoba-tts';
import { createController, Output } from './controller';
import { countsAsListened } from './queue';
import { estimateSeconds } from './timerOutput';
import { EngineState, FetchAudio, IDLE_STATE, ListenEngine, Track } from './types';

const MARKER = require('@/assets/audio/marker.wav') as number;
const LOCK_OPTIONS = { showNextTrack: true, showPreviousTrack: true, showSeekForward: false, showSeekBackward: false };
/** 読み上げの速さ（1 がふつう。運転中に聞き取りやすいよう少しゆっくり） */
const RATE = 0.95;

/** 端末の声でその場で読む出力（iOS と、書き出せないとき） */
function speechOutput(): Output {
  let current: { track: Track; ev: Parameters<Output['start']>[2] } | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let position = 0;
  const clear = () => { if (timer) clearInterval(timer); timer = null; };
  const speak = () => {
    if (!current) return;
    const { track, ev } = current;
    const duration = estimateSeconds(track);
    clear();
    timer = setInterval(() => { position = Math.min(duration, position + 0.5); ev.onProgress(position, duration); }, 500);
    Speech.speak(track.speech, { language: 'ja-JP', rate: RATE, onDone: () => { clear(); ev.onProgress(duration, duration); ev.onEnd(); } });
  };
  return {
    mode: 'speech',
    async prepare() { return true; },
    start(track, _i, ev) { current = { track, ev }; position = 0; speak(); },
    // その場の読み上げは途中から続けられない（Android）ので、止めて、再開は頭から読む
    pause() { clear(); void Speech.stop(); },
    resume() { position = 0; speak(); },
    stop() { clear(); current = null; void Speech.stop(); },
  };
}

const plainPath = (uri: string) => decodeURIComponent(uri.replace(/^file:\/\//, ''));

export function createEngine(fetchAudio: FetchAudio): ListenEngine {
  const dir = new Directory(Paths.cache, 'kotoba-tts');
  let tracks: Track[] = [];
  let playlist: AudioPlaylist | null = null;
  let speech: ListenEngine | null = null;
  /** いま（並びの1番目）と次（2番目）の表現の位置と一時ファイル */
  let cur: { i: number; file: File } | null = null;
  let nxt: { i: number; file: File } | null = null;
  /** 並びを作り直しているあいだは、並びの知らせを受けない */
  let rebuilding = false;
  let state: EngineState = IDLE_STATE;
  let last = { position: 0, duration: 0 };
  const counted = new Set<number>();
  const listeners = new Set<(s: EngineState) => void>();
  const listened = new Set<(id: string, seconds: number) => void>();
  const subs: { remove: () => void }[] = [];
  let modeSet = false;

  const set = (patch: Partial<EngineState>) => {
    state = { ...state, ...patch };
    for (const l of listeners) l(state);
  };
  const count = (i: number, position: number, duration: number, finished: boolean) => {
    if (i < 0 || counted.has(i) || !tracks[i] || !countsAsListened(position, duration, finished)) return;
    counted.add(i);
    for (const l of listened) l(tracks[i].id, finished ? duration : position);
  };
  const remove = (f: { file: File } | null) => { try { if (f?.file.exists) f.file.delete(); } catch { /* 消せなくても、次の起動で空にする */ } };

  /** 一時フォルダを空にする（起動のときと、並びを作り直すとき） */
  function cleanDir() {
    try { if (dir.exists) dir.delete(); } catch { /* 残っていても上書きする */ }
    try { dir.create({ intermediates: true, idempotent: true }); } catch { /* 作れなければ書き出しで失敗する */ }
  }
  cleanDir();

  /** i 番目を一時ファイルに書き出す（自然な声がオンでつながればサーバーの MP3、ほかは端末の読み上げの WAV） */
  async function render(i: number): Promise<{ i: number; file: File } | null> {
    const t = tracks[i];
    if (!t) return null;
    try {
      const bytes = await fetchAudio(t.id);
      if (bytes) {
        const file = new File(dir, `${i}-${t.id}.mp3`);
        await file.write(new Uint8Array(bytes));
        return { i, file };
      }
      if (!KotobaTts) return null;
      const file = new File(dir, `${i}-${t.id}.wav`);
      await KotobaTts.synthesizeToFile(t.speech, plainPath(file.uri), RATE);
      return file.exists ? { i, file } : null;
    } catch {
      return null;
    }
  }

  const meta = (i: number) => ({ title: tracks[i]?.title ?? '', artist: 'ことば', albumTitle: tracks[i]?.reading || undefined });

  /** i 番目から鳴らし直す（並びを [しるし, i, i+1] に作り直す）。一時ファイルは2つまで */
  async function startAt(i: number, autoplay: boolean) {
    if (!playlist) return;
    rebuilding = true;
    set({ loading: true, index: i, position: 0, duration: 0 });
    playlist.pause();
    remove(cur);
    remove(nxt);
    cur = null;
    nxt = null;
    // 書き出せないものは飛ばす
    let j = i;
    while (j < tracks.length && !cur) { cur = await render(j); if (!cur) j++; }
    if (!cur) { rebuilding = false; set({ loading: false, playing: false }); return; }
    nxt = await render(cur.i + 1);
    playlist.clear();
    playlist.add(MARKER);
    playlist.add({ uri: cur.file.uri });
    if (nxt) playlist.add({ uri: nxt.file.uri });
    playlist.skipTo(1);
    try { playlist.updateLockScreenMetadata(meta(cur.i)); } catch { /* ロック画面がないとき */ }
    last = { position: 0, duration: 0 };
    set({ index: cur.i, loading: false, mode: 'audio' });
    if (autoplay) playlist.play();
    setTimeout(() => { rebuilding = false; }, 0);
  }

  /** 次へ進んだ（並びの2番目に移った）：終えたものを消し、さらに次を書き出して足す */
  async function advanced() {
    if (!playlist || !cur) return;
    rebuilding = true;
    const done = cur;
    remove(done);
    cur = nxt;
    nxt = null;
    playlist.remove(1); // [しるし, いま]
    if (!cur) { rebuilding = false; set({ playing: false }); return; }
    set({ index: cur.i, position: 0, duration: 0 });
    try { playlist.updateLockScreenMetadata(meta(cur.i)); } catch { /* ロック画面がないとき */ }
    setTimeout(() => { rebuilding = false; }, 0);
    const next = await render(cur.i + 1);
    if (next && playlist && cur && next.i === cur.i + 1) { nxt = next; playlist.add({ uri: next.file.uri }); } else remove(next);
  }

  function teardown() {
    for (const s of subs.splice(0)) s.remove();
    if (playlist) {
      try { playlist.clearLockScreenControls(); } catch { /* なくてもよい */ }
      playlist.destroy();
    }
    playlist = null;
    remove(cur);
    remove(nxt);
    cur = null;
    nxt = null;
    speech?.destroy();
    speech = null;
  }

  return {
    async load(next, start) {
      teardown();
      cleanDir();
      tracks = next;
      counted.clear();
      set({ ...IDLE_STATE, length: next.length, index: start });
      if (next.length === 0) return;
      if (!modeSet) {
        modeSet = true;
        await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' }).catch(() => {});
      }
      const usable = KotobaTts ? await KotobaTts.isAvailable().catch(() => false) : false;
      if (!usable) {
        speech = createController(speechOutput());
        subs.push({ remove: speech.subscribe((s) => set(s)) });
        subs.push({ remove: speech.onListened((id, sec) => { for (const l of listened) l(id, sec); }) });
        await speech.load(next, start);
        return;
      }
      const p = createAudioPlaylist({ sources: [], loop: 'none', updateInterval: 500 });
      playlist = p;
      subs.push(p.addListener('playlistStatusUpdate', (st) => {
        if (rebuilding || st.currentIndex !== 1 || !cur) return;
        last = { position: st.currentTime, duration: st.duration };
        if (st.didJustFinish) {
          count(cur.i, st.duration, st.duration, true);
          if (!nxt) { remove(cur); set({ playing: false }); }
        }
        set({ playing: st.playing, position: st.currentTime, duration: st.duration, loading: st.isBuffering && !st.isLoaded });
      }));
      subs.push(p.addListener('trackChanged', ({ currentIndex }) => {
        if (rebuilding || !cur) return;
        if (currentIndex === 2) {
          // 次へ（聞き終えた・次を押した・車の「次」）
          count(cur.i, last.position, last.duration, false);
          void advanced();
        } else if (currentIndex === 0) {
          // 前（車・ロック画面の「前」でしるしへ来た）
          if (last.position > 3 || cur.i === 0) void startAt(cur.i, true);
          else void startAt(cur.i - 1, true);
        }
      }));
      try { p.setActiveForLockScreen(true, meta(start), LOCK_OPTIONS); } catch { /* なくても鳴らせる */ }
      await startAt(start, false);
    },
    play() { if (speech) speech.play(); else playlist?.play(); },
    pause() { if (speech) speech.pause(); else playlist?.pause(); },
    next() {
      if (speech) { speech.next(); return; }
      if (!playlist || !cur) return;
      if (nxt) playlist.next();
      else if (cur.i + 1 < tracks.length) void startAt(cur.i + 1, true);
    },
    previous() {
      if (speech) { speech.previous(); return; }
      if (!playlist || !cur) return;
      if (state.position > 3 || cur.i === 0) void playlist.seekTo(0);
      else void startAt(cur.i - 1, true);
    },
    getState: () => state,
    subscribe(l) { listeners.add(l); return () => { listeners.delete(l); }; },
    onListened(l) { listened.add(l); return () => { listened.delete(l); }; },
    destroy() {
      teardown();
      listeners.clear();
      listened.clear();
    },
  };
}
