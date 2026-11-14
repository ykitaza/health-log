// web（e2e）では、その日の体（DayBody）の 3D を使わない（expo-gl と three を web の束に入れない）。2D の図（components/DayBody.tsx）を出す。
// Android と iOS は DayBody3D.native.tsx
import type { ComponentType, ReactNode } from 'react';
import type { Injury } from '@/db/repositories/injuries';

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
  /** 部品ごとの回復の明るさ（0〜1。0 より大きい部品は暖色で、parts のミントより優先）。筋トレの記録の画面の、記録のない日 */
  recovery?: Record<string, number>;
  /** 空いている部品（回復済みの期限を過ぎた・一度も鍛えていない部位。灰色。lib/recoveryMap.ts の idleMeshes）。記録のない日 */
  idle?: string[];
  /** 直している途中のケガ（赤で脈打つ）。記録のない日 */
  injuries?: Injury[];
  /** 体を押した（押した部品の名前。同じ部品・皮膚・外を押して選ぶのをやめたら null） */
  onPick?: (mesh: string | null) => void;
  /** 種目の札を押した（札の key。「+N」の札は null）。渡すと札が押せる（ホームの LATEST） */
  onPressEntry?: (key: string | null) => void;
  /** 体と札のあいだに重ねるもの（ホームのヒーローの、体の列の外の横スワイプをページの切り替えに回す面）。札はこの上に出す */
  shield?: ReactNode;
};

export const DayBody3D: ComponentType<DayBody3DProps> | null = null;
/** 3D の体の出典（web は 3D を出さないので出さない） */
export const DayBodyAttribution: ComponentType | null = null;
