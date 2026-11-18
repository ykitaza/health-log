import { defaultRatio } from '@/lib/bodyweight';
import { big3Assignments, Big3Role, isBig3Role } from '@/lib/exercises';
import { nameLengthError, parseFormVideoUrl } from '@/lib/limits';
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
  /** 回数だけの種目の、体重に対する割合（0〜1）。null は名前から決める（lib/bodyweight.ts の ratioOf）。重量×回数の種目は null */
  bodyweightRatio: number | null;
  /**
   * 保存してある BIG3 の役（null は割り当てなし）。どの種目にもないあいだは名前で決めるので、
   * 画面で使う役は big3Assignments（lib/exercises.ts）で求める
   */
  big3: Big3Role | null;
  /** フォームの動画のリンク（https://）。なければ null */
  formVideoUrl: string | null;
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
  record_type: RecordType; sort_order: number; hidden: number; bodyweight_ratio: number | null;
  big3: string | null; form_video_url: string | null;
};

const toExercise = (r: ExerciseRow): Exercise => ({
  id: r.id, bodyPartId: r.body_part_id, bodyPartName: r.body_part_name, name: r.name,
  recordType: r.record_type, sortOrder: r.sort_order, hidden: r.hidden === 1, bodyweightRatio: r.bodyweight_ratio,
  big3: isBig3Role(r.big3) ? r.big3 : null, formVideoUrl: r.form_video_url,
});

const EXERCISE_SELECT = `
  SELECT e.id, e.body_part_id, p.name AS body_part_name, e.name, e.record_type, e.sort_order, e.hidden, e.bodyweight_ratio,
    e.big3, e.form_video_url
  FROM exercises e JOIN body_parts p ON p.id = e.body_part_id
  WHERE e.deleted_at IS NULL AND p.deleted_at IS NULL`;

function checkRatio(ratio: number): number {
  if (!(ratio >= 0 && ratio <= 1)) throw new Error('体重に対する割合は 0〜100% で入れてください');
  return ratio;
}

/** フォームの動画のリンク（前後の空白を取る。空は null）。形が違えば断る */
function checkFormVideoUrl(text: string | null | undefined): string | null {
  const r = parseFormVideoUrl(text ?? '');
  if ('error' in r) throw new Error(r.error);
  return r.value;
}

/** 種目の追加・編集の入力の BIG3 の役とフォームの動画（省くと変えない） */
type ExtraInput = { big3?: Big3Role | null; formVideoUrl?: string | null };

/**
 * 種目 id の BIG3 の役を role にする（null は外す）。1つの役は1つの種目だけなので、その役を持つほかの種目からは外す。
 * どの種目にも役がない（名前で決めている）あいだに変えるときは、名前で決めていたほかの役を先に保存する
 * （保存した役が1つでもあると名前では決めなくなり、変えていない役まで消えてしまうため）。
 * 今と同じ役（名前で決めた役も含む）なら何も書かない。行の updated_at を変えるので、トリガーが同期の outbox に積む
 */
