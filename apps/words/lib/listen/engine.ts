/**
 * 端末の聞く（Android）。声は端末の読み上げ（Pixel では Google の音声。無料で、つながらなくても使える）。
 *
 * 画面を消しても鳴らし続け、ロック画面・通知の操作と、車の Bluetooth の「次」「前」で動かすため、
 * 読み上げをその場で鳴らす（expo-speech）のではなく、いま聞くものと次のものだけを一時ファイル（WAV）に書き出し、
 * expo-audio の再生の並び（AudioPlaylist。メディアセッションと裏での再生を持つ）で鳴らす。
 * - 書き出すのは自前の小さなモジュール（modules/kotoba-tts。Android の TextToSpeech.synthesizeToFile）
 * - 一時ファイルは「いま」と「次」の2つまで。鳴らし終えたらすぐ消す。保存（キャッシュ）はしない。起動のときに一時フォルダを空にする
 * - 設定の「自然な声（Polly）」をオンにしたときだけ、サーバーの音声（POST /v1/audio の MP3）を同じ一時ファイルの作りで使う
 * - 設定の読み方（lib/listen/pace.ts）：1 語を 1 つの一時ファイルにまとめる（端末の声は区切りごとに書き出して間を挟んでつなぎ、
 *   くり返しは同じ音声を並べる。自然な声は MP3 を無音のフレームを挟んでつなぐ。lib/listen/audioJoin.ts）。
 *   速さは再生の並びの速さ（playbackRate）で、その語を鳴らし始めるときに合わせる。設定は書き出すごとに読む（次に準備する語から効く）
 *
 * 並びは [しるし, いま, 次]。しるしは同梱の短い無音（assets/audio/marker.wav。一時ファイルではない）。
 * 車やロック画面の「前」は、並びの中で前（しるし）へ移るので、それを受けて前の表現を書き出し、並びを作り直す。
 * 「次」と、聞き終えて次へ進んだときは、終えたもののファイルを消し、さらに次を書き出して足す。
 *
 * しるしは createAudioPlaylist の sources で渡す（ライブラリが require の番号を { uri } に直す）。
 * playlist.add は番号を直さずにそのままネイティブへ渡し、型が合わずに例外になるので、add には { uri } だけを渡す。
 *
 * 端末の読み上げのモジュールがない（iOS）・書き出せない・再生の並びで鳴らせないときは、expo-speech でその場で読む
 * （画面を開いているあいだの操作）。Android で並びから落ちたときは、理由（state.error）を画面に出す
 */
import { AudioPlaylist, createAudioPlaylist, setAudioModeAsync } from 'expo-audio';
import { Directory, File, Paths } from 'expo-file-system';
import * as Speech from 'expo-speech';
import { KotobaTts } from '@/modules/kotoba-tts';
import { createController, Output } from './controller';
import { joinMp3, joinWav } from './audioJoin';
import { ListenPace, paceSeconds, wordPlan } from './pace';
import { countsAsListened } from './queue';
import { EngineState, FetchAudio, IDLE_STATE, ListenEngine, sectionsOf, Track } from './types';

const MARKER = require('@/assets/audio/marker.wav') as number;
const LOCK_OPTIONS = { showNextTrack: true, showPreviousTrack: true, showSeekForward: false, showSeekBackward: false };
/** 読み上げの速さ（1 がふつう。運転中に聞き取りやすいよう少しゆっくり） */
const RATE = 0.95;
/** 1つを書き出すのを待つ上限（終わったの知らせが来ないとき、読み込み中のまま止まらないように） */
const RENDER_TIMEOUT_MS = 20000;
/** 並びを作り直したあと、作り直しで出た並びの知らせ（しるしへ移った、など）を受けないあいだ */
const QUIET_MS = 400;

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    p.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

/**
 * 端末の声でその場で読む出力（iOS と、書き出せないとき）。区切りを1つずつ読み、あいだは時計で待つ（読み方の間とくり返し）。
 * 読み方は準備（prepare）のときに読む
 */
