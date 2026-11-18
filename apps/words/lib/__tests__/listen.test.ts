import { createController, Output } from '../listen/controller';
import { countsAsListened, prefetchTargets, progressOf } from '../listen/queue';
import { buildScript, spokenText } from '../speech';
import type { Track } from '../listen/types';

describe('聞くの小さな決まり', () => {
  it('先に書き出すのは次の1つ（一時ファイルは2つまで）。聞いたに数えるのは最後まで、か6割', () => {
    expect(prefetchTargets(0, 10)).toEqual([1]);
    expect(prefetchTargets(9, 10)).toEqual([]);
    expect(countsAsListened(5, 10, false)).toBe(false);
    expect(countsAsListened(6, 10, false)).toBe(true);
    expect(countsAsListened(0, 0, true)).toBe(true);
    expect(progressOf(15, 10)).toBe(1);
  });

  it('端末の読み上げに渡す文は、区切りごとに間を空ける', () => {
    const script = buildScript({ text: '腑に落ちる', reading: 'ふにおちる', meaning: '納得する', nuance: '', use_note: '', examples: [] }, []);
    expect(spokenText(script)).toBe('腑に落ちる\n\n読みは、ふにおちる。\n\n納得する。');
  });
});

describe('再生の土台', () => {
  /** 偽の出力。prepare が false のもの（音声がない）は飛ばす */
  function fakeOutput(missing: Set<number> = new Set()) {
    const log: string[] = [];
    let ev: Parameters<Output['start']>[2] | null = null;
    const out: Output = {
      mode: 'audio',
      prepare: async (_t, i) => !missing.has(i),
      start: (t, _i, events) => { ev = events; log.push(`start ${t.id}`); },
      pause: () => log.push('pause'),
      resume: () => log.push('resume'),
      stop: () => {},
      prefetch: (_tracks, from) => log.push(`prefetch ${from}`),
      nowPlaying: (t, i, len, playing) => log.push(`now ${t.id} ${i + 1}/${len} ${playing ? 'playing' : 'paused'}`),
    };
    return { out, log, progress: (p: number, d: number) => ev?.onProgress(p, d), end: () => ev?.onEnd() };
  }
  const tracks: Track[] = ['a', 'b', 'c', 'd'].map((id) => ({ id, title: id, reading: '', speech: id, sections: [id] }));
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('最後まで聞いたら聞いたに数えて次へ。音声のないものは飛ばす', async () => {
    const f = fakeOutput(new Set([1]));
    const c = createController(f.out);
    const heard: string[] = [];
    c.onListened((id) => heard.push(id));
    await c.load(tracks, 0);
    expect(c.getState()).toMatchObject({ index: 0, playing: false, length: 4 });
    c.play();
    await flush();
    f.progress(10, 10);
    f.end();
    await flush();
    expect(heard).toEqual(['a']);
    expect(c.getState().index).toBe(2); // b は音声がないので飛ばす
    expect(f.log).toContain('start c');
  });

  it('次へ：6割聞いていれば数える。前へ：少し聞いていたら同じものの頭へ', async () => {
    const f = fakeOutput();
    const c = createController(f.out);
    const heard: string[] = [];
    c.onListened((id) => heard.push(id));
    await c.load(tracks, 0);
    c.play();
    await flush();
    f.progress(7, 10);
    c.next();
    await flush();
    expect(heard).toEqual(['a']);
    expect(c.getState().index).toBe(1);
    f.progress(1, 10);
    c.next();
    await flush();
    expect(heard).toEqual(['a']); // b は 1 割だけ
    f.progress(5, 10);
    c.previous();
    await flush();
    expect(c.getState().index).toBe(2);
    f.progress(1, 10);
    c.previous();
    await flush();
    expect(c.getState().index).toBe(1);
  });

  it('鳴らせなかったら止まって理由を残す。次に鳴らし始めたら理由を消す', async () => {
    let ev: Parameters<Output['start']>[2] | null = null;
    const out: Output = {
      mode: 'speech',
      prepare: async () => true,
      start: (_t, _i, events) => { ev = events; },
      pause: () => {},
      resume: () => {},
      stop: () => {},
    };
    const c = createController(out);
    await c.load(tracks, 0);
    expect(c.getState().error).toBeNull();
    c.play();
    await flush();
    ev!.onError?.('端末の読み上げが使えません：テスト');
    expect(c.getState()).toMatchObject({ playing: false, loading: false, error: '端末の読み上げが使えません：テスト' });
    c.play();
    await flush();
    expect(c.getState()).toMatchObject({ playing: true, error: null });
  });

  it('一時停止と再開。最後まで聞いたら止まる', async () => {
    const f = fakeOutput();
    const c = createController(f.out);
    await c.load(tracks.slice(0, 1), 0);
    c.play();
    await flush();
    f.progress(2, 10);
    c.pause();
    expect(c.getState().playing).toBe(false);
    c.play();
    expect(f.log).toEqual(expect.arrayContaining(['pause', 'resume']));
    f.progress(10, 10);
    f.end();
    await flush();
    expect(c.getState().playing).toBe(false);
  });
});
