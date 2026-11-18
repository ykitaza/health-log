/**
 * 和の動きの値（Figma「動き」の絵コンテ）。値だけを置き（Reanimated を読み込まない）、jest で確かめる。
 *
 * 共通のきまり：どの動きも一度だけ（くり返し・点滅・脈打つ動きはしない）。曲線はひとつ cubic-bezier(0.2, 0, 0, 1)。
 * OS の「アニメーションを減らす」がオンなら、すべて 150ms のフェードだけ。
 * 動かすのは不透明度・位置・ぼかし・切り抜きの幅だけ。大きさを変えるのは落款のみ
 */
export const EASE = [0.2, 0, 0, 1] as const;

export const motion = {
  /** 拾ったとき：墨がにじむ（不透明度 0 → 1、にじみ 6 → 0） */
  ink: { duration: 600, blurFrom: 6, bleedFrom: 0.18, bleedTo: 0 },
  /** 手札に入れたとき：栞がすべりこむ（上に 24px・不透明度 0 → 止まる） */
  bookmark: { duration: 400, dropFrom: -24 },
  /** 使えたとき：朱の印を押す（大きさ 125% → 100%・不透明度 0 → 1）。短い振動 1 回 */
  seal: { duration: 240, scaleFrom: 1.25, vibrateMs: 12 },
  /** 答えを見たとき：筆で書くように埋まる（切り抜きの幅 0 → 100%） */
  brush: { duration: 700 },
  /** 動きを減らす設定のとき */
  reducedFade: 150,
} as const;

/** 動きを減らす設定なら、長さを 150ms のフェードにする */
export function motionDuration(kind: keyof Omit<typeof motion, 'reducedFade'>, reduced: boolean): number {
  return reduced ? motion.reducedFade : motion[kind].duration;
}
