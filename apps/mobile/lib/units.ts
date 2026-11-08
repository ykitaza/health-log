export type WeightUnit = 'kg' | 'lb';

const KG_PER_LB = 0.45359237;

export function kgToUnit(kg: number, unit: WeightUnit): number {
  return unit === 'kg' ? kg : kg / KG_PER_LB;
}

export function unitToKg(value: number, unit: WeightUnit): number {
  return unit === 'kg' ? value : value * KG_PER_LB;
}

/** 入力の文字列を数に。空や数でないものは null。全角数字と「,」の小数点も受ける */
export function parseNumber(text: string): number | null {
  const s = text
    .trim()
    .replace(/[０-９．，]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(',', '.');
  if (s === '') return null;
  if (!/^\d+(\.\d+)?$|^\d+\.$|^\.\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** 小数1桁に丸めて表示（末尾の .0 は残す） */
export function fmt1(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1);
}

/** 入力欄に戻すとき用（80.0 → "80"、80.5 → "80.5"） */
export function trimNumber(n: number): string {
  const r = Math.round(n * 100) / 100;
  return String(r);
}

/** 3桁区切り */
export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}
