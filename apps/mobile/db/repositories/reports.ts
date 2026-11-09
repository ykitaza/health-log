import { parseReport, Report, ReportRow } from '@/lib/reports';
import { serializeWrites } from '../serial';
import type { Db, Deps } from '../types';

const COLUMNS = 'id, title, body, kind, period_start, period_end, overall_tone, headline, highlights, next_steps, created_at';

/**
 * レポート（同期で受け取った、MCP の save_report のまとめ）。アプリからは読むのと消すのだけ（書き換えない）。
 * 消すと、トリガーが delete を outbox に積み、次の同期でサーバーに届く
 */
export function reportRepository(db: Db, deps: Deps) {
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

    async remove(id: string): Promise<void> {
      const now = deps.now().toISOString();
      await db.runAsync('UPDATE reports SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL', [now, now, id]);
    },
  }, ['remove']);
}
