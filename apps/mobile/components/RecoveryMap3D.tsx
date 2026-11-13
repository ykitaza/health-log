// web（e2e）では 3D の体を使わない（expo-gl と three を web の束に入れない）。回復マップは 2D の図を出す。
// Android と iOS は RecoveryMap3D.native.tsx
import type { ComponentType, ReactNode } from 'react';
import type { Injury } from '@/db/repositories/injuries';

export type RecoveryMap3DProps = {
  /** 部品ごとの回復の光の明るさ（0〜1） */
  levels: Record<string, number>;
  /** 直している途中のケガ（控えめな印） */
  injuries: Injury[];
  /** 選んでいる部品（押した部位の部品） */
  selected: string[];
  /** 図の上で押した部品（外を押した・選んだ部品をもう一度押したら null） */
  onPick: (mesh: string | null) => void;
  /** 注釈（引き出し線つきの札）を付ける部位。回復中とケガのある部位 */
  callouts: RecoveryCallout[];
  /** 描けないときに出すもの（2D の図） */
  fallback: ReactNode;
};

/** 注釈の札：英字と日本語の部位名、状態（「あと1日」）、ケガ（「▲ 腰の筋肉」）。色はその部位の色 */
export type RecoveryCallout = {
  id: string; en: string; name: string; status: string; injury: string | null; color: string;
  anchor: [number, number, number]; facing: 'front' | 'back';
  /** ケガがある（先に出す） */
  hurt: boolean;
  /** 最後に鍛えた日（新しいものを先に出す） */
  last: string;
};

export const RecoveryMap3D: ComponentType<RecoveryMap3DProps> | null = null;
