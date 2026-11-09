// 食事の目標（筋トレの日・休みの日の kcal と PFC）を、体のデータから自動で計算する。
// 数字は一般的な目安で、医療のための計算ではない（画面にも書く）。保存はしない（画面で直してから保存する）。
//
// 1. 基礎代謝（BMR）：直近の体脂肪率があれば Katch-McArdle（370 + 21.6 × 除脂肪体重）。なければ Mifflin-St Jeor
// 2. 1日に使うカロリー（TDEE）：BMR × ふだんの活動の量の係数（筋トレの分は含めない）。筋トレの日は TRAINING_KCAL を足す
// 3. 目標のカロリー：目標体重と今の体重から、減量（週に体重の 0.5%）・維持・増量（週に 0.25%）。1kg ＝ 7,200kcal。
//    差が体重の ±1% 以内なら維持。下限は BMR（下回らない）
// 4. PFC：たんぱく質は体重 1kg あたり 2.0g、脂質はカロリーの 25%、炭水化物は残り
// 体重・体脂肪率は、いちばん新しい体重の日までの 7 日の平均（ぶれを抑える）
import { addDays, DateKey } from './date';
import type { DailyTarget, Policy } from './meals';
import { parseNumber } from './units';

export type Sex = 'male' | 'female';
export const SEX_LABELS: Record<Sex, string> = { male: '男性', female: '女性' };

export type Activity = 'sedentary' | 'light' | 'moderate' | 'very';
export const ACTIVITY_LABELS: Record<Activity, string> = {
  sedentary: 'ほとんど座っている', light: '少し動く', moderate: 'よく動く', very: 'とてもよく動く',
};
/** ふだんの活動の量の係数（筋トレの分は含めない。一般的な活動係数） */
export const ACTIVITY_FACTORS: Record<Activity, number> = { sedentary: 1.2, light: 1.375, moderate: 1.55, very: 1.725 };
export const ACTIVITIES = Object.keys(ACTIVITY_LABELS) as Activity[];
export const isActivity = (v: unknown): v is Activity => typeof v === 'string' && v in ACTIVITY_FACTORS;
export const isSex = (v: unknown): v is Sex => v === 'male' || v === 'female';

/**
 * 筋トレの日に足す kcal。筋トレ（Compendium of Physical Activities の resistance training、およそ 5 METs）を
 * 60 分、体重 70kg として、安静（1 MET）を引いた分：(5 − 1) × 70kg × 1 時間 ≒ 280kcal。
 * 体重や時間で変えず、決まった値にする（目安 250〜300kcal の中ほど）
 */
export const TRAINING_KCAL = 280;
/** 体重 1kg の増減に要る kcal */
export const KCAL_PER_KG = 7200;
/** 1週間に変える体重の割合（体重に対して） */
export const CUT_RATE = 0.005;
export const BULK_RATE = 0.0025;
/** 目標体重との差がこの割合以内なら維持 */
export const MAINTAIN_BAND = 0.01;
export const PROTEIN_PER_KG = 2.0;
export const FAT_RATIO = 0.25;
/** 体重・体脂肪率の平均をとる日数（いちばん新しい体重の日を含む） */
export const AVERAGE_DAYS = 7;
/** 前回の自動計算から体重がこの割合以上変わったら、計算し直すかを聞く */
export const REFRESH_RATE = 0.02;

/** 生まれた年の範囲（15〜100歳。式は大人向け） */
export function birthYearRange(thisYear: number) {
  return { min: thisYear - 100, max: thisYear - 15 };
}

/** 生まれた年の入力。空なら value は null（消す） */
export function parseBirthYear(text: string, thisYear: number): { value: number | null } | { error: string } {
  if (text.trim() === '') return { value: null };
  const { min, max } = birthYearRange(thisYear);
  const n = parseNumber(text);
  if (n == null || !Number.isInteger(n) || n < min || n > max) return { error: `生まれた年は ${min}〜${max} の数字で入れてください` };
  return { value: n };
}

export type BodyDay = { date: DateKey; weightKg: number | null; bodyFatPct: number | null };

/** 計算に使った体重・体脂肪率（平均）と、その日の範囲 */
export type BodyBasis = {
  weightKg: number; weightFrom: DateKey; weightTo: DateKey; weightDays: number;
  bodyFat: { pct: number; from: DateKey; to: DateKey; days: number } | null;
};

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * 計算に使う体重と体脂肪率。今日までで、いちばん新しい体重の日から AVERAGE_DAYS 日の平均。
 * 体脂肪率も同じ日の範囲の記録だけを使う（範囲になければ null。古い体脂肪率は使わない）
 */
export function bodyBasis(days: BodyDay[], today: DateKey): BodyBasis | null {
  const past = days.filter((d) => d.date <= today).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const weights = past.filter((d) => d.weightKg != null);
  if (weights.length === 0) return null;
  const to = weights[weights.length - 1].date;
  const start = addDays(to, -(AVERAGE_DAYS - 1));
  const inWindow = past.filter((d) => d.date >= start && d.date <= to);
  const w = inWindow.filter((d) => d.weightKg != null);
  const f = inWindow.filter((d) => d.bodyFatPct != null);
  return {
    weightKg: mean(w.map((d) => d.weightKg!)), weightFrom: w[0].date, weightTo: to, weightDays: w.length,
    bodyFat: f.length ? { pct: mean(f.map((d) => d.bodyFatPct!)), from: f[0].date, to: f[f.length - 1].date, days: f.length } : null,
  };
}

