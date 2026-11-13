// web（e2e）では、ホームのヒーローの INJURY の 3D の体を使わない（expo-gl と three を web の束に入れない）。
// 2D の図（components/HeroBody.tsx の Figure2D）を出す。Android と iOS は HeroBody3D.native.tsx
import type { ComponentType, ReactNode } from 'react';
import type { Injury } from '@/db/repositories/injuries';

export type HeroBody3DProps = {
  width: number;
  height: number;
  /** 札を置ける上下の範囲（四隅の数字の間） */
  band: { top: number; bottom: number };
  /** 直している途中のケガ（赤の印） */
  injuries: Injury[];
  /** 札の番号（INJ-01 ▲・部位・直し中）。injuryNumbers */
  numbers: Map<string, string>;
  /** 回す操作を受ける左右の範囲（体の列。外の横スワイプはページの切り替え） */
  rotate: { left: number; width: number };
  /** 描けないときに出すもの（2D の図） */
  fallback: ReactNode;
};

export const HeroBody3D: ComponentType<HeroBody3DProps> | null = null;
