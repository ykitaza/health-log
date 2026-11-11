// 「成長を見る」画面（app/growth.tsx）の決まり。どれも純粋な関数（lerpParams・dayIndexAt は UI スレッドでも呼ぶ worklet。
// jest ではただの関数として動く）。再生の位置は「日の番号の小数」で、0 が最初の記録の日、dayCount − 1 が今日
import { addDays, DateKey, daysBetween, formatJpDate, formatMonthDay } from './date';
import { GrowthDay, GrowthParams, Highlight, PlaybackSpeed, playbackSeconds, satellites, SatState, Subtitle } from './growth';
import { fmt1, kgToUnit, WeightUnit } from './units';

/** 衛星の状態（形の部品 components/growth と同じ名前。lib/growth.ts の meal は food に写す） */
export type SatStates = { training: SatState; food: SatState; sleep: SatState };

export const EMPTY_PARAMS: GrowthParams = { volumeKg: 0, foodDays: 0, sleepDays: 0, days: 0 };

/** 日の数字・日付・累計を描き直す間隔の下限（ms）。速い再生では、これより細かくは描き直さない */
export const DAY_UPDATE_MS = 66;

/** 速さの切り替え：1x → 2x → 4x → 1x */
export function nextSpeed(s: PlaybackSpeed): PlaybackSpeed {
  return s === 1 ? 2 : s === 2 ? 4 : 1;
}

/** 再生の位置の最後（今日）。記録がなければ 0 */
export function lastPosition(dayCount: number): number {
  return Math.max(0, dayCount - 1);
}

/** 再生を使えるか。記録が2日以上あり、動きを減らす設定がオフのとき */
export function canPlay(dayCount: number, reduced: boolean): boolean {
  return dayCount >= 2 && !reduced;
}

/** 再生の位置 → 再生の秒（pickSubtitles の atSec と同じ物差し。等速） */
export function secondsAt(pos: number, dayCount: number, speed: PlaybackSpeed): number {
  return (pos / Math.max(1, dayCount - 1)) * playbackSeconds(dayCount, speed);
}

/** 位置から最後（今日）まで等速で進むのにかかる時間（ms） */
export function remainingMs(pos: number, dayCount: number, speed: PlaybackSpeed): number {
  const end = lastPosition(dayCount);
  return Math.max(0, (secondsAt(end, dayCount, speed) - secondsAt(Math.min(pos, end), dayCount, speed)) * 1000);
}

/** 位置 → 出している日の番号（切り捨て。範囲に収める） */
export function dayIndexAt(pos: number, dayCount: number): number {
  'worklet';
  if (dayCount <= 0) return 0;
  return Math.min(dayCount - 1, Math.max(0, Math.floor(pos + 1e-6)));
}

/** 位置の形の値。前後の日の累計を、日の中の進み具合でまっすぐにつなぐ（毎フレーム UI スレッドで呼ぶ） */
export function lerpParams(series: GrowthParams[], pos: number): GrowthParams {
  'worklet';
  const n = series.length;
  if (n === 0) return { volumeKg: 0, foodDays: 0, sleepDays: 0, days: 0 };
  const p = Math.min(n - 1, Math.max(0, pos));
  const i = Math.floor(p);
  const t = p - i;
  const a = series[i];
  const b = series[Math.min(n - 1, i + 1)];
  return {
    volumeKg: a.volumeKg + (b.volumeKg - a.volumeKg) * t,
    foodDays: a.foodDays + (b.foodDays - a.foodDays) * t,
    sleepDays: a.sleepDays + (b.sleepDays - a.sleepDays) * t,
    days: a.days + (b.days - a.days) * t,
  };
}

/** 日の番号 → 日付 */
export function dateAt(startDate: DateKey, index: number): DateKey {
  return addDays(startDate, index);
}

/** 最初の記録の日から today までの、日ごとの衛星（番号 i は最初の記録の日の i 日後） */
export function satsByIndex(days: GrowthDay[], startDate: DateKey | null, dayCount: number): SatStates[] {
  if (startDate == null) return [];
  const byDate = new Map(days.map((d) => [d.date, d]));
  return Array.from({ length: dayCount }, (_, i) => {
    const s = satellites(byDate.get(addDays(startDate, i)));
    return { training: s.training, food: s.meal, sleep: s.sleep };
  });
}

export const NO_SATS: SatStates = { training: 'none', food: 'none', sleep: 'none' };

/** 再生中に衛星をならす日数（再生の約1秒ぶん。少なくとも1日） */
export function satWindowDays(dayCount: number, speed: PlaybackSpeed): number {
  return Math.max(1, Math.round(Math.max(1, dayCount - 1) / playbackSeconds(dayCount, speed)));
}

/**
 * 再生中の衛星：index までの window 日でならす。その間の半分以上の日で明るい（できた）なら明るい、
 * 1日でも記録があれば薄い、なければなし
 */
