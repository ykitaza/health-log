import { addDays, todayKey } from '@/lib/date';
import { GRAMS_MAX, KCAL_MAX, TARGET_WEIGHT } from '@/lib/meals';
import {
  currentPhase, endDateFor, Phase, PHASE_DIRECTIONS, PHASE_KINDS, PHASE_LIMITS, PHASE_STATUSES, PhaseDirection, PhaseKind, PhaseMealTargets,
  PhaseSnapshot, PhaseStatus, TargetChange, weeksTotal,
} from '@/lib/phases';
import { serializeWrites } from '../serial';
import type { Db, Deps } from '../types';

/** 書けなかったときの理由（画面にそのまま出す） */
export class PhaseError extends Error {}

export type PhaseInput = {
  direction: PhaseDirection;
  name: string;
  startDate: string;
  weeks: number;
  targetWeightKg: number;
  mealTargets: PhaseMealTargets | null;
  /** 開始時の記録（体重・体脂肪率・BIG3・成長スコア。画面が今の記録から出して渡す） */
  snapshot: PhaseSnapshot | null;
};

export type RehabInput = { name: string; startDate: string; snapshot: PhaseSnapshot | null };

type Row = {
  id: string; kind: string; direction: string | null; name: string | null; start_date: string; end_date: string | null;
  target_weight_kg: number | null; meal_targets: string | null; snapshot: string | null; status: string; paused_phase_id: string | null;
  target_history: string | null; ended_on: string | null; created_at: string;
};

function json<T>(text: string | null, fallback: T): T {
  if (text == null) return fallback;
  try {
    return (JSON.parse(text) as T) ?? fallback;
  } catch {
    return fallback;
  }
}

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T => (list as readonly unknown[]).includes(v);

/**
 * 端末の行をフェーズにする。知らない種類・状態は読まない（null）。項目は後勝ちで当てはめるので、食い違っていても読む
 * （療養の向き・目標・終了日・履歴は捨て、終えた日は active でないときだけ使う。サーバーの sync_repository.py と同じ）
 */
function toPhase(r: Row): Phase | null {
  if (!isOneOf(PHASE_KINDS, r.kind) || !isOneOf(PHASE_STATUSES, r.status)) return null;
  const rehab = r.kind === 'rehab';
  return {
    id: r.id, kind: r.kind, direction: !rehab && isOneOf(PHASE_DIRECTIONS, r.direction) ? r.direction : null, name: r.name ?? '',
    startDate: r.start_date, endDate: rehab ? null : r.end_date, targetWeightKg: rehab ? null : r.target_weight_kg,
    mealTargets: json<PhaseMealTargets | null>(r.meal_targets, null), snapshot: json<PhaseSnapshot | null>(r.snapshot, null),
    status: r.status, pausedPhaseId: rehab ? r.paused_phase_id : null,
    targetHistory: rehab ? [] : json<TargetChange[]>(r.target_history, []), endedOn: r.status === 'active' ? null : r.ended_on,
    createdAt: r.created_at,
  };
}

const SELECT = `SELECT id, kind, direction, name, start_date, end_date, target_weight_kg, meal_targets, snapshot, status, paused_phase_id,
  target_history, ended_on, created_at FROM phases WHERE deleted_at IS NULL`;

const inRange = (v: number | null | undefined, min: number, max: number, open = false) =>
  v != null && Number.isFinite(v) && (open ? v > min : v >= min) && v <= max ? v : null;

/**
 * 開始時の記録を、サーバーの範囲（sync_entities.py の PhaseSnapshot）に収める。範囲の外の値は null にする
 * （記録から出した値なので、断ってフェーズを始められなくするより、その値だけ持たない）
 */
export function cleanSnapshot(s: PhaseSnapshot | null): PhaseSnapshot | null {
  if (!s) return null;
  const big3 = s.big3 && {
    bench: inRange(s.big3.bench, 0, 1000, true), squat: inRange(s.big3.squat, 0, 1000, true), deadlift: inRange(s.big3.deadlift, 0, 1000, true),
  };
  const score = inRange(s.growth_score, 0, 100);
  return {
    weight_kg: inRange(s.weight_kg, TARGET_WEIGHT.min, TARGET_WEIGHT.max), body_fat_pct: inRange(s.body_fat_pct, 0, 100), big3,
    growth_score: score == null ? null : Math.round(score),
  };
}

/** 食事の目標の確かめ（サーバーの PhaseDayTarget と同じ範囲：kcal 0〜20000、たんぱく質 0〜5000g） */
function mealTargetsError(t: PhaseMealTargets | null): string | null {
  if (!t) return null;
  for (const day of [t.training_day, t.rest_day]) {
    if (!day) return '食事の目標を入れてください';
    if (day.kcal != null && inRange(day.kcal, 0, KCAL_MAX) == null) return `kcal は0〜${KCAL_MAX}で入れてください`;
    if (day.protein_g != null && inRange(day.protein_g, 0, GRAMS_MAX) == null) return `たんぱく質は0〜${GRAMS_MAX}g で入れてください`;
  }
  return null;
}

