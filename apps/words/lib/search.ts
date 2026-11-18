/**
 * 端末で探す（docs/words-design.md の「アプリで文字で探す」「絞り込みの軸」）。純粋な関数だけを置き、jest で確かめる。
 *
 * - 表現ごとに、同期しない列 search_key を持つ。対象の項目を正規化して、改行でつないだもの
 *   （探すための文の項目と、前後の文・本や人の名前）
 * - 探す言葉は空白で区切り、それぞれに同じ正規化をかけて、全部を含むもの（LIKE の「かつ」）を出す
 * - 並べ方：表現・読みに一致（同じ → 前方 → 含む）、意味・こういう時に使えそうに一致、それ以外、の順。
 *   同じ順位の中は、絞り込みの並べ方（タグの重みの合計 → ★ → 置き場所（手札・自分の言葉・拾った）→ 新しい順）
 */
import { searchKey } from './normalize';
import { Place, Register, REGISTER_LABELS, TagStatus } from './types';

/** 探すための文の版（サーバーの SEARCH_DOC_VERSION と同じ考え方。項目や順を変えたら上げて作り直す） */
export const SEARCH_KEY_VERSION = 1;

export type SearchKeyInput = {
  text: string;
  reading: string;
  meaning: string;
  nuance: string;
  register: Register | null;
  use_note: string;
  scene: string;
  note: string;
  /** 例文（本人のものと、断っていない Claude の案） */
  examples: string[];
  situations: string[];
  feelings: string[];
  encounters: { scene: string; title: string; surrounding_text: string }[];
};

/** 項目を正規化してつなぐ（空の項目は入れない）。区切りの改行は、探す言葉に入らないので、項目をまたいで当たらない */
export function buildSearchKey(e: SearchKeyInput): string {
  const parts = [
    e.text, e.reading, e.meaning, e.nuance, e.register ? REGISTER_LABELS[e.register] : '',
    ...e.situations, ...e.feelings, e.use_note, ...e.examples, e.scene,
    ...e.encounters.map((x) => x.scene), e.note,
    ...e.encounters.map((x) => x.surrounding_text), ...e.encounters.map((x) => x.title),
  ];
  return parts.map((p) => searchKey(p ?? '')).filter((p) => p !== '').join('\n');
}

/** 探す言葉を、空白で区切って正規化する（空のものは捨てる。同じものは1つに） */
export function queryTerms(query: string): string[] {
  return [...new Set(query.split(/\s+/).map(searchKey).filter((t) => t !== ''))];
}

/** LIKE に入れる形（% と _ と \ を逃がす。ESCAPE '\' と一緒に使う） */
export const likePattern = (term: string) => `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export type Rankable = {
  id: string;
  text: string;
  reading: string;
  meaning: string;
  use_note: string;
  star: boolean;
  place: Place;
  created_at: string;
  /** 絞り込みに使ったタグの重みの合計（確かめたもの 1.0、Claude の案 0.5） */
  tagWeight: number;
};

export const TAG_WEIGHT: Record<TagStatus, number> = { confirmed: 1, proposed: 0.5, rejected: 0 };
const PLACE_ORDER: Record<Place, number> = { hand: 0, own: 1, collected: 2 };

/** 文字の当たりの順位（小さいほど上）。言葉がなければ 0 */
export function textRank(e: Pick<Rankable, 'text' | 'reading' | 'meaning' | 'use_note'>, terms: string[]): number {
  if (terms.length === 0) return 0;
  const text = searchKey(e.text);
  const reading = searchKey(e.reading);
  const all = (field: string, test: (f: string, t: string) => boolean) => field !== '' && terms.every((t) => test(field, t));
  const eq = (f: string, t: string) => f === t;
  const starts = (f: string, t: string) => f.startsWith(t);
  const has = (f: string, t: string) => f.includes(t);
  if (all(text, eq) || all(reading, eq)) return 0;
  if (all(text, starts) || all(reading, starts)) return 1;
  if (terms.some((t) => text.includes(t) || reading.includes(t))) return 2;
  if (terms.some((t) => has(searchKey(e.meaning), t) || has(searchKey(e.use_note), t))) return 3;
  return 4;
}

/** 絞り込みの並べ方（タグの重み → ★ → 置き場所 → 新しい順） */
export function facetCompare(a: Rankable, b: Rankable): number {
  return b.tagWeight - a.tagWeight
    || Number(b.star) - Number(a.star)
    || PLACE_ORDER[a.place] - PLACE_ORDER[b.place]
    || b.created_at.localeCompare(a.created_at);
}

export function rankResults<T extends Rankable>(items: T[], query: string): T[] {
  const terms = queryTerms(query);
  const ranks = new Map(items.map((e) => [e.id, textRank(e, terms)]));
  return [...items].sort((a, b) => ranks.get(a.id)! - ranks.get(b.id)! || facetCompare(a, b));
}

/** 時期の絞り込み（拾った日 created_at の月 'YYYY-MM' か、直近の日数） */
export type Period = { kind: 'days'; days: number } | { kind: 'month'; month: string };
export const periodLabel = (p: Period) => (p.kind === 'days' ? `この${p.days === 7 ? '1週間' : `${p.days}日`}` : `${Number(p.month.slice(5))}月`);
