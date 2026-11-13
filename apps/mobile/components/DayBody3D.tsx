// web（e2e）では、その日の体（DayBody）の 3D を使わない（expo-gl と three を web の束に入れない）。2D の図（components/DayBody.tsx）を出す。
// Android と iOS は DayBody3D.native.tsx
import type { ComponentType, ReactNode } from 'react';

/** 種目の札（EX-01〜）：番号・種目・いちばん重いセット・部位 */
export type DayBodyEntry = { key: string; no: number; name: string; set: string; part: string };

export type DayBody3DProps = {
  width: number;
  height: number;
  entries: DayBodyEntry[];
  /** その日の部位（光らせる） */
  parts: string[];
  /** 札を置ける上下の範囲（ホームでは四隅の数字の間） */
  band: { top: number; bottom: number };
  /** 描けないときに出すもの（2D の図） */
  fallback: ReactNode;
};

export const DayBody3D: ComponentType<DayBody3DProps> | null = null;
/** 3D の体の出典（web は 3D を出さないので出さない） */
export const DayBodyAttribution: ComponentType | null = null;
