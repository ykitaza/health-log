import type { DateKey } from '@/lib/date';
import type { RecordType, SetInput } from '@/lib/sets';
import type { TrainingSetRow } from '@/lib/training';
import type { Db, Deps } from '../types';

export type SetRecord = { id: string; setIndex: number; weightKg: number | null; reps: number; memo: string; done: boolean };
export type Entry = {
  id: string;
  date: DateKey;
  exerciseId: string;
  exerciseName: string;
  bodyPartId: string;
  bodyPartName: string;
  recordType: RecordType;
  sortOrder: number;
  sets: SetRecord[];
};

type EntryRow = {
  id: string; date: string; exercise_id: string; exercise_name: string; body_part_id: string;
  body_part_name: string; record_type: RecordType; sort_order: number;
};
type SetRow = { id: string; entry_id: string; set_index: number; weight_kg: number | null; reps: number; memo: string; done: number };

const ENTRY_SELECT = `
  SELECT w.id, w.date, w.exercise_id, e.name AS exercise_name, e.body_part_id, p.name AS body_part_name,
         e.record_type, w.sort_order
  FROM workout_entries w
  JOIN exercises e ON e.id = w.exercise_id
  JOIN body_parts p ON p.id = e.body_part_id
  WHERE w.deleted_at IS NULL`;

