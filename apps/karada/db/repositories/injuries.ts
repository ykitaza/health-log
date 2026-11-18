import {
  fixedOnFor, injuryInputError, InjuryInput, InjuryStatus, isReviewResult, lengthError, normalizeInjury, ReviewResult, Side,
} from '@/lib/injuries';
import { todayKey } from '@/lib/date';
import { INJURY_LIMITS } from '@/lib/limits';
import { serializeWrites } from '../serial';
import type { Db, Deps } from '../types';

export type Injury = {
  id: string;
  occurredOn: string;
  site: string;
  side: Side | null;
  exerciseId: string | null;
  /** 種目の名前（種目がない・端末にないときは null） */
  exerciseName: string | null;
  phase: string;
  symptom: string;
  cause: string;
  fix: string;
  status: InjuryStatus;
  fixedOn: string | null;
  createdAt: string;
  reviewCount: number;
  /** いちばん新しい振り返り（日付の新しいもの、同じなら後に記録したもの） */
  lastReview: { date: string; result: ReviewResult } | null;
};

export type InjuryReview = {
  id: string;
  injuryId: string;
  date: string;
  result: ReviewResult;
  note: string;
  exerciseId: string | null;
  exerciseName: string | null;
};

export type ReviewInput = { date: string; result: ReviewResult; note: string; exerciseId: string | null };

/** 書けなかったときの理由（画面にそのまま出す） */
export class InjuryError extends Error {}

type InjuryRow = {
  id: string; occurred_on: string; site: string; side: string | null; exercise_id: string | null; exercise_name: string | null;
  phase: string; symptom: string; cause: string; fix: string; status: string; fixed_on: string | null; created_at: string;
  review_count: number; last_date: string | null; last_result: string | null;
};

type ReviewRow = {
  id: string; injury_id: string; date: string; result: string; note: string; exercise_id: string | null; exercise_name: string | null;
};

// 種目の名前は、消した種目でも出す（ケガの記録は残るため）
const INJURY_SELECT = `
SELECT i.id, i.occurred_on, i.site, i.side, i.exercise_id, e.name AS exercise_name, i.phase, i.symptom, i.cause, i.fix, i.status, i.fixed_on,
  i.created_at,
  (SELECT COUNT(*) FROM injury_reviews r WHERE r.injury_id = i.id AND r.deleted_at IS NULL) AS review_count,
  (SELECT r.date FROM injury_reviews r WHERE r.injury_id = i.id AND r.deleted_at IS NULL ORDER BY r.date DESC, r.created_at DESC, r.id DESC LIMIT 1) AS last_date,
  (SELECT r.result FROM injury_reviews r WHERE r.injury_id = i.id AND r.deleted_at IS NULL ORDER BY r.date DESC, r.created_at DESC, r.id DESC LIMIT 1) AS last_result
FROM injuries i LEFT JOIN exercises e ON e.id = i.exercise_id
WHERE i.deleted_at IS NULL`;

function toInjury(r: InjuryRow): Injury {
  return normalizeInjury({
    id: r.id, occurredOn: r.occurred_on, site: r.site, side: r.side, exerciseId: r.exercise_id, exerciseName: r.exercise_name,
    phase: r.phase ?? '', symptom: r.symptom ?? '', cause: r.cause ?? '', fix: r.fix ?? '', status: r.status, fixedOn: r.fixed_on,
    createdAt: r.created_at, reviewCount: r.review_count,
    lastReview: r.last_date && isReviewResult(r.last_result) ? { date: r.last_date, result: r.last_result } : null,
  });
}

const trim = (s: string) => s.trim();

/**
 * ケガの記録と振り返り。書き込みはトリガーが outbox に積み、次の同期でサーバーに届く。
 * 1つの操作は1回の UPDATE にする（部位と左右、状態と直せた日を同じ変更で送るため。db/syncSpec.ts の together）
 */
