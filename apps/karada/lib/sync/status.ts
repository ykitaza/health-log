/**
 * 同期の知らせ（ホームの上）を出すかと、下に引っぱったときの動き。React を使わずに jest で確かめる（lib/__tests__/sync-status.test.ts）
 */
import type { SyncErrorCode } from './engine';

export const SIGNED_OUT_NOTICE = 'ログインすると同期できます';
export const SYNC_FAILED = '同期できませんでした';
/** 引っぱって同期するときの読み上げ */
export const PULL_SYNCING = '同期しています';
export const PULL_DONE = '同期しました';

type Auth = 'loading' | 'signedOut' | 'signedIn';

/** 自動の同期（起動・前面・書き込みのあと）が、この回数続けて失敗したら、ホームに知らせを出す */
export const SYNC_ALERT_FAILURES = 2;

/** ホームの上の知らせ。押したときの動き：retry は同期をやり直す、account はアカウントの画面を開く */
export type SyncAlert = {
  text: string;
  /** 文のあとに添える操作の言葉（「やり直す」など） */
  action: { label: string; to: 'retry' | 'account' };
};

/**
 * ホームの上に出す知らせ。ふだん（同期できている・同期中・未送信がある・ログインしていない）は出さない（null）。
 * 最後に同期した時刻と未送信の件数は、設定 → アカウントの画面で見る。
 * 出すのは、同期が続けて失敗しているとき（1回の失敗は自動でやり直すので出さない。引っぱって失敗したときはスナックバー）と、
 * 別のアカウントでログインしたとき（アカウントの画面で選ぶまで同期しないので、1回目から出す）
 */
export function syncAlert(s: { auth: Auth; error: SyncErrorCode | null; failures: number }): SyncAlert | null {
  if (s.auth !== 'signedIn' || !s.error) return null;
  if (s.error === 'accountChanged') return { text: SYNC_FAILED, action: { label: '確かめる', to: 'account' } };
  if (s.failures < SYNC_ALERT_FAILURES) return null;
  return { text: SYNC_FAILED, action: { label: 'やり直す', to: 'retry' } };
}

/**
 * 下に引っぱったとき。ログインしていれば同期を頼み、true（終わるまでマークを出す）。
 * ログインしていなければ同期せず、案内を出して false。読み込み中は何もしない
 */
export function startPull(auth: Auth, syncNow: () => void, notice: (message: string) => void): boolean {
  if (auth === 'signedIn') { syncNow(); return true; }
  if (auth === 'signedOut') notice(SIGNED_OUT_NOTICE);
  return false;
}
