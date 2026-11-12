/** 筋肉の図の向き。背中は後ろ姿、ほかは前から */
export type MuscleView = 'front' | 'back';

/** 筋肉の図で塗り分ける筋肉（Figma「部品案：筋肉の図」のパーツ。左右はまとめる） */
export type Muscle =
  | 'trapezius' | 'deltoid' | 'pecs' | 'biceps' | 'triceps' | 'forearm' | 'abs' | 'obliques'
  | 'lats' | 'erectors' | 'glutes' | 'quads' | 'hamstrings' | 'shins' | 'calves';

export type MuscleFigureSpec = { view: MuscleView; muscles: Muscle[] };

/**
 * 部位の名前（種目と部位の管理の名前。db/seed.ts の初期の部位）→ 筋肉の図の向きと塗る筋肉。
 * 腕（上腕二頭筋・上腕三頭筋）は Figma の「腕（前）」のとおり前から二頭筋と前腕を塗る（前の図に三頭筋のパーツはない）。
 * 「腕」「腹」は名前を付け替えたとき用。
 * 知らない部位は前から見た図で、どこも塗らない
 */
const PART_MUSCLES: Record<string, MuscleFigureSpec> = {
  胸: { view: 'front', muscles: ['pecs'] },
  背中: { view: 'back', muscles: ['trapezius', 'lats', 'erectors'] },
  肩: { view: 'front', muscles: ['deltoid'] },
  脚: { view: 'front', muscles: ['quads', 'shins'] },
  上腕二頭筋: { view: 'front', muscles: ['biceps', 'forearm'] },
  上腕三頭筋: { view: 'front', muscles: ['biceps', 'forearm'] },
  腕: { view: 'front', muscles: ['biceps', 'forearm'] },
  腹筋: { view: 'front', muscles: ['abs', 'obliques'] },
  腹: { view: 'front', muscles: ['abs', 'obliques'] },
};

export function muscleFigureFor(part: string): MuscleFigureSpec {
  return PART_MUSCLES[part.trim()] ?? { view: 'front', muscles: [] };
}