export function smoothSats(byIndex: SatStates[], index: number, window: number): SatStates {
  const list = byIndex.slice(Math.max(0, index - Math.max(1, window) + 1), index + 1);
  if (list.length === 0) return NO_SATS;
  const one = (k: keyof SatStates): SatState => {
    const bright = list.filter((s) => s[k] === 'bright').length;
    if (bright > 0 && bright * 2 >= list.length) return 'bright';
    return list.some((s) => s[k] !== 'none') ? 'dim' : 'none';
  };
  return { training: one('training'), food: one('food'), sleep: one('sleep') };
}

/** 最初の記録の日から today までのハイライトだけ（体重の記録は、最初の記録の日より前にあることがある） */
export function highlightsInRange(items: Highlight[], startDate: DateKey | null, today: DateKey): Highlight[] {
  if (startDate == null) return [];
  return items.filter((h) => h.date >= startDate && h.date <= today);
}

/** その日に出す字幕（その日のハイライトのうち、優先度のいちばん高いもの。同じなら先のもの）。なければ null */
export function subtitleOn(items: Highlight[], date: DateKey): Highlight | null {
  let best: Highlight | null = null;
  for (const h of items) if (h.date === date && (best == null || h.priority > best.priority)) best = h;
  return best;
}

/**
 * 再生で、日の番号が from（含まない）から to（含む）へ進んだあいだに出す字幕。間に2つあれば後のもの
 * （速い再生で日の描き直しを間引いても、飛ばした日の字幕を拾う）。なければ null
 */
export function subtitlePassed(subs: Subtitle[], startDate: DateKey, from: number, to: number): Subtitle | null {
  let out: Subtitle | null = null;
  for (const s of subs) {
    const i = daysBetween(startDate, s.date);
    if (i > from && i <= to) out = s;
  }
  return out;
}

/** つまみの横の位置（0〜width）→ いちばん近い日の番号（1日単位で止まる） */
export function indexAtX(x: number, width: number, dayCount: number): number {
  if (dayCount <= 1 || width <= 0) return 0;
  return Math.min(dayCount - 1, Math.max(0, Math.round((x / width) * (dayCount - 1))));
}

/** 日の番号（小数でもよい）→ つまみの上の割合（0＝左はし、1＝右はし） */
export function ratioAt(pos: number, dayCount: number): number {
  'worklet';
  if (dayCount <= 1) return 0;
  return Math.min(1, Math.max(0, pos / (dayCount - 1)));
}

/** 2026年9月14日（月） */
export function formatFullDate(key: DateKey): string {
  return `${Number(key.slice(0, 4))}年${formatJpDate(key)}`;
}

/** つまみの下の左右の日付。最初の記録の日が今日（か記録がない）なら、左に「今日」だけ */
export function scrubberLabels(startDate: DateKey | null, today: DateKey): { left: string; right: string | null } {
  if (startDate == null || startDate >= today) return { left: '今日', right: null };
  return { left: formatMonthDay(startDate), right: formatMonthDay(today) };
}

/** 下の累計の文字。筋トレは負荷量の累計をトン（lb なら k lb）で小数1桁、食事・睡眠は日数 */
export function growthTotals(p: GrowthParams, unit: WeightUnit): { volume: string; volumeUnit: string; foodDays: string; sleepDays: string } {
  return {
    volume: fmt1(kgToUnit(p.volumeKg, unit) / 1000),
    volumeUnit: unit === 'kg' ? 't' : 'k lb',
    foodDays: String(p.foodDays),
    sleepDays: String(p.sleepDays),
  };
}

const SAT_WORDS: Record<keyof SatStates, Record<SatState, string>> = {
  training: { bright: '筋トレ あり', dim: '筋トレ 少し', none: '筋トレ なし' },
  food: { bright: '食事 目標に届いた', dim: '食事 記録あり', none: '食事 なし' },
  sleep: { bright: '睡眠 7時間以上', dim: '睡眠 7時間未満', none: '睡眠 なし' },
};

/** 衛星の印の読み上げ（「筋トレ あり、食事 記録あり、睡眠 なし」） */
export function satsLabel(s: SatStates): string {
  return (['training', 'food', 'sleep'] as const).map((k) => SAT_WORDS[k][s[k]]).join('、');
}

/** 速さのボタンの読み上げ（「再生の速さ 1倍。押すと2倍」） */
export function speedLabel(s: PlaybackSpeed): string {
  return `再生の速さ ${s}倍。押すと${nextSpeed(s)}倍`;
}

/** 再生のボタンの読み上げ。使えないときは理由も入れる */
export function playLabel(o: { playing: boolean; dayCount: number; reduced: boolean }): string {
  if (o.playing) return '一時停止';
  if (o.dayCount === 0) return '再生（記録がまだないため使えません）';
  if (o.dayCount < 2) return '再生（記録が2日以上になると使えます）';
  if (o.reduced) return '再生（動きを減らす設定がオンのため使えません。つまみと前後のハイライトで日を選べます）';
  return '再生';
}
