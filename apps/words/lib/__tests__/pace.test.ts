import { joinMp3, joinWav, mp3Frames, parseWav, wavBytes } from '../listen/audioJoin';
import { createEngine } from '../listen/engine.web';
import { DEFAULT_PACE, ListenPace, paceSeconds, parsePace, SECTION_GAP_MS, serializePace, WORD_GAP_MS, wordPlan } from '../listen/pace';
import { estimateSeconds } from '../listen/timerOutput';
import type { Track } from '../listen/types';
import { setup } from '@/test-utils/nodeDb';

describe('聞くの読み方（速さ・くり返し・間）', () => {
  it('既定は 1.0 倍・1 回・ふつう。壊れた値・知らない値はその項目だけ既定', () => {
    expect(parsePace(null)).toEqual(DEFAULT_PACE);
    expect(parsePace('こわれた')).toEqual(DEFAULT_PACE);
    expect(parsePace('{"speed":1.2,"repeat":5,"pause":"long"}')).toEqual({ speed: 1.2, repeat: 1, pause: 'long' });
    const p: ListenPace = { speed: 0.8, repeat: 3, pause: 'short' };
    expect(parsePace(serializePace(p))).toEqual(p);
  });

  it('端末に残り、読み直しても同じ（設定の画面を開き直しても残る）', async () => {
    const { repos } = await setup();
    expect(await repos.local.listenPace()).toEqual(DEFAULT_PACE);
    await repos.local.setListenPace({ speed: 1.2, repeat: 2, pause: 'long' });
    expect(await repos.local.listenPace()).toEqual({ speed: 1.2, repeat: 2, pause: 'long' });
  });

  it('1 語の並べ方：区切りのあいだに間、くり返しのあいだと語のあとにも間。区切りの音声はくり返しで使い回す', () => {
    expect(wordPlan(2, { speed: 1, repeat: 2, pause: 'long' })).toEqual([
      { part: 0 }, { silence: SECTION_GAP_MS.long }, { part: 1 }, { silence: WORD_GAP_MS.long },
      { part: 0 }, { silence: SECTION_GAP_MS.long }, { part: 1 }, { silence: WORD_GAP_MS.long },
    ]);
    // 自然な声は音声 1 つ（区切りのあいだはサーバーの SSML のまま）
    expect(wordPlan(1, { speed: 1, repeat: 3, pause: 'short' })).toEqual([
      { part: 0 }, { silence: WORD_GAP_MS.short }, { part: 0 }, { silence: WORD_GAP_MS.short }, { part: 0 }, { silence: WORD_GAP_MS.short },
    ]);
  });

  it('かかる秒の見積もりは、くり返しで増え、速いと減り、間が長いと増える', () => {
    const sections = ['腑に落ちる', '読みは、ふにおちる。', '説明や出来事に、心から納得する。頭でわかるだけでなく、気持ちのうえでもすっと受け入れられる感じ。'];
    const base = paceSeconds(sections, DEFAULT_PACE);
    expect(paceSeconds(sections, { ...DEFAULT_PACE, repeat: 3 })).toBeGreaterThan(base * 2.5);
    expect(paceSeconds(sections, { ...DEFAULT_PACE, speed: 1.2 })).toBeLessThan(base);
    expect(paceSeconds(sections, { ...DEFAULT_PACE, speed: 0.8 })).toBeGreaterThan(base);
    expect(paceSeconds(sections, { ...DEFAULT_PACE, pause: 'long' })).toBeGreaterThan(base);
    expect(paceSeconds(sections, { ...DEFAULT_PACE, pause: 'short' })).toBeLessThan(base);
    expect(estimateSeconds({ speech: sections.join('\n\n'), sections })).toBe(base);
  });
});

