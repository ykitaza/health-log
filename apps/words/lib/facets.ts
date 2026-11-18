/**
 * 探すの絞り込み（docs/words-design.md の「絞り込みの軸」）。純粋な関数で jest で確かめる。
 * 同じ軸の中は「どれか」、軸どうしは「かつ」。タグは rejected を使わない
 */
import { addDays, DateKey, jstDate } from './date';
import { rankResults, TAG_WEIGHT } from './search';
import type { Place, Register, TagStatus } from './types';

export type Facets = {
  situations: string[];
  feelings: string[];
  registers: Register[];
  sources: string[];
  /** 本・人（encounter.title） */
  titles: string[];
  /** 時期：'week'（この1週間）か 'YYYY-MM'（拾った月）か 'YYYY'（年） */
  periods: string[];
  places: Place[];
  starred: boolean;
};

export const EMPTY_FACETS: Facets = { situations: [], feelings: [], registers: [], sources: [], titles: [], periods: [], places: [], starred: false };

export const facetCount = (f: Facets) =>
  f.situations.length + f.feelings.length + f.registers.length + f.sources.length + f.titles.length + f.periods.length + f.places.length + (f.starred ? 1 : 0);

export type FacetItem = {
  id: string; text: string; reading: string; meaning: string; use_note: string; star: boolean; place: Place; created_at: string;
  register: Register | null;
};
export type Link = { expression_id: string; tag_id: string; status: TagStatus };
export type EncounterFacet = { expression_id: string; source_id: string | null; title: string };

/** 時期に入るか（拾った日 created_at を日本時間の日付で見る） */
export function inPeriod(createdAt: string, period: string, today: DateKey): boolean {
  const day = jstDate(new Date(createdAt));
  if (period === 'week') return day > addDays(today, -7) && day <= today;
  if (/^\d{4}-\d{2}$/.test(period)) return day.startsWith(period);
  if (/^\d{4}$/.test(period)) return day.startsWith(`${period}-`);
  return false;
}

export function applyFacets<T extends FacetItem>(
  items: T[], f: Facets, links: Link[], encounters: EncounterFacet[], today: DateKey, query = '',
): (T & { tagWeight: number; tagIds: Map<string, TagStatus> })[] {
  const linksOf = new Map<string, Map<string, TagStatus>>();
  for (const l of links) {
    if (l.status === 'rejected') continue;
    const m = linksOf.get(l.expression_id) ?? new Map<string, TagStatus>();
    m.set(l.tag_id, l.status);
    linksOf.set(l.expression_id, m);
  }
  const encOf = new Map<string, EncounterFacet[]>();
  for (const e of encounters) encOf.set(e.expression_id, [...(encOf.get(e.expression_id) ?? []), e]);
  const anyOf = (wanted: string[], has: (v: string) => boolean) => wanted.length === 0 || wanted.some(has);

  const out = items.flatMap((e) => {
    const tags = linksOf.get(e.id) ?? new Map<string, TagStatus>();
    const enc = encOf.get(e.id) ?? [];
    const ok = anyOf(f.situations, (t) => tags.has(t))
      && anyOf(f.feelings, (t) => tags.has(t))
      && anyOf(f.registers, (r) => e.register === r)
      && anyOf(f.sources, (s) => enc.some((x) => x.source_id === s))
      && anyOf(f.titles, (t) => enc.some((x) => x.title === t))
      && anyOf(f.periods, (p) => inPeriod(e.created_at, p, today))
      && anyOf(f.places, (p) => e.place === p)
      && (!f.starred || e.star);
    if (!ok) return [];
    const tagWeight = [...f.situations, ...f.feelings].reduce((w, t) => w + (tags.has(t) ? TAG_WEIGHT[tags.get(t)!] : 0), 0);
    return [{ ...e, tagWeight, tagIds: tags }];
  });
  return rankResults(out, query);
}

/** 時期の選択肢：この1週間、拾った月（新しい順に4つまで、今年のもの）、去年より前は年 */
export function periodOptions(createdAts: string[], today: DateKey): { key: string; label: string }[] {
  const year = today.slice(0, 4);
  const months = [...new Set(createdAts.map((c) => jstDate(new Date(c)).slice(0, 7)))].sort().reverse();
  const thisYear = months.filter((m) => m.startsWith(year)).slice(0, 4);
  const years = [...new Set(months.filter((m) => !m.startsWith(year)).map((m) => m.slice(0, 4)))];
  return [
    ...(createdAts.some((c) => inPeriod(c, 'week', today)) ? [{ key: 'week', label: 'この1週間' }] : []),
    ...thisYear.map((m) => ({ key: m, label: `${Number(m.slice(5))}月` })),
    ...years.map((y) => ({ key: y, label: Number(y) === Number(year) - 1 ? '去年' : `${y}年` })),
  ];
}