export type GoalInput = {
  weightKg: number; bodyFatPct: number | null; activity: Activity; targetWeightKg: number | null;
  /** 体脂肪率がないとき（Mifflin-St Jeor）だけ使う */
  heightCm: number | null; age: number | null; sex: Sex | null;
};

export type GoalCalc = {
  bmr: number; bmrMethod: 'katch-mcardle' | 'mifflin-st-jeor';
  tdeeRest: number; tdeeTraining: number;
  policy: Policy;
  /** 1週間に変える体重（kg。減量は負） */
  weeklyKg: number;
  /** 1日あたりの差（kcal。減量は負）。下限で削った前の値 */
  dailyDelta: number;
  /** 下限（BMR）で目標を引き上げた日があるか */
  floored: boolean;
  /** 計算に使った体重（0.1kg に丸めた値。たんぱく質の目標はこれ × PROTEIN_PER_KG） */
  bodyWeightKg: number;
  proteinG: number;
  training: DailyTarget; rest: DailyTarget;
};

const round10 = (n: number) => Math.round(n / 10) * 10;
const ceil10 = (n: number) => Math.ceil(n / 10) * 10;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** 基礎代謝（kcal／日）。体脂肪率がなく、身長・年齢・性別のどれかもなければ null */
export function basalMetabolism(i: Pick<GoalInput, 'weightKg' | 'bodyFatPct' | 'heightCm' | 'age' | 'sex'>) {
  if (i.bodyFatPct != null) {
    return { bmr: 370 + 21.6 * i.weightKg * (1 - i.bodyFatPct / 100), method: 'katch-mcardle' as const };
  }
  if (i.heightCm == null || i.age == null || i.sex == null) return null;
  return { bmr: 10 * i.weightKg + 6.25 * i.heightCm - 5 * i.age + (i.sex === 'male' ? 5 : -161), method: 'mifflin-st-jeor' as const };
}

/** 方針と、1週間に変える体重（kg） */
export function policyFor(weightKg: number, targetWeightKg: number | null): { policy: Policy; weeklyKg: number } {
  if (targetWeightKg == null || Math.abs(targetWeightKg - weightKg) <= weightKg * MAINTAIN_BAND + 1e-9) return { policy: 'maintain', weeklyKg: 0 };
  return targetWeightKg < weightKg ? { policy: 'cut', weeklyKg: -weightKg * CUT_RATE } : { policy: 'bulk', weeklyKg: weightKg * BULK_RATE };
}

/** 足りない入力があれば null（先に missingInputs で確かめる） */
export function calcGoal(i: GoalInput): GoalCalc | null {
  const bodyWeightKg = round1(i.weightKg);
  const b = basalMetabolism({ ...i, weightKg: bodyWeightKg });
  if (!b) return null;
  const { bmr, method } = b;
  const tdeeRest = bmr * ACTIVITY_FACTORS[i.activity];
  const tdeeTraining = tdeeRest + TRAINING_KCAL;
  const { policy, weeklyKg } = policyFor(bodyWeightKg, i.targetWeightKg);
  const dailyDelta = (weeklyKg * KCAL_PER_KG) / 7;
  const proteinG = Math.round(bodyWeightKg * PROTEIN_PER_KG);
  let floored = false;
  const target = (tdee: number): DailyTarget => {
    const raw = tdee + dailyDelta;
    if (raw < bmr) floored = true;
    const kcal = Math.max(round10(raw), ceil10(bmr));
    const fat_g = Math.round((kcal * FAT_RATIO) / 9);
    const carbs_g = Math.round(Math.max(kcal - proteinG * 4 - fat_g * 9, 0) / 4);
    return { kcal, fat_g, carbs_g };
  };
  const training = target(tdeeTraining);
  const rest = target(tdeeRest);
  return { bmr, bmrMethod: method, tdeeRest, tdeeTraining, policy, weeklyKg, dailyDelta, floored, bodyWeightKg, proteinG, training, rest };
}

/** 計算に足りない入力（画面で先に入れてもらう） */
export type Missing = 'weight' | 'height' | 'sex' | 'birthYear' | 'activity';

/**
 * 足りない入力。体重と活動の量はいつも要る。身長・性別・生まれた年は、体脂肪率がないとき（Mifflin-St Jeor）だけ要る。
 * 体重がないときは、ほかの項目を聞いても計算できないので、体重だけを返す
 */
export function missingInputs(p: {
  basis: BodyBasis | null; heightCm: number | null; sex: Sex | null; birthYear: number | null; activity: Activity | null;
}): Missing[] {
  if (!p.basis) return ['weight'];
  const out: Missing[] = [];
  if (!p.basis.bodyFat) {
    if (!p.sex) out.push('sex');
    if (p.birthYear == null) out.push('birthYear');
    if (p.heightCm == null) out.push('height');
  }
  if (!p.activity) out.push('activity');
  return out;
}

/** 前回の自動計算の体重から、REFRESH_RATE 以上変わったか */
export function weightChanged(previousKg: number | null, currentKg: number | null): boolean {
  if (previousKg == null || currentKg == null || previousKg <= 0) return false;
  return Math.abs(currentKg - previousKg) / previousKg >= REFRESH_RATE - 1e-9;
}
