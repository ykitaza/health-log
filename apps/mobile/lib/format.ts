import { fmt1, kgToUnit, trimNumber, WeightUnit } from './units';

/** 「80.0 kg × 8 回」。回数だけなら「20 回」 */
export function formatSetLong(weightKg: number | null, reps: number, unit: WeightUnit): string {
  return weightKg == null ? `${reps} 回` : `${fmt1(kgToUnit(weightKg, unit))} ${unit} × ${reps} 回`;
}

/** 「80kg × 8」。回数だけなら「20回」 */
export function formatSetShort(weightKg: number | null, reps: number, unit: WeightUnit): string {
  return weightKg == null ? `${reps}回` : `${trimNumber(kgToUnit(weightKg, unit))}${unit} × ${reps}`;
}

/** 負荷量（kg）を t で（12.45） */
export function tonnes(volumeKg: number, unit: WeightUnit = 'kg'): string {
  return (kgToUnit(volumeKg, unit) / 1000).toFixed(2);
}
