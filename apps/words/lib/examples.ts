/**
 * 例文（expression.examples）。本人のもの（origin user、いつも confirmed）と Claude のもの（補う。本人が確かめたら confirmed）を
 * 1つの一覧に持つ（サーバーの ExampleFields）。同期は項目ごとの後勝ちなので、一覧ごと置き換わる。
 * 外すのは一覧から消すこと。同じ文（正規化して同じ）は2つ持たない。合わせて8件まで
 */
import { searchKey } from './normalize';
import { Example, MAX_EXAMPLE, MAX_EXAMPLES } from './types';

const clean = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, MAX_EXAMPLE);

/** 本人の例文を足す（同じ文があれば、本人が確かめたものにする） */
export function addUserExamples(list: Example[], texts: string[], now: string): Example[] {
  let out = [...list];
  for (const raw of texts) {
    const text = clean(raw);
    if (!text) continue;
    const i = out.findIndex((x) => searchKey(x.text) === searchKey(text));
    if (i >= 0) { out[i] = { ...out[i], confirmed: true, updated_at: now }; continue; }
    if (out.length >= MAX_EXAMPLES) break;
    out = [...out, { text, origin: 'user', confirmed: true, created_at: now, updated_at: now }];
  }
  return out;
}

/** Claude の例文を確かめる（ワンタップ） */
export function confirmExample(list: Example[], text: string, now: string): Example[] {
  return list.map((x) => (x.text === text ? { ...x, confirmed: true, updated_at: now } : x));
}

/** 例文を外す（一覧から消す） */
export function removeExample(list: Example[], text: string): Example[] {
  return list.filter((x) => x.text !== text);
}

/** 出す順：本人のもの → 確かめた Claude のもの → まだ確かめていない Claude の案（同じ順位は元の順） */
export function orderedExamples(list: Example[]): Example[] {
  const rank = (x: Example) => (x.origin !== 'user' ? 2 : 0) + (x.confirmed ? 0 : 1);
  return list.map((x, i) => ({ x, i })).sort((a, b) => rank(a.x) - rank(b.x) || a.i - b.i).map(({ x }) => x);
}

/** 端末の表の値（JSON の文字列）から読む。形の違うものは捨てる */
export function parseExamples(v: unknown): Example[] {
  let a: unknown = v;
  if (typeof v === 'string') {
    try { a = JSON.parse(v); } catch { return []; }
  }
  if (!Array.isArray(a)) return [];
  return a.flatMap((x) => {
    if (!x || typeof x !== 'object' || typeof (x as Example).text !== 'string') return [];
    const e = x as Partial<Example>;
    return [{
      text: e.text!, origin: e.origin === 'claude' ? 'claude' : 'user', confirmed: e.origin === 'claude' ? !!e.confirmed : true,
      created_at: typeof e.created_at === 'string' ? e.created_at : '', updated_at: typeof e.updated_at === 'string' ? e.updated_at : '',
    } satisfies Example];
  });
}
