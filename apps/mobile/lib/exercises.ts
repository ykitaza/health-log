import { normalize } from './bodyweight';
import type { RecordType } from './sets';

/** 種目の選択の絞り込み：部位のチップ（null ならすべて）と検索の文字（前後の空白は無視し、名前に含むもの） */
export function searchExercises<T extends { name: string; bodyPartId: string }>(exercises: T[], partId: string | null, query: string): T[] {
  const q = query.trim();
  return exercises.filter((e) => (!partId || e.bodyPartId === partId) && (q === '' || e.name.includes(q)));
}

/** BIG3 の役。種目の big3 の列に入れる値（サーバーの exercise.big3 と同じ） */
export type Big3Role = 'bench' | 'squat' | 'deadlift';
export const BIG3_ROLES: readonly Big3Role[] = ['bench', 'squat', 'deadlift'];
export const BIG3_LABELS: Record<Big3Role, string> = { bench: 'ベンチプレス', squat: 'スクワット', deadlift: 'デッドリフト' };

/** 名前にこれを含むものは、BIG3 とは別の種目とみなす（名前で決めるときだけ。サーバーの big3.EXCLUDED_WORDS と同じ） */
export const BIG3_EXCLUDED_WORDS = [
  'インクライン', 'デクライン', 'ダンベル', 'スミス', 'マシン', 'ケーブル', 'ナロー', 'フロント', 'ゴブレット', 'ハック',
  'ブルガリアン', 'スプリット', 'ジャンプ', 'シシー', '片足', '自重', 'ルーマニアン', 'スティッフ',
] as const;

export function isBig3Role(v: unknown): v is Big3Role {
  return v === 'bench' || v === 'squat' || v === 'deadlift';
}

type Big3Candidate = { id: string; name: string; recordType: RecordType; hidden: boolean; big3: Big3Role | null };

/**
 * BIG3 の役 → 種目の ID（割り当てのない役は入れない）。サーバー（services/training/training/domain/big3.py）と同じ決まり
 * （testdata/training/big3.json で確かめる）。
 * - 種目の big3 で決める。1つの役は1つの種目だけ（画面で付け替えると前の種目から外す）。同期で重なったら ID の小さいほう
 * - どの種目にも役がないあいだは、名前で決める：名前に「ベンチプレス」「スクワット」「デッドリフト」を含み、インクライン・ダンベルなど
 *   別の種目を表す言葉を含まない、表示中の重量×回数の種目。いくつもあれば、名前がちょうど同じもの、短いもの、ID の小さいものの順
 */
export function big3Assignments(exercises: Big3Candidate[]): Partial<Record<Big3Role, string>> {
  const out: Partial<Record<Big3Role, string>> = {};
  const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const explicit = exercises.filter((e) => isBig3Role(e.big3)).sort(byId);
  if (explicit.length > 0) {
    for (const e of explicit) out[e.big3!] ??= e.id;
    return out;
  }
  const excluded = BIG3_EXCLUDED_WORDS.map(normalize);
  const len = (s: string) => [...s].length;
  for (const role of BIG3_ROLES) {
    const word = normalize(BIG3_LABELS[role]);
    const candidates = exercises
      .map((e) => ({ e, key: normalize(e.name) }))
      .filter(({ e, key }) => !e.hidden && e.recordType === 'weight_reps' && key.includes(word) && !excluded.some((x) => key.includes(x)))
      .sort((a, b) => Number(a.key !== word) - Number(b.key !== word) || len(a.key) - len(b.key) || byId(a.e, b.e));
    if (candidates[0]) out[role] = candidates[0].e.id;
  }
  return out;
}

/** 種目の ID → BIG3 の役（名前の横の「BIG3」の印に使う） */
export function big3RoleById(exercises: Big3Candidate[]): Map<string, Big3Role> {
  return new Map(Object.entries(big3Assignments(exercises)).map(([role, id]) => [id, role as Big3Role]));
}

/** フォームの動画を開けなかったときの案内（AI で記録の「開けなかったとき」と同じ形） */
export const FORM_VIDEO_OPEN_FAILED = 'フォームの動画を開けませんでした。ブラウザで開けるか確かめてください。';

/** フォームの動画のリンクを外のアプリ（YouTube・ブラウザ）で開く。開けたら true、開けなかったら false（呼ぶ側で案内を出す） */
export async function openFormVideo(url: string, open: (url: string) => Promise<unknown>): Promise<boolean> {
  try {
    await open(url);
    return true;
  } catch {
    return false;
  }
}

/** 3つの役がそろっていれば、役 → 種目の ID（レポートの BIG3 のタイル。lib/reports.ts の Big3Lifts）。そろわなければ null */
export function completeBig3(assignments: Partial<Record<Big3Role, string>>): Record<Big3Role, string> | null {
  const { bench, squat, deadlift } = assignments;
  return bench && squat && deadlift ? { bench, squat, deadlift } : null;
}