function speechOutput(pace: () => ListenPace): Output {
  let current: { track: Track; ev: Parameters<Output['start']>[2]; pace: ListenPace } | null = null;
  let prepared: { i: number; pace: ListenPace } | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let gap: ReturnType<typeof setTimeout> | null = null;
  /** 読み始めるたびに増やす（止めた・次へ送ったあとに、前の読み上げや時計から続きを読まないように） */
  let run = 0;
  let position = 0;
  const clear = () => {
    if (timer) clearInterval(timer);
    if (gap) clearTimeout(gap);
    timer = null;
    gap = null;
  };
  const speak = () => {
    if (!current) return;
    const { track, ev, pace: p } = current;
    const my = ++run;
    const sections = sectionsOf(track);
    const plan = wordPlan(sections.length, p);
    const duration = paceSeconds(sections, p);
    clear();
    position = 0;
    timer = setInterval(() => { position = Math.min(duration, position + 0.5); ev.onProgress(position, duration); }, 500);
    const step = (k: number) => {
      if (my !== run) return;
      const seg = plan[k];
      if (!seg) { clear(); ev.onProgress(duration, duration); ev.onEnd(); return; }
      if ('silence' in seg) { gap = setTimeout(() => step(k + 1), seg.silence / p.speed); return; }
      Speech.speak(sections[seg.part], {
        language: 'ja-JP',
        rate: RATE * p.speed,
        onDone: () => step(k + 1),
        onError: (e) => { if (my !== run) return; clear(); ev.onError?.(`端末の読み上げが使えません：${messageOf(e)}`); },
      });
    };
    step(0);
  };
  return {
    mode: 'speech',
    async prepare(_t, i) { prepared = { i, pace: pace() }; return true; },
    start(track, i, ev) { current = { track, ev, pace: prepared?.i === i ? prepared.pace : pace() }; speak(); },
    // その場の読み上げは途中から続けられない（Android）ので、止めて、再開は頭から読む
    pause() { run++; clear(); void Speech.stop(); },
    resume() { speak(); },
    stop() { run++; clear(); current = null; void Speech.stop(); },
  };
}

