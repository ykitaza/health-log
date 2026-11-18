/**
 * 日付の扱い（日本時間）。'YYYY-MM-DD' の文字で持つ。
 * 振り返りの日付の区切りは日本時間の午前4時（夜中の振り返りは前の日に数える。docs/words-design.md の「振り返りと間隔」）。
 * 通知の週は、日本時間の暦の月曜〜日曜
 */
export type DateKey = string;

const JST_MS = 9 * 3600_000;
const DAY_MS = 86_400_000;
/** 振り返りの1日の始まり（日本時間の午前4時） */
export const DAY_START_HOUR = 4;

const pad = (n: number) => String(n).padStart(2, '0');

const keyOfUtc = (t: number): DateKey => {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

/** 日本時間の暦の日付 */
export function jstDate(at: Date): DateKey {
  return keyOfUtc(at.getTime() + JST_MS);
}

/** 振り返りの日（日本時間の午前4時で区切る） */
export function reviewDay(at: Date): DateKey {
  return keyOfUtc(at.getTime() + JST_MS - DAY_START_HOUR * 3600_000);
}

export function isDateKey(v: unknown): v is DateKey {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
}

const utcOf = (key: DateKey) => Date.parse(`${key}T00:00:00Z`);

export function addDays(key: DateKey, days: number): DateKey {
  return keyOfUtc(utcOf(key) + days * DAY_MS);
}

/** b − a（日） */
export function diffDays(a: DateKey, b: DateKey): number {
  return Math.round((utcOf(b) - utcOf(a)) / DAY_MS);
}

/** その日の週の月曜 */
export function weekStart(key: DateKey): DateKey {
  const dow = new Date(utcOf(key)).getUTCDay(); // 0 = 日曜
  return addDays(key, -((dow + 6) % 7));
}

/** 日本時間のその日の、時・分の時刻（Date） */
export function jstAt(key: DateKey, minutes: number): Date {
  return new Date(utcOf(key) - JST_MS + minutes * 60_000);
}

/** 日本時間の、その日の0時からの分 */
export function jstMinutes(at: Date): number {
  const d = new Date(at.getTime() + JST_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** 「11月15日」 */
export function formatMonthDay(key: DateKey): string {
  const [, m, d] = key.split('-').map(Number);
  return `${m}月${d}日`;
}

/** 「2026年11月」（拾った月の見出し） */
export function formatMonth(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${y}年${m}月`;
}

/** 「20:00」 */
export function formatMinutes(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${pad(minutes % 60)}`;
}

/** 「3分前」「昨日」「11月15日」（さっき拾ったの横） */
export function relativeTime(iso: string, now: Date): string {
  const t = Date.parse(iso);
  const sec = Math.max(0, Math.floor((now.getTime() - t) / 1000));
  if (sec < 60) return 'いま';
  if (sec < 3600) return `${Math.floor(sec / 60)}分前`;
  const today = jstDate(now);
  const day = jstDate(new Date(t));
  if (day === today) return `${Math.floor(sec / 3600)}時間前`;
  if (diffDays(day, today) === 1) return '昨日';
  return formatMonthDay(day);
}
