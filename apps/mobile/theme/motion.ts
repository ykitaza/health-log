/**
 * 動きの長さ・イージング・ずらし。値だけを置き（Reanimated を読み込まない）、jest で確かめる。
 * 決まり：開くものは閉じるものより少し長く。行き帰りがあるものは同じ長さ。はね返るのは出てくるときだけ。
 * 動きを減らす設定（Android の「アニメーションを削除」）がオンなら、長さもずらしも 0 にして、すぐに結果を出す
 */
export const duration = {
  /** 押して縮む */
  press: 100,
  /** 出てくる（シート、バッジ、チェック、カレンダーの丸、棒が伸びる） */
  enter: 250,
  /** 閉じる・消える */
  exit: 150,
  /** 行き帰りがあるもの（切り替えの印、画面の横すべり） */
  toggle: 250,
  /** 文字の差し替え（数字の桁）、タブの切り替え */
  text: 150,
  /** リストの1行が現れる */
  listItem: 180,
  /** 入力の間違いで欄が揺れる（全体） */
  shake: 280,
} as const;

/** 出てくる動きのイージング（なめらかな ease-out）。Easing.bezier(...EASE_OUT) で使う */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;
/** 閉じる・消える動きのイージング（ease-in） */
export const EASE_IN = [0.4, 0, 1, 1] as const;

/** 押したときの縮み */
export const PRESS_SCALE = 0.97;

/** はね返り（出てくるときだけ使う）。pop は少し行き過ぎて戻る、release は押して離したときの軽い戻り */
export const springs = {
  pop: { damping: 11, stiffness: 320, mass: 0.7 },
  release: { damping: 16, stiffness: 380, mass: 0.6 },
} as const;

/** 並んだものを順に出すときの、1つあたりのずらしと全体の長さ */
export const STAGGER_MS = 40;
export const STAGGER_TOTAL_MS = 300;

/** 動きを減らす設定なら 0 */
export function motionDuration(ms: number, reduced: boolean): number {
  return reduced ? 0 : ms;
}

/** i 番目を出すまでの待ち。最後の行が出終わるまでを STAGGER_TOTAL_MS に収める（それより後ろの行は一緒に出す） */
export function staggerDelay(index: number, reduced: boolean): number {
  if (reduced || index <= 0) return 0;
  return Math.min(index * STAGGER_MS, STAGGER_TOTAL_MS - duration.listItem);
}
