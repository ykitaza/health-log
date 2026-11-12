// ホームの画面に出す言葉と、カードを出すかどうかの決まり（app/(tabs)/index.tsx と components/home.tsx が使う）
import { goalProgress } from './body';
import { addDays, addMonths, DateKey, daysBetween, formatMonthDay, weekStart } from './date';
import type { Big3Role } from './exercises';
import { weekOf } from './goals';
import { GrowthDay, GrowthParams, growthScore, GrowthScore, growthSeries, NO_PART_SETS, satellites, SatState, SCORE_MAX } from './growth';
import { formatMinutes } from './health';
import { SLOT_LABELS, Slot, slotAt } from './meals';
import type { Report } from './reports';
import { big3PartialNote, big3Trend, TrainingSetRow, volumeBetween } from './training';
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
 * レポートのタブの「やること」：週のまとめの次の一歩を、やることの週（まとめの期間の次の週）の新しい順に。
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

/** ホームの BIG3 のカードの折れ線の、いちばん広い期間（上限の3か月。筋トレの推移の「BIG3 の推定1RM（合計）」と同じ） */
export const HOME_BIG3_MONTHS = 3;

/** 折れ線の始まりの日（from）、差の基準の日（base）、差の言葉（「先週より」「先週の記録なし」） */
export type Big3Range = { from: DateKey; base: DateKey; diffText: string; noDiffText: string };

/**
 * ホームのカードの折れ線の幅と、差の基準。BIG3 の最初の記録の日（first）から今日までの長さで、段階で広げる。
 * - 7日以内：7日。最初の記録の日との差（「始めた日より」）
 * - 8〜14日：14日。7日前との差（「先週より」）
 * - 15日〜1か月：1か月。7日前との差（「先週より」）
 * - 1か月を超える：3か月（上限）。1か月前との差（「先月より」）
 */
export function big3Range(first: DateKey, today: DateKey): Big3Range {
  const days = daysBetween(first, today);
  const monthAgo = addMonths(today, -1);
  const make = (from: DateKey, base: DateKey, word: string): Big3Range => ({ from, base, diffText: `${word}より`, noDiffText: `${word}の記録なし` });
  if (days <= 7) return make(addDays(today, -7), first, '始めた日');
  if (days <= 14) return make(addDays(today, -14), addDays(today, -7), '先週');
  if (first >= monthAgo) return make(monthAgo, addDays(today, -7), '先週');
  return make(addMonths(today, -HOME_BIG3_MONTHS), monthAgo, '先月');
}

/**
 * ホームの「BIG3 推定1RM 合計」。筋トレの推移のグラフと同じ big3Trend で、今の合計・基準の日との差・折れ線の点を出す。
 * 折れ線の幅と差の基準は big3Range。記録がある種目だけの合計で、3種目そろっていなければ添え書き（note）も返す。
 * 1種目も記録がない（割り当てがない・記録がない）あいだは null
 */
export function homeBig3(rows: TrainingSetRow[], assignments: Partial<Record<Big3Role, string>>, today: DateKey) {
  const widest = addMonths(today, -HOME_BIG3_MONTHS);
  const wide = big3Trend(rows, assignments, today, widest);
  if (wide.total == null) return null;
  // 最初の記録の日。点は記録の日と from から並ぶので、先頭が from なら記録は from 以前（1か月を超える昔）で、段階は同じになる
  const range = big3Range(wide.points[0].date, today);
  const trend = range.from === widest ? wide : big3Trend(rows, assignments, today, range.from);
  const base = trend.points.filter((p) => p.date <= range.base).pop();
  return {
    totalKg: wide.total,
    diffKg: base ? wide.total - base.total : null,
    points: trend.points,
    from: range.from,
    diffText: range.diffText,
    noDiffText: range.noDiffText,
    note: big3PartialNote(wide),
  };
}

/** 成長スコアの内訳のシートのひとこと */
export const GROWTH_SCORE_NOTE = '直近7日の記録から計算します。記録がない日は数えません';

