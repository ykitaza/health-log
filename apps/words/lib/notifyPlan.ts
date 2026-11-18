/**
 * ローカル通知の予約の決め方（docs/words-design.md の「通知」）。純粋な関数で、jest で確かめる。
 *
 * | 送るとき | 予約した時刻に、期限の手札が3つ以上あるとき（due_on で先に分かるので、3つ以上になる日を計算して予約する） |
 * | 回数 | 週（月曜〜日曜、日本時間）に2回まで。2回の間は48時間以上あける |
 * | 時刻 | 直近14日のアプリを前面にした時刻の中央値を15分単位に丸め、7:00〜22:00 におさめる。記録が5回より少なければ 20:00 |
 * | 送らないとき | その週に自分で聞いたとき、手札が空のとき、通知を許可していないとき |
 * | 文 | 「手札の言葉が3つ、聞いて確かめごろです」（振り返りの画面を聞くに変えたので、メモの文から変えた）。続けた日数や、さぼったことは書かない |
 */
import { addDays, DateKey, jstAt, jstDate, jstMinutes, weekStart } from './date';

export const DUE_THRESHOLD = 3;
export const WEEKLY_MAX = 2;
export const MIN_GAP_MS = 48 * 3600_000;
export const OPEN_WINDOW_DAYS = 14;
export const MIN_OPENS = 5;
export const DEFAULT_MINUTES = 20 * 60;
export const EARLIEST_MINUTES = 7 * 60;
export const LATEST_MINUTES = 22 * 60;
/** 先を探す日数（それより先は、次にアプリを開いたときに予約し直す） */
export const LOOKAHEAD_DAYS = 60;

/** 中央値（偶数個なら真ん中の2つの平均） */
function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** 通知の時刻（日本時間の0時からの分）。opens はアプリを前面にした時刻 */
export function notifyMinutes(opens: Date[], now: Date): number {
  const since = now.getTime() - OPEN_WINDOW_DAYS * 86_400_000;
  const recent = opens.filter((o) => o.getTime() >= since && o.getTime() <= now.getTime());
  if (recent.length < MIN_OPENS) return DEFAULT_MINUTES;
  const rounded = Math.round(median(recent.map(jstMinutes)) / 15) * 15;
  return Math.min(LATEST_MINUTES, Math.max(EARLIEST_MINUTES, rounded));
}

export type NotifyInput = {
  now: Date;
  /** 手札の期限（due_on）。手札でないものは入れない */
  handDue: (DateKey | null)[];
  opens: Date[];
  /** 送った（予約した時刻を過ぎた）通知の時刻 */
  sent: Date[];
  /** 自分で聞いた（聞いた1回 listen_session の）時刻 */
  selfListens: Date[];
  permitted: boolean;
};

export type NotifyPlan = { at: Date; count: number; body: string } | null;

export const notifyBody = (count: number) => `手札の言葉が${count}つ、聞いて確かめごろです`;
export const NOTIFY_TITLE = 'ことば';

/** 次に予約する通知。予約は常に1つだけ（呼ぶ側が前の予約を消してから入れる）。送らないなら null */
export function planNotification({ now, handDue, opens, sent, selfListens, permitted }: NotifyInput): NotifyPlan {
  if (!permitted || handDue.length === 0) return null;
  const minutes = notifyMinutes(opens, now);
  const today = jstDate(now);
  const lastSent = sent.reduce<number>((m, s) => Math.max(m, s.getTime()), -Infinity);
  const weekOf = (d: Date) => weekStart(jstDate(d));
  const sentIn = (week: DateKey) => sent.filter((s) => weekOf(s) === week).length;
  const selfIn = new Set(selfListens.map(weekOf));
  for (let i = 0; i <= LOOKAHEAD_DAYS; i++) {
    const day = addDays(today, i);
    const at = jstAt(day, minutes);
    if (at.getTime() <= now.getTime()) continue;
    const count = handDue.filter((d) => d != null && d <= day).length;
    if (count < DUE_THRESHOLD) continue;
    const week = weekStart(day);
    if (selfIn.has(week)) continue;
    if (sentIn(week) >= WEEKLY_MAX) continue;
    if (at.getTime() - lastSent < MIN_GAP_MS) continue;
    return { at, count, body: notifyBody(count) };
  }
  return null;
}
