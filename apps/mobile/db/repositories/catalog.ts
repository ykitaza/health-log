import { nameLengthError } from '@/lib/limits';
import type { RecordType } from '@/lib/sets';
import { serializeWrites } from '../serial';
import type { Db, Deps } from '../types';

export type BodyPart = { id: string; name: string; sortOrder: number; hidden: boolean };
export type Exercise = {
  id: string;
  bodyPartId: string;
  bodyPartName: string;
  name: string;
  recordType: RecordType;
  sortOrder: number;
  hidden: boolean;
};

/** 非表示の部位・種目と同じ名前を足そうとしたとき。id は、その非表示のもの（表示に戻すときに使う） */
export class HiddenDuplicateError extends Error {
  constructor(message: string, readonly id: string) {
    super(message);
    this.name = 'HiddenDuplicateError';
  }
}

type ExerciseRow = {
  id: string; body_part_id: string; body_part_name: string; name: string;
  record_type: RecordType; sort_order: number; hidden: number;
};

const toExercise = (r: ExerciseRow): Exercise => ({
  id: r.id, bodyPartId: r.body_part_id, bodyPartName: r.body_part_name, name: r.name,
  recordType: r.record_type, sortOrder: r.sort_order, hidden: r.hidden === 1,
});

const EXERCISE_SELECT = `
  SELECT e.id, e.body_part_id, p.name AS body_part_name, e.name, e.record_type, e.sort_order, e.hidden
  FROM exercises e JOIN body_parts p ON p.id = e.body_part_id
  WHERE e.deleted_at IS NULL AND p.deleted_at IS NULL`;

/** 部位と種目。使わなくなったものは消さずに非表示にする（これまでの記録は残る） */
export function catalogRepository(db: Db, deps: Deps) {
  return serializeWrites(db, {
    async listBodyParts(opts: { includeHidden?: boolean } = {}): Promise<BodyPart[]> {
      const rows = await db.getAllAsync<{ id: string; name: string; sort_order: number; hidden: number }>(
        `SELECT id, name, sort_order, hidden FROM body_parts
         WHERE deleted_at IS NULL ${opts.includeHidden ? '' : 'AND hidden = 0'} ORDER BY sort_order, name`, [],
      );
      return rows.map((r) => ({ id: r.id, name: r.name, sortOrder: r.sort_order, hidden: r.hidden === 1 }));
    },

    /** 非表示の部位の種目は、includeHidden でなければ出さない */
    async listExercises(opts: { includeHidden?: boolean } = {}): Promise<Exercise[]> {
      const rows = await db.getAllAsync<ExerciseRow>(
        `${EXERCISE_SELECT} ${opts.includeHidden ? '' : 'AND e.hidden = 0 AND p.hidden = 0'}
         ORDER BY p.sort_order, e.sort_order, e.name`, [],
      );
      return rows.map(toExercise);
    },

    /** 非表示でも取れる（過去の記録の表示に使う） */
    async getExercise(id: string): Promise<Exercise | null> {
      const r = await db.getFirstAsync<ExerciseRow>(`${EXERCISE_SELECT} AND e.id = ?`, [id]);
      return r ? toExercise(r) : null;
    },

    async createExercise(input: { name: string; bodyPartId: string; recordType: RecordType }): Promise<string> {
      const name = input.name.trim();
      if (name === '') throw new Error('種目の名前を入れてください');
      const tooLong = nameLengthError('種目', name);
      if (tooLong) throw new Error(tooLong);
      const dup = await db.getFirstAsync<{ id: string; hidden: number }>(
        'SELECT id, hidden FROM exercises WHERE deleted_at IS NULL AND body_part_id = ? AND name = ?', [input.bodyPartId, name],
      );
      if (dup?.hidden) throw new HiddenDuplicateError('非表示の種目があります。表示に戻しますか？', dup.id);
      if (dup) throw new Error('同じ部位に同じ名前の種目があります');
      const max = await db.getFirstAsync<{ m: number | null }>(
        'SELECT MAX(sort_order) AS m FROM exercises WHERE body_part_id = ?', [input.bodyPartId],
      );
      const id = deps.newId();
      const now = deps.now().toISOString();
      await db.runAsync(
        `INSERT INTO exercises (id, body_part_id, name, record_type, sort_order, hidden, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
        [id, input.bodyPartId, name, input.recordType, (max?.m ?? -1) + 1, now, now],
      );
      return id;
    },

    async createBodyPart(nameInput: string): Promise<string> {
      const name = nameInput.trim();
      if (name === '') throw new Error('部位の名前を入れてください');
      const tooLong = nameLengthError('部位', name);
      if (tooLong) throw new Error(tooLong);
      const dup = await db.getFirstAsync<{ id: string; hidden: number }>(
        'SELECT id, hidden FROM body_parts WHERE deleted_at IS NULL AND name = ?', [name],
      );
      if (dup?.hidden) throw new HiddenDuplicateError('非表示の部位があります。表示に戻しますか？', dup.id);
      if (dup) throw new Error('同じ名前の部位があります');
      const max = await db.getFirstAsync<{ m: number | null }>('SELECT MAX(sort_order) AS m FROM body_parts', []);
      const id = deps.newId();
      const now = deps.now().toISOString();
      await db.runAsync(
        'INSERT INTO body_parts (id, name, sort_order, hidden, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)',
        [id, name, (max?.m ?? -1) + 1, now, now],
      );
      return id;
    },

    async setExerciseHidden(id: string, hidden: boolean): Promise<void> {
      await db.runAsync('UPDATE exercises SET hidden = ?, updated_at = ? WHERE id = ?',
        [hidden ? 1 : 0, deps.now().toISOString(), id]);
    },

    async setBodyPartHidden(id: string, hidden: boolean): Promise<void> {
      await db.runAsync('UPDATE body_parts SET hidden = ?, updated_at = ? WHERE id = ?',
        [hidden ? 1 : 0, deps.now().toISOString(), id]);
    },
  }, ['createExercise', 'createBodyPart', 'setExerciseHidden', 'setBodyPartHidden']);
}
