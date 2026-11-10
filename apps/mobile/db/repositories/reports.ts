import { parseReport, Report, ReportRow } from '@/lib/reports';
import { serializeWrites } from '../serial';
import type { Db, Deps } from '../types';

const COLUMNS = 'id, title, body, kind, period_start, period_end, overall_tone, headline, highlights, next_steps, created_at';

/** 閉じた「まだ作っていないまとめ」の key（lib/reports.ts の PendingReport）。端末だけに覚える（同期しない sync_meta に置く） */
const DISMISSED_PENDING = 'reports.dismissed_pending';
/** 覚えておく数。出す範囲は日7＋週4＋月1（と今日）なので、古いものは捨ててよい */
const DISMISSED_MAX = 50;

/**
 * レポート（同期で受け取った、MCP の save_report のまとめ）。アプリからは読むのと消すのだけ（書き換えない）。
 * 消すと、トリガーが delete を outbox に積み、次の同期でサーバーに届く
 */
export function reportRepository(db: Db, deps: Deps) {
  async function dismissedPending(): Promise<string[]> {
    const raw = (await db.getFirstAsync<{ value: string | null }>('SELECT value FROM sync_meta WHERE key = ?', [DISMISSED_PENDING]))?.value;
    try {
      const list: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.filter((k): k is string => typeof k === 'string') : [];
    } catch {
      return [];
    }
  }

  return serializeWrites(db, {
    /** 消していないレポート（作った時刻の新しい順、同じなら ID の順） */
    async list(): Promise<Report[]> {
      const rows = await db.getAllAsync<ReportRow>(
        `SELECT ${COLUMNS} FROM reports WHERE deleted_at IS NULL ORDER BY created_at DESC, id DESC`, [],
      );
      return rows.map(parseReport);
    },

    async latest(): Promise<Report | null> {
      const row = await db.getFirstAsync<ReportRow>(
        `SELECT ${COLUMNS} FROM reports WHERE deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 1`, [],
      );
      return row && parseReport(row);
    },

    /** その日の日のまとめ（期間がその日だけの daily）。いくつかあれば、いちばん新しいもの */
    async dailyFor(date: string): Promise<Report | null> {
      const row = await db.getFirstAsync<ReportRow>(
        `SELECT ${COLUMNS} FROM reports WHERE deleted_at IS NULL AND kind = 'daily' AND period_start = ? AND period_end = ?
         ORDER BY created_at DESC, id DESC LIMIT 1`, [date, date],
      );
      return row && parseReport(row);
    },

    async get(id: string): Promise<Report | null> {
      const row = await db.getFirstAsync<ReportRow>(`SELECT ${COLUMNS} FROM reports WHERE id = ? AND deleted_at IS NULL`, [id]);
      return row && parseReport(row);
    },

    /** 閉じた「まだ作っていないまとめ」の key（古い順） */
    dismissedPending,

    /** 「まだ作っていないまとめ」を閉じ、もう出さない。同期の対象ではないので、書き込みの列（serializeWrites）には並べない */
    async dismissPending(key: string): Promise<void> {
      const list = (await dismissedPending()).filter((k) => k !== key);
      list.push(key);
      await db.runAsync(
        'INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
        [DISMISSED_PENDING, JSON.stringify(list.slice(-DISMISSED_MAX))],
      );
    },

    async remove(id: string): Promise<void> {
      const now = deps.now().toISOString();
      await db.runAsync('UPDATE reports SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL', [now, now, id]);
    },
  }, ['remove']);
}