export function workoutRepository(db: Db, deps: Deps) {
  async function withSets(rows: EntryRow[]): Promise<Entry[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const sets = await db.getAllAsync<SetRow>(
      `SELECT id, entry_id, set_index, weight_kg, reps, memo, done FROM workout_sets
       WHERE deleted_at IS NULL AND entry_id IN (${ids.map(() => '?').join(',')}) ORDER BY set_index`, ids,
    );
    const byEntry = new Map<string, SetRecord[]>();
    for (const s of sets) {
      const list = byEntry.get(s.entry_id) ?? [];
      list.push({ id: s.id, setIndex: s.set_index, weightKg: s.weight_kg, reps: s.reps, memo: s.memo, done: s.done === 1 });
      byEntry.set(s.entry_id, list);
    }
    return rows.map((r) => ({
      id: r.id, date: r.date, exerciseId: r.exercise_id, exerciseName: r.exercise_name,
      bodyPartId: r.body_part_id, bodyPartName: r.body_part_name, recordType: r.record_type,
      sortOrder: r.sort_order, sets: byEntry.get(r.id) ?? [],
    }));
  }

  return {
    /** その日の記録（実施した順） */
    async getDay(date: DateKey): Promise<Entry[]> {
      const rows = await db.getAllAsync<EntryRow>(`${ENTRY_SELECT} AND w.date = ? ORDER BY w.sort_order`, [date]);
      return withSets(rows);
    },

    async getEntry(id: string): Promise<Entry | null> {
      const rows = await db.getAllAsync<EntryRow>(`${ENTRY_SELECT} AND w.id = ?`, [id]);
      return (await withSets(rows))[0] ?? null;
    },

    async findEntry(date: DateKey, exerciseId: string): Promise<Entry | null> {
      const rows = await db.getAllAsync<EntryRow>(`${ENTRY_SELECT} AND w.date = ? AND w.exercise_id = ?`, [date, exerciseId]);
      return (await withSets(rows))[0] ?? null;
    },

    /** その日より前の、いちばん新しい記録（「前回」） */
    async previousEntry(exerciseId: string, beforeDate: DateKey): Promise<Entry | null> {
      const rows = await db.getAllAsync<EntryRow>(
        `${ENTRY_SELECT} AND w.exercise_id = ? AND w.date < ? ORDER BY w.date DESC LIMIT 1`, [exerciseId, beforeDate],
      );
      return (await withSets(rows))[0] ?? null;
    },

    /**
     * 1種目ぶんを保存する。id がなければ、その日の最後に足す。
     * セットは ID で突き合わせて更新し、なくなったものは論理削除する。セットが空なら保存しない。
     */
    async saveEntry(input: { id?: string; date: DateKey; exerciseId: string; sets: SetInput[] }): Promise<string> {
      if (input.sets.length === 0) throw new Error('セットを1つ以上入れてください');
      const now = deps.now().toISOString();
      let entryId = input.id ?? '';
      await db.withTransactionAsync(async () => {
        if (!entryId) {
          const max = await db.getFirstAsync<{ m: number | null }>(
            'SELECT MAX(sort_order) AS m FROM workout_entries WHERE date = ? AND deleted_at IS NULL', [input.date],
          );
          entryId = deps.newId();
          await db.runAsync(
            'INSERT INTO workout_entries (id, date, exercise_id, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
            [entryId, input.date, input.exerciseId, (max?.m ?? -1) + 1, now, now],
          );
        } else {
          await db.runAsync('UPDATE workout_entries SET updated_at = ? WHERE id = ?', [now, entryId]);
        }
        const existing = await db.getAllAsync<{ id: string }>(
          'SELECT id FROM workout_sets WHERE entry_id = ? AND deleted_at IS NULL', [entryId],
        );
        const keep = new Set<string>();
        for (const [i, s] of input.sets.entries()) {
          if (s.id && existing.some((e) => e.id === s.id)) {
            keep.add(s.id);
            await db.runAsync(
              'UPDATE workout_sets SET set_index = ?, weight_kg = ?, reps = ?, memo = ?, done = ?, updated_at = ? WHERE id = ?',
              [i, s.weightKg, s.reps, s.memo, s.done ? 1 : 0, now, s.id],
            );
          } else {
            await db.runAsync(
              `INSERT INTO workout_sets (id, entry_id, set_index, weight_kg, reps, memo, done, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [deps.newId(), entryId, i, s.weightKg, s.reps, s.memo, s.done ? 1 : 0, now, now],
            );
          }
        }
        for (const e of existing) {
          if (!keep.has(e.id)) {
            await db.runAsync('UPDATE workout_sets SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, e.id]);
          }
        }
      });
      return entryId;
    },

    /** 種目を外す（その種目のセットも論理削除） */
    async deleteEntry(id: string): Promise<void> {
      const now = deps.now().toISOString();
      await db.withTransactionAsync(async () => {
        await db.runAsync('UPDATE workout_entries SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, id]);
        await db.runAsync(
          'UPDATE workout_sets SET deleted_at = ?, updated_at = ? WHERE entry_id = ? AND deleted_at IS NULL', [now, now, id],
        );
      });
    },

    /** 並び順を1つ上（-1）か下（+1）へ */
    async moveEntry(id: string, direction: -1 | 1): Promise<void> {
      const me = await db.getFirstAsync<{ date: string; sort_order: number }>(
        'SELECT date, sort_order FROM workout_entries WHERE id = ? AND deleted_at IS NULL', [id],
      );
      if (!me) return;
      const other = await db.getFirstAsync<{ id: string; sort_order: number }>(
        direction < 0
          ? 'SELECT id, sort_order FROM workout_entries WHERE date = ? AND deleted_at IS NULL AND sort_order < ? ORDER BY sort_order DESC LIMIT 1'
          : 'SELECT id, sort_order FROM workout_entries WHERE date = ? AND deleted_at IS NULL AND sort_order > ? ORDER BY sort_order ASC LIMIT 1',
        [me.date, me.sort_order],
      );
      if (!other) return;
      const now = deps.now().toISOString();
      await db.withTransactionAsync(async () => {
        await db.runAsync('UPDATE workout_entries SET sort_order = ?, updated_at = ? WHERE id = ?', [other.sort_order, now, id]);
        await db.runAsync('UPDATE workout_entries SET sort_order = ?, updated_at = ? WHERE id = ?', [me.sort_order, now, other.id]);
      });
    },

    /** 集計用の、すべてのセット（消したものは除く。非表示の種目も含む） */
    async allSetRows(): Promise<TrainingSetRow[]> {
      const rows = await db.getAllAsync<{ date: string; exercise_id: string; body_part_id: string; weight_kg: number | null; reps: number }>(
        `SELECT w.date, w.exercise_id, e.body_part_id, s.weight_kg, s.reps
         FROM workout_sets s
         JOIN workout_entries w ON w.id = s.entry_id
         JOIN exercises e ON e.id = w.exercise_id
         WHERE s.deleted_at IS NULL AND w.deleted_at IS NULL
         ORDER BY w.date, w.sort_order, s.set_index`, [],
      );
      return rows.map((r) => ({ date: r.date, exerciseId: r.exercise_id, bodyPartId: r.body_part_id, weightKg: r.weight_kg, reps: r.reps }));
    },

    /** CSV の書き出し用 */
    async exportRows() {
      return db.getAllAsync<{ date: string; body_part: string; exercise: string; set_index: number; weight_kg: number | null; reps: number; memo: string; done: number }>(
        `SELECT w.date, p.name AS body_part, e.name AS exercise, s.set_index, s.weight_kg, s.reps, s.memo, s.done
         FROM workout_sets s
         JOIN workout_entries w ON w.id = s.entry_id
         JOIN exercises e ON e.id = w.exercise_id
         JOIN body_parts p ON p.id = e.body_part_id
         WHERE s.deleted_at IS NULL AND w.deleted_at IS NULL
         ORDER BY w.date, w.sort_order, s.set_index`, [],
      );
    },
  };
}
