import { readLook } from './appearance';

/**
 * 見た目（HUD・クラシック）。このファイルが最初に評価されるときに 1 回だけ読み、色と飾りを決める。
 * 画面の StyleSheet.create や、色から作る定数は、このファイルを読み込んだあとに評価されるので、そのまま選んだ見た目になる。
 * 見た目を変えたら、アプリを開き直すと反映される
 */
export const look = readLook();
export const isHud = look === 'hud';

/**
 * HUD（今の見た目）の色。値は Figma の変数コレクション「hlog 改善案」に合わせる（括弧の中は Figma の変数の名前）。
 * 画面には色を直接書かず、colors の名前を使う
 */
export const HUD_COLORS = {
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

/** 色の名前の組（HUD とクラシックで同じ名前を持つ） */
export type Palette = { readonly [K in keyof typeof HUD_COLORS]: string };

/**
 * クラシック（飾りの少ない見た目）の色。Figma「ホーム（unslop 案）」（249:15091・250:15489）は、地と文字の灰色を HUD のまま残し、
 * 飾り（角の切り欠き・英字のラベル・光）だけをやめている。なので色の値は HUD と同じにする（名前の意味も同じ）。
 * 見た目の違いは deco と lbl、計器の色（CLASSIC_METER_COLORS）で出す
 */
export const CLASSIC_COLORS: Palette = { ...HUD_COLORS };

/** 画面で使う色。見た目（look）で HUD かクラシックを選ぶ */
export const colors: Palette = isHud ? HUD_COLORS : CLASSIC_COLORS;

/**
 * 見た目ごとの飾り。brackets は角の切り欠き、enLabels は英語の見出し（lbl）、trackedMono は字間を広げた英数字、
 * pulse は光の明滅、scan は走査線。HUD では全部あり、クラシックでは全部なし
 */
export const deco = { brackets: isHud, enLabels: isHud, trackedMono: isHud, pulse: isHud, scan: isHud } as const;

/** 見出しの文字：HUD は英語、クラシックは日本語 */
export const lbl = (en: string, ja: string) => (deco.enLabels ? en : ja);

/**
 * 筋肉の図（components/MuscleFigure）の地の色（Figma「部品案：筋肉の図」）。muscle は筋肉のパーツ、body は頭・首・手・足。
 * その日の部位の筋肉は colors.accent で塗る
 */
export const figureColors = {
  muscle: '#4A515D',
  body: '#343A44',
} as const;

/**
 * 回復マップの色のうち、テーマの色から取るもの（lib/recoveryMap.ts の RecoveryPalette。どの状態にどれを使うかは lib が決める）。
 * 回復中の暖色とケガの赤は lib/recoveryMap.ts の LOAD_ORANGE・LOAD_YELLOW・INJURY_RED。
 * 色が意味を持つので、見た目（look）によらず HUD の色にする
 */
export const recoveryPalette = {
  /** 回復済み（3D のホログラムの色。体の輪郭・皮膚の線・台もこの色。カードの枠と同じ緑） */
  rest: HUD_COLORS.accent,
  /**
   * 回復済み（2D の図の塗り）。平らに塗る 2D で明るい緑をいちめんに塗ると、回復中の暖色より目立つので、控えめな緑にする
   * （3D の緑は弱い縁の光なので、見た目の強さがそろう）
   */
  restFill: HUD_COLORS.accentMuted,
  /**
   * 空いている・まだ（3D の部品の光、凡例、一覧の印）。入力欄の枠と同じ灰色。
   * まだ（一度も鍛えていない）も、いちばん長く空いている部位として同じ灰色にする（緑だと回復済みと見分けられない）。見分けは文字（「まだ」と「空いて N日」）
   */
  idle: HUD_COLORS.outline,
  /** 空いている・まだ（2D の図の塗り）。色を付けない筋肉と同じ灰色 */
  idleFill: figureColors.muscle,
} as const;

/**
 * その日の体で鍛えた部位（記録のない日は前回の部位）の光の色：明るいミント（ふだんの体はアクセントの緑）。lib/dayBody.ts の dayBodyGlow の levels に使う。
 * 回復マップの色と並ぶので、見た目によらず HUD の色にする
 */
export const TRAINED_GLOW = HUD_COLORS.onAccentDark;

/** 入力のヒント（placeholder）の色 */
export const placeholderColor = colors.sub;

/**
 * 部位の量（セット数。components/PartVolumeCard）の色。青〜水色の濃淡で、緑（回復済み）・黄と橙（回復中）・赤（ケガ）は使わない。
 * empty は 0 セット（図の筋肉の地と同じ灰色）、steps は 1〜4・5〜9・10〜14・15〜20・21 以上の 5 段（段が上がるほど明るい。lib/partVolume.ts の volumeLevel）。
 * toward は目安に近づいた差の文字。遠ざかった・同じ差は colors.sub
 */
export const volumePalette = {
  empty: figureColors.muscle,
  steps: ['#2A78AD', '#3A9AD9', '#63BDF5', '#9DD8FF', '#DDF2FF'],
  toward: '#63BDF5',
} as const;

/**
 * ホームの計器の盤（刷新 A）の色。ミント 1 色の濃淡（LOG の負荷量の 3 段・PFC のドーナツ）と、空のマス・輪の地。
 * mint1 の上の文字は colors.text、mint2・mint3 の上の文字は colors.onAccent（どちらも 4.5:1 以上）。いちばん薄い mint1 も、空のマス・カードの上で 3:1 以上
 */
export const HUD_METER_COLORS = {
  mint1: '#327D55',
  mint2: '#44A872',
  mint3: HUD_COLORS.accent,
  /** 空のマス・計器の棒の地 */
  empty: HUD_COLORS.input,
  /** 輪の空の目盛り・方眼の地の線 */
  ring: '#2A2F37',
  /** 角の切り欠き（ブラケット） */
  bracket: HUD_COLORS.accentMuted,
} as const;

export type MeterPalette = { readonly [K in keyof typeof HUD_METER_COLORS]: string };

/**
 * クラシックの計器の色（Figma「ホーム（unslop 案）」の方眼のマス）。LOG の負荷量の 3 段は落ち着いた緑の濃淡で、どの段の上の文字も colors.text（4.5:1 以上）。
 * いちばん薄い mint1 は空のマスと色だけでは 3:1 に届かないので、鍛えた日はマスの部位の文字（胸・脚…）でも見分ける。
 * PFC は灰色の棒にするので、ここの濃淡は使わない。ring は輪のこれからの目盛り（過ぎた目盛りは colors.outline、今の週は colors.accent）
 */
export const CLASSIC_METER_COLORS: MeterPalette = {
  mint1: '#223A2D',
  mint2: '#2A5840',
  mint3: '#357A55',
  empty: CLASSIC_COLORS.input,
  ring: '#2A2F37',
  bracket: CLASSIC_COLORS.accentMuted,
};

/** クラシックのカードの細い枠（本文の色 #F3F5F7 の 8%。Figma「ホーム（unslop 案）」の枠）。Palette の外に置く（HUD の色の組は変えない） */
export const hairline = 'rgba(243,245,247,0.08)';

export const hudColors: MeterPalette = isHud ? HUD_METER_COLORS : CLASSIC_METER_COLORS;

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
/** 気をつけたいの帯の地（筋トレの入力画面の「直すこと」。caution.container より暗い。枠は caution.accent の 50%） */
export const cautionBand = '#211A0D';

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
