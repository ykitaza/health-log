import { startPull, SIGNED_OUT_NOTICE, syncedAgo, syncStatusLine } from '../sync/status';

const NOW = Date.parse('2026-11-09T03:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const base = { auth: 'signedIn' as const, syncing: false, error: null, pending: 0, lastSyncedAt: ago(2 * 60_000) };

describe('最後に同期してからの時間', () => {
  test.each([
    [0, 'たった今'], [59_000, 'たった今'], [60_000, '1分前'], [2 * 60_000 + 30_000, '2分前'], [59 * 60_000, '59分前'],
    [60 * 60_000, '1時間前'], [23 * 3600_000, '23時間前'], [25 * 3600_000, '1日前'],
  ])('%i ミリ秒前は「%s」', (ms, text) => {
    expect(syncedAgo(ago(ms), NOW)).toBe(text);
  });

  test('端末の時計より新しい時刻（同期した直後に、表示の時刻がまだ古いとき）も「たった今」', () => {
    expect(syncedAgo(ago(-30_000), NOW)).toBe('たった今');
  });
});

describe('同期の状態の1行', () => {
  test('ふだんは「同期 N分前」。1分未満は「同期 たった今」。まだなら「まだ同期していません」', () => {
    expect(syncStatusLine(base, NOW)).toEqual({ kind: 'synced', text: '同期 2分前' });
    expect(syncStatusLine({ ...base, lastSyncedAt: ago(10_000) }, NOW)!.text).toBe('同期 たった今');
    expect(syncStatusLine({ ...base, lastSyncedAt: null }, NOW)!.text).toBe('まだ同期していません');
  });

  test('同期中は「同期しています…」（未送信や前の失敗より先）', () => {
    expect(syncStatusLine({ ...base, syncing: true, pending: 3, error: 'network' }, NOW)).toEqual({ kind: 'syncing', text: '同期しています…' });
  });

  test('送っていない記録があれば「未送信 N件」', () => {
    expect(syncStatusLine({ ...base, pending: 3 }, NOW)).toEqual({ kind: 'pending', text: '未送信 3件' });
  });

  test('失敗したら「同期できませんでした」と「やり直す」（未送信より先）', () => {
    expect(syncStatusLine({ ...base, error: 'network', pending: 3 }, NOW))
      .toEqual({ kind: 'error', text: '同期できませんでした', action: { label: 'やり直す', to: 'retry' } });
  });

  test('別のアカウントでログインしたときは、やり直しても同じなので、アカウントの画面を開く', () => {
    expect(syncStatusLine({ ...base, error: 'accountChanged' }, NOW)!.action).toEqual({ label: '確かめる', to: 'account' });
  });

  test('ログインしていないときは「ログインすると同期できます」（押すとアカウントの画面）。読み込み中は出さない', () => {
    expect(syncStatusLine({ ...base, auth: 'signedOut' }, NOW))
      .toEqual({ kind: 'signedOut', text: 'ログインすると同期できます', action: { label: 'ログイン', to: 'account' } });
    expect(syncStatusLine({ ...base, auth: 'loading' }, NOW)).toBeNull();
  });
});

describe('下に引っぱったとき', () => {
  test('ログインしていれば同期を頼み、回る印を出す', () => {
    const syncNow = jest.fn();
    const notice = jest.fn();
    expect(startPull('signedIn', syncNow, notice)).toBe(true);
    expect(syncNow).toHaveBeenCalledTimes(1);
    expect(notice).not.toHaveBeenCalled();
  });

  test('ログインしていなければ同期せず、「ログインすると同期できます」と知らせる。回る印は出さない', () => {
    const syncNow = jest.fn();
    const notice = jest.fn();
    expect(startPull('signedOut', syncNow, notice)).toBe(false);
    expect(syncNow).not.toHaveBeenCalled();
    expect(notice).toHaveBeenCalledWith(SIGNED_OUT_NOTICE);
  });

  test('ログインしているか分からないあいだは、何もしない', () => {
    const syncNow = jest.fn();
    const notice = jest.fn();
    expect(startPull('loading', syncNow, notice)).toBe(false);
    expect(syncNow).not.toHaveBeenCalled();
    expect(notice).not.toHaveBeenCalled();
  });
});
