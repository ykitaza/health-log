/**
 * 聞くの声の選び方（自然な声＝サーバーの Polly か、端末の声か）。
 * 設定の「自然な声（Polly）」がオンで、ログインしていて宛先があるときだけ POST /v1/audio を呼ぶ。
 * 取れなければ端末の声に戻し、その理由（画面に小さく出す）を知らせる
 */
import { ApiError } from '../api';
import type { ListenPause } from './pace';
import type { FetchAudio } from './types';

/** いまの声。natural：サーバーの声で読めた。device：自然な声がオンだが、端末の声に戻した（理由つき） */
export type VoiceNote = { kind: 'natural' } | { kind: 'device'; reason: string } | null;

export type VoiceSource = {
  /** 設定の「自然な声」 */
  polly: boolean;
  /** ログインしているか */
  signedIn: boolean;
  /** API の宛先があるか */
  configured: boolean;
  /** 設定の「区切りのあいだの間」（サーバーの台本の break に入る） */
  pause?: ListenPause;
  api: { audio: (id: string, pause?: ListenPause) => Promise<ArrayBuffer> } | null;
};

/** 自然な声を使えなかった理由（短く。画面に出す） */
export function voiceFallbackReason(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.code) {
      case 'network': return 'サーバーにつながりません';
      case 'signedOut': return 'ログインし直してください';
      case 'forbidden': return '自然な声を使う許可がありません';
      case 'throttled': return 'サーバーが混み合っています';
      default:
        if (e.status === 404) return 'この言葉はまだサーバーに同期していません';
        return `サーバーの声を作れませんでした${e.status ? `（${e.status}）` : ''}`;
    }
  }
  return `サーバーの声を使えません：${e instanceof Error ? e.message : String(e)}`;
}

/**
 * 1つの表現の音声を取る関数を作る。source は毎回読む（設定を変えたら、次に取る表現から効く）。
 * 自然な声がオフなら null（端末の声。知らせは消す）。オンで取れなければ null と、端末の声に戻した理由を知らせる
 */
export function createAudioFetcher(source: () => VoiceSource, onNote: (note: VoiceNote) => void): FetchAudio {
  return async (id) => {
    const s = source();
    if (!s.polly) { onNote(null); return null; }
    if (!s.configured) { onNote({ kind: 'device', reason: 'サーバーの宛先がありません' }); return null; }
    if (!s.signedIn || !s.api) { onNote({ kind: 'device', reason: 'ログインしていません' }); return null; }
    try {
      const bytes = await s.api.audio(id, s.pause);
      // 取っているあいだに設定をオフにしたら、使わない
      if (!source().polly) { onNote(null); return null; }
      onNote({ kind: 'natural' });
      return bytes;
    } catch (e) {
      onNote({ kind: 'device', reason: voiceFallbackReason(e) });
      return null;
    }
  };
}

/** 画面に出す一文 */
export function voiceNoteText(note: VoiceNote): string | null {
  if (!note) return null;
  if (note.kind === 'natural') return '自然な声（Polly）で読んでいます';
  return `自然な声を使えないので、端末の声で読んでいます（${note.reason}）`;
}
