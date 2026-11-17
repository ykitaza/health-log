// 3D の体（components/bodyScene.ts）に渡す色。見た目ごとに選ぶ：HUD とクラシックでホログラムに戻したとき（theme の MATTE_BODY が false）は
// 今までの光の色（暗い地の上の明るい色）、クラシックのつや消しの体は紙の上の石膏の色合い（theme/matte.ts）。
// 2D の図の色は theme（recoveryPalette・volumePalette・figureColors）
import {
  HUD_LOAD_PALETTE, HUD_RECOVERY_PALETTE, HUD_TONE_COLORS, HUD_VOLUME_PALETTE, matteBody, TRAINED_GLOW,
} from '@/theme';
import { MATTE, MATTE_RECOVERED, matteRecovering, matteVolume } from '@/theme/matte';
import { volumeGlowLevel } from './partVolume';
import { recoveryColor } from './recoveryMap';

export type BodyColors = {
  /** 回復済み（回復の色で塗るときの、ふだんの部品） */
  rest: string;
  /** 色の意味がないときの体（その日の体の、鍛えていない部品・ケガの画面） */
  neutral: string;
  /** その日に鍛えた部位 */
  trained: string;
  /** 空いている・まだ（回復）、0 セット（部位の量） */
  idle: string;
  /** 直している途中のケガ（回復マップ・ホーム） */
  injury: string;
  /** ケガの画面：直している途中・直せた */
  fixing: string;
  fixed: string;
  /** 回復中の明るさ k（0〜1）の色 */
  recovering: (k: number) => string;
  /** 部位の量の光の明るさ k（段 ÷ 5）の色 */
  volume: (k: number) => string;
};

const HUD_BODY: BodyColors = {
  rest: HUD_RECOVERY_PALETTE.rest,
  neutral: HUD_RECOVERY_PALETTE.rest,
  trained: TRAINED_GLOW,
  idle: HUD_RECOVERY_PALETTE.idle,
  injury: HUD_LOAD_PALETTE.injury,
  fixing: HUD_TONE_COLORS.caution.accent,
  fixed: HUD_RECOVERY_PALETTE.rest,
  recovering: (k) => recoveryColor(k, { rest: HUD_RECOVERY_PALETTE.rest, yellow: HUD_LOAD_PALETTE.yellow, orange: HUD_LOAD_PALETTE.orange }),
  volume: (k) => {
    const level = volumeGlowLevel(k);
    return level <= 0 ? HUD_VOLUME_PALETTE.empty : HUD_VOLUME_PALETTE.steps[Math.min(level, HUD_VOLUME_PALETTE.steps.length) - 1];
  },
};

/** つや消しの体（試作の値）。その日の体は、鍛えた部位を部位の量のいちばん濃い青、ほかを石膏にする */
const MATTE_BODY_COLORS: BodyColors = {
  rest: MATTE_RECOVERED,
  neutral: MATTE.plaster,
  trained: matteVolume(5),
  idle: MATTE.plaster,
  injury: MATTE.injury,
  fixing: MATTE.injury,
  fixed: MATTE_RECOVERED,
  recovering: matteRecovering,
  volume: (k) => matteVolume(volumeGlowLevel(k)),
};

export const bodyColors: BodyColors = matteBody ? MATTE_BODY_COLORS : HUD_BODY;
/** jest 用 */
export const BODY_COLOR_SETS = { hud: HUD_BODY, matte: MATTE_BODY_COLORS };
