import { inRange, LIMITS, memoLengthError, rangeMessage, REPS_MAX } from './limits';
import { estimated1RM } from './training';
import { kgToUnit, parseNumber, trimNumber, unitToKg, WeightUnit } from './units';

/** 記録の入力画面の1セット（入力中の文字列のまま持つ） */
export type SetDraft = {
  key: string; // 画面での並びの key
  id?: string; // 保存済みのセットの ID
  weight: string;
  /** weight を保存済みの値（kg）から作ったときの、その kg。lb で出すと丸めが入るので、変えていなければこちらを保存する */
  weightKg?: number;
  reps: string;
  memo: string;
  done: boolean;
};

export type RecordType = 'weight_reps' | 'reps_only';

export type SetError = { weight?: string; reps?: string; memo?: string };

/** 重さも回数もメモもない行（保存しない） */
export function isBlank(d: SetDraft): boolean {
  return d.weight.trim() === '' && d.reps.trim() === '' && d.memo.trim() === '';
}

/** 行の重量（kg）。保存済みの値から作って文字を変えていなければ、その kg（lb の丸めを入れない） */
function draftWeightKg(d: SetDraft, unit: WeightUnit): number | null {
  const w = parseNumber(d.weight);
  if (w == null) return null;
  const unchanged = d.weightKg != null && d.weight.trim() === trimNumber(kgToUnit(d.weightKg, unit));
  return unchanged ? d.weightKg! : unitToKg(w, unit);
}

/** 入力の確認。エラーのある行だけ返す（key → エラー） */
export function validateSets(drafts: SetDraft[], recordType: RecordType, unit: WeightUnit): Map<string, SetError> {
  const errors = new Map<string, SetError>();
  for (const d of drafts) {
    if (isBlank(d)) continue;
    const e: SetError = {};
    const reps = parseNumber(d.reps);
    if (reps == null || reps <= 0) e.reps = '回数を入れてください';
    else if (!Number.isInteger(reps)) e.reps = '回数は整数で入れてください';
    else if (reps > REPS_MAX) e.reps = `回数は ${REPS_MAX} 回までで入れてください`;
    if (recordType === 'weight_reps') {
      const kg = draftWeightKg(d, unit);
      if (d.weight.trim() === '') e.weight = '重量を入れてください';
      else if (kg == null || !inRange(kg, LIMITS.setWeight)) e.weight = rangeMessage(LIMITS.setWeight, unit);
    }
    const memo = memoLengthError(d.memo);
    if (memo) e.memo = memo;
    if (e.weight || e.reps || e.memo) errors.set(d.key, e);
  }
  return errors;
}

export type SetInput = { id?: string; weightKg: number | null; reps: number; memo: string; done: boolean };

/** 保存済みのセットから、入力の行を作る（重量は単位に直し、元の kg も持つ） */
export function draftFromSet(s: { id: string; weightKg: number | null; reps: number; memo: string; done: boolean }, unit: WeightUnit, key: string): SetDraft {
  return {
    key, id: s.id, weight: s.weightKg == null ? '' : trimNumber(kgToUnit(s.weightKg, unit)),
    weightKg: s.weightKg ?? undefined, reps: String(s.reps), memo: s.memo, done: s.done,
  };
}

/** 保存用に変換する（空の行は落とす）。先に validateSets で確かめておく */
export function toSetInputs(drafts: SetDraft[], recordType: RecordType, unit: WeightUnit): SetInput[] {
  return drafts
    .filter((d) => !isBlank(d))
    .map((d) => ({
      id: d.id,
      weightKg: recordType === 'weight_reps' ? draftWeightKg(d, unit) : null,
      reps: parseNumber(d.reps) ?? 0,
      memo: d.memo.trim(),
      done: d.done,
    }));
}

/** 保存のボタンを押したとき：行ごとのエラー、画面の下に出す文言、保存するセット（formError があれば保存しない） */
export function prepareSave(drafts: SetDraft[], recordType: RecordType, unit: WeightUnit) {
  const errors = validateSets(drafts, recordType, unit);
  if (errors.size > 0) return { errors, formError: '入力を確かめてください', sets: [] as SetInput[] };
  const sets = toSetInputs(drafts, recordType, unit);
  return { errors, formError: sets.length === 0 ? 'セットを1つ以上入れてください' : null, sets };
}

/** 保存したときに変わる中身（空の行は保存しないので含めない。画面の key も含めない） */
const savedShape = (drafts: SetDraft[]) =>
  JSON.stringify(drafts.filter((d) => !isBlank(d)).map((d) => [d.id ?? null, d.weight.trim(), d.reps.trim(), d.memo.trim(), d.done]));

/** 開いたときから、保存していない変更があるか（入力の途中で戻るときの確認に使う） */
export function hasChanges(initial: SetDraft[], current: SetDraft[]): boolean {
  return savedShape(initial) !== savedShape(current);
}

/** 「上のセットをコピー」で写すセット：重量か回数が入っている最後のセット（なければ null） */
export function lastFilledSet(drafts: SetDraft[]): SetDraft | null {
  for (let i = drafts.length - 1; i >= 0; i--) {
    const d = drafts[i];
    if (d.weight.trim() !== '' || d.reps.trim() !== '') return d;
  }
  return null;
}

/** 上のセットを写す（メモと完了は写さない） */
export function copyOf(d: SetDraft, key: string): SetDraft {
  return { key, weight: d.weight, weightKg: d.weightKg, reps: d.reps, memo: '', done: false };
}

/**
 * 入れている行が、それまでの自己ベスト（その日より前の推定1RM の最大）を超えるか（「自己ベスト」のバッジを出す）。
 * 自己ベストがまだない種目、回数だけの種目、入力が正しくない行は超えない
 */
export function beatsBest(d: SetDraft, best: { e1rm: number } | null, recordType: RecordType, unit: WeightUnit): boolean {
  if (!best || recordType !== 'weight_reps') return false;
  const reps = parseNumber(d.reps);
  if (reps == null || !Number.isInteger(reps) || reps <= 0 || reps > REPS_MAX) return false;
  const kg = draftWeightKg(d, unit);
  if (kg == null || !inRange(kg, LIMITS.setWeight)) return false;
  return estimated1RM(kg, reps) > best.e1rm + 1e-9;
}
