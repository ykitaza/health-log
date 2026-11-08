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

/** Health Connect から取り込んだ睡眠・心拍を読む（書くのは取り込みだけ：db/repositories/healthConnect.ts） */
export function healthRepository(db: Db) {
  return {
    async sleepDay(date: DateKey): Promise<SleepDay | null> {
      const rows = await db.getAllAsync<{ start_at: string; end_at: string; asleep_min: number; awake_min: number }>(
        `SELECT start_at, end_at, asleep_min, awake_min FROM sleep_sessions
         WHERE deleted_at IS NULL AND date = ? ORDER BY asleep_min + awake_min DESC, start_at`, [date],
      );
      if (rows.length === 0) return null;
      return {
        date,
        asleepMin: rows.reduce((n, r) => n + r.asleep_min, 0),
        awakeMin: rows.reduce((n, r) => n + r.awake_min, 0),
        mainStartAt: rows[0].start_at,
        mainEndAt: rows[0].end_at,
        sessions: rows.length,
      };
    },
  };
}
