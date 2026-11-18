/**
 * 振り返りの場面の文（Figma の 4a・4b）。出会いの前後の文に、その出会いの言い回し（なければ表現）が入っていれば、
 * そこを空欄にして見せる。見つからなければ null（場面の説明だけを出す）
 */
export type Cloze = { before: string; answer: string; after: string };

type Enc = { surrounding_text: string; wording: string };

export function makeCloze(text: string, encounters: Enc[]): Cloze | null {
  for (const e of encounters) {
    const sentence = e.surrounding_text.trim();
    if (!sentence) continue;
    for (const target of [e.wording.trim(), text.trim()].filter(Boolean)) {
      const i = sentence.indexOf(target);
      if (i >= 0) return { before: sentence.slice(0, i), answer: target, after: sentence.slice(i + target.length) };
    }
  }
  return null;
}
