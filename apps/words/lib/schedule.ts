/**
 * 手札の間隔と、聞く順（v1。docs/words-design.md の「聞くと間隔（v1）」）。サーバーの words/domain/schedule.py と同じ計算にし、
 * testdata/words/schedule.json・listen_queue.json で両方を確かめる。
 *
 * 自己採点の振り返りはやめ、車などで「聞く」ことを触れた回数として間隔に使う。
 * - 聞いた：回数と時刻を残し、手札ならその日の最初の1回だけ max(間隔, min(ceil(間隔×1.5), 14))。期限は その日＋間隔
 * - 使えた：min(max(間隔×3, 7), 60)、段階は使えた。同じ日の2回目は回数だけ
 * 日付の区切りは日本時間の午前4時（夜中に聞いたものは前の日に数える）
 */
import { addDays, DateKey, diffDays, reviewDay } from './date';
import type { Expression, Schedule } from './types';

export const LISTEN_FACTOR = 1.5;
export const LISTEN_CAP = 14;
export const USE_FACTOR = 3;
export const USE_MIN = 7;
export const USE_CAP = 60;
/** 手札に45日以上いて、まだ使えていない → 拾ったに戻すのを勧める */
export const STALE_HAND_DAYS = 45;
/** 使えたが違う日に2回 → 自分の言葉にするかを聞く */
export const OWN_USES = 2;
export const RISK_CAP = 3;
export const STAR_WEIGHT = 1.5;
export const DEFAULT_USEFULNESS = 2;
export const RECENT_DAYS = 14;
export const LISTEN_QUEUE_MAX = 20;

/** その時刻の「日」（日本時間の午前4時で区切る） */
export const businessDay = (at: Date): DateKey => reviewDay(at);

/** RFC 3339 の時刻の「日」 */
export function momentDay(text: string | null | undefined): DateKey | null {
  if (!text) return null;
  const t = Date.parse(text);
  return Number.isNaN(t) ? null : businessDay(new Date(t));
}

export const EMPTY_SCHEDULE: Schedule = {
  stage: null, interval_days: 1, due_on: null, listened_at: null, listen_count: 0, use_count: 0, last_used_on: null,
};

/** 手札に入れたとき：間隔1日、明日が期限、意味がわかる。回数（聞いた・使えた）は残す */
export function enterHand(s: Schedule, day: DateKey): Schedule {
  return { ...s, stage: 'understood', interval_days: 1, due_on: addDays(day, 1) };
}

/** 手札から出したとき：段階と期限を外す（回数と間隔はそのまま） */
export function leaveHand(s: Schedule): Schedule {
  return { ...s, stage: null, due_on: null };
}

/** 聞いた（流し終えた）。回数と時刻を残し、手札ならその日の最初の1回だけ間隔を延ばす（14日まで、縮めない） */
export function applyListen(s: Schedule, at: string, inHand = true): Schedule {
  const day = momentDay(at);
  const before = momentDay(s.listened_at);
  const next = { ...s, listened_at: at, listen_count: s.listen_count + 1 };
  if (!inHand || !day || before === day) return next;
  const interval = Math.max(s.interval_days, Math.min(Math.ceil(s.interval_days * LISTEN_FACTOR), LISTEN_CAP));
  return { ...next, interval_days: interval, due_on: addDays(day, interval) };
}

/** 実際に使えた。手札でないときは、使えた回数と日だけを残す */
export function applyUse(s: Schedule, day: DateKey, inHand = true): Schedule {
  const next = { ...s, use_count: s.use_count + 1, last_used_on: day };
  if (!inHand) return next;
  if (s.last_used_on === day) return { ...next, stage: 'used' };
  const interval = Math.min(Math.max(s.interval_days * USE_FACTOR, USE_MIN), USE_CAP);
  return { ...next, stage: 'used', interval_days: interval, due_on: addDays(day, interval) };
}

// --- 並べる順 ---

