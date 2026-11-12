// 「成長を見る」画面（app/growth.tsx）の決まり。どれも純粋な関数（'worklet' のものは UI スレッドでも呼ぶ。
// jest ではただの関数として動く）。再生の位置は「日の番号の小数」で、0 が最初の記録の日、dayCount − 1 が今日
import { addDays, DateKey, daysBetween, formatJpDate, formatMonthDay } from './date';
import { GrowthParams, Highlight, NO_PART_SETS, playbackSeconds, Subtitle } from './growth';
import { kgToUnit, WeightUnit } from './units';

export const EMPTY_PARAMS: GrowthParams = { volumeKg: 0, foodDays: 0, sleepDays: 0, days: 0, partSets: [...NO_PART_SETS] };

/** 日の数字・日付・字幕を描き直す間隔の下限（ms）。これより細かくは描き直さない */
export const DAY_UPDATE_MS = 66;

/** 再生の位置の最後（今日）。記録がなければ 0 */
export function lastPosition(dayCount: number): number {
  return Math.max(0, dayCount - 1);
}

/** 再生を使えるか。記録が2日以上あり、動きを減らす設定がオフのとき */
export function canPlay(dayCount: number, reduced: boolean): boolean {
  return dayCount >= 2 && !reduced;
}

/** 再生の位置 → 再生の秒（pickSubtitles の atSec と同じ物差し。等速） */
export function secondsAt(pos: number, dayCount: number): number {
  return (pos / Math.max(1, dayCount - 1)) * playbackSeconds(dayCount);
}

/** 位置から最後（今日）まで等速で進むのにかかる時間（ms） */
export function remainingMs(pos: number, dayCount: number): number {
  const end = lastPosition(dayCount);
  return Math.max(0, (secondsAt(end, dayCount) - secondsAt(Math.min(pos, end), dayCount)) * 1000);
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
  if (n === 0) return { volumeKg: 0, foodDays: 0, sleepDays: 0, days: 0, partSets: [0, 0, 0, 0, 0, 0] };
  const p = Math.min(n - 1, Math.max(0, pos));
  const i = Math.floor(p);
  const t = p - i;
  const a = series[i];
  const b = series[Math.min(n - 1, i + 1)];
  const partSets: number[] = [];
  for (let k = 0; k < a.partSets.length; k++) partSets.push(a.partSets[k] + ((b.partSets[k] ?? a.partSets[k]) - a.partSets[k]) * t);
  return {
    volumeKg: a.volumeKg + (b.volumeKg - a.volumeKg) * t,
    foodDays: a.foodDays + (b.foodDays - a.foodDays) * t,
    sleepDays: a.sleepDays + (b.sleepDays - a.sleepDays) * t,
    days: a.days + (b.days - a.days) * t,
    partSets,
  };
}

