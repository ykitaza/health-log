import { ratioOf, weightOn, withBodyweight } from '@/lib/bodyweight';
import type { DateKey } from '@/lib/date';
import type { RecordType, SetInput } from '@/lib/sets';
import { menuFromDay, TrainingSetRow } from '@/lib/training';
import { serializeWrites } from '../serial';
import { bodyRepository } from './body';
import type { Db, Deps } from '../types';

/** bodyweightLoadKg は回数だけのセットの負荷（その日の体重 × 種目の割合。lib/bodyweight.ts）。体重がない・重量×回数のセットは null */
export type SetRecord = {
  id: string; setIndex: number; weightKg: number | null; reps: number; memo: string; done: boolean; bodyweightLoadKg: number | null;
};
export type Entry = {
  id: string;
  date: DateKey;
  exerciseId: string;
  exerciseName: string;
  bodyPartId: string;
  bodyPartName: string;
  recordType: RecordType;
  /** 回数だけの種目の割合（0〜1。持たなければ名前から決めたもの）。重量×回数の種目は null */
  bodyweightRatio: number | null;
  sortOrder: number;
  sets: SetRecord[];
};

type EntryRow = {
  id: string; date: string; exercise_id: string; exercise_name: string; body_part_id: string;
  body_part_name: string; record_type: RecordType; sort_order: number; bodyweight_ratio: number | null;
};
type SetRow = { id: string; entry_id: string; set_index: number; weight_kg: number | null; reps: number; memo: string; done: number };

const ENTRY_SELECT = `
  SELECT w.id, w.date, w.exercise_id, e.name AS exercise_name, e.body_part_id, p.name AS body_part_name,
         e.record_type, e.bodyweight_ratio, w.sort_order
  FROM workout_entries w
  JOIN exercises e ON e.id = w.exercise_id
  JOIN body_parts p ON p.id = e.body_part_id
  WHERE w.deleted_at IS NULL`;

