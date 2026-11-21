import { readLook } from './appearance';
import { MATTE, MATTE_RECOVERED, matteRecovering } from './matte';

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
 * クラシック（紙の記録帳）の色。Figma「クラシック（大胆版）」の「クラシックの決まり」（252:17067）：地は生成りの紙、文字は墨、色は緑 1 つだけ。
 * 名前の意味は HUD と同じ。カードの塗りは作らないので card は紙と同じ色にし、まとまりは罫（line）で区切る。
 * accentDark は選んだチップ・バッジの地（薄い緑）。切り替えの選んだもの・主なボタンは墨の地に紙の文字（components/ui.tsx）。
 * danger と star は、一段上の面（input）の上でも 4.5:1 になるよう、決まりの赤（#C2302A）・黄土（#866300）より少し濃くした
 */
export const CLASSIC_COLORS: Palette = {
  bg: '#F5F2EA',
  card: '#F5F2EA',
  input: '#EAE5DA',
  line: '#DAD4C8',
  outline: '#857D71',
  text: '#1B1916',
  sub: '#575047',
  accent: '#1E6B47',
  onAccent: '#F5F2EA',
  accentDark: '#DDE8DF',
  onAccentDark: '#123F2A',
  accentMuted: '#857D71',
  inverseAccent: '#8FD9B0',
  danger: '#B42B25',
  dangerDark: '#F6E0DC',
  onDangerDark: '#8E1F1A',
  star: '#7D5C00',
  disabled: '#8C8478',
  disabledContainer: '#E3DED3',
  scrim: 'rgba(27,25,22,0.45)',
};

/** クラシックの、Palette の外の色（HUD の色の組は変えない）。muted は曜日・出典・メタの控えめな文字（本文には使わない） */
export const paper = { muted: '#6A6257' } as const;

/** 画面で使う色。見た目（look）で HUD かクラシックを選ぶ */
export const colors: Palette = isHud ? HUD_COLORS : CLASSIC_COLORS;

/**
 * 見た目ごとの飾り。brackets は角の切り欠き、enLabels は英語の見出し（lbl）、trackedMono は字間を広げた英数字、
 * pulse は光の明滅、scan は走査線。HUD では全部あり、クラシックでは全部なし
 */
export const deco = { brackets: isHud, enLabels: isHud, trackedMono: isHud, pulse: isHud, scan: isHud } as const;

/** 見出しの文字：HUD は英語、クラシックは日本語 */
export const lbl = (en: string, ja: string) => (deco.enLabels ? en : ja);

/** ケガの番号の見せ方。HUD は「INJ-01」、クラシックは「ケガ 1」（lib/injuries の injuryNumbers の文字から） */
export const injuryNo = (no: string) => (deco.enLabels ? no : no.replace(/^INJ-0*(\d+)$/, 'ケガ $1'));

/**
 * 筋肉の図（components/MuscleFigure）の地の色（Figma「部品案：筋肉の図」）。muscle は筋肉のパーツ、body は頭・首・手・足。
 * その日の部位の筋肉は colors.accent で塗る
 */
export const HUD_FIGURE_COLORS = {
  muscle: '#4A515D',
  body: '#343A44',
} as const;

/**
 * クラシックの筋肉の図：紙の上の石膏の色（3D のつや消しの体に光が当たった色。theme/matte.ts の石膏 #EAE3D4 は、光の下で #D1C7B1〜#DDD2BA に見える）。
 * 筋肉は頭・手・足より一段濃い
 */
export const CLASSIC_FIGURE_COLORS: { readonly [K in keyof typeof HUD_FIGURE_COLORS]: string } = {
  muscle: '#D3C9B5',
  body: '#DFD6C3',
};

export const figureColors = isHud ? HUD_FIGURE_COLORS : CLASSIC_FIGURE_COLORS;

/**
 * 回復マップの色のうち、テーマの色から取るもの（lib/recoveryMap.ts の RecoveryPalette。どの状態にどれを使うかは lib が決める）。
 * 回復中の暖色とケガの赤は lib/recoveryMap.ts の LOAD_ORANGE・LOAD_YELLOW・INJURY_RED。
 * 意味は見た目によらず同じ。HUD は暗い地の上の明るい色、クラシックは紙の上の濃い色（「クラシックの決まり」の意味の色）
 */
export const HUD_RECOVERY_PALETTE = {
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
  idleFill: HUD_FIGURE_COLORS.muscle,
} as const;

/**
 * クラシックの回復マップの色（紙の上。#334「藍の一色」：色は回復中の藍とケガの赤だけ。緑は使わない）。
 * 回復中は淡い藍から濃い藍へ明るさで混ぜる（ramp。theme/matte.ts。図の塗り・一覧の印と文字・札で同じ色）、
 * 回復済みは図の塗りが石膏のまま・一覧の印と文字が補足の墨、空いている・まだは枠の灰色と石膏の筋肉の色
 */
