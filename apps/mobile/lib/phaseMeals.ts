// フェーズの食事の目標（筋トレの日・休みの日の kcal とたんぱく質）を、計画から自動で計算する。
// 式は食事の目標の「自動で計算」（lib/autoGoal.ts。サーバーの suggest_goals と同じ）と同じで、1日あたりの差だけを計画から出す：
// - 維持のカロリー：基礎代謝 × 活動の量の係数（体重・体脂肪率は今日までの7日平均）。筋トレの日は +280kcal。下限は基礎代謝
// - 1日あたりの差：(目標体重 − 線の始まりの体重) × 7,200kcal ÷ 線の日数。増量で差が負・減量で差が正になる（目標が向きと逆の）ときは 0
//   線の始まりの体重か日数がなければ、suggest_goals の決まった速さ（増量は週に体重の 0.25%、減量は 0.5%）
// - 維持と療養は差 0（維持のカロリー。療養で減らさない）
// - たんぱく質は体重 × 2.0g（筋トレの日も休みの日も同じ）
import type { Repositories } from '@/db';
import {
  ACTIVITY_FACTORS, Activity, basalMetabolism, BodyBasis, bodyBasis, BULK_RATE, CUT_RATE, dayTargets, KCAL_PER_KG, Maintenance, Missing,
  missingInputs, Sex,
} from './autoGoal';
import type { DateKey } from './date';
import type { PhaseDirection, PhaseKind, PhaseMealTargets } from './phases';

/** 計画のうち、食事の目標に使うもの。fromKg は線の始まりの体重、days は線の日数（始まりの日から終わりの日まで） */
export type PhaseMealPlan = {
  kind: PhaseKind;
  direction: PhaseDirection | null;
  fromKg: number | null;
  targetKg: number | null;
  days: number | null;
};

/** 1日あたりの差（kcal。減らすときは負） */
export function phaseDailyDelta(m: Maintenance, p: PhaseMealPlan): number {
  if (p.kind === 'rehab' || p.direction == null || p.direction === 'maintain') return 0;
  const raw = p.fromKg != null && p.targetKg != null && p.days != null && p.days > 0
    ? ((p.targetKg - p.fromKg) * KCAL_PER_KG) / p.days
    : ((p.direction === 'bulk' ? BULK_RATE : -CUT_RATE) * (p.fromKg ?? m.bodyWeightKg) * KCAL_PER_KG) / 7;
  return p.direction === 'bulk' ? Math.max(0, raw) : Math.min(0, raw);
}

/** 計画から出した食事の目標 */
export function phaseMealTargets(m: Maintenance, p: PhaseMealPlan): PhaseMealTargets {
  const { proteinG, training, rest } = dayTargets(m, phaseDailyDelta(m, p));
  return { training_day: { kcal: training.kcal, protein_g: proteinG }, rest_day: { kcal: rest.kcal, protein_g: proteinG } };
}

/** 療養の食事の目標：維持のカロリー（減らさない）。維持のカロリーが出せなければ null */
export function rehabMealTargets(m: Maintenance | null): PhaseMealTargets | null {
  return m ? phaseMealTargets(m, { kind: 'rehab', direction: null, fromKg: null, targetKg: null, days: null }) : null;
}

/** 維持のカロリー。足りない入力があれば null（missingInputs で先に確かめる） */
export function maintenanceOf(i: {
  basis: BodyBasis | null; activity: Activity | null; heightCm: number | null; sex: Sex | null; birthYear: number | null; today: DateKey;
}): Maintenance | null {
  if (!i.basis || !i.activity) return null;
  const bodyWeightKg = Math.round(i.basis.weightKg * 10) / 10;
  const age = i.birthYear == null ? null : Number(i.today.slice(0, 4)) - i.birthYear;
  const b = basalMetabolism({ weightKg: bodyWeightKg, bodyFatPct: i.basis.bodyFat?.pct ?? null, heightCm: i.heightCm, age, sex: i.sex });
  return b ? { bmr: b.bmr, tdeeRest: b.bmr * ACTIVITY_FACTORS[i.activity], bodyWeightKg } : null;
}

/** 体のデータと設定から、維持のカロリーと足りない入力を読む（食事の目標の画面の「自動で計算」と同じもの） */
export async function loadMaintenance(repos: Repositories, today: DateKey): Promise<{ maintenance: Maintenance | null; missing: Missing[] }> {
  const [settings, profile, daily] = await Promise.all([repos.settings.get(), repos.settings.profile(), repos.body.listDaily()]);
  const basis = bodyBasis(daily, today);
  const input = { basis, activity: settings.activity, heightCm: settings.heightCm, ...profile };
  return { maintenance: maintenanceOf({ ...input, today }), missing: missingInputs(input) };
}

const MISSING_LABELS: Record<Missing, string> = { weight: '体重の記録', height: '身長', sex: '性別', birthYear: '生まれた年', activity: '活動の量' };

/** 計算できないときの説明（画面に出す） */
export function missingNote(missing: Missing[]): string {
  if (missing.includes('weight')) return '体重の記録がないので、食事の目標は自動で計算できません。';
  return `自動で計算するには、アカウントの画面の${missing.map((m) => MISSING_LABELS[m]).join('・')}が要ります。`;
}
