/**
 * 拾ったの一覧の絞り込みと、本・人ごとのまとまり（Figma の 2-collection）。純粋な関数で jest で確かめる
 */
import { formatMonthDay } from './date';
import type { Place, Source } from './types';

export type CollectedFilter = 'all' | 'star' | 'unwritten' | 'ai' | 'hand' | 'own' | `source:${string}`;

type Item = {
  id: string; text: string; scene: string; star: boolean; place: Place; created_at: string;
  firstVia: 'mcp' | 'app'; firstSourceId: string | null; firstTitle: string; firstMetOn: string | null; firstLocator: string;
};

export function applyFilter<T extends Item>(items: T[], f: CollectedFilter): T[] {
  if (f === 'all') return items;
  if (f === 'star') return items.filter((e) => e.star);
  if (f === 'unwritten') return items.filter((e) => !e.scene);
  if (f === 'ai') return items.filter((e) => e.firstVia === 'mcp');
  if (f === 'hand' || f === 'own') return items.filter((e) => e.place === f);
  const id = f.slice('source:'.length);
  return items.filter((e) => e.firstSourceId === id);
}

/** 題を『』で囲む場所（本・作品）。会話などは、題は人や場なので囲まない */
const TITLED = new Set(['book', 'tablet', 'headphones', 'film', 'podcast']);

export type Group<T> = { key: string; head: string; sub: string; items: T[] };

/** 最初の出会いの場所と題でまとめる。まとまりは、中のいちばん新しいものの順 */
export function groupByWork<T extends Item>(items: T[], sources: Source[]): Group<T>[] {
  const byKey = new Map<string, T[]>();
  for (const e of items) {
    const key = `${e.firstSourceId ?? ''}|${e.firstTitle}`;
    byKey.set(key, [...(byKey.get(key) ?? []), e]);
  }
  const groups = [...byKey.entries()].map(([key, list]) => {
    const first = list[0];
    const source = sources.find((s) => s.id === first.firstSourceId);
    const titled = !!first.firstTitle && (!source || TITLED.has(source.icon_key));
    // 題に『』が付いていれば（本人が付けて書いた）、重ねない
    const quoted = first.firstTitle.startsWith('『') ? first.firstTitle : `『${first.firstTitle}』`;
    const head = titled ? quoted : source?.name ?? (first.firstTitle || '出会った場所なし');
    const sub = titled
      ? source?.name ?? ''
      : [first.firstMetOn ? formatMonthDay(first.firstMetOn) : null, source ? first.firstTitle : null].filter(Boolean).join(' · ');
    const items = [...list].sort((a, b) => b.created_at.localeCompare(a.created_at));
    return { key, head, sub, items };
  });
  return groups.sort((a, b) => b.items[0].created_at.localeCompare(a.items[0].created_at));
}

/** 行の下の一言：場面。なければ「Claude から · 位置」 */
export function rowSub(e: Item): string {
  if (e.scene) return e.scene;
  return [e.firstVia === 'mcp' ? 'Claude から' : null, e.firstLocator || null].filter(Boolean).join(' · ');
}