/** 記録がまだないときの形の値（種だけが出る） */
const NO_GROWTH: GrowthParams = { volumeKg: 0, foodDays: 0, sleepDays: 0, days: 0, partSets: [...NO_PART_SETS] };

/**
 * ホームの形の段に出すもの：形の値（今日までの累計）、今日の衛星（部品の名前に合わせて meal を food に写す）、成長スコア。
 * 今日までに記録が1つもなければ、形の値は全部 0、スコアは null（点が出せない。画面では「—」）
 */
export function homeGrowth(days: GrowthDay[], today: DateKey, weeklyTrainingGoal: number | null): {
  params: GrowthParams; sats: { training: SatState; food: SatState; sleep: SatState }; score: GrowthScore | null;
} {
  const series = growthSeries(days, today);
  const sat = satellites(days.find((d) => d.date === today));
  return {
    params: series[series.length - 1] ?? NO_GROWTH,
    sats: { training: sat.training, food: sat.meal, sleep: sat.sleep },
    score: series.length === 0 ? null : growthScore(days, today, weeklyTrainingGoal),
  };
}

/** 内訳の合計（「78 / 100」）。点が出せないときは「—」 */
export function scoreTotalText(score: GrowthScore | null): string {
  return score ? `${score.total} / 100` : '—';
}

/** 先週との差（「↑ +4」「↓ −3」「±0」）。向きは矢印と符号でも伝える（色だけにしない）。差が出せないときは null（出さない） */
export function scoreDiff(diff: number | null): { dir: 'up' | 'down' | 'flat'; text: string } | null {
  if (diff == null) return null;
  if (diff === 0) return { dir: 'flat', text: '±0' };
  return diff > 0 ? { dir: 'up', text: `↑ +${diff}` } : { dir: 'down', text: `↓ −${-diff}` };
}

/** 先週との差の読み上げ（「先週より 4点高い」「先週より 3点低い」「先週と同じ」）。差が出せないときは null */
export function scoreDiffSpoken(diff: number | null): string | null {
  if (diff == null) return null;
  if (diff === 0) return '先週と同じ';
  return diff > 0 ? `先週より ${diff}点高い` : `先週より ${-diff}点低い`;
}

/** 成長スコアの読み上げ（「成長スコア 78点、直近7日。先週より 4点高い。押すと内訳」） */
export function scoreA11yLabel(score: GrowthScore | null): string {
  if (!score) return '成長スコア まだ記録がありません。押すと内訳';
  return [`成長スコア ${score.total}点、直近7日`, scoreDiffSpoken(score.diffFromLastWeek), '押すと内訳'].filter(Boolean).join('。');
}

const PILLAR_NAMES = { training: '筋トレ', meal: '食事', sleep: '睡眠' } as const;

/**
 * 内訳の柱の行（筋トレ・食事・睡眠の順）。text は「32 / 40」（点は四捨五入）、その柱の記録が7日に1日もなければ「—」。
 * 点が出せない（score が null）ときは、どの柱も「—」
 */
export function scorePillars(score: GrowthScore | null): { key: keyof typeof PILLAR_NAMES; name: string; text: string; label: string }[] {
  return (['training', 'meal', 'sleep'] as const).map((key) => {
    const name = PILLAR_NAMES[key];
    const max = SCORE_MAX[key];
    const points = score?.[key].points ?? null;
    if (points == null) return { key, name, text: '—', label: `${name} 記録なし` };
    const n = Math.round(points);
    return { key, name, text: `${n} / ${max}`, label: `${name} ${n}点、${max}点満点` };
  });
}

/** 先月との差の向きと文字（「+7.5」「−2.5」「±0」）。0.05 未満の差は ±0 とする（筋トレの推移のカードと同じ） */
export function signedChange(v: number): { dir: 'up' | 'down' | 'flat'; text: string } {
  if (Math.abs(v) < 0.05) return { dir: 'flat', text: '±0' };
  return v > 0 ? { dir: 'up', text: `+${fmt1(v)}` } : { dir: 'down', text: `−${fmt1(-v)}` };
}
