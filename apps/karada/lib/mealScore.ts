// 食事のスコア（1日 0〜100 点。issue #331）。サーバーの services/meals/meals/domain/meal_score.py をそのまま写したもの。
// アプリはこれで、同期していなくても（オフラインでも）その日の点を出す。
// サーバーと同じ点になるように、同じテストのデータ（testdata/meals/meal_score.json）を pytest と jest の両方で確かめている。
// 足す順番・丸め（js_round と同じ Math.round）・割る順番もサーバーに合わせる。目安の数字と出典はサーバーのファイルの説明にある。
//
// 内訳は 4 つで、重みは同じ（各 25 点）。内訳の中の項目も同じ重み。
//   エネルギー    目標の kcal との差。±10% 以内なら満点、そこから離れるほど下げ、±50% で 0
//   たんぱく質    目標の 90% 以上で満点。足りない分だけ下げる（多いぶんは下げない）
//   バランス      食事バランスガイドの 5 区分の「つ（SV）」が目安の幅に入っているかと、食物繊維
//   控えたいもの  食塩・脂質のエネルギー比・菓子と嗜好飲料・お酒
// 1 日の途中（今日）は、エネルギーとたんぱく質を「1 日の終わりに付く」（deferred）として外し、残りの内訳だけで点を出す
// （昼に「エネルギーをあと 1,202 kcal」と勧めると、食べ過ぎを促すように読めるため）。前の日との差は、同じ規則で数えた点どうしで比べる。
// 推定がない（その日の品目のどれかに値がない）項目は「記録なし」にして、点を下げない（残りの項目だけで割合を出す）。
import type { Sex } from './autoGoal';
import { EstimateAmount, floatSum, MealItem } from './meals';

export type ScorePartKey = 'energy' | 'protein' | 'balance' | 'moderation';
export const PART_LABELS: Record<ScorePartKey, string> = { energy: 'エネルギー', protein: 'たんぱく質', balance: 'バランス', moderation: '控えたいもの' };
export const PART_KEYS: ScorePartKey[] = ['energy', 'protein', 'balance', 'moderation'];

/** 食事バランスガイドの 5 区分（推定の項目名、名前） */
const SV_GROUPS: [EstimateAmount, string][] = [
  ['sv_staple', '主食'], ['sv_side', '副菜'], ['sv_main', '主菜'], ['sv_dairy', '牛乳・乳製品'], ['sv_fruit', '果物'],
];

export type SvBand = { label: string; ranges: Record<string, [number, number]> };

/** 食事バランスガイドの、エネルギーの欄ごとの「つ（SV）」の幅（下限, 上限）。サーバーの SV_BANDS と同じ */
export const SV_BANDS: SvBand[] = [
  { label: '1,400〜2,000kcal', ranges: { sv_staple: [4, 5], sv_side: [5, 6], sv_main: [3, 4], sv_dairy: [2, 2], sv_fruit: [2, 2] } },
  { label: '2,200±200kcal（基本形）', ranges: { sv_staple: [5, 7], sv_side: [5, 6], sv_main: [3, 5], sv_dairy: [2, 2], sv_fruit: [2, 2] } },
  { label: '2,400〜3,000kcal', ranges: { sv_staple: [6, 8], sv_side: [6, 7], sv_main: [4, 6], sv_dairy: [2, 3], sv_fruit: [2, 3] } },
];
const BASIC_BAND = SV_BANDS[1];

const ENERGY_FULL = 0.10, ENERGY_ZERO = 0.50; // 目標の kcal との差の割合：ここまで満点、ここで 0
const PROTEIN_FULL = 0.90; // 目標のたんぱく質のこの割合以上で満点
const FAT_RATIO: [number, number] = [20, 30]; // 脂質のエネルギー比（%）
const FAT_ZERO_DISTANCE = 10; // 幅からこのポイント離れると 0
const FAT_KCAL_PER_G = 9;
const SNACK_KCAL = 200; // 菓子・嗜好飲料（kcal/日）
/** 性別で変わる目安。性別がなければ厳しいほう（サーバーの SALT_G・FIBER_G・ALCOHOL_G） */
const SALT_G = { male: 7.5, female: 6.5, none: 6.5 };
const FIBER_G = { male: 22, female: 18, none: 22 };
const ALCOHOL_G = { male: 40, female: 20, none: 20 };
const bySex = <T>(table: { male: T; female: T; none: T }, sex: Sex | null): T => table[sex ?? 'none'];