describe('1 語の音声を 1 つにまとめる', () => {
  const fmt = { channels: 1, sampleRate: 1000, bitsPerSample: 16, blockAlign: 2 };
  /** 中身が value の PCM（n 標本） */
  const pcm = (n: number, value: number) => wavBytes(fmt, new Uint8Array(n * 2).fill(value));

  it('端末の声（WAV）：区切りを無音を挟んでつなぎ、くり返す（標本の速さから無音の長さを決める）', () => {
    const plan = wordPlan(2, { speed: 1, repeat: 2, pause: 'short' });
    const w = parseWav(joinWav([pcm(10, 1), pcm(20, 2)], plan));
    expect(w).toMatchObject(fmt);
    const section = SECTION_GAP_MS.short; // 1000Hz なので 1ms が 1 標本
    const word = WORD_GAP_MS.short;
    expect(w.data.length).toBe(2 * (10 + section + 20 + word) * 2);
    // 1 つ目の区切りのあと、無音（0）が続き、2 つ目の区切り
    expect([...w.data.subarray(18, 22)]).toEqual([1, 1, 0, 0]);
    expect(w.data[(10 + section) * 2]).toBe(2);
  });

  it('WAV の頭が 44 バイトでなくても（ほかのチャンクがあっても）読める。形がそろわなければつながない', () => {
    const plain = pcm(4, 7);
    const extra = new Uint8Array(plain.length + 12);
    extra.set(plain.subarray(0, 12), 0);
    extra.set([0x4c, 0x49, 0x53, 0x54, 4, 0, 0, 0, 1, 2, 3, 4], 12); // LIST チャンク
    extra.set(plain.subarray(12), 24);
    expect([...parseWav(extra).data]).toEqual([7, 7, 7, 7, 7, 7, 7, 7]);
    const other = wavBytes({ ...fmt, sampleRate: 2000 }, new Uint8Array(4));
    expect(() => joinWav([plain, other], wordPlan(2, DEFAULT_PACE))).toThrow('そろっていません');
  });

  /** MPEG-2 Layer III・24000Hz・48kbps・モノラル（Polly の MP3 と同じ形）。1 フレーム 144 バイト・576 標本 */
  const HEADER = [0xff, 0xf3, 0x64, 0xc0];
  const frame = (fill: number, tag?: string) => {
    const f = new Uint8Array(144).fill(fill);
    f.set(HEADER, 0);
    if (tag) f.set([...tag].map((c) => c.charCodeAt(0)), 13);
    return f;
  };
  const join = (...parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  };

  it('自然な声（MP3）：ID3・Xing の枠を外し、無音のフレームを挟んでくり返す（長さが最初の 1 つ分にならない）', () => {
    const id3 = join(new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 6]), new Uint8Array(6));
    const audio = join(frame(0x55), frame(0x55), frame(0x55));
    const v1 = join(new Uint8Array([0x54, 0x41, 0x47]), new Uint8Array(125));
    const mp3 = join(id3, frame(0, 'Xing'), audio, v1);
    expect(mp3Frames(mp3).audio).toEqual(audio);

    const out = joinMp3(mp3, wordPlan(1, { speed: 1, repeat: 2, pause: 'normal' }));
    const silentFrames = Math.ceil((WORD_GAP_MS.normal / 1000) * 24000 / 576);
    expect(out.length).toBe(2 * audio.length + 2 * silentFrames * 144);
    expect(String.fromCharCode(...out)).not.toContain('Xing');
    expect(out.subarray(0, audio.length)).toEqual(audio);
    // 無音のフレーム：同じ形の頭（CRC なし）で、中身は 0
    const silence = out.subarray(audio.length, audio.length + 144);
    expect([...silence.subarray(0, 4)]).toEqual(HEADER);
    expect(silence.subarray(4).every((b) => b === 0)).toBe(true);
    expect(out.subarray(audio.length + silentFrames * 144, 2 * audio.length + silentFrames * 144)).toEqual(audio);
  });

  it('MP3 でないものはつながない（呼ぶ側はそのまま鳴らす）', () => {
    expect(() => joinMp3(new Uint8Array([1, 2, 3, 4, 5]), wordPlan(1, DEFAULT_PACE))).toThrow();
  });
});

describe('設定の読み方が聞くに効く（web の聞く。準備するときに読み方を読む）', () => {
  const tracks: Track[] = ['腑に落ちる', '一目置く', '言わずもがな'].map((t, i) => ({
    id: `id-${i}`, title: t, reading: '', speech: t, sections: [t, '説明や出来事に、心から納得する。'],
  }));
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  it('くり返し・速さ・間で 1 語の長さが変わり、変えたら次に準備する語から効く', async () => {
    let pace: ListenPace = DEFAULT_PACE;
    const fetched: string[] = [];
    const engine = createEngine(async (id) => { fetched.push(id); return null; }, () => pace);
    await engine.load(tracks, 0);
    engine.play();
    await jest.advanceTimersByTimeAsync(0);
    const base = engine.getState().duration;
    expect(base).toBe(estimateSeconds(tracks[0]));

    // 鳴らしている語の長さは変えない
    pace = { speed: 0.8, repeat: 3, pause: 'long' };
    await jest.advanceTimersByTimeAsync(1000);
    expect(engine.getState().duration).toBe(base);

    // 次に準備する語から効く
    engine.next();
    await jest.advanceTimersByTimeAsync(0);
    expect(engine.getState().index).toBe(1);
    expect(engine.getState().duration).toBe(estimateSeconds(tracks[1], pace));
    expect(engine.getState().duration).toBeGreaterThan(base * 3);

    pace = { speed: 1.2, repeat: 1, pause: 'short' };
    engine.next();
    await jest.advanceTimersByTimeAsync(0);
    expect(engine.getState().duration).toBe(estimateSeconds(tracks[2], pace));
    expect(engine.getState().duration).toBeLessThan(base);
    // 1 語ごとに声を取りにいく（読み込みと再生の始めで 1 語目は 2 回）
    expect(new Set(fetched)).toEqual(new Set(['id-0', 'id-1', 'id-2']));
    engine.destroy();
  });
});
