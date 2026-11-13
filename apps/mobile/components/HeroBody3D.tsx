// web（e2e）ではホームの LATEST の 3D の体を使わない（expo-gl と three を web の束に入れない）。2D の図（components/HomeHero.tsx）を出す。
// Android と iOS は HeroBody3D.native.tsx
import type { ComponentType, ReactNode } from 'react';

/** LATEST の種目の札（EX-01〜）：番号・種目・いちばん重いセット・部位 */
export type HeroEntry = { key: string; no: number; name: string; set: string; part: string };

export type HeroBody3DProps = {
  width: number;
  height: number;
  entries: HeroEntry[];
  /** その日の部位（光らせる） */
  parts: string[];
  /** 札を置ける上下の範囲（四隅の数字の間） */
  band: { top: number; bottom: number };
  /** 描けないときに出すもの（2D の図） */
  fallback: ReactNode;
};

export const HeroBody3D: ComponentType<HeroBody3DProps> | null = null;
/** 3D の体の出典（web は 3D を出さないので出さない） */
export const HeroAttribution: ComponentType | null = null;
