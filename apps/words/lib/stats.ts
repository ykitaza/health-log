/**
 * 活動の記録（docs/words-design.md の「活動の記録」）。続ける気持ちを支えるための数で、責めるためには使わない。
 * サーバーの words/domain/stats.py と同じ計算を、端末の SQLite（同期したもの）から行う。testdata/words/stats.json で確かめる。
 * - captured：その期間に拾った数（表現を作った日）
 * - reencountered：その期間に足した出会いのうち、表現を作った日より後のもの
 * - used：その期間の使えたの記録（usage）の数
 * - hand_entered：今の手札の hand_since がその期間のもの
 * - moved_to_own：今 own の表現の moved_at がその期間のもの
 * - listened_items・listened_minutes：その期間の listen_session の合計（分は秒÷60 を小数1桁に丸める）
 * 期間は日本時間の午前4時で区切った日で、週は月曜〜日曜、月は暦の月
 */
import { addDays, DateKey, weekStart } from './date';
import { momentDay } from './schedule';
import type { Place } from './types';

export type Unit = 'week' | 'month';
export const UNKNOWN_SOURCE = '（場所なし）';

type Period = { start: DateKey; end: DateKey };

/** 今日を含む期間から count 個さかのぼる（古い順） */
export function periods(today: DateKey, unit: Unit, count: number): Period[] {
  const out: Period[] = [];
  if (unit === 'week') {
    const start = weekStart(today);
    for (let i = 0; i < count; i++) {
      const s = addDays(start, -7 * i);
      out.push({ start: s, end: addDays(s, 6) });
    }
  } else {
    let [y, m] = today.split('-').map(Number);
    for (let i = 0; i < count; i++) {
      const s = `${y}-${String(m).padStart(2, '0')}-01`;
      const ny = m === 12 ? y + 1 : y;
      const nm = m === 12 ? 1 : m + 1;
      out.push({ start: s, end: addDays(`${ny}-${String(nm).padStart(2, '0')}-01`, -1) });
      if (m === 1) { y -= 1; m = 12; } else m -= 1;
    }
  }
  return out.reverse();
}

type Expr = { id: string; source_id: string | null; place: Place; created_at: string; hand_since: DateKey | null; moved_at: string | null };

export type Row = {
  from: DateKey; to: DateKey; captured: number; reencountered: number; used: number; hand_entered: number; moved_to_own: number;
  listened_items: number; listened_minutes: number;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

export function activityStats(
  expressions: Expr[],
  encounters: { expression_id: string; created_at: string }[],
  usages: { used_on: DateKey }[],
  listens: { listened_on: DateKey; seconds: number; items: number }[],
  sources: { id: string; name: string }[],
  today: DateKey,
  unit: Unit = 'week',
  count = 8,
) {
  const spans = periods(today, unit, count);
  const created = new Map(expressions.map((e) => [e.id, momentDay(e.created_at)]));
  const bucket = (day: DateKey | null | undefined) => (day ? spans.findIndex((p) => p.start <= day && day <= p.end) : -1);
  const rows = spans.map((p) => ({
    from: p.start, to: p.end, captured: 0, reencountered: 0, used: 0, hand_entered: 0, moved_to_own: 0, listened_items: 0, listened_seconds: 0,
  }));
  type Key = Exclude<keyof (typeof rows)[number], 'from' | 'to'>;
  const add = (day: DateKey | null | undefined, key: Key, n = 1) => {
    const i = bucket(day);
    if (i >= 0) rows[i][key] += n;
  };
  const bySource = new Map<string | null, number>();
  for (const e of expressions) {
    const day = created.get(e.id);
    add(day, 'captured');
    if (bucket(day) >= 0) bySource.set(e.source_id, (bySource.get(e.source_id) ?? 0) + 1);
    if (e.place === 'hand') add(e.hand_since, 'hand_entered');
    if (e.place === 'own') add(momentDay(e.moved_at), 'moved_to_own');
  }
  for (const x of encounters) {
    const day = momentDay(x.created_at);
    const first = created.get(x.expression_id);
    if (first && day && day > first) add(day, 'reencountered');
  }
  for (const u of usages) add(u.used_on, 'used');
  for (const s of listens) {
    add(s.listened_on, 'listened_items', s.items);
    add(s.listened_on, 'listened_seconds', s.seconds);
  }
  const periodsOut: Row[] = rows.map(({ listened_seconds, ...r }) => ({ ...r, listened_minutes: round1(listened_seconds / 60) }));
  const keys = ['captured', 'reencountered', 'used', 'hand_entered', 'moved_to_own', 'listened_items', 'listened_minutes'] as const;
  const totals = Object.fromEntries(keys.map((k) => [k, k === 'listened_minutes'
    ? round1(periodsOut.reduce((n, r) => n + r[k], 0)) : periodsOut.reduce((n, r) => n + r[k], 0)])) as Record<(typeof keys)[number], number>;
  const names = new Map(sources.map((s) => [s.id, s.name]));
  const nameOf = (id: string | null) => (id ? names.get(id) ?? '' : '');
  const capturedBySource = [...bySource.entries()]
    .sort((a, b) => b[1] - a[1] || (nameOf(a[0]) < nameOf(b[0]) ? -1 : nameOf(a[0]) > nameOf(b[0]) ? 1 : 0))
    .map(([id, n]) => ({ source: id ? names.get(id) ?? UNKNOWN_SOURCE : UNKNOWN_SOURCE, captured: n }));
  const count_ = (p: Place) => expressions.filter((e) => e.place === p).length;
  return {
    unit,
    from: spans[0]?.start ?? null,
    to: spans[spans.length - 1]?.end ?? null,
    periods: periodsOut,
    totals,
    captured_by_source: capturedBySource,
    now: { collected: count_('collected'), hand: count_('hand'), own: count_('own'), total: expressions.length },
  };
}

export type ActivityStats = ReturnType<typeof activityStats>;

/** 「1時間5分」「12分」「40秒」 */
export function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s}秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}分`;
  return `${Math.floor(m / 60)}時間${m % 60 ? `${m % 60}分` : ''}`;
}

/** 一言（責めない。数があるときだけ、積み上がりを伝える） */
export function encouragement(total: number, thisPeriod: number): string {
  if (total === 0) return '出会った言葉を、ひとつ拾うところから';
  if (thisPeriod > 0) return `今週は ${thisPeriod} 語。これまでに ${total} 語、拾っています`;
  return `これまでに ${total} 語、拾っています`;
}

/** 落款の並び：使えたことのある表現と自分の言葉（新しく使えた順）。1つの表現に1つの印 */
export function sealGallery<T extends { place: Place; use_count: number; last_used_on: DateKey | null; created_at: string }>(items: T[]): T[] {
  return items.filter((e) => e.use_count > 0 || e.place === 'own')
    .sort((a, b) => (b.last_used_on ?? '').localeCompare(a.last_used_on ?? '') || b.created_at.localeCompare(a.created_at));
}
