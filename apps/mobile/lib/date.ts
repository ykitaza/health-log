// 日付は端末の暦の日付を 'YYYY-MM-DD' の文字列で扱う。
// 日数の計算は UTC で行い、夏時間などのずれを避ける。

export type DateKey = string;

const pad = (n: number) => String(n).padStart(2, '0');

export function toDateKey(d: Date): DateKey {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayKey(now: Date = new Date()): DateKey {
  return toDateKey(now);
}

/** 端末の暦で、次の日の0時までのミリ秒 */
export function msUntilNextDay(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime();
}

function parts(key: DateKey): [number, number, number] {
  const [y, m, d] = key.split('-').map(Number);
  return [y, m, d];
}

function toUtc(key: DateKey): number {
  const [y, m, d] = parts(key);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms: number): DateKey {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

const DAY = 24 * 60 * 60 * 1000;

export function addDays(key: DateKey, n: number): DateKey {
  return fromUtc(toUtc(key) + n * DAY);
}

/** b − a の日数 */
export function daysBetween(a: DateKey, b: DateKey): number {
  return Math.round((toUtc(b) - toUtc(a)) / DAY);
}

/** 0 = 日曜 */
export function weekday(key: DateKey): number {
  return new Date(toUtc(key)).getUTCDay();
}

/** その週の日曜 */
export function weekStart(key: DateKey): DateKey {
  return addDays(key, -weekday(key));
}

export function addMonths(key: DateKey, n: number): DateKey {
  const [y, m, d] = parts(key);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${pad(nm + 1)}-${pad(Math.min(d, last))}`;
}

export function yearMonth(key: DateKey): { year: number; month: number } {
  const [y, m] = parts(key);
  return { year: y, month: m };
}

export const MONTH_NAMES_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
export const WEEKDAY_EN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'];

/** 11月8日（日） */
export function formatJpDate(key: DateKey): string {
  const [, m, d] = parts(key);
  return `${m}月${d}日（${WEEKDAY_JA[weekday(key)]}）`;
}

/** カレンダーの日のマスの読み上げの名前（「11月5日（木） 今日 記録あり」）。「2026-11-05」と数字を読ませない */
export function dayLabel(key: DateKey, { today, marked }: { today?: boolean; marked?: boolean }): string {
  return [formatJpDate(key), today ? '今日' : '', marked ? '記録あり' : ''].filter(Boolean).join(' ');
}

/** 11月8日 */
export function formatMonthDay(key: DateKey): string {
  const [, m, d] = parts(key);
  return `${m}月${d}日`;
}

/** 11/8 */
export function formatShortDate(key: DateKey): string {
  const [, m, d] = parts(key);
  return `${m}/${d}`;
}

/**
 * 月のカレンダー（日曜始まり、6週×7日）。前後の月の日も入れ、inMonth で見分ける。
 * month は 1〜12。
 */
export function monthMatrix(year: number, month: number): { key: DateKey; day: number; inMonth: boolean }[][] {
  const first = `${year}-${pad(month)}-01`;
  const start = weekStart(first);
  const rows: { key: DateKey; day: number; inMonth: boolean }[][] = [];
  for (let w = 0; w < 6; w++) {
    const row = [];
    for (let i = 0; i < 7; i++) {
      const key = addDays(start, w * 7 + i);
      const [y, m, d] = parts(key);
      row.push({ key, day: d, inMonth: y === year && m === month });
    }
    rows.push(row);
  }
  return rows;
}

/** 「2日前」「今日」 */
export function relativeDays(from: DateKey, today: DateKey): string {
  const n = daysBetween(from, today);
  if (n <= 0) return '今日';
  if (n === 1) return '昨日';
  return `${n}日前`;
}

/**
 * 種目の選択に出す「前回」の日。今日に記録するなら「2日前」のように今日から数える。
 * 過去の日に記録するなら、その日と同じ日は「この日」、ほかは「11/1」のように日付で出す（選んだ日から数えた日数は分かりにくいため）
 */
export function lastDoneLabel(last: DateKey, date: DateKey, today: DateKey): string {
  if (date === today) return relativeDays(last, date);
  return last === date ? 'この日' : formatShortDate(last);
}

/** ホームで選んだ日。選んでいない（null）か、今日以降（日付が変わったあとなど）なら今日 */
export function pickedDayOrToday(picked: DateKey | null, today: DateKey): DateKey {
  return picked != null && picked < today ? picked : today;
}