type Rankable = Pick<Expression, 'id' | 'interval_days' | 'due_on' | 'listened_at' | 'hand_since' | 'usefulness' | 'usefulness_until' | 'star'>;

/** 今の役立ち度（1〜3）。null と期限切れは2 */
export function usefulnessOf(e: Pick<Expression, 'usefulness' | 'usefulness_until'>, today: DateKey): number {
  if (e.usefulness == null || (e.usefulness_until != null && e.usefulness_until < today)) return DEFAULT_USEFULNESS;
  return e.usefulness;
}

/** 忘れそうな度合い：最後に聞いた日からの日数 ÷ 間隔（まだなら手札に入れてからの日数）。3で止める */
export function risk(e: Rankable, today: DateKey): number {
  const since = momentDay(e.listened_at) ?? e.hand_since;
  if (!since) return 0;
  return Math.min(Math.max(diffDays(since, today), 0) / Math.max(e.interval_days, 1), RISK_CAP);
}

export function priority(e: Rankable, today: DateKey): number {
  return risk(e, today) * usefulnessOf(e, today) * (e.star ? STAR_WEIGHT : 1);
}

export const isDue = (e: Pick<Expression, 'due_on'>, today: DateKey) => e.due_on != null && e.due_on <= today;

export type QueueGroup = 'due' | 'hand' | 'star' | 'recent';
export type QueueItem<T> = { expression: T; group: QueueGroup; priority: number };

/**
 * 聞く順：手札の期限のもの（優先度の順）→ 手札のほか（優先度の順）→ ★のもの（新しく拾った順）→ 最近14日に拾ったもの（新しい順）。
 * 同じ表現は1回だけ。同じ優先度は ID の順。limit 件まで
 */
export function listenQueue<T extends Rankable & Pick<Expression, 'place' | 'created_at'>>(items: T[], today: DateKey, limit = LISTEN_QUEUE_MAX): QueueItem<T>[] {
  const cmpId = (a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const byPriority = (a: T, b: T) => priority(b, today) - priority(a, today) || cmpId(a, b);
  const newest = (a: T, b: T) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : cmpId(a, b));
  const hand = items.filter((e) => e.place === 'hand');
  const rest = items.filter((e) => e.place !== 'hand');
  const recentFrom = addDays(today, -(RECENT_DAYS - 1));
  const groups: [QueueGroup, T[]][] = [
    ['due', hand.filter((e) => isDue(e, today)).sort(byPriority)],
    ['hand', hand.filter((e) => !isDue(e, today)).sort(byPriority)],
    ['star', rest.filter((e) => e.star).sort(newest)],
    ['recent', rest.filter((e) => { const d = momentDay(e.created_at); return d != null && d >= recentFrom; }).sort(newest)],
  ];
  const out: QueueItem<T>[] = [];
  const seen = new Set<string>();
  for (const [group, list] of groups) {
    for (const e of list) {
      if (seen.has(e.id) || out.length >= limit) continue;
      seen.add(e.id);
      out.push({ expression: e, group, priority: Math.round(priority(e, today) * 1000) / 1000 });
    }
  }
  return out;
}

/** 自分の言葉に移す条件：使えたが、違う日に2回（勧めるだけ。自動では移さない） */
export const ownReady = (useDays: DateKey[]) => new Set(useDays).size >= OWN_USES;

/** 拾ったに戻すのを勧める：手札に45日以上いて、まだ一度も使えていない */
export function suggestDemote(e: Pick<Expression, 'place' | 'use_count' | 'hand_since'>, today: DateKey): boolean {
  return e.place === 'hand' && e.use_count === 0 && e.hand_since != null && diffDays(e.hand_since, today) >= STALE_HAND_DAYS;
}

/** 手札の期限のものの数 */
export const dueCount = (hand: Pick<Expression, 'due_on'>[], today: DateKey) => hand.filter((e) => isDue(e, today)).length;