export function workoutRepository(db: Db, deps: Deps) {
  const body = bodyRepository(db, deps);
  /** 日ごとの体重（体組成。Health Connect の取り込みを含む）。自重の種目の負荷量に使う */
  async function bodyWeights(): Promise<{ date: DateKey; weightKg: number }[]> {
    return (await body.listDaily()).flatMap((d) => (d.weightKg == null ? [] : [{ date: d.date, weightKg: d.weightKg }]));
  }

  async function withSets(rows: EntryRow[]): Promise<Entry[]> {
    if (rows.length === 0) return [];
    const ratios = rows.map((r) => ratioOf({ recordType: r.record_type, name: r.exercise_name, bodyweightRatio: r.bodyweight_ratio }));
    const weights = ratios.some((x) => x != null) ? await bodyWeights() : [];
    const ids = rows.map((r) => r.id);
    const sets = await db.getAllAsync<SetRow>(
      `SELECT id, entry_id, set_index, weight_kg, reps, memo, done FROM workout_sets
       WHERE deleted_at IS NULL AND entry_id IN (${ids.map(() => '?').join(',')}) ORDER BY set_index, id`, ids,
    );
    const byEntry = new Map<string, SetRecord[]>();
    for (const s of sets) {
      const list = byEntry.get(s.entry_id) ?? [];
      list.push({ id: s.id, setIndex: s.set_index, weightKg: s.weight_kg, reps: s.reps, memo: s.memo, done: s.done === 1, bodyweightLoadKg: null });
      byEntry.set(s.entry_id, list);
    }
    return rows.map((r, i) => {
      const ratio = ratios[i];
      const kg = ratio == null ? null : weightOn(weights, r.date);
      const sets = (byEntry.get(r.id) ?? []).map((s) =>
        (ratio != null && s.weightKg == null && kg != null ? { ...s, bodyweightLoadKg: kg * ratio } : s));
      return {
        id: r.id, date: r.date, exerciseId: r.exercise_id, exerciseName: r.exercise_name,
        bodyPartId: r.body_part_id, bodyPartName: r.body_part_name, recordType: r.record_type, bodyweightRatio: ratio,
        sortOrder: r.sort_order, sets,
      };
    });
  }

  async function getDay(date: DateKey): Promise<Entry[]> {
    const rows = await db.getAllAsync<EntryRow>(`${ENTRY_SELECT} AND w.date = ? ORDER BY w.sort_order, w.id`, [date]);
    return withSets(rows);
  }

  return serializeWrites(db, {
    /** その日の記録（実施した順） */
    getDay,

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
        `${ENTRY_SELECT} AND w.exercise_id = ? AND w.date < ? ORDER BY w.date DESC, w.sort_order DESC, w.id DESC LIMIT 1`, [exerciseId, beforeDate],
      );
      return (await withSets(rows))[0] ?? null;
    },

    /** いくつかの日の記録（日付の新しい順、その日の中は実施した順）。推移の記録のカードに使う */
    async getDays(dates: DateKey[]): Promise<Entry[]> {
      if (dates.length === 0) return [];
      const rows = await db.getAllAsync<EntryRow>(
        `${ENTRY_SELECT} AND w.date IN (${dates.map(() => '?').join(',')}) ORDER BY w.date DESC, w.sort_order, w.id`, dates,
      );
      return withSets(rows);
    },

    /** その日より前で、いちばん新しくトレーニングした日と、その日の記録（「前回のメニュー」）。なければ null */
    async previousDay(beforeDate: DateKey): Promise<{ date: DateKey; entries: Entry[] } | null> {
      const last = await db.getFirstAsync<{ date: string }>(
        `SELECT w.date FROM workout_entries w
         WHERE w.deleted_at IS NULL AND w.date < ?
           AND EXISTS (SELECT 1 FROM workout_sets s WHERE s.entry_id = w.id AND s.deleted_at IS NULL)
         ORDER BY w.date DESC LIMIT 1`, [beforeDate],
      );
      if (!last) return null;
      const entries = (await getDay(last.date)).filter((e) => e.sets.length > 0);
      return { date: last.date, entries };
    },

    /**
     * 前回のメニューを写す（「同じメニューで始める」）。種目ごとに、重さと回数だけを未完了のセットとして入れる（menuFromDay）。
     * 写す先の日に記録があれば断る（2回押しても二重にしない）
     */
    async copyDay(fromDate: DateKey, toDate: DateKey): Promise<void> {
      const menu = menuFromDay(await getDay(fromDate));
      if (menu.length === 0) throw new Error('写す記録がありません');
      const now = deps.now().toISOString();
      await db.withTransactionAsync(async () => {
        const has = await db.getFirstAsync<{ n: number }>(
          'SELECT COUNT(*) AS n FROM workout_entries WHERE date = ? AND deleted_at IS NULL', [toDate],
        );
        if ((has?.n ?? 0) > 0) throw new Error('この日にはもう種目があります');
        for (const [order, e] of menu.entries()) {
          const entryId = deps.newId();
          await db.runAsync(
            'INSERT INTO workout_entries (id, date, exercise_id, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
            [entryId, toDate, e.exerciseId, order, now, now],
          );
          for (const [i, st] of e.sets.entries()) {
            await db.runAsync(
              `INSERT INTO workout_sets (id, entry_id, set_index, weight_kg, reps, memo, done, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [deps.newId(), entryId, i, st.weightKg, st.reps, st.memo, st.done ? 1 : 0, now, now],
            );
          }
        }
      });
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

    /**
     * 集計用の、すべてのセット（消したものは除く。非表示の種目も含む）。
     * 回数だけのセットには、自重の負荷（その日の体重 × 種目の割合）を入れる（体重がなければ null で、負荷量に入らない）
     */
    async allSetRows(): Promise<TrainingSetRow[]> {
      const rows = await db.getAllAsync<{
        date: string; exercise_id: string; body_part_id: string; weight_kg: number | null; reps: number;
        name: string; record_type: RecordType; bodyweight_ratio: number | null;
      }>(
        `SELECT w.date, w.exercise_id, e.body_part_id, s.weight_kg, s.reps, e.name, e.record_type, e.bodyweight_ratio
         FROM workout_sets s
         JOIN workout_entries w ON w.id = s.entry_id
         JOIN exercises e ON e.id = w.exercise_id
         WHERE s.deleted_at IS NULL AND w.deleted_at IS NULL
         ORDER BY w.date, w.sort_order, w.id, s.set_index, s.id`, [],
      );
      const out: TrainingSetRow[] = rows.map((r) => ({
        date: r.date, exerciseId: r.exercise_id, bodyPartId: r.body_part_id, weightKg: r.weight_kg, reps: r.reps,
        bodyweightRatio: ratioOf({ recordType: r.record_type, name: r.name, bodyweightRatio: r.bodyweight_ratio }),
      }));
      return out.some((r) => r.bodyweightRatio != null) ? withBodyweight(out, await bodyWeights()) : out;
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
         ORDER BY w.date, w.sort_order, w.id, s.set_index, s.id`, [],
      );
    },
  }, ['saveEntry', 'deleteEntry', 'moveEntry', 'copyDay']);
}
