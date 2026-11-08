/** 種目の選択の絞り込み：部位のチップ（null ならすべて）と検索の文字（前後の空白は無視し、名前に含むもの） */
export function searchExercises<T extends { name: string; bodyPartId: string }>(exercises: T[], partId: string | null, query: string): T[] {
  const q = query.trim();
  return exercises.filter((e) => (!partId || e.bodyPartId === partId) && (q === '' || e.name.includes(q)));
}
