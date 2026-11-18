/**
 * 「聞く」の読み上げの台本（版 1）。サーバーの words/domain/speech.py と同じ型にし、testdata/words/speech.json で確かめる。
 * 表現 → 読み（表現と違うときだけ）→ 説明（意味。ニュアンス）→ 使い方（use_note、なければ使う場面のタグ3つまで）→ 例文2つまで。
 * アプリは区切り（sections）を端末の読み上げで、区切りのあいだに間を空けて読む（既定）。自然な声のときはサーバーが SSML を Polly で読む
 */
import type { Example, Expression, TagKind, TagStatus } from './types';

export const SPEECH_VERSION = 1;
export const SECTION_BREAK_MS = 800;
export const EXAMPLE_BREAK_MS = 500;
export const LEAD_BREAK_MS = 300;
export const MAX_EXAMPLES_SPOKEN = 2;
const MAX_CHARS = { text: 200, reading: 100, explanation: 400, usage: 200, example: 200 } as const;

export type SectionName = keyof typeof MAX_CHARS;
export type Script = { sections: [SectionName, string][]; ssml: string };

/** 空白をまとめ、長ければ切る（文字は Unicode の1文字ずつ数える） */
function cut(text: string, limit: number): string {
  const t = text.split(/\s+/).filter(Boolean).join(' ');
  const chars = [...t];
  return chars.length <= limit ? t : `${chars.slice(0, limit - 1).join('')}…`;
}

const sentence = (t: string) => (/[。！？!?…]$/.test(t) ? t : `${t}。`);

const escapeXml = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 読む例文：本人のもの → 確かめた Claude のもの → ほかの Claude のもの の順に2つまで（同じ順位は元の順） */
export function spokenExamples(examples: Pick<Example, 'text' | 'origin' | 'confirmed'>[]): string[] {
  const rank = (x: Pick<Example, 'origin' | 'confirmed'>) => (x.origin !== 'user' ? 2 : 0) + (x.confirmed ? 0 : 1);
  return examples.map((x, i) => ({ x, i })).sort((a, b) => rank(a.x) - rank(b.x) || a.i - b.i).slice(0, MAX_EXAMPLES_SPOKEN).map(({ x }) => x.text);
}

export function buildScript(
  e: Pick<Expression, 'text' | 'reading' | 'meaning' | 'nuance' | 'use_note'> & { examples: Pick<Example, 'text' | 'origin' | 'confirmed'>[] },
  tags: { kind: TagKind; name: string; status: TagStatus }[],
): Script {
  const sections: [SectionName, string][] = [['text', cut(e.text, MAX_CHARS.text)]];
  if (e.reading && e.reading !== e.text) sections.push(['reading', `読みは、${sentence(cut(e.reading, MAX_CHARS.reading))}`]);
  const explanation = [e.meaning, e.nuance].filter((t) => t.trim() !== '').map(sentence).join(' ');
  if (explanation) sections.push(['explanation', cut(explanation, MAX_CHARS.explanation)]);
  const situations = tags.filter((t) => t.kind === 'situation' && t.status !== 'rejected').map((t) => t.name);
  const usage = e.use_note.trim() ? `こういう時に。${sentence(e.use_note.trim())}`
    : situations.length > 0 ? `使う場面は、${situations.slice(0, 3).join('、')}。` : '';
  if (usage) sections.push(['usage', cut(usage, MAX_CHARS.usage)]);
  spokenExamples(e.examples).forEach((x, n) => {
    sections.push(['example', `${n === 0 ? '例えば。' : ''}${sentence(cut(x, MAX_CHARS.example))}`]);
  });
  const parts: string[] = [];
  sections.forEach(([name, text], i) => {
    if (i > 0) {
      const gap = name === 'example' && sections[i - 1][0] === 'example' ? EXAMPLE_BREAK_MS : SECTION_BREAK_MS;
      parts.push(`<break time="${gap}ms"/>`);
    }
    if (name === 'example' && text.startsWith('例えば。')) parts.push(`例えば<break time="${LEAD_BREAK_MS}ms"/>${escapeXml(text.slice('例えば。'.length))}`);
    else parts.push(escapeXml(text));
  });
  return { sections, ssml: `<speak>${parts.join('')}</speak>` };
}

/**
 * 端末の読み上げに渡す文。区切りごとに改行を2つ入れて間を空ける（Android の読み上げは SSML の break を読まないため、
 * 改行と句点の間で区切る）
 */
export const spokenText = (s: Script) => s.sections.map(([, t]) => t).join('\n\n');

/** 端末の読み上げで区切りごとに書き出すときの文（あいだの間は設定の読み方で決める。lib/listen/pace.ts） */
export const spokenSections = (s: Script) => s.sections.map(([, t]) => t);
