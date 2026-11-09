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
  /** 行き帰りがあるもの（切り替えの印、画面の横すべり、下のタブの画面の切り替え） */
  toggle: 250,
  /** 文字の差し替え（数字の桁） */
  text: 150,
  /** 下のタブの選んだ印が、まん中から広がって現れる（消えるのは exit） */
  indicator: 200,
  /** リストの1行が現れる */
  listItem: 180,
  /** 入力の間違いで欄が揺れる（全体） */
  shake: 280,
  /** グラフの線が左から右へ描かれる。大きな数字の数え上げも同じ長さ */
  draw: 600,
  /** グラフの棒が1本、下から伸びる */
  barGrow: 400,
} as const;

/** グラフの棒を順に伸ばすときの、ずらしの全体（最後の棒が伸び始めるまで） */
export const BAR_STAGGER_TOTAL_MS = 300;

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

/**
 * わざと待つ長さ（80ms まで）。2つの動きを順に見せるとき（レポートの帯のあとに調子のアイコンがポンと出る、
 * 指標のタイルが出たあとに変化の矢印が出る）に使う
 */
export const HOLD_MS = 80;

/** 動きを減らす設定なら 0 */
export function motionDuration(ms: number, reduced: boolean): number {
  return reduced ? 0 : ms;
}

/** 下のタブの印の長さ。選ぶと広がって現れ（indicator）、選ばなくなると消える（exit）。動きを減らす設定なら 0 */
export function tabIndicatorDuration(selected: boolean, reduced: boolean): number {
  return motionDuration(selected ? duration.indicator : duration.exit, reduced);
}

/** i 番目を出すまでの待ち。最後の行が出終わるまでを STAGGER_TOTAL_MS に収める（それより後ろの行は一緒に出す） */
export function staggerDelay(index: number, reduced: boolean): number {
  if (reduced || index <= 0) return 0;
  return Math.min(index * STAGGER_MS, STAGGER_TOTAL_MS - duration.listItem);
}

/**
 * n 本の棒の i 本目が伸び始めるまでの待ち。1本につき 40ms ずらすが、最後の棒でも BAR_STAGGER_TOTAL_MS までに収める
 * （本数が多いときは、ずらしを小さくする）
 */
export function barDelay(index: number, count: number, reduced: boolean): number {
  if (reduced || count <= 1 || index <= 0) return 0;
  const step = Math.min(STAGGER_MS, BAR_STAGGER_TOTAL_MS / (count - 1));
  return Math.min(index, count - 1) * step;
}