/** 本人の目標 kcal に合う欄と、目標 kcal から選んだか（false なら目標がないので基本形）。境目の 2,000 と 2,400 は基本形 */
export function svBand(targetKcal: number | null): { band: SvBand; fromTarget: boolean } {
  if (targetKcal == null) return { band: BASIC_BAND, fromTarget: false };
  if (targetKcal < 2000) return { band: SV_BANDS[0], fromTarget: true };
  if (targetKcal <= 2400) return { band: BASIC_BAND, fromTarget: true };
  return { band: SV_BANDS[2], fromTarget: true };
}

/** 内訳の中の項目。ratio は 0〜1（null は記録なし）。advice はいちばん伸ばしやすいときに見せる一言 */
export type SubScore = {
  key: string; label: string; ratio: number | null;
  value: number | null; low: number | null; high: number | null; unit: string; advice: string | null;
};
export type PartScore = {
  key: ScorePartKey; label: string;
  /** 項目の割合の平均（0〜1）。項目が全部記録なしなら null */
  ratio: number | null;
  /** 0〜100 点（記録なし・数えないときは null） */
  points: number | null;
  /** 1 日の途中なので数えない（1 日の終わりに付く）。エネルギーとたんぱく質だけ */
  deferred: boolean;
  items: SubScore[];
};
/** いちばん伸ばしやすい項目。gain はその項目を満点にしたときに上がる点 */
export type Improvement = { part: ScorePartKey; item: SubScore; gain: number };
export type MealScore = {
  /** 0〜100 点。内訳が全部記録なしなら null */
  score: number | null;
  parts: PartScore[];
  easiest: Improvement | null;
  band: SvBand;
  bandFromTarget: boolean;
  sex: Sex | null;
  /** 1 日の途中（今日）。エネルギーとたんぱく質は数えない */
  inProgress: boolean;
};

/** サーバーの js_round と同じ（0.5 は大きい方へ） */
const jsRound = (x: number) => Math.round(x);

/** 整数を 3 桁区切りで見せる（1,202。サーバーの f"{n:,}" と同じ） */
const intText = (n: number) => n.toLocaleString('en-US');

