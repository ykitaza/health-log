import { inRange, LIMITS, rangeMessage } from './limits';
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

export type SetError = { weight?: string; reps?: string };

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
    if (recordType === 'weight_reps') {
      const kg = draftWeightKg(d, unit);
      if (d.weight.trim() === '') e.weight = '重量を入れてください';
      else if (kg == null || !inRange(kg, LIMITS.setWeight)) e.weight = rangeMessage(LIMITS.setWeight, unit);
    }
    if (e.weight || e.reps) errors.set(d.key, e);
  }
  return errors;
}

export type SetInput = { id?: string; weightKg: number | null; reps: number; memo: string; done: boolean };

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

/** 上のセットを写す（メモと完了は写さない） */
export function copyOf(d: SetDraft, key: string): SetDraft {
  return { key, weight: d.weight, weightKg: d.weightKg, reps: d.reps, memo: '', done: false };
}