export const CLASSIC_RECOVERY_PALETTE: { readonly [K in keyof typeof HUD_RECOVERY_PALETTE]: string } & { readonly ramp: (k: number) => string } = {
  rest: CLASSIC_COLORS.sub,
  restFill: MATTE_RECOVERED,
  idle: CLASSIC_COLORS.outline,
  idleFill: CLASSIC_FIGURE_COLORS.muscle,
  ramp: matteRecovering,
};

export const recoveryPalette = isHud ? HUD_RECOVERY_PALETTE : CLASSIC_RECOVERY_PALETTE;

/**
 * その日の体で鍛えた部位（記録のない日は前回の部位）の光の色：明るいミント（ふだんの体はアクセントの緑）。lib/dayBody.ts の dayBodyGlow の levels に使う。
 * 3D の体の色は lib/bodyColors.ts が見た目ごとに選ぶ（ホログラムはいつもこの色）
 */
export const TRAINED_GLOW = HUD_COLORS.onAccentDark;

/** 入力のヒント（placeholder）の色 */
export const placeholderColor = colors.sub;

/**
 * 部位の量（セット数。components/PartVolumeCard）の色。青〜水色の濃淡で、緑（回復済み）・黄と橙（回復中）・赤（ケガ）は使わない。
 * empty は 0 セット（図の筋肉の地と同じ灰色）、steps は 1〜4・5〜9・10〜14・15〜20・21 以上の 5 段（段が上がるほど明るい。lib/partVolume.ts の volumeLevel）。
 * toward は目安に近づいた差の文字。遠ざかった・同じ差は colors.sub
 */
export const HUD_VOLUME_PALETTE = {
  empty: HUD_FIGURE_COLORS.muscle,
  steps: ['#2A78AD', '#3A9AD9', '#63BDF5', '#9DD8FF', '#DDF2FF'],
  toward: '#63BDF5',
} as const;

/**
 * クラシックの部位の量の色（紙の上）：石膏の色から青（#1F63A0）へ、段が上がるほど濃い（3D のつや消しの体と同じ段。lib/bodyColors.ts）。
 * 薄い段は紙と近いので、見本には枠を付け、部位の名前とセット数の文字で見分ける
 */
export const CLASSIC_VOLUME_PALETTE: { empty: string; steps: readonly string[]; toward: string } = {
  empty: CLASSIC_FIGURE_COLORS.muscle,
  steps: MATTE.volume.slice(1),
  toward: '#1F63A0',
};

export const volumePalette = isHud ? HUD_VOLUME_PALETTE : CLASSIC_VOLUME_PALETTE;

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
 * クラシックの計器の色（「クラシックの決まり」の直近 4 週の墨の濃淡）。1 段・2 段の上の文字は墨、3 段の上の文字は紙の色（components/homeHud.tsx の onCell）。
 * 空のマスは紙に罫の枠。1 段は空のマスと色が近いので、罫の枠と部位の文字（胸・脚…）で見分ける。
 * ring は棒の地・フェーズの輪のこれからの目盛り（罫の色）
 */
export const CLASSIC_METER_COLORS: MeterPalette = {
  mint1: '#E6E0D3',
  mint2: '#CBC2B2',
  mint3: '#5F574C',
  empty: CLASSIC_COLORS.bg,
  ring: CLASSIC_COLORS.line,
  bracket: CLASSIC_COLORS.outline,
};

/** クラシックの罫（行の区切り・帳の縦線）。Palette の外に置く（HUD の色の組は変えない） */
export const hairline = isHud ? 'rgba(243,245,247,0.08)' : CLASSIC_COLORS.line;

export const hudColors: MeterPalette = isHud ? HUD_METER_COLORS : CLASSIC_METER_COLORS;

/**
 * レポートの調子（overall_tone・highlights の tone）の色（Figma の color/tone-good・tone-good-container など）。
 * accent はアイコン・ラベル・帯の色、container は面の色、onToneSub は面の上の補足の文字（color/on-tone-variant）。どれも文字が面に対して 4.5:1 以上（lib/__tests__/contrast.test.ts）。
 * 気をつけたいは赤を使わず琥珀色にする（責める感じにしない）
 */
