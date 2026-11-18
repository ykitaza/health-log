/**
 * 探すための正規化（docs/words-design.md の「正規化」）。サーバーの search_key() と同じ決まりにし、
 * testdata/words/search_key.json で両方を確かめる。
 *
 * 1. Unicode の NFKC（全角の英数字を半角に、半角のカタカナを全角に）
 * 2. 英字を小文字に
 * 3. カタカナをひらがなに（U+30A1〜U+30F6 → U+3041〜U+3096、ヽ・ヾ → ゝ・ゞ）。長音の「ー」と「々」は残す
 * 4. 空白・改行・タブと、句読点・記号（Unicode の分類 Z・P・S）を除く
 * 5. 送り仮名のゆれや、漢字とかなの違いは正規化しない（読み reading を探す対象に入れる）
 */
const STRIP = /[\s\p{Z}\p{P}\p{S}]/gu;

export function searchKey(text: string): string {
  let out = '';
  for (const ch of text.normalize('NFKC').toLowerCase()) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x30a1 && c <= 0x30f6) out += String.fromCodePoint(c - 0x60);
    else if (c === 0x30fd || c === 0x30fe) out += String.fromCodePoint(c - 0x60);
    else out += ch;
  }
  return out.replace(STRIP, '');
}

/** 同じ表現を探すための形（expression.normalized_key） */
export const normalizedKey = searchKey;

/** 2文字ずつの組（1文字なら、その1文字） */
function bigrams(key: string): Set<string> {
  const chars = [...key];
  if (chars.length < 2) return new Set(chars);
  const out = new Set<string>();
  for (let i = 0; i < chars.length - 1; i++) out.add(chars[i] + chars[i + 1]);
  return out;
}

/** 2文字の組の重なり（Jaccard）。0〜1 */
export function bigramJaccard(a: string, b: string): number {
  const x = bigrams(a);
  const y = bigrams(b);
  if (x.size === 0 || y.size === 0) return 0;
  let both = 0;
  for (const g of x) if (y.has(g)) both++;
  return both / (x.size + y.size - both);
}

/** 似た表現のしきい値（決めていないこと。メモの勧めの 0.5） */
export const SIMILAR_THRESHOLD = 0.5;

/**
 * 似ているか（normalized_key どうし。サーバーの words/domain/similarity.py と同じ。testdata/words/similarity.json）。
 * 同じ形は「同じ表現」なので似ているに入れない。片方がもう片方を含むか、2文字の組の重なりが 0.5 以上
 */
export function isSimilarKey(a: string, b: string): boolean {
  if (!a || !b || a === b) return false;
  return a.includes(b) || b.includes(a) || bigramJaccard(a, b) >= SIMILAR_THRESHOLD;
}
