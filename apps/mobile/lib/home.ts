// ホームの画面に出す言葉と、カードを出すかどうかの決まり（app/(tabs)/index.tsx と components/home.tsx が使う）
import { goalProgress } from './body';
import { addDays, addMonths, DateKey, weekStart } from './date';
import type { Big3Role } from './exercises';
import type { GoalProgress } from './goals';
import { weekOf } from './goals';
import { formatMinutes } from './health';
import { SLOT_LABELS, Slot, slotAt } from './meals';
import type { Report } from './reports';
import { big3Trend, TrainingSetRow, volumeBetween } from './training';
import { fmt1, kgToUnit, WeightUnit } from './units';

/** 今日の体調のカードの2行目。目標体重とその日の体重があるときだけ（からだの画面と同じ lib/body.ts の goalProgress） */
export function goalLine(weightKg: number | null, goalKg: number | null, unit: WeightUnit): string | null {
  if (weightKg == null || goalKg == null) return null;
  const p = goalProgress(weightKg, goalKg, null);
  return p.direction === 'reached' ? '目標に届きました' : `目標まで あと ${fmt1(kgToUnit(p.remaining, unit))} ${unit}`;
}

/** 寝不足とみなす睡眠（分）。これ未満の日に、今日のトレーニングのカードにひとこと出す */
export const SHORT_SLEEP_MIN = 6 * 60;

/** 寝不足の日のひとこと。前の夜の睡眠が6時間未満のときだけ */
export function sleepNote(asleepMin: number | null | undefined): string | null {
  if (asleepMin == null || asleepMin >= SHORT_SLEEP_MIN) return null;
  return `睡眠 ${formatMinutes(asleepMin)}。今日は軽めでも大丈夫`;
}

/** 今週の目標の棒の割合（0〜1）。目標に届いたら満たす。目標がなければ 0 */
export function goalRatio(p: GoalProgress): number {
  if (p.goal == null || p.goal <= 0) return 0;
  return p.reached ? 1 : Math.min(1, p.days / p.goal);
}

/** 今週の目標の行の読み上げ（「筋トレ 2回、目標 3回」「食事の記録 6日、目標 5日、達成」） */
export function goalA11yLabel(name: string, unit: string, p: GoalProgress): string {
  return [`${name} ${p.days}${unit}`, p.goal != null ? `目標 ${p.goal}${unit}` : null, p.reached ? '達成' : null].filter(Boolean).join('、');
}

/**
 * 今週やること：最新の週のまとめ（kind が weekly で、期間の終わりが先週の月曜〜今週の日曜のもの）の次の一歩。
 * reports は新しい順（db の reports.list）。いちばん新しい週のまとめに次の一歩がなければ null（カードを出さない）
 */
export function weeklyTodo(reports: Pick<Report, 'id' | 'kind' | 'periodStart' | 'periodEnd' | 'nextSteps'>[], today: DateKey): { reportId: string; steps: string[] } | null {
  const { start, end } = weekOf(today);
  const from = addDays(start, -7);
  const latest = reports.find((r) => {
    const last = r.periodEnd ?? r.periodStart;
    return r.kind === 'weekly' && last != null && last >= from && last <= end;
  });
  return latest && latest.nextSteps.length > 0 ? { reportId: latest.id, steps: latest.nextSteps } : null;
}

/** 今週やることのチェック（端末だけに置く）。レポートの id と、済んだ項目の番号 */
export type TodoChecks = { reportId: string; done: number[] };

/** 置いた値（JSON）から、そのレポートの済んだ番号を読む。違うレポートの値や壊れた値なら空 */
export function readTodoChecks(raw: string | null, reportId: string): number[] {
  try {
    const v = raw ? (JSON.parse(raw) as Partial<TodoChecks>) : null;
    if (v?.reportId !== reportId || !Array.isArray(v.done)) return [];
    return v.done.filter((n): n is number => Number.isInteger(n) && n >= 0);
  } catch {
    return [];
  }
}

/** i 番目を済んだ／まだに切り替えた値（番号は小さい順） */
export function toggleTodo(done: number[], i: number): number[] {
  return done.includes(i) ? done.filter((n) => n !== i) : [...done, i].sort((a, b) => a - b);
}

/**
 * 「記録する」のシートの食事の行。今日なら時刻から区分を決め（食事のタブの「食事を追加」と同じ slotAt）、その区分で品目の入力を開く。
 * 過去の日は時刻が当てにならないので、区分を選ぶ所（その日の食事のタブ）へ
 */
export function mealRecordTarget(date: DateKey, today: DateKey, hour: number): { slot: Slot; text: string } | { slot: null; text: string } {
  if (date !== today) return { slot: null, text: '区分を選んで記録します' };
  const slot = slotAt(hour);
  return { slot, text: `${SLOT_LABELS[slot]}として記録します（時刻から）` };
}

/** 合計負荷量／今週：月曜始まりの週の、月曜から今日までの負荷量（kg） */
export function thisWeekVolume(rows: TrainingSetRow[], today: DateKey): number {
  return volumeBetween(rows, weekStart(today), today);
}

/** ホームの BIG3 のカードの折れ線の期間（筋トレの推移の「BIG3 の推定1RM（合計）」と同じ3か月） */
export const HOME_BIG3_MONTHS = 3;

/**
 * ホームの「BIG3 推定1RM 合計」。筋トレの推移のグラフと同じ big3Trend で、今の合計・先月との差・3か月の折れ線の点を出す。
 * 3種目がそろわない（割り当てがない・記録がない）あいだは null
 */
export function homeBig3(rows: TrainingSetRow[], assignments: Partial<Record<Big3Role, string>>, today: DateKey) {
  const from = addMonths(today, -HOME_BIG3_MONTHS);
  const trend = big3Trend(rows, assignments, today, from);
  if (trend.total == null) return null;
  return {
    totalKg: trend.total,
    diffKg: trend.totalMonthAgo == null ? null : trend.total - trend.totalMonthAgo,
    points: trend.points,
    from,
  };
}

/** 先月との差の向きと文字（「+7.5」「−2.5」「±0」）。0.05 未満の差は ±0 とする（筋トレの推移のカードと同じ） */
export function signedChange(v: number): { dir: 'up' | 'down' | 'flat'; text: string } {
  if (Math.abs(v) < 0.05) return { dir: 'flat', text: '±0' };
  return v > 0 ? { dir: 'up', text: `+${fmt1(v)}` } : { dir: 'down', text: `−${fmt1(-v)}` };
}