async function assignBig3(db: Db, id: string, role: Big3Role | null, now: string): Promise<void> {
  const rows = await db.getAllAsync<{ id: string; name: string; record_type: RecordType; hidden: number; big3: string | null }>(
    'SELECT id, name, record_type, hidden, big3 FROM exercises WHERE deleted_at IS NULL', [],
  );
  const all = rows.map((r) => ({ id: r.id, name: r.name, recordType: r.record_type, hidden: r.hidden === 1, big3: isBig3Role(r.big3) ? r.big3 : null }));
  const current = big3Assignments(all);
  const currentRole = (Object.keys(current) as Big3Role[]).find((k) => current[k] === id) ?? null;
  if (currentRole === role) return;
  const set = (exerciseId: string, value: Big3Role | null) =>
    db.runAsync('UPDATE exercises SET big3 = ?, updated_at = ? WHERE id = ? AND big3 IS NOT ?', [value, now, exerciseId, value]);
  if (!all.some((e) => e.big3 != null)) {
    for (const [r, exerciseId] of Object.entries(current) as [Big3Role, string][]) {
      if (exerciseId !== id && r !== role) await set(exerciseId, r);
    }
  }
  if (role) {
    const holders = all.filter((e) => e.id !== id && e.big3 === role);
    for (const e of holders) await set(e.id, null);
  }
  await set(id, role);
}

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

    /**
     * bodyweightRatio は回数だけの種目の割合（0〜1）。省くと名前から決める。重量×回数の種目には入れない。
     * big3 は BIG3 の役（ほかの種目が持っていれば、そちらから外す）、formVideoUrl はフォームの動画のリンク（https://）
     */
    async createExercise(input: { name: string; bodyPartId: string; recordType: RecordType; bodyweightRatio?: number | null } & ExtraInput): Promise<string> {
      const name = input.name.trim();
      if (name === '') throw new Error('種目の名前を入れてください');
      const tooLong = nameLengthError('種目', name);
      if (tooLong) throw new Error(tooLong);
      const ratio = input.recordType === 'reps_only' ? checkRatio(input.bodyweightRatio ?? defaultRatio(name)) : null;
      const formVideoUrl = checkFormVideoUrl(input.formVideoUrl);
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
      await db.withTransactionAsync(async () => {
        await db.runAsync(
          `INSERT INTO exercises (id, body_part_id, name, record_type, sort_order, hidden, bodyweight_ratio, form_video_url, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
          [id, input.bodyPartId, name, input.recordType, (max?.m ?? -1) + 1, ratio, formVideoUrl, now, now],
        );
        // 「なし」で足すときは書かない（名前で決めている役を、ほかの種目から外さないため）
        if (input.big3) await assignBig3(db, id, input.big3, now);
      });
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

    /**
     * 種目の名前と部位（回数だけの種目は体重に対する割合も）を変える。記録は種目の ID でつながっているので、
     * 過去の記録も新しい名前で出る（割合を変えると、過去の負荷量も新しい割合で出る）。
     * 同じ部位に同じ名前（非表示のものも含む）があれば断る。部位を変えたら、その部位の最後に並べる。
     * bodyweightRatio を省くと割合は変えない。big3（BIG3 の役。null は外す）・formVideoUrl（null は消す）も、省くと変えない
     */
    async updateExercise(id: string, input: { name: string; bodyPartId: string; bodyweightRatio?: number } & ExtraInput): Promise<void> {
      const name = input.name.trim();
      if (name === '') throw new Error('種目の名前を入れてください');
      const tooLong = nameLengthError('種目', name);
      if (tooLong) throw new Error(tooLong);
      const cur = await db.getFirstAsync<{
        body_part_id: string; name: string; sort_order: number; record_type: RecordType; bodyweight_ratio: number | null; form_video_url: string | null;
      }>(
        'SELECT body_part_id, name, sort_order, record_type, bodyweight_ratio, form_video_url FROM exercises WHERE id = ? AND deleted_at IS NULL', [id],
      );
      if (!cur) throw new Error('種目が見つかりません');
      if (input.bodyweightRatio != null && cur.record_type !== 'reps_only') throw new Error('体重に対する割合は、回数だけの種目にだけ入れられます');
      const ratio = input.bodyweightRatio != null ? checkRatio(input.bodyweightRatio) : cur.bodyweight_ratio;
      const formVideoUrl = input.formVideoUrl !== undefined ? checkFormVideoUrl(input.formVideoUrl) : cur.form_video_url;
      const now = deps.now().toISOString();
      // BIG3 の役は、名前などと別に書く（ほかの種目から外すこともあるため）。名前などが変わらなくても役だけ変えられる
      const big3 = () => (input.big3 !== undefined ? assignBig3(db, id, input.big3, now) : Promise.resolve());
      if (cur.name === name && cur.body_part_id === input.bodyPartId && cur.bodyweight_ratio === ratio && cur.form_video_url === formVideoUrl) {
        await db.withTransactionAsync(big3);
        return;
      }
      const dup = await db.getFirstAsync<{ hidden: number }>(
        'SELECT hidden FROM exercises WHERE deleted_at IS NULL AND body_part_id = ? AND name = ? AND id <> ?', [input.bodyPartId, name, id],
      );
      if (dup?.hidden) throw new Error('同じ部位に同じ名前の非表示の種目があります');
      if (dup) throw new Error('同じ部位に同じ名前の種目があります');
      let sortOrder = cur.sort_order;
      if (cur.body_part_id !== input.bodyPartId) {
        const max = await db.getFirstAsync<{ m: number | null }>(
          'SELECT MAX(sort_order) AS m FROM exercises WHERE body_part_id = ?', [input.bodyPartId],
        );
        sortOrder = (max?.m ?? -1) + 1;
      }
      await db.withTransactionAsync(async () => {
        await db.runAsync(
          'UPDATE exercises SET name = ?, body_part_id = ?, sort_order = ?, bodyweight_ratio = ?, form_video_url = ?, updated_at = ? WHERE id = ?',
          [name, input.bodyPartId, sortOrder, ratio, formVideoUrl, now, id],
        );
        // 名前を変えると名前で決める役も変わりうるので、名前を書いたあとで役を決める
        await big3();
      });
    },

    /** 部位の名前を変える。同じ名前の部位（非表示のものも含む）があれば断る */
    async renameBodyPart(id: string, nameInput: string): Promise<void> {
      const name = nameInput.trim();
      if (name === '') throw new Error('部位の名前を入れてください');
      const tooLong = nameLengthError('部位', name);
      if (tooLong) throw new Error(tooLong);
      const dup = await db.getFirstAsync<{ hidden: number }>(
        'SELECT hidden FROM body_parts WHERE deleted_at IS NULL AND name = ? AND id <> ?', [name, id],
      );
      if (dup?.hidden) throw new Error('同じ名前の非表示の部位があります');
      if (dup) throw new Error('同じ名前の部位があります');
      await db.runAsync('UPDATE body_parts SET name = ?, updated_at = ? WHERE id = ? AND name <> ?',
        [name, deps.now().toISOString(), id, name]);
    },

    async setExerciseHidden(id: string, hidden: boolean): Promise<void> {
      await db.runAsync('UPDATE exercises SET hidden = ?, updated_at = ? WHERE id = ?',
        [hidden ? 1 : 0, deps.now().toISOString(), id]);
    },

    async setBodyPartHidden(id: string, hidden: boolean): Promise<void> {
      await db.runAsync('UPDATE body_parts SET hidden = ?, updated_at = ? WHERE id = ?',
        [hidden ? 1 : 0, deps.now().toISOString(), id]);
    },
  }, ['createExercise', 'createBodyPart', 'updateExercise', 'renameBodyPart', 'setExerciseHidden', 'setBodyPartHidden']);
}
