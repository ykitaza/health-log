/**
 * 同期をいつ動かすか。
 * - 記録を保存したあと（write）は、少し待ってまとめる（続けて保存しても1回にする）
 * - 起動・前面に戻った・「今すぐ同期」（start・foreground・manual）は、すぐ動かす
 * - 動いている最中に頼まれたら、終わったあとにもう1回だけ動かす
 * - 失敗して retry なら、指数的に間をあけてやり直す（ゆらぎをつける）。成功したら間を戻す
 */
import type { SyncOutcome } from './engine';

export type SyncReason = 'start' | 'foreground' | 'write' | 'manual' | 'retry';

type Timer = ReturnType<typeof setTimeout>;

export type SchedulerDeps = {
  run: () => Promise<SyncOutcome>;
  onDone?: (outcome: SyncOutcome) => void;
  onStart?: () => void;
  debounceMs?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  random?: () => number;
  setTimer?: (fn: () => void, ms: number) => Timer;
  clearTimer?: (t: Timer) => void;
};

/** n 回続けて失敗したあとの待ち時間（ミリ秒）。base × 2^(n-1) を上限で切り、半分から全部のあいだでゆらす */
export function backoffDelay(failures: number, base: number, max: number, random: () => number): number {
  const full = Math.min(max, base * 2 ** Math.max(0, failures - 1));
  return Math.round(full / 2 + (full / 2) * random());
}

export function createSyncScheduler({
  run, onDone, onStart, debounceMs = 3_000, baseDelayMs = 5_000, maxDelayMs = 10 * 60_000, random = Math.random,
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (t) => clearTimeout(t),
}: SchedulerDeps) {
  let running = false;
  let again = false;
  let stopped = false;
  let failures = 0;
  let debounce: Timer | null = null;
  let retry: Timer | null = null;

  const clear = () => {
    if (debounce) clearTimer(debounce);
    if (retry) clearTimer(retry);
    debounce = retry = null;
  };

  async function start(): Promise<void> {
    if (stopped) return;
    if (running) { again = true; return; }
    clear();
    running = true;
    onStart?.();
    let outcome: SyncOutcome;
    try {
      outcome = await run();
    } catch {
      outcome = { ok: false, error: 'server', retry: true };
    }
    running = false;
    if (stopped) return;
    if (outcome.ok) failures = 0;
    else if (outcome.retry) failures++;
    onDone?.(outcome);
    if (again) { again = false; void start(); return; }
    if (!outcome.ok && outcome.retry) {
      retry = setTimer(() => { retry = null; void start(); }, backoffDelay(failures, baseDelayMs, maxDelayMs, random));
    }
  }

  return {
    request(reason: SyncReason) {
      stopped = false;
      if (reason === 'write') {
        if (running) { again = true; return; }
        if (retry) return; // やり直しを待っている（つながらない）あいだは、保存のたびに送らない
        if (debounce) clearTimer(debounce);
        debounce = setTimer(() => { debounce = null; void start(); }, debounceMs);
        return;
      }
      void start();
    },
    /** ログアウトしたときなど。待っているものを捨てる */
    stop() {
      stopped = true;
      again = false;
      failures = 0;
      clear();
    },
    get failures() { return failures; },
  };
}

export type SyncScheduler = ReturnType<typeof createSyncScheduler>;
