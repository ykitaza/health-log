// 月のまとめの目標バー（現在→目標）の純粋な計算。DB は読まない（読むのは components/report/MonthlyReportBlocks.tsx）。
// 体重の基準は BodyChangeBlock と同じ：期間の体重の7日移動平均の最後の点（lib/reports.ts の bodyChange の last.value）を
// 「現在の体重」、最初の点（first.value）を「期間の初めの体重」として呼ぶ側が渡す。
// 節目は設定項目を持たず、10kg 刻みで自動生成する（report-redesign-scope の決定待ち3への実装側の答え。Issue #192）

/** 節目の刻み（kg） */
export const MILESTONE_STEP_KG = 10;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** 体重は小数1桁で扱う（表示の fmt1 と同じ丸め。浮動小数の 0.2000000004 のような誤差を残さない） */
const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * 次の節目（kg）：今の体重より目標の向きにあって、目標には届いていない、10kg 刻みの境界。
 * 増量（目標 > 現在）なら現在より大きく目標より小さい最小の10の倍数、減量なら現在より小さく目標より大きい最大の10の倍数。
 * そういう境界がなければ節目は目標そのもの。現在が目標に届いている（差 0.05kg 未満、bodyChange の reached と同じ）ときも目標そのもの
 */
export function nextMilestoneKg(currentKg: number, goalKg: number, stepKg: number = MILESTONE_STEP_KG): number {
  if (!(stepKg > 0) || Math.abs(goalKg - currentKg) < 0.05) return goalKg;
  if (goalKg > currentKg) {
    const m = (Math.floor(currentKg / stepKg) + 1) * stepKg;
    return m < goalKg ? round1(m) : goalKg;
  }
  const m = (Math.ceil(currentKg / stepKg) - 1) * stepKg;
  return m > goalKg ? round1(m) : goalKg;
}

export type GoalProgress = {
  /** 進み具合 0〜1。startKg があれば（現在−初め）／（目標−初め）、なければ現在／目標（増量の素の割合）。どちらも 0〜1 に丸める。
   * startKg が目標とほぼ同じなら、届いていれば 1、届いていなければ 0 */
  ratio: number;
  /** 目標までの残り（kg、0以上。小数1桁）。届いていれば 0 */
  remainingKg: number;
  /** 次の節目（kg）。nextMilestoneKg と同じ */
  milestoneKg: number;
  /** 節目までの残り（kg、0以上。小数1桁） */
  toMilestoneKg: number;
  /** 節目の、バーの左端（startKg、なければ 0）から右端（目標）までの位置 0〜1。マーカーの位置に使う */
  milestoneRatio: number;
  /** 目標に届いているか（差 0.05kg 未満。bodyChange の reached と同じ決まり） */
  reached: boolean;
};

/**
 * 目標バーの値。currentKg は bodyChange の last.value（7日移動平均）、startKg は同 first.value を渡す想定。
 * startKg が目標とほぼ同じ（差 0.05kg 未満）で割合が出せないときは、届いていれば 1、届いていなければ 0。
 * startKg がなければ現在／目標（増量の素の割合）
 */
export function goalProgress(input: { currentKg: number; goalKg: number; startKg?: number | null; stepKg?: number }): GoalProgress {
  const { currentKg, goalKg } = input;
  const stepKg = input.stepKg ?? MILESTONE_STEP_KG;
  const reached = Math.abs(goalKg - currentKg) < 0.05;
  const remainingKg = reached ? 0 : round1(Math.abs(goalKg - currentKg));
  const milestoneKg = nextMilestoneKg(currentKg, goalKg, stepKg);
  const toMilestoneKg = reached ? 0 : round1(Math.abs(milestoneKg - currentKg));
  const startKg = input.startKg ?? null;
  let ratio: number;
  let milestoneRatio: number;
  if (startKg != null && Math.abs(goalKg - startKg) >= 0.05) {
    ratio = clamp01((currentKg - startKg) / (goalKg - startKg));
    milestoneRatio = clamp01((milestoneKg - startKg) / (goalKg - startKg));
  } else if (startKg != null) {
    // 期間の初めがほぼ目標（初め→目標の幅がない）：割合は出せないので、届いていれば 1（下で決める）、届いていなければ 0。
    // 現在÷目標にすると、減量中で目標を上回っていても満杯近くになるため。節目は、今（バーの左端）から目標までの位置
    ratio = 0;
    milestoneRatio = clamp01((milestoneKg - currentKg) / (goalKg - currentKg));
  } else {
    ratio = goalKg !== 0 ? clamp01(currentKg / goalKg) : 0;
    milestoneRatio = goalKg !== 0 ? clamp01(milestoneKg / goalKg) : 0;
  }
  if (reached) { ratio = 1; milestoneRatio = 1; }
  return { ratio, remainingKg, milestoneKg, toMilestoneKg, milestoneRatio, reached };
}
