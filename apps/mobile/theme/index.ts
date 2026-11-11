/**
 * 色。値は Figma の変数コレクション「hlog 改善案」に合わせる（括弧の中は Figma の変数の名前）。
 * 画面には色を直接書かず、ここの名前を使う
 */
export const colors = {
  /** 画面の地（color/background） */
  bg: '#0E1013',
  /** カード・シート・下のタブ（color/surface） */
  card: '#181B20',
  /** 一段明るい面：入力欄の地、ダイアログ、小さなカード（color/surface-high） */
  input: '#22262D',
  /** 区切りの線・飾りの枠（color/outline-variant）。押せるものや入力欄の境目には outline を使う */
  line: '#2C313A',
  /** 入力欄・チップ・切り替えの枠（color/outline、カードの上で 3.7:1） */
  outline: '#6E7580',
  /** 本文（color/on-surface） */
  text: '#F3F5F7',
  /** 補足の文字・入力のヒント（color/on-surface-variant、カードの上で 6.6:1） */
  sub: '#9AA1AD',
  /** 主な色（color/primary） */
  accent: '#5BE49B',
  /** accent の上の文字（color/on-primary） */
  onAccent: '#08130D',
  /** 選んだもの・バッジの地（color/primary-container） */
  accentDark: '#173A28',
  /** accentDark の上の文字（color/on-primary-container） */
  onAccentDark: '#A6F2C8',
  /** 前の週の棒など、控えめな緑（color/primary-muted、input の上で 3:1 以上） */
  accentMuted: '#3F8F63',
  /** 明るい地（スナックバー）の上の緑の文字（color/inverse-primary） */
  inverseAccent: '#1B6B43',
  /** エラー・消す（color/error） */
  danger: '#F4666B',
  /** エラーの地（color/error-container） */
  dangerDark: '#3A1719',
  /** dangerDark の上の文字（color/on-error-container） */
  onDangerDark: '#FFB3B5',
  star: '#F5A524',
  /** 使えないもののアイコン・文字（color/disabled。text を card に 38% で混ぜた色） */
  disabled: '#6B6E72',
  /** 使えないボタンの地（color/disabled-container） */
  disabledContainer: '#32353A',
  /** ダイアログ・シートの後ろを暗くする */
  scrim: 'rgba(0,0,0,0.6)',
} as const;

/**
 * 記録で育つ形（components/growth）の色。点は training を主に、中心に近い部分は sleep。
 * 衛星は内側から training（丸）・food（ひし形）・sleep（輪）
 */
export const growthColors = {
  training: '#5EE6A0',
  food: '#5ED4E6',
  sleep: '#B79CF0',
} as const;

/** 入力のヒント（placeholder）の色 */
export const placeholderColor = colors.sub;

/**
 * レポートの調子（overall_tone・highlights の tone）の色（Figma の color/tone-good・tone-good-container など）。
 * accent はアイコン・ラベル・帯の色、container は面の色、onToneSub は面の上の補足の文字（color/on-tone-variant）。どれも文字が面に対して 4.5:1 以上（lib/__tests__/contrast.test.ts）。
 * 気をつけたいは赤を使わず琥珀色にする（責める感じにしない）
 */
export const toneColors = {
  good: { accent: '#5BE49B', container: '#173A28' },
  steady: { accent: '#A9BCCF', container: '#1F2833' },
  caution: { accent: '#F5B54A', container: '#3A2A0C' },
} as const;
export const onToneSub = '#C8CED8';

/** 部位の色（グラフ用）。部位の並び順で選ぶ */
export const PART_COLORS = ['#5BE49B', '#6FA8FF', '#B98CFF', '#F5A524', '#FF8FB1', '#4DD4E6', '#E6D85B', '#FF7A59'];
export const partColor = (index: number) => PART_COLORS[((index % PART_COLORS.length) + PART_COLORS.length) % PART_COLORS.length];

export const fonts = {
  regular: 'NotoSansJP_400Regular',
  bold: 'NotoSansJP_700Bold',
  num: 'BarlowCondensed_600SemiBold',
  numBold: 'BarlowCondensed_700Bold',
} as const;

/**
 * 文字の段階（Figma の文字スタイル「改善案/…」、M3 の type scale）。
 * Figma の Medium（500）は、読み込んでいるフォント（400・700）に合わせて、ラベルは太字にする
 */
export const type = {
  headlineS: { size: 24, lineHeight: 32, bold: true },
  titleL: { size: 22, lineHeight: 28, bold: true },
  titleM: { size: 16, lineHeight: 24, bold: true },
  titleS: { size: 14, lineHeight: 20, bold: true },
  bodyL: { size: 16, lineHeight: 24, bold: false },
  bodyM: { size: 14, lineHeight: 20, bold: false },
  bodyS: { size: 12, lineHeight: 16, bold: false },
  labelL: { size: 14, lineHeight: 20, bold: true },
  labelM: { size: 12, lineHeight: 16, bold: true },
  labelS: { size: 11, lineHeight: 16, bold: true },
  numDisplay: { size: 48, lineHeight: 56, bold: true, num: true },
  numL: { size: 32, lineHeight: 40, bold: true, num: true },
  numM: { size: 22, lineHeight: 28, bold: false, num: true },
  numS: { size: 18, lineHeight: 24, bold: false, num: true },
} as const;
export type TypeName = keyof typeof type;

/** 角の丸み（Figma の radius/…）。dialog は M3 の basic dialog の 28 */
export const radius = { xs: 4, s: 8, m: 12, l: 16, dialog: 28, full: 999, card: 16, input: 8, pill: 999 } as const;

/** 余白（Figma の space/…、8dp の刻み）。screen は画面の左右 */
export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 32, screen: 16 } as const;

/** 押せるものの大きさ（Figma の size/touch）と、アイコンボタンの見た目の大きさ */
export const size = { touch: 48, iconButton: 40, icon: 24, topBar: 64, fab: 56, buttonL: 56, buttonM: 48 } as const;
