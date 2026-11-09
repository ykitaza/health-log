/**
 * 数字の表示が変わったとき、どの文字が変わったか（number-pop-in の考え方。変わった桁だけを下から上げて入れ替える）。
 * 位を合わせるため、右端（いちばん下の位）からそろえて比べる。桁が増えた左の文字は、変わったものとする。
 * 前の値がない（初めて出す）ときは、どれも変わっていないことにする（開いたときは動かさない）
 */
export function changedDigits(prev: string | undefined, next: string): boolean[] {
  if (prev === undefined) return Array.from(next, () => false);
  const offset = prev.length - next.length;
  return Array.from(next, (c, i) => {
    const j = i + offset;
    return j < 0 || prev[j] !== c;
  });
}
