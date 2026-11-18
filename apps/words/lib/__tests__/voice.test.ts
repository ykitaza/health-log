import { ApiError } from '../api';
import { createAudioFetcher, VoiceNote, voiceNoteText, VoiceSource } from '../listen/voice';

describe('聞くの声の選び方（自然な声と端末の声）', () => {
  const mp3 = new Uint8Array([1, 2, 3]).buffer;
  function setup(o: Partial<VoiceSource> & { audio?: (id: string) => Promise<ArrayBuffer> }) {
    const calls: string[] = [];
    const notes: VoiceNote[] = [];
    const source: VoiceSource = {
      polly: true, signedIn: true, configured: true,
      api: { audio: async (id) => { calls.push(id); return o.audio ? o.audio(id) : mp3; } },
      ...o,
    };
    const fetch = createAudioFetcher(() => source, (n) => notes.push(n));
    return { source, fetch, calls, notes, last: () => voiceNoteText(notes[notes.length - 1] ?? null) };
  }

  it('オフならサーバーを呼ばず、端末の声（知らせもなし）', async () => {
    const t = setup({ polly: false });
    expect(await t.fetch('a')).toBeNull();
    expect(t.calls).toEqual([]);
    expect(t.last()).toBeNull();
  });

  it('オンでつながれば、サーバーの声（POST /v1/audio の MP3）を使う', async () => {
    const t = setup({});
    expect(await t.fetch('a')).toBe(mp3);
    expect(t.calls).toEqual(['a']);
    expect(t.last()).toBe('自然な声（Polly）で読んでいます');
  });

  it('設定を変えたら、次に取る表現から効く（読み直さなくてよい）', async () => {
    const t = setup({ polly: false });
    expect(await t.fetch('a')).toBeNull();
    t.source.polly = true;
    expect(await t.fetch('b')).toBe(mp3);
    expect(t.calls).toEqual(['b']);
  });

  it('ログインしていない・宛先がないときは、端末の声に戻して理由を出す', async () => {
    const a = setup({ signedIn: false });
    expect(await a.fetch('a')).toBeNull();
    expect(a.calls).toEqual([]);
    expect(a.last()).toBe('自然な声を使えないので、端末の声で読んでいます（ログインしていません）');
    const b = setup({ configured: false });
    expect(await b.fetch('a')).toBeNull();
    expect(b.last()).toContain('サーバーの宛先がありません');
  });

  it.each([
    [new ApiError('network'), 'サーバーにつながりません'],
    [new ApiError('server', 500), 'サーバーの声を作れませんでした（500）'],
    [new ApiError('server', 404), 'この言葉はまだサーバーに同期していません'],
    [new ApiError('throttled', 429), 'サーバーが混み合っています'],
    [new ApiError('signedOut', 401), 'ログインし直してください'],
  ])('サーバーがエラー（%s）なら端末の声に戻し、理由を出す', async (err, reason) => {
    const t = setup({ audio: async () => { throw err; } });
    expect(await t.fetch('a')).toBeNull();
    expect(t.last()).toBe(`自然な声を使えないので、端末の声で読んでいます（${reason}）`);
  });

  it('取っているあいだにオフにしたら、取れた音声も使わない', async () => {
    let release: () => void = () => {};
    const t = setup({ audio: () => new Promise((r) => { release = () => r(mp3); }) });
    const p = t.fetch('a');
    t.source.polly = false;
    release();
    expect(await p).toBeNull();
    expect(t.last()).toBeNull();
  });
});
