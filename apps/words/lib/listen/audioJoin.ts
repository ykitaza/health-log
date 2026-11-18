/**
 * 1 語の音声を 1 つにまとめる（くり返しと間。lib/listen/pace.ts の wordPlan の並べ方）。ネイティブを使わず JS だけで、バイトをつなぐ。
 * - 端末の声：区切りごとに書き出した WAV（PCM）を、無音（0 の標本）を挟んでつなぐ
 * - 自然な声：サーバーの MP3 を、無音のフレームを挟んでつなぐ。先頭の ID3・Xing（Info）の枠と、末尾の ID3v1 は外す
 *   （Xing があると長さが最初の 1 つ分になるため）。無音のフレームは、最初のフレームと同じ形（版・標本の速さ・ビットレート）で、
 *   中身（サイド情報と本体）を 0 にしたもの（どの復号器でも無音になる。ビットレートが変わらないので長さの見積もりも合う）
 */
import type { Segment } from './pace';

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));
const u16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const u32 = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;

function concat(chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

// ---- WAV ----

export type Wav = { channels: number; sampleRate: number; bitsPerSample: number; blockAlign: number; data: Uint8Array };

/** WAV（PCM）を読む。チャンクを順に見る（44 バイトの頭とは決めない）。data の長さが壊れていたら残り全部 */
export function parseWav(b: Uint8Array): Wav {
  if (b.length < 12 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WAVE') throw new Error('WAV ではありません');
  let fmt: Omit<Wav, 'data'> | null = null;
  let at = 12;
  while (at + 8 <= b.length) {
    const id = ascii(b, at, 4);
    const size = u32(b, at + 4);
    const body = at + 8;
    if (id === 'fmt ') {
      if (u16(b, body) !== 1) throw new Error('PCM の WAV ではありません');
      fmt = { channels: u16(b, body + 2), sampleRate: u32(b, body + 4), blockAlign: u16(b, body + 12), bitsPerSample: u16(b, body + 14) };
    } else if (id === 'data') {
      if (!fmt) throw new Error('WAV の形がありません');
      const end = size === 0 || body + size > b.length ? b.length : body + size;
      return { ...fmt, data: b.subarray(body, end) };
    }
    at = body + size + (size % 2);
  }
  throw new Error('WAV に音がありません');
}

/** PCM の WAV を作る（44 バイトの頭） */
export function wavBytes(w: Omit<Wav, 'data'>, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(44 + data.length);
  const v = new DataView(out.buffer);
  const tag = (at: number, s: string) => { for (let i = 0; i < 4; i++) out[at + i] = s.charCodeAt(i); };
  tag(0, 'RIFF'); v.setUint32(4, 36 + data.length, true); tag(8, 'WAVE');
  tag(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, w.channels, true);
  v.setUint32(24, w.sampleRate, true); v.setUint32(28, w.sampleRate * w.blockAlign, true);
  v.setUint16(32, w.blockAlign, true); v.setUint16(34, w.bitsPerSample, true);
  tag(36, 'data'); v.setUint32(40, data.length, true);
  out.set(data, 44);
  return out;
}

/** 区切りごとの WAV を、並べ方のとおりに無音を挟んで 1 つにする。形（標本の速さ・チャンネル・ビット）が違えばつながない */
export function joinWav(parts: Uint8Array[], plan: Segment[]): Uint8Array<ArrayBuffer> {
  const wavs = parts.map(parseWav);
  const f = wavs[0];
  if (!f) throw new Error('つなぐ音がありません');
  if (wavs.some((w) => w.sampleRate !== f.sampleRate || w.channels !== f.channels || w.bitsPerSample !== f.bitsPerSample)) {
    throw new Error('区切りごとの音の形がそろっていません');
  }
  const silence = (ms: number) => {
    const frames = Math.round((ms * f.sampleRate) / 1000);
    // 8 ビットの PCM は 128 が無音
    return new Uint8Array(frames * f.blockAlign).fill(f.bitsPerSample === 8 ? 128 : 0);
  };
  const chunks = plan.map((s) => ('part' in s ? wavs[s.part].data : silence(s.silence)));
  return wavBytes(f, concat(chunks));
}

// ---- MP3 ----

const BITRATES = {
  v1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  v2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const SAMPLE_RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

export type Mp3Frame = { length: number; sampleRate: number; samples: number; header: Uint8Array };

/** at から MPEG-1/2/2.5 Layer III のフレームの頭を読む。違えば null */
export function mp3FrameAt(b: Uint8Array, at: number): Mp3Frame | null {
  if (at + 4 > b.length || b[at] !== 0xff || (b[at + 1] & 0xe0) !== 0xe0) return null;
  const version = (b[at + 1] >> 3) & 3;
  const layer = (b[at + 1] >> 1) & 3;
  const bitrateIdx = (b[at + 2] >> 4) & 0xf;
  const rateIdx = (b[at + 2] >> 2) & 3;
  if (version === 1 || layer !== 1 || bitrateIdx === 0 || bitrateIdx === 15 || rateIdx === 3) return null;
  const v1 = version === 3;
  const bitrate = (v1 ? BITRATES.v1 : BITRATES.v2)[bitrateIdx] * 1000;
  const sampleRate = SAMPLE_RATES[version][rateIdx];
  const padding = (b[at + 2] >> 1) & 1;
  const length = Math.floor(((v1 ? 144 : 72) * bitrate) / sampleRate) + padding;
  return { length, sampleRate, samples: v1 ? 1152 : 576, header: b.slice(at, at + 4) };
}

/** 先頭の ID3v2 と、Xing・Info・VBRI の枠と、末尾の ID3v1 を外した、音のフレームだけ。最初の音のフレームも返す */
export function mp3Frames(b: Uint8Array): { audio: Uint8Array; first: Mp3Frame } {
  let start = 0;
  if (b.length >= 10 && ascii(b, 0, 3) === 'ID3') {
    const size = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f);
    start = 10 + size + (b[5] & 0x10 ? 10 : 0);
  }
  let end = b.length;
  if (end - start >= 128 && ascii(b, end - 128, 3) === 'TAG') end -= 128;
  // 最初のフレームを探す（次のフレームも続いているもの）
  let at = start;
  let first: Mp3Frame | null = null;
  for (; at + 4 <= end; at++) {
    const f = mp3FrameAt(b, at);
    if (f && (at + f.length === end || mp3FrameAt(b, at + f.length))) { first = f; break; }
  }
  if (!first) throw new Error('MP3 の音が見つかりません');
  const body = ascii(b, at + 4, Math.min(first.length - 4, 64));
  if (/Xing|Info|VBRI/.test(body)) {
    // 長さを書いた枠（音はない）。外して、次のフレームを最初にする
    at += first.length;
    const next = mp3FrameAt(b, at);
    if (!next) throw new Error('MP3 の音が見つかりません');
    first = next;
  }
  return { audio: b.subarray(at, end), first };
}

/** 無音のフレーム（最初のフレームと同じ形。CRC なし・詰め物なし。中身は 0）を ms の長さ分 */
export function mp3Silence(first: Mp3Frame, ms: number): Uint8Array<ArrayBuffer> {
  const header = first.header.slice();
  header[1] |= 0x01; // CRC なし
  header[2] &= ~0x02; // 詰め物なし
  const frame = mp3FrameAt(header, 0);
  if (!frame) throw new Error('MP3 の形を読めません');
  const one = new Uint8Array(frame.length);
  one.set(header, 0);
  const count = Math.ceil((ms / 1000) * first.sampleRate / first.samples);
  const out = new Uint8Array(one.length * count);
  for (let i = 0; i < count; i++) out.set(one, i * one.length);
  return out;
}

/** サーバーの MP3（1 語分）を、並べ方のとおりに無音のフレームを挟んで 1 つにする（part は 0 だけ） */
export function joinMp3(bytes: Uint8Array, plan: Segment[]): Uint8Array<ArrayBuffer> {
  const { audio, first } = mp3Frames(bytes);
  return concat(plan.map((s) => ('part' in s ? audio : mp3Silence(first, s.silence))));
}
