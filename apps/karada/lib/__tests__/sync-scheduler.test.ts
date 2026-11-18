import type { SyncOutcome } from '../sync/engine';
import { NOTHING_RECEIVED } from '../sync/received';
import { backoffDelay, createSyncScheduler } from '../sync/scheduler';

const OK: SyncOutcome = { ok: true, applied: 0, sent: 0, rejected: 0, received: NOTHING_RECEIVED };
const OFFLINE: SyncOutcome = { ok: false, error: 'network', retry: true };
const flush = () => new Promise((r) => setImmediate(r));

function setup(outcomes: SyncOutcome[]) {
  jest.useFakeTimers({ doNotFake: ['setImmediate'] });
  const run = jest.fn(async () => outcomes.shift() ?? OK);
  const done: SyncOutcome[] = [];
  const s = createSyncScheduler({ run, onDone: (o) => done.push(o), random: () => 1 });
  return { s, run, done };
}

afterEach(() => { jest.useRealTimers(); });

describe('同期をいつ動かすか', () => {
  test('保存のあとは3秒待ち、続けて保存しても1回にまとめる', async () => {
    const { s, run } = setup([]);
    s.request('write');
    jest.advanceTimersByTime(2000);
    s.request('write');
    jest.advanceTimersByTime(2999);
    expect(run).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
  });

  test('起動・前面に戻った・今すぐ同期は、すぐ動かす。動いている最中に頼まれたら、終わったあとにもう1回', async () => {
    let finish: (o: SyncOutcome) => void = () => undefined;
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    const run = jest.fn(() => new Promise<SyncOutcome>((r) => { finish = r; }));
    const s = createSyncScheduler({ run });
    s.request('start');
    expect(run).toHaveBeenCalledTimes(1);
    s.request('manual');
    s.request('foreground');
    expect(run).toHaveBeenCalledTimes(1);
    finish(OK);
    await flush();
    expect(run).toHaveBeenCalledTimes(2);
    finish(OK);
    await flush();
    expect(run).toHaveBeenCalledTimes(2);
  });

  test('つながらなければ、5秒・10秒・20秒…と間をあけてやり直し（上限10分）、成功したら間を戻す', async () => {
    const { s, run } = setup([OFFLINE, OFFLINE, OFFLINE, OK]);
    s.request('start');
    await flush();
    for (const wait of [5_000, 10_000, 20_000]) {
      const before = run.mock.calls.length;
      jest.advanceTimersByTime(wait - 1);
      await flush();
      expect(run).toHaveBeenCalledTimes(before);
      jest.advanceTimersByTime(1);
      await flush();
      expect(run).toHaveBeenCalledTimes(before + 1);
    }
    expect(s.failures).toBe(0);
    expect(backoffDelay(30, 5_000, 600_000, () => 1)).toBe(600_000);
    expect(backoffDelay(1, 5_000, 600_000, () => 0)).toBe(2_500); // ゆらぎ：半分から全部
  });

  test('やり直しを待つあいだは、保存のたびには送らない。今すぐ同期は待たずに動かす', async () => {
    const { s, run } = setup([OFFLINE]);
    s.request('start');
    await flush();
    s.request('write');
    jest.advanceTimersByTime(3_000);
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
    s.request('manual');
    await flush();
    expect(run).toHaveBeenCalledTimes(2);
  });

  test('ログインの期限切れ（retry でない）は、やり直さない。止めたら、待っているものを捨てる', async () => {
    const { s, run, done } = setup([{ ok: false, error: 'signedOut', retry: false }, OFFLINE]);
    s.request('start');
    await flush();
    jest.advanceTimersByTime(60 * 60_000);
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
    s.request('start');
    await flush();
    s.stop();
    jest.advanceTimersByTime(60 * 60_000);
    await flush();
    expect(run).toHaveBeenCalledTimes(2);
    expect(done.map((o) => o.ok || o.error)).toEqual(['signedOut', 'network']);
  });
});
