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

/** 小数1桁で表示したときに 0.0 になる値か（-0 や -0.04 も含む）。「±0」の判定と、色・矢印を「変わらず」にする判定に使う */
export function isFlat(n: number): boolean {
  return Math.round(Math.abs(n) * 10) === 0;
}

/** 増減を符号つきの小数1桁で（+1.6、−0.8、±0。マイナスは全角の「−」。小数1桁で 0 になる値は ±0） */
export function formatSigned(n: number): string {
  if (isFlat(n)) return '±0';
  return `${n > 0 ? '+' : '−'}${fmt1(Math.abs(n))}`;
}
