/**
 * 同期の状態の小さな表示（ホームの上）の文と、下に引っぱったときの動き。React を使わずに jest で確かめる（lib/__tests__/sync-status.test.ts）
 */
import type { SyncErrorCode } from './engine';

export const SIGNED_OUT_NOTICE = 'ログインすると同期できます';
export const SYNC_FAILED = '同期できませんでした';

type Auth = 'loading' | 'signedOut' | 'signedIn';

/** 押したときの動き：retry は同期をやり直す、account はアカウントの画面を開く */
export type SyncLine = {
  kind: 'signedOut' | 'syncing' | 'error' | 'pending' | 'synced';
  text: string;
  /** 文のあとに添える操作の言葉（「やり直す」など） */
  action?: { label: string; to: 'retry' | 'account' };
};

/** 最後に同期してからの時間：1分未満は「たった今」、そのあとは N分前・N時間前・N日前 */
export function syncedAgo(lastSyncedAt: string, now: number): string {
  const min = Math.floor((now - Date.parse(lastSyncedAt)) / 60_000);
  if (!(min >= 1)) return 'たった今';
  if (min < 60) return `${min}分前`;
  if (min < 24 * 60) return `${Math.floor(min / 60)}時間前`;
  return `${Math.floor(min / (24 * 60))}日前`;
}

/** 表示する1行。読み込み中（ログインしているか分からない）は出さない */
export function syncStatusLine(s: {
  auth: Auth; syncing: boolean; error: SyncErrorCode | null; pending: number; lastSyncedAt: string | null;
}, now: number): SyncLine | null {
  if (s.auth === 'loading') return null;
  if (s.auth === 'signedOut') return { kind: 'signedOut', text: SIGNED_OUT_NOTICE, action: { label: 'ログイン', to: 'account' } };
  if (s.syncing) return { kind: 'syncing', text: '同期しています…' };
  // 別のアカウントでログインしたときは、アカウントの画面で選ぶまで同期しない（やり直しても同じ）
  if (s.error === 'accountChanged') return { kind: 'error', text: SYNC_FAILED, action: { label: '確かめる', to: 'account' } };
  if (s.error) return { kind: 'error', text: SYNC_FAILED, action: { label: 'やり直す', to: 'retry' } };
  if (s.pending > 0) return { kind: 'pending', text: `未送信 ${s.pending}件` };
  return { kind: 'synced', text: s.lastSyncedAt ? `同期 ${syncedAgo(s.lastSyncedAt, now)}` : 'まだ同期していません' };
}

/**
 * 下に引っぱったとき。ログインしていれば同期を頼み、true（終わるまで回る印を出す）。
 * ログインしていなければ同期せず、案内を出して false。読み込み中は何もしない
 */
export function startPull(auth: Auth, syncNow: () => void, notice: (message: string) => void): boolean {
  if (auth === 'signedIn') { syncNow(); return true; }
  if (auth === 'signedOut') notice(SIGNED_OUT_NOTICE);
  return false;
}
