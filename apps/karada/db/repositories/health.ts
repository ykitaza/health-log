import type { DateKey } from '@/lib/date';
import type { Db } from '../types';

/** その日の睡眠（起きた日でまとめる）。昼寝など、1日に複数あれば足す */
export type SleepDay = {
  date: DateKey;
  asleepMin: number;
  awakeMin: number;
  /** いちばん長い睡眠の、寝た時刻と起きた時刻（ISO 8601） */
  mainStartAt: string;
  mainEndAt: string;
  sessions: number;
};

/** その日の心拍のまとめ */
export type HeartRateDay = {
  date: DateKey;
  restingBpm: number | null;
  avgBpm: number | null;
  minBpm: number | null;
  maxBpm: number | null;
  samples: number;
};

/** その日の歩数の合計 */
export type StepDay = { date: DateKey; steps: number };

/** Health Connect から取り込んだ睡眠・心拍・歩数を読む（書くのは取り込みだけ：db/repositories/healthConnect.ts） */
export function healthRepository(db: Db) {
  /** from〜to（両端を含む）の日ごとの睡眠。日付の古い順。記録のない日は入らない */
  async function sleepDays(from: DateKey, to: DateKey): Promise<SleepDay[]> {
    const rows = await db.getAllAsync<{ date: DateKey; start_at: string; end_at: string; asleep_min: number; awake_min: number }>(
      `SELECT date, start_at, end_at, asleep_min, awake_min FROM sleep_sessions
       WHERE deleted_at IS NULL AND date >= ? AND date <= ? ORDER BY date, asleep_min + awake_min DESC, start_at`, [from, to],
    );
    const days: SleepDay[] = [];
    for (const r of rows) {
      const last = days[days.length - 1];
      if (last?.date === r.date) {
        last.asleepMin += r.asleep_min;
        last.awakeMin += r.awake_min;
        last.sessions += 1;
        continue;
      }
      // 日の中では長い順に並ぶので、初めの行がいちばん長い睡眠
      days.push({ date: r.date, asleepMin: r.asleep_min, awakeMin: r.awake_min, mainStartAt: r.start_at, mainEndAt: r.end_at, sessions: 1 });
    }
    return days;
  }

  /** from〜to（両端を含む）の日ごとの心拍のまとめ。日付の古い順 */
  async function heartRateDays(from: DateKey, to: DateKey): Promise<HeartRateDay[]> {
    const rows = await db.getAllAsync<{ date: DateKey; resting_bpm: number | null; avg_bpm: number | null; min_bpm: number | null; max_bpm: number | null; samples: number }>(
      `SELECT date, resting_bpm, avg_bpm, min_bpm, max_bpm, samples FROM heart_rate_days
       WHERE deleted_at IS NULL AND date >= ? AND date <= ? ORDER BY date`, [from, to],
    );
    return rows.map((r) => ({ date: r.date, restingBpm: r.resting_bpm, avgBpm: r.avg_bpm, minBpm: r.min_bpm, maxBpm: r.max_bpm, samples: r.samples }));
  }

  /** from〜to（両端を含む）の日ごとの歩数の合計。日付の古い順。記録のない日は入らない */
  async function stepDays(from: DateKey, to: DateKey): Promise<StepDay[]> {
    return db.getAllAsync<StepDay>(
      'SELECT date, steps FROM step_days WHERE deleted_at IS NULL AND date >= ? AND date <= ? ORDER BY date', [from, to],
    );
  }

  return {
    sleepDays,
    heartRateDays,
    stepDays,
    async sleepDay(date: DateKey): Promise<SleepDay | null> {
      return (await sleepDays(date, date))[0] ?? null;
    },
    async heartRateDay(date: DateKey): Promise<HeartRateDay | null> {
      return (await heartRateDays(date, date))[0] ?? null;
    },
    async stepDay(date: DateKey): Promise<StepDay | null> {
      return (await stepDays(date, date))[0] ?? null;
    },
  };
}
