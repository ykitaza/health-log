import { parseNumber, unitToKg, WeightUnit } from './units';

/** 記録の入力画面の1セット（入力中の文字列のまま持つ） */
export type SetDraft = {
  key: string; // 画面での並びの key
  id?: string; // 保存済みのセットの ID
  weight: string;
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

/** 入力の確認。エラーのある行だけ返す（key → エラー） */
export function validateSets(drafts: SetDraft[], recordType: RecordType): Map<string, SetError> {
  const errors = new Map<string, SetError>();
  for (const d of drafts) {
    if (isBlank(d)) continue;
    const e: SetError = {};
    const reps = parseNumber(d.reps);
    if (reps == null || reps <= 0 || !Number.isInteger(reps)) e.reps = '回数を入れてください';
    if (recordType === 'weight_reps') {
      const w = parseNumber(d.weight);
      if (d.weight.trim() === '') e.weight = '重量を入れてください';
      else if (w == null || w <= 0) e.weight = '重量は正の数で入れてください';
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
    .map((d) => {
      const w = parseNumber(d.weight);
      return {
        id: d.id,
        weightKg: recordType === 'weight_reps' && w != null ? unitToKg(w, unit) : null,
        reps: parseNumber(d.reps) ?? 0,
        memo: d.memo.trim(),
        done: d.done,
      };
    });
}

/** 上のセットを写す（メモと完了は写さない） */
export function copyOf(d: SetDraft, key: string): SetDraft {
  return { key, weight: d.weight, reps: d.reps, memo: '', done: false };
}