const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

function nameError(name: string): string | null {
  return [...name.trim()].length > PHASE_LIMITS.name ? `名前は${PHASE_LIMITS.name}文字までです` : null;
}

function targetError(kg: number): string | null {
  return Number.isFinite(kg) && kg >= TARGET_WEIGHT.min && kg <= TARGET_WEIGHT.max
    ? null : `目標体重は${TARGET_WEIGHT.min}〜${TARGET_WEIGHT.max}kg で入れてください`;
}

/**
 * フェーズ。アプリだけが書く（MCP は読むだけ）。書き込みはトリガーが outbox に積み、次の同期でサーバーに届く。
 * 1つの操作は1つの行につき1回の UPDATE にする（状態と終えた日、目標と終了日と履歴を同じ変更で送るため。db/syncSpec.ts の together）。
 * 止まっているか・時計のずれは療養の行から求める（lib/phases.ts）ので、療養を始めても通常のフェーズの行は変えない
 */
export function phaseRepository(db: Db, deps: Deps) {
  const today = () => todayKey(deps.now());
  const nowIso = () => deps.now().toISOString();

  async function list(): Promise<Phase[]> {
    const rows = await db.getAllAsync<Row>(`${SELECT} ORDER BY start_date DESC, created_at DESC, id DESC`, []);
    return rows.map(toPhase).filter((p): p is Phase => p != null);
  }

  async function get(id: string): Promise<Phase | null> {
    const row = await db.getFirstAsync<Row>(`${SELECT} AND id = ?`, [id]);
    return row ? toPhase(row) : null;
  }

  async function mustGet(id: string, kind?: PhaseKind): Promise<Phase> {
    const p = await get(id);
    if (!p || (kind && p.kind !== kind)) throw new PhaseError('このフェーズは消えています');
    return p;
  }

  async function checkCount() {
    const count = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM phases WHERE deleted_at IS NULL', []);
    if ((count?.n ?? 0) >= PHASE_LIMITS.phases) throw new PhaseError(`フェーズは${PHASE_LIMITS.phases}件までです`);
  }

  async function insert(values: Record<string, string | number | null>): Promise<string> {
    const id = deps.newId();
    const now = nowIso();
    const cols = ['id', ...Object.keys(values), 'created_at', 'updated_at'];
    await db.runAsync(`INSERT INTO phases (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      [id, ...Object.values(values), now, now]);
    return id;
  }

  /** 終える・中断する（終えた日は今日。開始日より前にはしない） */
  async function finish(p: Phase, status: Exclude<PhaseStatus, 'active'>) {
    const on = today() < p.startDate ? p.startDate : today();
    await db.runAsync("UPDATE phases SET status = ?, ended_on = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL AND status = 'active'",
      [status, on, nowIso(), p.id]);
  }

  /** 目標と終了日を変え、変えた日から線を引き直す（同じ日にもう一度変えたら、その日の1件を置き換える） */
  async function replan(p: Phase, targetWeightKg: number, endDate: string, weightKg: number | null) {
    if (p.status !== 'active') throw new PhaseError('終えたフェーズは変えられません');
    const day = today() < p.startDate ? p.startDate : today();
    const history = p.targetHistory.filter((c) => c.date !== day);
    if (history.length === 0 && day !== p.startDate && p.endDate && p.targetWeightKg != null) {
      // 前の版の行などで履歴がないときは、最初の線を先に入れる（前の線を薄く残すため）
      history.push({ date: p.startDate, target_weight_kg: p.targetWeightKg, end_date: p.endDate, weight_kg: p.snapshot?.weight_kg ?? null });
    }
    history.push({ date: day, target_weight_kg: targetWeightKg, end_date: endDate, weight_kg: weightKg });
    if (history.length > PHASE_LIMITS.targetHistory) throw new PhaseError(`目標の変更は${PHASE_LIMITS.targetHistory}回までです`);
    await db.runAsync('UPDATE phases SET target_weight_kg = ?, end_date = ?, target_history = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
      [targetWeightKg, endDate, JSON.stringify(history), nowIso(), p.id]);
  }

  return serializeWrites(db, {
    /** 消していないフェーズ（開始日の新しい順、同じなら記録の新しい順） */
    list,

    get,

    /** 今のフェーズ（療養中なら療養）と、療養で止まっている通常のフェーズ */
    async current(asOf: string = today()) {
      return currentPhase(await list(), asOf);
    },

    /** 通常のフェーズを始める（本人の宣言）。実施中のフェーズがあれば断る（先に終えるか中断する）。作った ID を返す */
    async start(input: PhaseInput): Promise<string> {
      if (!isOneOf(PHASE_DIRECTIONS, input.direction)) throw new PhaseError('向きを選んでください');
      if (!isDay(input.startDate)) throw new PhaseError('開始日を選んでください');
      if (!Number.isInteger(input.weeks) || input.weeks < 1 || input.weeks > PHASE_LIMITS.weeks) {
        throw new PhaseError(`期間は1〜${PHASE_LIMITS.weeks}週で入れてください`);
      }
      const error = targetError(input.targetWeightKg) ?? nameError(input.name) ?? mealTargetsError(input.mealTargets);
      if (error) throw new PhaseError(error);
      const snapshot = cleanSnapshot(input.snapshot);
      if ((await list()).some((p) => p.status === 'active')) throw new PhaseError('実施中のフェーズがあります。終えるか中断してから始めてください');
      await checkCount();
      const endDate = endDateFor(input.startDate, input.weeks);
      const history: TargetChange[] = [{
        date: input.startDate, target_weight_kg: input.targetWeightKg, end_date: endDate, weight_kg: snapshot?.weight_kg ?? null,
      }];
      return insert({
        kind: 'normal', direction: input.direction, name: input.name.trim(), start_date: input.startDate, end_date: endDate,
        target_weight_kg: input.targetWeightKg, meal_targets: input.mealTargets ? JSON.stringify(input.mealTargets) : null,
        snapshot: snapshot ? JSON.stringify(snapshot) : null, status: 'active', paused_phase_id: null,
        target_history: JSON.stringify(history), ended_on: null,
      });
    },

    /**
     * 療養に入る。実施中の通常のフェーズがあれば、それを止める（paused_phase_id に持つ。通常のフェーズの行は変えない）。
     * 実施中の療養があれば断る。作った ID を返す
     */
    async startRehab(input: RehabInput): Promise<string> {
      if (!isDay(input.startDate)) throw new PhaseError('開始日を選んでください');
      const error = nameError(input.name);
      if (error) throw new PhaseError(error);
      const phases = await list();
      if (phases.some((p) => p.kind === 'rehab' && p.status === 'active')) throw new PhaseError('療養はもう始めています');
      await checkCount();
      const normal = phases.find((p) => p.kind === 'normal' && p.status === 'active' && p.startDate <= input.startDate) ?? null;
      return insert({
        kind: 'rehab', direction: null, name: input.name.trim(), start_date: input.startDate, end_date: null, target_weight_kg: null,
        meal_targets: null, snapshot: input.snapshot ? JSON.stringify(cleanSnapshot(input.snapshot)) : null, status: 'active',
        paused_phase_id: normal?.id ?? null, target_history: '[]', ended_on: null,
      });
    },

    /**
     * 療養を終える。resume なら止めていた通常のフェーズを続け（療養の日数だけ終わりが後ろにずれる）、そうでなければ
     * 止めていたフェーズも終える（振り返って次に進む）
     */
    async endRehab(id: string, { resume }: { resume: boolean }): Promise<void> {
      const rehab = await mustGet(id, 'rehab');
      if (rehab.status !== 'active') return;
      await db.withTransactionAsync(async () => {
        await finish(rehab, 'ended');
        const paused = rehab.pausedPhaseId ? await get(rehab.pausedPhaseId) : null;
        if (!resume && paused && paused.status === 'active') await finish(paused, 'ended');
      });
    },

    /** 目標体重を変える。weightKg は線の始まりの体重（今の週の平均。なければ null で、前の線の今日の値から引く） */
    async changeTarget(id: string, targetWeightKg: number, weightKg: number | null): Promise<void> {
      const p = await mustGet(id, 'normal');
      const error = targetError(targetWeightKg) ?? (weightKg == null ? null : targetError(weightKg));
      if (error) throw new PhaseError(error);
      await replan(p, targetWeightKg, p.endDate!, weightKg);
    },

    /** 延長する（終了日を weeks 週だけ後ろへ）。線は前の線の今日の値から引き直す */
    async extend(id: string, weeks: number): Promise<void> {
      const p = await mustGet(id, 'normal');
      if (!Number.isInteger(weeks) || weeks < 1 || (weeksTotal(p) ?? 0) + weeks > PHASE_LIMITS.weeks) {
        throw new PhaseError(`期間は${PHASE_LIMITS.weeks}週までです`);
      }
      await replan(p, p.targetWeightKg!, addDays(p.endDate!, weeks * 7), null);
    },

    /** 食事の目標を変える */
    async setMealTargets(id: string, targets: PhaseMealTargets | null): Promise<void> {
      await mustGet(id);
      const error = mealTargetsError(targets);
      if (error) throw new PhaseError(error);
      await db.runAsync('UPDATE phases SET meal_targets = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
        [targets ? JSON.stringify(targets) : null, nowIso(), id]);
    },

    async rename(id: string, name: string): Promise<void> {
      await mustGet(id);
      const error = nameError(name);
      if (error) throw new PhaseError(error);
      await db.runAsync('UPDATE phases SET name = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL', [name.trim(), nowIso(), id]);
    },

    /** 早く終える（振り返りへ進む） */
    async end(id: string): Promise<void> {
      await finish(await mustGet(id), 'ended');
    },

    /** 中断する（振り返らず、未設定に戻す） */
    async abort(id: string): Promise<void> {
      await finish(await mustGet(id), 'aborted');
    },
  }, ['start', 'startRehab', 'endRehab', 'changeTarget', 'extend', 'setMealTargets', 'rename', 'end', 'abort']);
}