export function injuryRepository(db: Db, deps: Deps) {
  const today = () => todayKey(deps.now());

  async function get(id: string): Promise<Injury | null> {
    const row = await db.getFirstAsync<InjuryRow>(`${INJURY_SELECT} AND i.id = ?`, [id]);
    return row && toInjury(row);
  }

  return serializeWrites(db, {
    /** 消していないケガ（痛めた日の新しい順、同じなら記録の新しい順） */
    async list(): Promise<Injury[]> {
      const rows = await db.getAllAsync<InjuryRow>(`${INJURY_SELECT} ORDER BY i.occurred_on DESC, i.created_at DESC, i.id DESC`, []);
      return rows.map(toInjury);
    },

    get,

    /** 振り返り（試した日の古い順。縦の年表に上から出す） */
    async reviews(injuryId: string): Promise<InjuryReview[]> {
      const rows = await db.getAllAsync<ReviewRow>(
        `SELECT r.id, r.injury_id, r.date, r.result, r.note, r.exercise_id, e.name AS exercise_name
         FROM injury_reviews r LEFT JOIN exercises e ON e.id = r.exercise_id
         WHERE r.injury_id = ? AND r.deleted_at IS NULL ORDER BY r.date, r.created_at, r.id`, [injuryId]);
      return rows.filter((r) => isReviewResult(r.result)).map((r) => ({
        id: r.id, injuryId: r.injury_id, date: r.date, result: r.result as ReviewResult, note: r.note ?? '',
        exerciseId: r.exercise_id, exerciseName: r.exercise_name,
      }));
    },

    /** ケガを記録する（直している途中で始める）。作ったケガの ID を返す */
    async create(input: InjuryInput): Promise<string> {
      const error = injuryInputError(input, today());
      if (error) throw new InjuryError(error);
      const count = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM injuries WHERE deleted_at IS NULL', []);
      if ((count?.n ?? 0) >= INJURY_LIMITS.injuries) {
        throw new InjuryError(`ケガの記録は${INJURY_LIMITS.injuries}件までです。古い記録を消してから記録してください`);
      }
      const id = deps.newId();
      const now = deps.now().toISOString();
      await db.runAsync(
        `INSERT INTO injuries (id, occurred_on, site, side, exercise_id, phase, symptom, cause, fix, status, fixed_on, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'fixing', NULL, ?, ?)`,
        [id, input.occurredOn, input.site, input.side, input.exerciseId, trim(input.phase), trim(input.symptom), trim(input.cause), trim(input.fix), now, now],
      );
      return id;
    },

    /** ケガを直す（状態はそのまま）。変わった項目だけをトリガーが積む（部位と左右は組で） */
    async update(id: string, input: InjuryInput): Promise<void> {
      const cur = await get(id);
      if (!cur) throw new InjuryError('このケガの記録は消えています');
      const error = injuryInputError(input, today(), cur.fixedOn);
      if (error) throw new InjuryError(error);
      await db.runAsync(
        `UPDATE injuries SET occurred_on = ?, site = ?, side = ?, exercise_id = ?, phase = ?, symptom = ?, cause = ?, fix = ?, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
        [input.occurredOn, input.site, input.side, input.exerciseId, trim(input.phase), trim(input.symptom), trim(input.cause), trim(input.fix),
          deps.now().toISOString(), id],
      );
    },

    /**
     * 直せたにする（直せた日は今日）・直している途中に戻す（直せた日を消す）。状態と直せた日は1回の UPDATE で、同じ変更で送る
     */
    async setStatus(id: string, status: InjuryStatus): Promise<void> {
      const cur = await get(id);
      if (!cur) return;
      const fixedOn = status === 'fixed' ? fixedOnFor(cur.occurredOn, today()) : null;
      await db.runAsync('UPDATE injuries SET status = ?, fixed_on = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
        [status, fixedOn, deps.now().toISOString(), id]);
    },

    /** 振り返りを足す。足した振り返りの ID を返す（直せたで、ケガを閉じるかは画面で聞く。自動では閉じない） */
    async addReview(injuryId: string, input: ReviewInput): Promise<string> {
      if (!(await get(injuryId))) throw new InjuryError('このケガの記録は消えています');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new InjuryError('試した日を選んでください');
      if (input.date > today()) throw new InjuryError('未来の日には記録できません');
      const error = lengthError('メモ', input.note, INJURY_LIMITS.reviewNote);
      if (error) throw new InjuryError(error);
      const count = await db.getFirstAsync<{ n: number }>(
        'SELECT COUNT(*) AS n FROM injury_reviews WHERE injury_id = ? AND deleted_at IS NULL', [injuryId]);
      if ((count?.n ?? 0) >= INJURY_LIMITS.reviewsPerInjury) {
        throw new InjuryError(`振り返りはケガ1件に${INJURY_LIMITS.reviewsPerInjury}件までです`);
      }
      const id = deps.newId();
      const now = deps.now().toISOString();
      await db.runAsync(
        `INSERT INTO injury_reviews (id, injury_id, date, result, note, exercise_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, injuryId, input.date, input.result, trim(input.note), input.exerciseId, now, now],
      );
      return id;
    },

    /** ケガを消す。振り返りも一緒に消す（ケガ → 振り返りの順に積む。MCP の delete_injury と同じ） */
    async remove(id: string): Promise<void> {
      const now = deps.now().toISOString();
      await db.withTransactionAsync(async () => {
        await db.runAsync('UPDATE injuries SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL', [now, now, id]);
        await db.runAsync('UPDATE injury_reviews SET deleted_at = ?, updated_at = ? WHERE injury_id = ? AND deleted_at IS NULL', [now, now, id]);
      });
    },
  }, ['create', 'update', 'setStatus', 'addReview', 'remove']);
}