/** 前から順に足して割る（サーバーの _mean と同じ並び） */
function mean(xs: number[]): number {
  let total = 0;
  for (const x of xs) total += x;
  return total / xs.length;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** あと何つ・何 g を、切り上げて見せる（小数の誤差で 1 つ多くならないよう、わずかに引いてから）。小数 1 桁は「2.0」のように見せる */
function ceilText(x: number, digits = 0): string {
  const scale = 10 ** digits;
  const n = Math.ceil(x * scale - 1e-9) / scale;
  return digits === 0 ? intText(n) : n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** その日のすべての品目に推定があれば合計、1 つでもなければ null（記録なし） */
function sumOf(items: MealItem[], key: EstimateAmount): number | null {
  let total = 0;
  for (const item of items) {
    const v = item[key];
    if (v == null) return null;
    total += v;
  }
  return total;
}

const sub = (key: string, label: string, ratio: number | null, value: number | null = null, low: number | null = null,
  high: number | null = null, unit = '', advice: string | null = null): SubScore => ({ key, label, ratio, value, low, high, unit, advice });

function energy(kcal: number, target: number | null): SubScore {
  if (target == null || target <= 0) return sub('kcal', 'エネルギー', null, null, null, null, 'kcal');
  const diff = (kcal - target) / target;
  const ratio = Math.abs(diff) <= ENERGY_FULL ? 1 : clamp01(1 - (Math.abs(diff) - ENERGY_FULL) / (ENERGY_ZERO - ENERGY_FULL));
  const gap = jsRound(Math.abs(kcal - target));
  const advice = kcal < target ? `エネルギーをあと ${intText(gap)} kcal` : `エネルギーを ${intText(gap)} kcal 控えめに`;
  return sub('kcal', 'エネルギー', ratio, kcal, target, target, 'kcal', advice);
}

function protein(proteinG: number, target: number | null): SubScore {
  if (target == null || target <= 0) return sub('protein_g', 'たんぱく質', null, null, null, null, 'g');
  const full = target * PROTEIN_FULL;
  const ratio = proteinG >= full ? 1 : proteinG / full;
  return sub('protein_g', 'たんぱく質', ratio, proteinG, target, null, 'g', `たんぱく質をあと ${ceilText(target - proteinG)} g`);
}

function sv(key: string, label: string, value: number | null, low: number, high: number): SubScore {
  if (value == null) return sub(key, label, null, null, low, high, 'つ');
  if (value < low) return sub(key, label, value / low, value, low, high, 'つ', `${label}をあと ${ceilText(low - value)} つ`);
  if (value > high) return sub(key, label, high / value, value, low, high, 'つ', `${label}を ${ceilText(value - high)} つ控えめに`);
  return sub(key, label, 1, value, low, high, 'つ');
}

function fiber(value: number | null, target: number): SubScore {
  if (value == null) return sub('fiber_g', '食物繊維', null, null, target, null, 'g');
  return sub('fiber_g', '食物繊維', Math.min(1, value / target), value, target, null, 'g', `食物繊維をあと ${ceilText(target - value)} g`);
}

/** 目安以下なら 1、超えたら目安の 2 倍で 0 になるまでまっすぐ下げる */
const cap = (value: number, limit: number) => (value <= limit ? 1 : clamp01(1 - (value - limit) / limit));

function salt(value: number | null, limit: number): SubScore {
  if (value == null) return sub('salt_g', '食塩', null, null, null, limit, 'g');
  return sub('salt_g', '食塩', cap(value, limit), value, null, limit, 'g', `食塩を ${ceilText(value - limit, 1)} g 控えめに`);
}

function fatRatio(fatG: number, kcal: number): SubScore {
  const [low, high] = FAT_RATIO;
  if (kcal <= 0) return sub('fat_ratio', '脂質', null, null, low, high, '%');
  const pct = fatG * FAT_KCAL_PER_G / kcal * 100;
  const distance = pct < low ? low - pct : pct > high ? pct - high : 0;
  const ratio = clamp01(1 - distance / FAT_ZERO_DISTANCE);
  const advice = pct > high ? '脂質を控えめに（揚げ物を焼き・蒸しに替えるなど）' : '脂質をもう少し（油・ナッツ・魚など）';
  return sub('fat_ratio', '脂質', ratio, pct, low, high, '%', advice);
}

function snack(items: MealItem[]): SubScore {
  if (items.some((i) => i.is_snack_or_sweet_drink == null)) return sub('snack_kcal', '菓子・嗜好飲料', null, null, null, SNACK_KCAL, 'kcal');
  // サーバーは sum()（Python 3.12 から誤差を補って足す）なので、同じ足し方にする
  const kcal = floatSum(items.filter((i) => i.is_snack_or_sweet_drink).map((i) => i.kcal));
  return sub('snack_kcal', '菓子・嗜好飲料', cap(kcal, SNACK_KCAL), kcal, null, SNACK_KCAL, 'kcal',
    `菓子・甘い飲み物を ${intText(jsRound(kcal - SNACK_KCAL))} kcal 控えめに`);
}

function alcohol(value: number | null, limit: number): SubScore {
  if (value == null) return sub('alcohol_g', 'お酒', null, null, null, limit, 'g');
  const ratio = value < limit ? 1 : clamp01(1 - value / (2 * limit));
  return sub('alcohol_g', 'お酒', ratio, value, null, limit, 'g', `お酒を控えめに（純アルコール ${limit} g 未満が目安）`);
}

function part(key: ScorePartKey, items: SubScore[], deferred = false): PartScore {
  const got = items.filter((i) => i.ratio != null);
  const ratio = got.length ? mean(got.map((i) => i.ratio!)) : null;
  return { key, label: PART_LABELS[key], ratio, points: ratio == null ? null : jsRound(100 * ratio), deferred, items };
}

/** 満点にしたときにいちばん点が上がる項目（同じなら内訳・項目の並びの先）。満点ばかりなら null */
function easiestOf(parts: PartScore[]): Improvement | null {
  const got = parts.filter((p) => p.ratio != null);
  let best: { gain: number; part: PartScore; item: SubScore } | null = null;
  for (const p of got) {
    const available = p.items.filter((i) => i.ratio != null);
    for (const item of available) {
      const gain = 100 * (1 - item.ratio!) / got.length / available.length;
      if (gain > 0 && (best == null || gain > best.gain)) best = { gain, part: p, item };
    }
  }
  return best == null ? null : { part: best.part.key, item: best.item, gain: jsRound(best.gain) };
}

/**
 * 1 日の食事のスコア。meals はその日の食事（readableMeals の順）、target はその日の目標（kcal とたんぱく質。なければ null）、
 * sex はアプリの設定の性別（なければ null で、厳しいほうの目安）、inProgress は 1 日の途中（今日。エネルギーとたんぱく質を外す）。
 * 食事がない日は null
 */
export function mealScore(
  meals: { items: MealItem[] }[], target: { kcal: number | null; protein_g: number | null } | null, sex: Sex | null,
  inProgress = false,
): MealScore | null {
  const items = meals.flatMap((m) => m.items);
  if (items.length === 0) return null;
  // 品目を前から順に足す（サーバーと同じ。食事ごとの合計を足すと、小数の誤差が変わる）
  let kcal = 0, proteinG = 0, fatG = 0;
  for (const i of items) {
    kcal += i.kcal;
    proteinG += i.protein_g;
    fatG += i.fat_g;
  }
  const targetKcal = target?.kcal ?? null;
  const { band, fromTarget } = svBand(targetKcal);
  const balance = SV_GROUPS.map(([key, label]) => sv(key, label, sumOf(items, key), ...band.ranges[key]));
  const parts = [
    inProgress ? part('energy', [sub('kcal', 'エネルギー', null, null, null, null, 'kcal')], true) : part('energy', [energy(kcal, targetKcal)]),
    inProgress
      ? part('protein', [sub('protein_g', 'たんぱく質', null, null, null, null, 'g')], true)
      : part('protein', [protein(proteinG, target?.protein_g ?? null)]),
    part('balance', [...balance, fiber(sumOf(items, 'fiber_g'), bySex(FIBER_G, sex))]),
    part('moderation', [salt(sumOf(items, 'salt_g'), bySex(SALT_G, sex)), fatRatio(fatG, kcal), snack(items),
      alcohol(sumOf(items, 'alcohol_g'), bySex(ALCOHOL_G, sex))]),
  ];
  const got = parts.filter((p) => p.ratio != null);
  return {
    score: got.length ? jsRound(100 * mean(got.map((p) => p.ratio!))) : null,
    parts, easiest: easiestOf(parts), band, bandFromTarget: fromTarget, sex, inProgress,
  };
}

/** 前の日の点との差（同じ規則で数えた点どうし。今日と比べる前の日の点も inProgress で数える）。どちらかの日に点がなければ null */
export function scoreDiff(today: MealScore | null, before: MealScore | null): number | null {
  return today?.score == null || before?.score == null ? null : today.score - before.score;
}

/** 内訳の点の言い方：点、または「1日の終わりに付く」（今日のエネルギーとたんぱく質）、「記録なし」 */
export function partText(p: PartScore): string {
  return p.deferred ? '1日の終わりに付く' : p.points == null ? '記録なし' : `${p.points}点`;
}

/** 差の見せ方（+5・−3・±0）。マイナスは数学の記号（U+2212） */
export function diffText(diff: number): string {
  return diff > 0 ? `+${diff}` : diff < 0 ? `−${-diff}` : '±0';
}

/**
 * 読み上げの文。点・前の日との差・内訳（記録なしは「記録なし」）・伸ばしやすい項目。責めない言い方にする
 * （前の日より低くても「前の日より 3 点低い」とだけ言い、伸ばしやすい項目は「〜で +N 点」）
 */
export function scoreSpeech(score: MealScore, diff: number | null): string {
  if (score.score == null) return '食事のスコア：記録なし';
  const head = `食事のスコア${score.inProgress ? '（ここまで）' : ''} ${score.score}点`;
  const vs = diff == null ? '' : diff === 0 ? '、前の日と同じ' : `、前の日より ${Math.abs(diff)}点${diff > 0 ? '高い' : '低い'}`;
  const parts = score.parts.map((p) => `${p.label} ${partText(p)}`).join('、');
  const next = score.easiest ? `。伸ばしやすいのは、${score.easiest.item.advice}で +${score.easiest.gain}点` : '';
  return `${head}${vs}。内訳：${parts}${next}`;
}
