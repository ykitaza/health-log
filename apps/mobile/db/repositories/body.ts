import { BodyRecordLike, BodyValues, DailyBody, dailyBodyValues } from '@/lib/body';
import type { DateKey } from '@/lib/date';
import { serializeWrites } from '../serial';
import type { Db, Deps } from '../types';

type Row = {
  id: string; date: string; measured_at: string; updated_at: string;
  weight_kg: number | null; body_fat_pct: number | null; muscle_pct: number | null; waist_cm: number | null; memo: string;
  source: 'manual' | 'health_connect';
};

const toLike = (r: Row): BodyRecordLike => ({
  date: r.date, measuredAt: r.measured_at, updatedAt: r.updated_at,
  weightKg: r.weight_kg, bodyFatPct: r.body_fat_pct, musclePct: r.muscle_pct, waistCm: r.waist_cm, memo: r.memo, source: r.source,
});

const SELECT = `SELECT id, date, measured_at, updated_at, weight_kg, body_fat_pct, muscle_pct, waist_cm, memo, source
  FROM body_records WHERE deleted_at IS NULL`;

const COLUMNS: Record<keyof BodyValues | 'memo', string> = {
  weightKg: 'weight_kg', bodyFatPct: 'body_fat_pct', musclePct: 'muscle_pct', waistCm: 'waist_cm', memo: 'memo',
};

export type BodyPatch = Partial<BodyValues & { memo: string }>;

/**
 * 体組成。1日に複数の記録を持てる。画面に出す1日1つの値は dailyBodyValues の決まり（手入力が先）で選ぶ。
 * 手入力は1日1件（その日の手入力の行）を書き換える。Health Connect の取り込みは lib/healthConnect/importer.ts が書く
 */
export function bodyRepository(db: Db, deps: Deps) {
  const repo = {
    /** 日ごとの値（古い順） */
    async listDaily(): Promise<DailyBody[]> {
      const rows = await db.getAllAsync<Row>(`${SELECT} ORDER BY date`, []);
      return dailyBodyValues(rows.map(toLike));
    },

    async getDay(date: DateKey): Promise<DailyBody | null> {
      const rows = await db.getAllAsync<Row>(`${SELECT} AND date = ?`, [date]);
      return dailyBodyValues(rows.map(toLike))[0] ?? null;
    },

    /**
     * その日の取り込み（Health Connect）だけから選んだ値（手入力があっても、取り込みの値）。計測を入れるシートの「取り込み 68.4 kg」。
     * 取り込みがなければ null
     */
    async getImportedDay(date: DateKey): Promise<DailyBody | null> {
      const rows = await db.getAllAsync<Row>(`${SELECT} AND date = ? AND source = 'health_connect'`, [date]);
      return dailyBodyValues(rows.map(toLike))[0] ?? null;
    },

    /**
     * 手入力の値を保存する（null を渡すと、その項目の手入力の値を消す。取り込みの値があれば、画面にはそれが出る）。今の値と同じ項目は書かない。
     * その日に手入力の行がなく、値がすべて空（null か空のメモ）なら、行を作らない
     */
    async saveManual(date: DateKey, patch: BodyPatch): Promise<void> {
      const all = Object.entries(patch).filter(([, v]) => v !== undefined) as [keyof BodyPatch, number | string | null][];
      const existing = await db.getFirstAsync<Row>(
        `SELECT id, date, measured_at, updated_at, weight_kg, body_fat_pct, muscle_pct, waist_cm, memo, source
         FROM body_records WHERE deleted_at IS NULL AND source = 'manual' AND date = ?
         ORDER BY measured_at DESC LIMIT 1`, [date],
      );
      const empty = (k: keyof BodyPatch, v: number | string | null) => (k === 'memo' ? (v ?? '') === '' : v == null);
      const entries = existing
        ? all.filter(([k, v]) => (k === 'memo' ? (v ?? '') : v) !== existing[COLUMNS[k] as keyof Row])
        : all.filter(([k, v]) => !empty(k, v));
      if (entries.length === 0) return;
      const now = deps.now();
      const nowIso = now.toISOString();
      if (existing) {
        const sets = entries.map(([k]) => `${COLUMNS[k]} = ?`).join(', ');
        await db.runAsync(
          `UPDATE body_records SET ${sets}, updated_at = ? WHERE id = ?`,
          [...entries.map(([k, v]) => (k === 'memo' ? (v ?? '') : v)), nowIso, existing.id],
        );
        return;
      }
      // 測った時刻：今日なら今。ほかの日は、その日の正午（端末の時刻）とする
      const [y, m, d] = date.split('-').map(Number);
      const sameDay = now.getFullYear() === y && now.getMonth() + 1 === m && now.getDate() === d;
      const measuredAt = sameDay ? nowIso : new Date(y, m - 1, d, 12).toISOString();
      const p = { weightKg: null, bodyFatPct: null, musclePct: null, waistCm: null, memo: '', ...patch };
      await db.runAsync(
        `INSERT INTO body_records (id, date, measured_at, weight_kg, body_fat_pct, muscle_pct, waist_cm, memo,
           source, external_id, origin_package, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual', NULL, NULL, ?, ?)`,
        [deps.newId(), date, measuredAt, p.weightKg, p.bodyFatPct, p.musclePct, p.waistCm, p.memo ?? '', nowIso, nowIso],
      );
    },

  };
  return serializeWrites(db, repo, ['saveManual']);
}