/** 日の番号 → 日付 */
export function dateAt(startDate: DateKey, index: number): DateKey {
  return addDays(startDate, index);
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
 * （日の描き直しを間引いても、飛ばした日の字幕を拾う）。なければ null
 */
export function subtitlePassed(subs: Subtitle[], startDate: DateKey, from: number, to: number): Subtitle | null {
  let out: Subtitle | null = null;
  for (const s of subs) {
    const i = daysBetween(startDate, s.date);
    if (i > from && i <= to) out = s;
  }
  return out;
}

/** 線の横の位置（0〜width）→ いちばん近い日の番号（1日単位で止まる） */
export function indexAtX(x: number, width: number, dayCount: number): number {
  if (dayCount <= 1 || width <= 0) return 0;
  return Math.min(dayCount - 1, Math.max(0, Math.round((x / width) * (dayCount - 1))));
}

/** 日の番号（小数でもよい）→ 線の上の割合（0＝左はし、1＝右はし） */
export function ratioAt(pos: number, dayCount: number): number {
  'worklet';
  if (dayCount <= 1) return 0;
  return Math.min(1, Math.max(0, pos / (dayCount - 1)));
}

/** 線の点を押したとみなす距離（dp）。点から遠ければ、押した位置の日へ */
export const MARK_HIT_DP = 24;

/** 線の帯を押した位置 → 飛ぶ日。いちばん近い点が MARK_HIT_DP 以内ならその点の日、なければ押した位置の日 */
export function seekIndexAtX(x: number, width: number, dayCount: number, markIndexes: number[]): number {
  let best: number | null = null;
  let bestDist = MARK_HIT_DP;
  for (const i of markIndexes) {
    const d = Math.abs(ratioAt(i, dayCount) * width - x);
    if (d <= bestDist) { best = i; bestDist = d; }
  }
  return best ?? indexAtX(x, width, dayCount);
}

// 画面全体の指の操作（1回押す＝再生と一時停止、左右になぞる＝日を移す）

/** タップとみなす動きの上限（dp）。縦横どちらもこれ未満で放したらタップ */
export const TAP_SLOP_DP = 10;
/** 画面の左右の端から、この幅（dp）で始まる指の動きは使わない（Android のジェスチャーの「戻る」とぶつかるため） */
export const EDGE_DP = 24;
/** 指で日を移す感度：1日あたりの指の動き（dp）。画面の幅で全期間を基本にし、この範囲に収める */
export const MIN_DP_PER_DAY = 3;
export const MAX_DP_PER_DAY = 40;

/** 放したときに、タップだったか */
export function isTap(dx: number, dy: number): boolean {
  return Math.abs(dx) < TAP_SLOP_DP && Math.abs(dy) < TAP_SLOP_DP;
}

/** 動いている途中で、日を移す指の動きとして受けるか（横に TAP_SLOP_DP 以上、縦より大きい） */
export function claimsDrag(dx: number, dy: number): boolean {
  return Math.abs(dx) >= TAP_SLOP_DP && Math.abs(dx) >= Math.abs(dy);
}

/** 押し始めの位置（画面の左はしからの dp）が、左右の端の帯にあるか */
export function startsAtEdge(pageX: number, screenWidth: number): boolean {
  return pageX < EDGE_DP || pageX > screenWidth - EDGE_DP;
}

/** 1日あたりの指の動き（dp）。画面の幅 ÷ 日と日のあいだの数を、MIN_DP_PER_DAY〜MAX_DP_PER_DAY に収める */
export function dpPerDay(screenWidth: number, dayCount: number): number {
  return Math.min(MAX_DP_PER_DAY, Math.max(MIN_DP_PER_DAY, screenWidth / Math.max(1, dayCount - 1)));
}

/** 指の横の動き（dp。右が正）→ 移す日数（右へ動かすと先の日へ。1日単位） */
export function dragDays(dx: number, screenWidth: number, dayCount: number): number {
  return Math.round(dx / dpPerDay(screenWidth, dayCount)) + 0; // + 0 で -0 を 0 にする
}

/** 押し始めの日から、指の動きで移った先の日の番号（範囲に収める） */
export function dragIndex(startIndex: number, dx: number, screenWidth: number, dayCount: number): number {
  if (dayCount <= 1) return 0;
  return Math.min(dayCount - 1, Math.max(0, startIndex + dragDays(dx, screenWidth, dayCount)));
}

// 初回のヒント（「タップで再生・左右になぞると日を移せます」）

/** ヒントを出したことを置く場所（sync_meta。同期しない。端末だけ） */
export const TIMELAPSE_HINT_KEY = 'growth.timelapse_hint_seen';
export const TIMELAPSE_HINT_TEXT = 'タップで再生・左右になぞると日を移せます';
/** 終わり（今日の姿で止まった）ときの、字幕の位置の薄い文字。画面のどこを押しても最初から再生する（ボタンは置かない） */
export const REPLAY_TEXT = 'タップでもう一度';

/**
 * ヒントを出すか。タップで一時停止したとき・再生が終わったときに呼ぶ。
 * まだ見せていなくて（seen が false）、それより前に画面を触っていない（touched：なぞる・点を押す・タップ・形を選ぶ・もう一度）ときだけ出す。
 * つまり、最初の操作がタップの一時停止だったとき、または一度も触らずに再生が終わったとき
 */
export function showsTimelapseHint(seen: boolean, touched: boolean): boolean {
  return !seen && !touched;
}

/** 2026年9月14日（月） */
export function formatFullDate(key: DateKey): string {
  return `${Number(key.slice(0, 4))}年${formatJpDate(key)}`;
}

/** 線の下の左右の日付。最初の記録の日が今日（か記録がない）なら、左に「今日」だけ */
export function scrubberLabels(startDate: DateKey | null, today: DateKey): { left: string; right: string | null } {
  if (startDate == null || startDate >= today) return { left: '今日', right: null };
  return { left: formatMonthDay(startDate), right: formatMonthDay(today) };
}

/** 再生中に、日の数字を描き直す間隔（ms） */
export const LIVE_UPDATE_MS = 33;
/** 再生中に、左上の式の番号と値を描き直す間隔（ms。1秒に約9回） */
export const FORMULA_UPDATE_MS = 110;

// 下の累計（数え上がる表示）

/** 累計の値（表示の単位）。volume は t（lb なら k lb）、food・sleep は日数 */
export type TotalValues = { volume: number; food: number; sleep: number };
/** 表示の単位の1つ分（筋トレは 0.1 t、食事・睡眠は 1日） */
export const TOTAL_STEPS: TotalValues = { volume: 0.1, food: 1, sleep: 1 };
/** 1フレームで、表示の値を本当の値へ近づける割合（差のこの割合。ただし単位で1つ以上） */
export const CHASE_RATIO = 0.18;

/** 形の値 → 累計の値（表示の単位）。perKg：1 kg を表示の重さの単位にした値（kg なら 1） */
export function totalValues(p: GrowthParams, perKg: number): TotalValues {
  'worklet';
  return { volume: (p.volumeKg * perKg) / 1000, food: p.foodDays, sleep: p.sleepDays };
}

/**
 * 表示の値を本当の値（target）へ1フレーム分近づける。進む量は差の CHASE_RATIO 倍を単位（step）の整数倍に切り捨てたもの（単位で1つ以上）。
 * 差が1単位以内なら target にぴったり合わせる（行き過ぎない・はね返らない）。増える向きも減る向きも同じ
 */
export function approachTotal(current: number, target: number, step: number, ratio?: number): number {
  'worklet';
  // 既定値を引数の既定値（ratio = CHASE_RATIO）にすると、UI スレッドへ持ち込まれず ReferenceError で落ちる（実機）。本体で読む
  const r = ratio ?? CHASE_RATIO;
  const d = target - current;
  if (Math.abs(d) <= step * (1 + 1e-9)) return target;
  const units = Math.max(1, Math.floor((Math.abs(d) * r) / step));
  return current + Math.sign(d) * units * step;
}

/** 累計の値を、文字が変わるかを比べるための整数に（筋トレは 0.1 単位の四捨五入、日数は切り捨て） */
export function totalKeys(v: TotalValues): TotalValues {
  'worklet';
  return { volume: Math.round(v.volume * 10), food: Math.floor(v.food + 1e-6), sleep: Math.floor(v.sleep + 1e-6) };
}

export type TotalsText = { volume: string; volumeUnit: string; foodDays: string; sleepDays: string };

/** totalKeys の値 → 下の累計の文字 */
export function totalsText(k: TotalValues, unit: WeightUnit): TotalsText {
  return { volume: (k.volume / 10).toFixed(1), volumeUnit: unit === 'kg' ? 't' : 'k lb', foodDays: String(k.food), sleepDays: String(k.sleep) };
}

/** 下の累計の文字。筋トレは負荷量の累計をトン（lb なら k lb）で小数1桁、食事・睡眠は日数（日と日のあいだの値は切り捨てる） */
export function growthTotals(p: GrowthParams, unit: WeightUnit): TotalsText {
  return totalsText(totalKeys(totalValues(p, kgToUnit(1, unit))), unit);
}

/** 下の累計の1行の読み上げ */
export function totalsLabel(t: TotalsText, unit: WeightUnit): string {
  return `累計。筋トレの負荷量 ${t.volume} ${unit === 'kg' ? 'トン' : '千ポンド'}、食事の目標に届いた日 ${t.foodDays}日、7時間以上眠った日 ${t.sleepDays}日`;
}
