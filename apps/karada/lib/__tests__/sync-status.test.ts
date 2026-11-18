import { startPull, SIGNED_OUT_NOTICE, SYNC_ALERT_FAILURES, syncAlert } from '../sync/status';

const base = { auth: 'signedIn' as const, error: null, failures: 0 };

describe('ホームの同期の知らせ', () => {
  test('ふだん（同期できている・同期中・未送信がある）は出さない。時刻と未送信の件数はアカウントの画面で見る', () => {
    expect(syncAlert(base)).toBeNull();
  });

  test('1回の失敗は出さない（自動でやり直す。引っぱって失敗したときはスナックバー）', () => {
    expect(syncAlert({ ...base, error: 'network', failures: 1 })).toBeNull();
  });

  test(`続けて ${SYNC_ALERT_FAILURES} 回失敗したら「同期できませんでした」と「やり直す」`, () => {
    expect(SYNC_ALERT_FAILURES).toBe(2);
    expect(syncAlert({ ...base, error: 'network', failures: 2 })).toEqual({ text: '同期できませんでした', action: { label: 'やり直す', to: 'retry' } });
    expect(syncAlert({ ...base, error: 'server', failures: 5 })!.action.to).toBe('retry');
  });

  test('成功したら（error が null）、前に何回失敗していても出さない', () => {
    expect(syncAlert({ ...base, error: null, failures: 3 })).toBeNull();
  });

  test('別のアカウントでログインしたときは、1回目から出し、押すとアカウントの画面（やり直しても同じため）', () => {
    expect(syncAlert({ ...base, error: 'accountChanged', failures: 1 })).toEqual({ text: '同期できませんでした', action: { label: '確かめる', to: 'account' } });
  });

  test('ログインしていない・読み込み中は出さない（ログインは任意。引っぱったときだけ案内する）', () => {
    expect(syncAlert({ auth: 'signedOut', error: 'network', failures: 3 })).toBeNull();
    expect(syncAlert({ auth: 'loading', error: 'network', failures: 3 })).toBeNull();
  });
});

describe('下に引っぱったとき', () => {
  test('ログインしていれば同期を頼み、マークを出す', () => {
    const syncNow = jest.fn();
    const notice = jest.fn();
    expect(startPull('signedIn', syncNow, notice)).toBe(true);
    expect(syncNow).toHaveBeenCalledTimes(1);
    expect(notice).not.toHaveBeenCalled();
  });

  test('ログインしていなければ同期せず、「ログインすると同期できます」と知らせる。マークは出さない', () => {
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