const plainPath = (uri: string) => decodeURIComponent(uri.replace(/^file:\/\//, ''));

/** 端末の読み上げ（ファイル）が使えるか。使えなければ理由、使えれば null */
async function checkTts(): Promise<string | null> {
  if (!KotobaTts) return '端末の読み上げのモジュールがありません';
  const late = '読み上げのエンジンが応えません（時間切れ）';
  try {
    // diagnose は理由を返す（古いビルドにはないので、そのときは isAvailable で見る）
    if (typeof KotobaTts.diagnose === 'function') return await withTimeout(KotobaTts.diagnose(), RENDER_TIMEOUT_MS, late);
    const ok = await withTimeout(KotobaTts.isAvailable(), RENDER_TIMEOUT_MS, late);
    return ok ? null : '日本語の読み上げが使えません';
  } catch (e) {
    return messageOf(e);
  }
}

/** 一時ファイル1つ（1 語分）。speed はその語を書き出したときの速さ（鳴らし始めるときに並びの速さを合わせる） */
type Rendered = { i: number; file: File; speed: number };

export function createEngine(fetchAudio: FetchAudio, pace: () => ListenPace): ListenEngine {
  const dir = new Directory(Paths.cache, 'kotoba-tts');
  let tracks: Track[] = [];
  let playlist: AudioPlaylist | null = null;
  let speech: ListenEngine | null = null;
  /** いま（並びの1番目）と次（2番目）の表現の位置と一時ファイル */
  let cur: Rendered | null = null;
  let nxt: Rendered | null = null;
  /** 並びにいま合わせている速さ */
  let rate = 1;
  /** 並びを作り直しているあいだ（と、その直後の少しのあいだ）は、並びの知らせを受けない */
  let rebuilding = false;
  let quietUntil = 0;
  const quiet = () => rebuilding || Date.now() < quietUntil;
  const settle = () => { rebuilding = false; quietUntil = Date.now() + QUIET_MS; };
  /** 書き出している途中に再生を押された（書き出し終えたら鳴らす） */
  let wantPlay = false;
  /** 端末の読み上げ（ファイル）や再生の並びで鳴らせず、その場の読み上げにした理由 */
  let fallbackReason: string | null = null;
  /** 最後に書き出せなかった理由 */
  let renderError: string | null = null;
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

  /** 端末の読み上げで text を file（WAV）に書き出す */
  async function synth(file: File, text: string) {
    if (!KotobaTts) throw new Error('端末の読み上げのモジュールがありません');
    await withTimeout(KotobaTts.synthesizeToFile(text, plainPath(file.uri), RATE), RENDER_TIMEOUT_MS, '書き出しが終わりません（時間切れ）');
    if (!file.exists || !file.size) throw new Error('書き出したファイルが空です');
  }

  /**
   * i 番目を一時ファイル（1 語に 1 つ）に書き出す（自然な声がオンでつながればサーバーの MP3、ほかは端末の読み上げの WAV）。
   * 読み方（くり返し・間）はここで読んで、1 つのファイルにまとめる。区切りごとの書き出しは、つないだらすぐ消す。
   * 書き出せなければ理由を残して null
   */
  async function render(i: number): Promise<Rendered | null> {
    const t = tracks[i];
    if (!t) return null;
    const p = pace();
    let file: File | null = null;
    try {
      const bytes = await fetchAudio(t.id);
      if (bytes) {
        file = new File(dir, `${i}-${t.id}.mp3`);
        let out: Uint8Array<ArrayBuffer> = new Uint8Array(bytes);
        // つなげない（読めない形の）ときは、1 回だけそのまま鳴らす
        try { out = joinMp3(out, wordPlan(1, p)); } catch { /* そのまま */ }
        await file.write(out);
        return { i, file, speed: p.speed };
      }
      if (!KotobaTts) { renderError = '端末の読み上げのモジュールがありません'; return null; }
      file = new File(dir, `${i}-${t.id}.wav`);
      const sections = sectionsOf(t);
      const parts: Uint8Array[] = [];
      for (let k = 0; k < sections.length; k++) {
        const part = new File(dir, `${i}-${t.id}-${k}.wav`);
        try {
          await synth(part, sections[k]);
          parts.push(await part.bytes());
        } finally {
          remove({ file: part });
        }
      }
      let joined: Uint8Array | null = null;
      try { joined = joinWav(parts, wordPlan(parts.length, p)); } catch { /* つなげない形：まとめて1回で書き出す */ }
      if (joined) await file.write(joined);
      else await synth(file, t.speech);
      return { i, file, speed: p.speed };
    } catch (e) {
      renderError = messageOf(e);
      remove(file ? { file } : null);
      return null;
    }
  }

  /** いまの語を書き出したときの速さに、並びの速さを合わせる */
  function applySpeed(p: AudioPlaylist, r: Rendered) {
    if (rate === r.speed) return;
    try { p.playbackRate = r.speed; rate = r.speed; } catch { /* 速さを変えられなくても鳴らせる */ }
  }

  const meta = (i: number) => ({ title: tracks[i]?.title ?? '', artist: 'ことば', albumTitle: tracks[i]?.reading || undefined });

  /** その場の読み上げ（expo-speech）で鳴らす。理由（fallbackReason）があれば画面に出す */
  async function startSpeech(start: number) {
    const sp = createController(speechOutput(pace));
    speech = sp;
    subs.push({ remove: sp.subscribe((st) => set({ ...st, error: st.error ?? fallbackReason })) });
    subs.push({ remove: sp.onListened((id, sec) => { for (const l of listened) l(id, sec); }) });
    await sp.load(tracks, start);
    // 準備の途中で再生を押されていたら鳴らす
    if (wantPlay && speech === sp) { wantPlay = false; sp.play(); }
  }

  /** 再生の並びをやめ、その場の読み上げにする（少なくとも鳴るように。裏での再生・車のボタンは効かない） */
  async function fallbackToSpeech(reason: string, start: number, autoplay: boolean) {
    const at = Math.min(Math.max(start, 0), Math.max(tracks.length - 1, 0));
    teardown();
    wantPlay = false;
    fallbackReason = reason;
    await startSpeech(at);
    if (autoplay) speech?.play();
  }

  /** i 番目から鳴らし直す（並びを [しるし, i, i+1] に作り直す）。一時ファイルは2つまで */
  async function startAt(i: number, autoplay: boolean) {
    const p = playlist;
    if (!p) return;
    rebuilding = true;
    set({ loading: true, index: i, position: 0, duration: 0 });
    try {
      p.pause();
      // 並びから外してからファイルを消す（消したファイルを並びが読みにいかないように）
      if (p.trackCount < 1) throw new Error('しるしの音を読み込めませんでした');
      for (let k = p.trackCount - 1; k >= 1; k--) p.remove(k);
      remove(cur);
      remove(nxt);
      cur = null;
      nxt = null;
      // 書き出せないものは飛ばす
      let j = i;
      while (j < tracks.length && !cur) { cur = await render(j); if (!cur) j++; }
      if (playlist !== p) return; // 待つあいだに並びを作り直した・閉じた
      if (!cur) {
        // 1つも書き出せない：端末の読み上げ（ファイル）が使えない。その場で読む
        await fallbackToSpeech(`端末の読み上げが使えません：${renderError ?? '書き出せませんでした'}`, i, autoplay || wantPlay);
        return;
      }
      nxt = await render(cur.i + 1);
      if (playlist !== p) return;
      // しるし（並びの最初）の後ろに、いまと次を並べる
      for (let k = p.trackCount - 1; k >= 1; k--) p.remove(k);
      p.add({ uri: cur.file.uri });
      if (nxt) p.add({ uri: nxt.file.uri });
      p.skipTo(1);
      applySpeed(p, cur);
      try { p.updateLockScreenMetadata(meta(cur.i)); } catch { /* ロック画面がないとき */ }
      last = { position: 0, duration: 0 };
      set({ index: cur.i, loading: false, mode: 'audio', error: null });
      if (autoplay || wantPlay) p.play();
      wantPlay = false;
    } catch (e) {
      if (playlist !== p) return;
      // 再生の並びで鳴らせない：その場で読む
      await fallbackToSpeech(`再生の準備に失敗しました：${messageOf(e)}`, cur?.i ?? i, autoplay || wantPlay);
    } finally {
      if (playlist === p) settle();
    }
  }

  /** 次へ進んだ（並びの2番目に移った）：終えたものを消し、さらに次を書き出して足す */
  async function advanced() {
    if (!playlist || !cur) return;
    const p = playlist;
    rebuilding = true;
    const done = cur;
    cur = nxt;
    nxt = null;
    try {
      p.remove(1); // [しるし, いま]。並びから外してからファイルを消す
      remove(done);
      if (!cur) { set({ playing: false }); return; }
      applySpeed(p, cur);
      set({ index: cur.i, position: 0, duration: 0 });
      try { p.updateLockScreenMetadata(meta(cur.i)); } catch { /* ロック画面がないとき */ }
    } catch (e) {
      set({ error: `次へ進めませんでした：${messageOf(e)}` });
      return;
    } finally {
      settle();
    }
    const next = await render(cur.i + 1);
    if (next && playlist === p && cur && next.i === cur.i + 1) {
      nxt = next;
      try { p.add({ uri: next.file.uri }); } catch (e) { set({ error: `次の表現を並べられませんでした：${messageOf(e)}` }); }
    } else remove(next);
  }

  function teardown() {
    for (const s of subs.splice(0)) s.remove();
    const p = playlist;
    playlist = null;
    if (p) {
      try { p.clearLockScreenControls(); } catch { /* なくてもよい */ }
      try { p.destroy(); } catch { /* 消せなくてもよい */ }
    }
    remove(cur);
    remove(nxt);
    cur = null;
    nxt = null;
    rebuilding = false;
    speech?.destroy();
    speech = null;
  }

  return {
    async load(next, start) {
      teardown();
      cleanDir();
      tracks = next;
      counted.clear();
      wantPlay = false;
      fallbackReason = null;
      renderError = null;
      set({ ...IDLE_STATE, length: next.length, index: start });
      if (next.length === 0) return;
      if (!modeSet) {
        modeSet = true;
        await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' }).catch(() => {});
      }
      if (!KotobaTts) {
        // iOS：もともとその場で読む（理由は出さない）
        await startSpeech(start);
        return;
      }
      const reason = await checkTts();
      if (reason) {
        fallbackReason = `端末の読み上げが使えません：${reason}`;
        await startSpeech(start);
        return;
      }
      let p: AudioPlaylist;
      try {
        // しるしはここで渡す（ライブラリが require の番号を { uri } に直す。add では直らない）
        p = createAudioPlaylist({ sources: [MARKER], loop: 'none', updateInterval: 500 });
      } catch (e) {
        fallbackReason = `再生の準備に失敗しました：${messageOf(e)}`;
        await startSpeech(start);
        return;
      }
      playlist = p;
      rate = 1;
      subs.push(p.addListener('playlistStatusUpdate', (st) => {
        // 再生のエラー（ファイルを読めない、など）は、並びの位置にかかわらず見る。ネイティブは error を足して知らせる（型にはない）
        const err = (st as { error?: { message?: string; code?: number } }).error;
        if (err && playlist === p) {
          const code = err.code != null ? `（${err.code}）` : '';
          // 止めているあいだのエラーで、急にしゃべり出さない
          void fallbackToSpeech(`音声を再生できません：${err.message ?? '不明なエラー'}${code}`, cur?.i ?? state.index, state.playing || wantPlay);
          return;
        }
        if (quiet() || st.currentIndex !== 1 || !cur) return;
        last = { position: st.currentTime, duration: st.duration };
        if (st.didJustFinish) {
          count(cur.i, st.duration, st.duration, true);
          if (!nxt) { remove(cur); set({ playing: false }); }
        }
        set({ playing: st.playing, position: st.currentTime, duration: st.duration, loading: st.isBuffering && !st.isLoaded });
      }));
      subs.push(p.addListener('trackChanged', ({ currentIndex }) => {
        if (quiet() || !cur) return;
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
    play() {
      if (speech) { speech.play(); return; }
      // 準備（エンジンの確かめ・書き出し）の途中なら、終えたら鳴らす
      if (!playlist || rebuilding || !cur) { if (tracks.length > 0) wantPlay = true; return; }
      playlist.play();
    },
    pause() { wantPlay = false; if (speech) speech.pause(); else playlist?.pause(); },
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