export const HUD_TONE_COLORS = {
  good: { accent: '#5BE49B', container: '#173A28' },
  steady: { accent: '#A9BCCF', container: '#1F2833' },
  caution: { accent: '#F5B54A', container: '#3A2A0C' },
} as const;
type ToneSet = { readonly [K in keyof typeof HUD_TONE_COLORS]: { readonly accent: string; readonly container: string } };
/** クラシックの調子の色（「クラシックの決まり」の紙の上の色。面は紙に薄く混ぜた色） */
export const CLASSIC_TONE_COLORS: ToneSet = {
  good: { accent: '#1E6B47', container: '#E1EBE3' },
  steady: { accent: '#4A5B6C', container: '#E5E8EA' },
  caution: { accent: '#8A5600', container: '#F1E6D2' },
};
export const toneColors: ToneSet = isHud ? HUD_TONE_COLORS : CLASSIC_TONE_COLORS;
export const HUD_ON_TONE_SUB = '#C8CED8';
export const CLASSIC_ON_TONE_SUB = CLASSIC_COLORS.sub;
export const onToneSub = isHud ? HUD_ON_TONE_SUB : CLASSIC_ON_TONE_SUB;
/** 気をつけたいの帯の地（筋トレの入力画面の「直すこと」。caution.container より暗い。枠は caution.accent の 50%）。クラシックは紙に薄い黄土 */
export const HUD_CAUTION_BAND = '#211A0D';
export const CLASSIC_CAUTION_BAND = '#F3EADA';
export const cautionBand = isHud ? HUD_CAUTION_BAND : CLASSIC_CAUTION_BAND;

/**
 * 意味を持つ色（意味は見た目によらず同じ。クラシックは紙の上で読める濃さ）。load は回復中の橙・黄（lib/recoveryMap の LOAD_ORANGE・LOAD_YELLOW）、
 * injury は直している途中のケガの赤、pfc は食事の P・F・C の色
 */
export const HUD_LOAD_PALETTE = { orange: '#FF8A3D', yellow: '#F5C94A', injury: '#FF5A4F' } as const;
/** クラシック：濃い橙・黄土・赤（「クラシックの決まり」の紙の上の色） */
export const CLASSIC_LOAD_PALETTE: { readonly [K in keyof typeof HUD_LOAD_PALETTE]: string } = { orange: '#B04A0C', yellow: '#866300', injury: '#C2302A' };
export const loadPalette = isHud ? HUD_LOAD_PALETTE : CLASSIC_LOAD_PALETTE;
export const pfcPalette = isHud
  ? { p: HUD_COLORS.accent, f: HUD_COLORS.star, c: '#6FA8FF' }
  : { p: CLASSIC_COLORS.accent, f: CLASSIC_COLORS.star, c: '#1F63A0' };

/**
 * 飾りの色（見た目で変わる。意味は持たない）。HUD は今の値。クラシックは紙の一段上の面と罫にして、色は緑 1 色だけにする。
 * Palette の外に置く（HUD の色の組は変えない）
 */
/** 選んだ・今の状態のパネルの地（フェーズの選択など。HUD は深い緑） */
export const accentSurface = isHud ? '#0F1C15' : CLASSIC_COLORS.input;
/** ケガの画面の方眼の線 */
export const gridLine = isHud ? '#1C2A23' : CLASSIC_COLORS.line;
/** 回復マップの一覧で選んだ行の地 */
export const rowOnFill = isHud ? 'rgba(91,228,155,0.08)' : 'rgba(27,25,22,0.06)';
/** 部位のバランスの直近の線（本文の色の 85%） */
export const recentStroke = isHud ? 'rgba(243,245,247,0.85)' : 'rgba(27,25,22,0.85)';
/** 3D の体の上に重ねる札・吹き出しの地（体の上でも読めるよう、地の色を半分すかす） */
export const overlayFill = isHud ? 'rgba(14,16,19,0.8)' : 'rgba(245,242,234,0.88)';

/** 部位の色（グラフ用）。部位の並び順で選ぶ。クラシックは紙の上で 3:1 以上の濃い色 */
export const HUD_PART_COLORS = ['#5BE49B', '#6FA8FF', '#B98CFF', '#F5A524', '#FF8FB1', '#4DD4E6', '#E6D85B', '#FF7A59'];
export const CLASSIC_PART_COLORS = ['#1E6B47', '#1F63A0', '#6B4BA8', '#866300', '#B03A6A', '#0E7383', '#6E6A00', '#B04A0C'];
export const PART_COLORS = isHud ? HUD_PART_COLORS : CLASSIC_PART_COLORS;
export const partColor = (index: number) => PART_COLORS[((index % PART_COLORS.length) + PART_COLORS.length) % PART_COLORS.length];

/**
 * 3D の体の見せ方。クラシックは紙の上のつや消しの体（石膏の像）にする。MATTE_BODY を false にすると、クラシックでも前のホログラム
 * （暗い舞台の上の光る体）に戻す（実機で描けない・見づらいときの戻し方。値を変えて配るだけでよい）
 */
export const MATTE_BODY = true;
/** つや消しの体を使うか（クラシックで、MATTE_BODY が true のとき） */
export const matteBody = !isHud && MATTE_BODY;
/**
 * 3D の体を載せる面の色。HUD とつや消しの体は画面の色のまま。クラシックでホログラムに戻したとき（MATTE_BODY が false）は、
 * 光る体が紙の上で消えるので、体の面だけを HUD の暗い地にし、札の文字も HUD の色にする
 */
export const stageColors: Palette = isHud || matteBody ? colors : HUD_COLORS;

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
