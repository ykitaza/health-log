// ホームの画面に出す言葉と、カードを出すかどうかの決まり（app/(tabs)/index.tsx と components/home.tsx が使う）
import { goalProgress } from './body';
import { addDays, DateKey, formatMonthDay, weekStart } from './date';
import { weekOf } from './goals';
import { SLOT_LABELS, Slot, slotAt } from './meals';
import type { Report } from './reports';
import { TrainingSetRow, volumeBetween } from './training';
import { fmt1, kgToUnit, WeightUnit } from './units';

/** 今日の体調のカードの2行目。目標体重とその日の体重があるときだけ（からだの画面と同じ lib/body.ts の goalProgress） */
export function goalLine(weightKg: number | null, goalKg: number | null, unit: WeightUnit): string | null {
  if (weightKg == null || goalKg == null) return null;
  const p = goalProgress(weightKg, goalKg, null);
  return p.direction === 'reached' ? '目標に届きました' : `目標まで あと ${fmt1(kgToUnit(p.remaining, unit))} ${unit}`;
}

/** 設定の「今週の目標」の欄を開く道（settings?section=weekly-goals） */
export const WEEKLY_GOALS_SECTION = 'weekly-goals';

/**
 * 今週やること：最新の週のまとめ（kind が weekly で、期間の終わりが先週の月曜〜今週の日曜のもの）の次の一歩。
 * reports は新しい順（db の reports.list）。いちばん新しい週のまとめに次の一歩がなければ null（カードを出さない）。
 * done は済んだ番号（レポートの next_steps_done。同期でサーバーにも届き、次の週のまとめで Claude・ChatGPT が振り返る）
 */
export function weeklyTodo(
  reports: Pick<Report, 'id' | 'kind' | 'periodStart' | 'periodEnd' | 'nextSteps' | 'nextStepsDone'>[], today: DateKey,
): { reportId: string; steps: string[]; done: number[] } | null {
  const { start, end } = weekOf(today);
  const from = addDays(start, -7);
  const latest = reports.find((r) => {
    const last = r.periodEnd ?? r.periodStart;
    return r.kind === 'weekly' && last != null && last >= from && last <= end;
  });
  return latest && latest.nextSteps.length > 0 ? { reportId: latest.id, steps: latest.nextSteps, done: latest.nextStepsDone } : null;
}

/** 済んだ数（次の一歩にある番号だけ数える） */
export function todoCount(steps: readonly string[], done: readonly number[]): number {
  return steps.filter((_, i) => done.includes(i)).length;
}

/** 全部できたか（次の一歩があって、どれも済んだ） */
export function todoAllDone(steps: readonly string[], done: readonly number[]): boolean {
  return steps.length > 0 && todoCount(steps, done) === steps.length;
}

/** 週（月曜〜日曜）の見出し。「11月9日〜15日」、月をまたぐときは「11月30日〜12月6日」 */
export function weekRangeLabel(start: DateKey): string {
  const end = addDays(start, 6);
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  return `${formatMonthDay(start)}〜${sameMonth ? `${Number(end.slice(8))}日` : formatMonthDay(end)}`;
}

type TodoSource = Pick<Report, 'id' | 'kind' | 'periodStart' | 'periodEnd' | 'nextSteps' | 'nextStepsDone'>;

/** 週のまとめの次の一歩を、やることの週（まとめの期間の次の週。月曜の日付）でまとめたもの */
export type TodoWeek = { reportId: string; start: DateKey; steps: string[]; done: number[] };

/** まとめの期間の週の月曜（期間の終わり、なければ始まりの週）。期間がなければ null */
function reportWeek(r: Pick<Report, 'periodStart' | 'periodEnd'>): DateKey | null {
  const last = r.periodEnd ?? r.periodStart;
  return last ? weekStart(last) : null;
}

/**
 * 週ごとのやること（previousTodo の材料）：週のまとめの次の一歩を、やることの週（まとめの期間の次の週）の新しい順に。
 * reports は新しい順（db の reports.list）。同じ週のまとめが2つあれば新しいほうだけ（ホームの今週やることと同じく、それに次の一歩がなければ出さない）。
 * 期間のないまとめと、次の一歩がない週は出さない
 */
export function todoWeeks(reports: TodoSource[]): TodoWeek[] {
  const seen = new Set<DateKey>();
  const weeks: TodoWeek[] = [];
  for (const r of reports) {
    const week = r.kind === 'weekly' ? reportWeek(r) : null;
    if (week == null || seen.has(week)) continue;
    seen.add(week);
    if (r.nextSteps.length > 0) weeks.push({ reportId: r.id, start: addDays(week, 7), steps: r.nextSteps, done: r.nextStepsDone });
  }
  return weeks.sort((a, b) => (a.start < b.start ? 1 : a.start > b.start ? -1 : 0));
}

/** 週のまとめの中身の「先週やることの振り返り」：そのまとめの週にやることだった一覧（前の週のまとめの次の一歩）。なければ null */
export function previousTodo(reports: TodoSource[], report: Pick<Report, 'kind' | 'periodStart' | 'periodEnd'>): TodoWeek | null {
  const week = report.kind === 'weekly' ? reportWeek(report) : null;
  if (week == null) return null;
  return todoWeeks(reports).find((w) => w.start === week) ?? null;
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
