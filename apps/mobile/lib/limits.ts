import { kgToUnit, parseNumber, trimNumber, unitToKg, WeightUnit } from './units';

/** 入れられる範囲。重さ（unit が kg）は、lb で入れても kg に直してから比べる */
export type Limit = { label: string; min: number; max: number; minExclusive?: boolean; unit: 'kg' | 'cm' | '%' };

/** 入れられる範囲は、ここにまとめる（体重は食事記録のサーバーと同じ 30〜300kg） */
export const LIMITS = {
  setWeight: { label: '重量', min: 0, minExclusive: true, max: 500, unit: 'kg' },
  bodyWeight: { label: '体重', min: 30, max: 300, unit: 'kg' },
  goalWeight: { label: '目標体重', min: 30, max: 300, unit: 'kg' },
  height: { label: '身長', min: 100, max: 250, unit: 'cm' },
  bodyFat: { label: '体脂肪率', min: 0, max: 100, unit: '%' },
  muscle: { label: '筋肉率', min: 0, max: 100, unit: '%' },
  waist: { label: 'ウエスト', min: 30, max: 200, unit: 'cm' },
} as const satisfies Record<string, Limit>;

/** 種目と部位の名前の長さの上限（前後の空白を取ってから、コードポイントで数える。同期のサーバーの上限 200 の内側） */
export const NAME_MAX_LENGTH = 40;

/**
 * メモ（セットと体組成）の長さの上限。同期のサーバーの Memo（max_length=1000）と同じ。
 * サーバー（Python の str）と同じく、コードポイントで数える（前後の空白を取ってから）。
 * 入力欄の maxLength は UTF-16 の単位で数えるので、欄で止まる長さはこれ以下になる（絵文字は2単位）
 */
export const MEMO_MAX_LENGTH = 1000;

/** セットの回数の上限。同期のサーバーの workout_set.reps（le=10000）と同じ */
export const REPS_MAX = 10000;

/** メモが長すぎるときの文言。長すぎなければ null */
export function memoLengthError(memo: string): string | null {
  const n = [...memo.trim()].length;
  return n > MEMO_MAX_LENGTH ? `メモは ${MEMO_MAX_LENGTH} 文字以内で入れてください（今は${n}文字）` : null;
}

/**
 * 名前が長すぎるときの文言。長すぎなければ null。
 * 長さはコードポイントで数える（[...name].length）。サロゲートペアの絵文字（💪 など）は1つと数えるが、
 * ZWJ でつないだ絵文字（👨‍👩‍👧 など）や肌の色を付けた絵文字は、見た目は1文字でも2つ以上と数える
 */
export function nameLengthError(what: '種目' | '部位', name: string): string | null {
  const n = [...name].length;
  return n > NAME_MAX_LENGTH ? `${what}の名前は${NAME_MAX_LENGTH}文字以内で入れてください（今は${n}文字）` : null;
}

export function inRange(value: number, limit: Limit): boolean {
  return (limit.minExclusive ? value > limit.min : value >= limit.min) && value <= limit.max;
}

/** 範囲外のときの文言。lb の表示なら lb で出す（小数1桁で、範囲の内側に丸める） */
export function rangeMessage(limit: Limit, unit: WeightUnit = 'kg'): string {
  const lb = limit.unit === 'kg' && unit === 'lb';
  const conv = (kg: number) => (lb ? kgToUnit(kg, 'lb') : kg);
  const u = lb ? 'lb' : limit.unit;
  const hi = trimNumber(Math.floor(conv(limit.max) * 10) / 10);
  if (limit.minExclusive) return `${limit.label}は ${hi}${u} までの正の数で入れてください`;
  const lo = trimNumber(Math.ceil(conv(limit.min) * 10) / 10);
  return `${limit.label}は ${lo}〜${hi}${u} で入れてください`;
}

/** 入力の文字列を、範囲の中の数に（重さは kg に直す）。空なら value は null。数でないか範囲外なら error */
export function parseInRange(text: string, limit: Limit, unit: WeightUnit = 'kg'): { value: number | null } | { error: string } {
  if (text.trim() === '') return { value: null };
  const n = parseNumber(text);
  const value = n == null ? null : limit.unit === 'kg' ? unitToKg(n, unit) : n;
  if (value == null || !inRange(value, limit)) return { error: rangeMessage(limit, unit) };
  return { value };
}
