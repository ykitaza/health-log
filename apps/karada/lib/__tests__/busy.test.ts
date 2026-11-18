import { createBusyGuard } from '../busy';
import { backToToday } from '../today';

// 書き込みのボタンの二重押しを止める（hooks/busy.ts の中身）
describe('書き込みを1つずつにする', () => {
  const deferred = () => {
    let resolve!: () => void;
    let reject!: (e: Error) => void;
    const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };

  test('処理中に続けて押しても、処理は1回だけ', async () => {
    const states: boolean[] = [];
    const run = createBusyGuard((b) => states.push(b));
    const d = deferred();
    const task = jest.fn(() => d.promise);
    const first = run(task);
    const second = run(task);
    await second;
    expect(task).toHaveBeenCalledTimes(1);
    d.resolve();
    await first;
    expect(states).toEqual([true, false]);
  });

  test('終わったら、また押せる', async () => {
    const run = createBusyGuard(() => {});
    const task = jest.fn(async () => {});
    await run(task);
    await run(task);
    expect(task).toHaveBeenCalledTimes(2);
  });

  test('失敗したら押せる状態に戻し、失敗を呼んだ側に返す', async () => {
    const states: boolean[] = [];
    const run = createBusyGuard((b) => states.push(b));
    await expect(run(async () => { throw new Error('保存できませんでした'); })).rejects.toThrow('保存できませんでした');
    expect(states).toEqual([true, false]);
    const task = jest.fn(async () => {});
    await run(task);
    expect(task).toHaveBeenCalledTimes(1);
  });

  test('保存して画面を離れるとき（stayBusy）は、終わっても押せないまま', async () => {
    const states: boolean[] = [];
    const run = createBusyGuard((b) => states.push(b));
    await run(async (stayBusy) => { stayBusy(); });
    expect(states).toEqual([true]);
    const task = jest.fn(async () => {});
    await run(task);
    expect(task).not.toHaveBeenCalled();
  });

  test('stayBusy を呼ぶ前に失敗したら、押せる状態に戻す', async () => {
    const states: boolean[] = [];
    const run = createBusyGuard((b) => states.push(b));
    await expect(run(async (stayBusy) => { await Promise.reject(new Error('x')); stayBusy(); })).rejects.toThrow('x');
    expect(states).toEqual([true, false]);
  });
});

describe('Android の戻る：今日でない日を見ているとき', () => {
  test('今日でない日なら、今日に戻して、戻るを使う（アプリを閉じない）', () => {
    const goToday = jest.fn();
    expect(backToToday(false, goToday)).toBe(true);
    expect(goToday).toHaveBeenCalledTimes(1);
  });

  test('今日なら何もしない（いつもの戻る）', () => {
    const goToday = jest.fn();
    expect(backToToday(true, goToday)).toBe(false);
    expect(goToday).not.toHaveBeenCalled();
  });
});
