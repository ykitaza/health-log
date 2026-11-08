// 「今日」を日付が変わったら決め直す（ホームの「今日の記録」が前の日のまま残り、追加した記録が前の日に入っていた）
import { migrate } from '@/db/migrations';
import { SEED_EXERCISES } from '@/db/seed';
import { memoryDb, repos, testDeps } from '@/test-utils/nodeDb';
import { msUntilNextDay, pickedDayOrToday, todayKey } from '../date';
import { watchToday } from '../today';

const BENCH = SEED_EXERCISES[0].id;

// 時刻は端末のタイムゾーンで作る（todayKey は端末の暦の日付）
beforeEach(() => { jest.useFakeTimers({ now: new Date(2026, 10, 8, 23, 50) }); });
afterEach(() => { jest.useRealTimers(); });

test('次の日の0時までのミリ秒', () => {
  expect(msUntilNextDay(new Date(2026, 10, 8, 23, 50))).toBe(10 * 60_000);
  expect(msUntilNextDay(new Date(2026, 10, 8, 0, 0))).toBe(24 * 60 * 60_000);
  expect(msUntilNextDay(new Date(2026, 11, 31, 23, 59, 59, 500))).toBe(500);
});

describe('watchToday', () => {
  test('前面に戻したとき（check）に日付が変わっていたら、新しい今日を知らせる。変わっていなければ知らせない', () => {
    const changes: [string, string][] = [];
    const w = watchToday((next, prev) => changes.push([next, prev]));
    expect(w.today).toBe('2026-11-08');
    w.check();
    expect(changes).toEqual([]);
    // 夜にアプリを閉じずに置き、朝に前面へ戻す（Android では裏のあいだタイマーが動かないことがある。時計だけ進める）
    jest.setSystemTime(new Date(2026, 10, 9, 7, 0));
    w.check();
    expect(changes).toEqual([['2026-11-09', '2026-11-08']]);
    expect(w.today).toBe('2026-11-09');
    w.check();
    expect(changes).toHaveLength(1);
    w.stop();
    expect(jest.getTimerCount()).toBe(0);
  });

  test('前面に出したままでも、0時になったら知らせる（タイマーは1つだけ）', () => {
    const changes: string[] = [];
    const w = watchToday((next) => changes.push(next));
    expect(jest.getTimerCount()).toBe(1);
    jest.advanceTimersByTime(9 * 60_000);
    expect(changes).toEqual([]);
    jest.advanceTimersByTime(60_000 + 1000);
    expect(changes).toEqual(['2026-11-09']);
    expect(jest.getTimerCount()).toBe(1);
    w.check();
    expect(jest.getTimerCount()).toBe(1);
    w.stop();
  });

  test('止めたあとは知らせない', () => {
    const changes: string[] = [];
    const w = watchToday((next) => changes.push(next));
    w.stop();
    jest.setSystemTime(new Date(2026, 10, 9, 7, 0));
    w.check();
    jest.advanceTimersByTime(24 * 60 * 60_000);
    expect(changes).toEqual([]);
  });
});

test('日をまたいで前面に戻したあと、ホームの「本日のトレーニングを追加」で保存した記録が「今日の記録」に出る', async () => {
  const deps = { ...testDeps(), now: () => new Date() };
  const db = memoryDb();
  await migrate(db, deps.now);
  const r = repos(db, deps);
  // ホームを開いたまま夜を越す。ホームの「今日」は watchToday が持つ（前は描いたときに一度だけ決めていた）
  const w = watchToday(() => {});
  jest.setSystemTime(new Date(2026, 10, 9, 7, 0));
  w.check(); // 前面に戻した
  // ホームは、カレンダーで日を選んでいなければ今日に追加し、今日の記録を出す
  await r.workouts.saveEntry({ date: pickedDayOrToday(null, w.today), exerciseId: BENCH, sets: [{ weightKg: 60, reps: 10, memo: '', done: false }] });
  expect((await r.workouts.getDay(todayKey())).map((e) => e.exerciseName)).toEqual(['ベンチプレス']);
  expect(await r.workouts.getDay('2026-11-08')).toEqual([]);
  w.stop();
});
