/**
 * 下に引っぱって同期するときの印（KARADA のマーク：K と心拍の線）の動きの値。Reanimated を読み込まずに jest で確かめる
 * （lib/__tests__/pull-mark.test.ts）。関数は worklet で、components/PullMark.tsx の useAnimatedStyle・useAnimatedProps から呼ぶ。
 * 形はアプリのアイコン（assets/icon-src/icon.svg）と同じ path。座標もアイコンのまま（viewBox で切り出す）
 */
import { duration } from '@/theme/motion';

/** K の線（名前は前のマークの h のまま） */
export const MARK_H_PATH = 'M330 250 V774 M570 250 L350 515 L570 774';
export const MARK_PULSE_PATH = 'M640 610 H672 L712 512 L762 708 L800 610 H836';
export const MARK_H_WIDTH = 92;
export const MARK_PULSE_WIDTH = 40;
/** 線の太さと丸い端まで入れた外形（x 284〜856、y 204〜820）に、少し余白を足したもの */
export const MARK_VIEWBOX = { x: 274, y: 194, width: 592, height: 636 } as const;

/** 心拍の線の長さ（path の各区間の長さの合計） */
export const PULSE_LENGTH = 32 + Math.hypot(40, 98) + Math.hypot(50, 196) + Math.hypot(38, 98) + 36;
/** 隠すときに、丸い端（太さの半分）も見えないように線の外へ出す分 */
const CAP = MARK_PULSE_WIDTH / 2;
/** 線の点線の形：描く分と、隠す分（前後の丸い端が線にかからない長さ） */
export const PULSE_DASH = [PULSE_LENGTH, PULSE_LENGTH + CAP * 2] as const;

/** マークの高さ（dp）。中身はこの分と上下の余白だけ下がる */
export const MARK_SIZE = 40;
/** 同期のあいだ、マークの場所をあけるために中身を下げる量（dp） */
export const MARK_SPACE = 56;
/** 出てくるとき、マークが上から下りてくる量（dp） */
export const MARK_DROP = 24;
/** 同期のあいだの、心拍の線と h の光の周期 */
export const PULL_CYCLE_MS = 900;
/** しきい値まで来たときに、ポンと大きくなる量 */
export const POP_SCALE = 1.12;

const clamp01 = (v: number) => {
  'worklet';
  return Math.min(1, Math.max(0, v));
};

/** 引っぱった量（0〜1。1 がしきい値）。しきい値まで来たら、同期すると決まる（マークがポンとはずむ） */
export function reachedThreshold(progress: number): boolean {
  'worklet';
  return progress >= 1;
}

/** 引っぱった量に合わせて、マークが上から下りてきて、薄い状態から濃くなる */
export function markPose(progress: number): { translateY: number; opacity: number } {
  'worklet';
  const p = clamp01(progress);
  return { translateY: MARK_DROP * (p - 1), opacity: 0.2 + 0.8 * p };
}

/** 引っぱった量に合わせて、心拍の線が左から描かれる（strokeDashoffset。0 で描き終わり、PULSE_DASH の後ろの分で何もない） */
export function pulseDrawOffset(progress: number): number {
  'worklet';
  return (PULSE_LENGTH + CAP) * (1 - clamp01(progress));
}

/**
 * 同期のあいだの心拍の線（t は 1 周期の中の 0〜1）。描き終わった形から始め、前半で左から消え、後半で左からまた描かれる。
 * t = 0 と t = 1 は同じ形（描き終わり）なので、くり返してもつなぎ目で跳ばない
 */
export function pulseLoopOffset(t: number): number {
  'worklet';
  const q = clamp01(t);
  return q < 0.5 ? -(PULSE_LENGTH + CAP) * (q * 2) : pulseDrawOffset(q * 2 - 1);
}

/**
 * 動き方。動きを減らす設定なら、線を描く・光る・はずむ動きはせず、マークを出して消すだけ（長さ 0）。
 * 出る 250ms（ease-out）、消える 150ms（ease-in、小さくなりながら）。はずむのは出るときだけ
 */
export function pullMarkMotion(reduced: boolean) {
  return reduced
    ? { enterMs: 0, exitMs: 0, loop: false, pop: false }
    : { enterMs: duration.enter, exitMs: duration.exit, loop: true, pop: true };
}

/** 消えるとき、マークはこの大きさまで小さくなる */
export const EXIT_SCALE = 0.6;
