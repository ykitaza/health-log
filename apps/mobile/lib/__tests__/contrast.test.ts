import { contrastRatio } from '../contrast';
import {
  CLASSIC_CAUTION_BAND, CLASSIC_COLORS, CLASSIC_LOAD_PALETTE, CLASSIC_METER_COLORS, CLASSIC_ON_TONE_SUB, CLASSIC_PART_COLORS, CLASSIC_TONE_COLORS,
  CLASSIC_VOLUME_PALETTE, colors, HUD_CAUTION_BAND, HUD_COLORS, HUD_METER_COLORS, HUD_ON_TONE_SUB, HUD_PART_COLORS, HUD_TONE_COLORS,
  HUD_VOLUME_PALETTE, MeterPalette, Palette, paper,
} from '@/theme';

type Tones = Record<'good' | 'steady' | 'caution', { accent: string; container: string }>;
type Volume = { empty: string; steps: readonly string[]; toward: string };
type Look = { colors: Palette; meter: MeterPalette; tones: Tones; onToneSub: string; cautionBand: string; parts: string[]; volume: Volume };

/** 見た目ごとの色の組（HUD は今の見た目、クラシックは Figma「クラシック（大胆版）」の「クラシックの決まり」の値） */
const SETS: Record<'HUD' | 'クラシック', Look> = {
  HUD: { colors: HUD_COLORS, meter: HUD_METER_COLORS, tones: HUD_TONE_COLORS, onToneSub: HUD_ON_TONE_SUB, cautionBand: HUD_CAUTION_BAND, parts: HUD_PART_COLORS, volume: HUD_VOLUME_PALETTE },
  クラシック: {
    colors: CLASSIC_COLORS, meter: CLASSIC_METER_COLORS, tones: CLASSIC_TONE_COLORS, onToneSub: CLASSIC_ON_TONE_SUB, cautionBand: CLASSIC_CAUTION_BAND,
    parts: CLASSIC_PART_COLORS, volume: CLASSIC_VOLUME_PALETTE,
  },
};
const LOOKS: [string, Palette, MeterPalette][] = [
  ['HUD', HUD_COLORS, HUD_METER_COLORS],
  ['クラシック', CLASSIC_COLORS, CLASSIC_METER_COLORS],
];
const LOOK_SETS = Object.entries(SETS) as [string, Look][];

// 文字は背景に対して 4.5:1 以上（Android のアクセシビリティの指針、WCAG 1.4.3）。
// 文字でないもの（アイコン、グラフの線）は 3:1 以上（WCAG 1.4.11）
describe('コントラスト比の計算', () => {
  test('白と黒は 21、同じ色は 1', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#5BE49B', '#5BE49B')).toBe(1);
  });
  test('順番によらない', () => {
    expect(contrastRatio(colors.sub, colors.card)).toBe(contrastRatio(colors.card, colors.sub));
  });
});

describe.each(LOOKS)('theme の色の組み合わせ（画面で文字に使っているもの）：%s', (_, colors) => {
  const text: [keyof Palette, keyof Palette][] = [
    // 本文・補足・強調・エラー・注意の文字と、画面・カード・入力欄の背景
    ...(['text', 'sub', 'accent', 'danger', 'star'] as const).flatMap((fg) =>
      (['bg', 'card'] as const).map((bg) => [fg, bg] as [keyof Palette, keyof Palette])),
    ['text', 'input'], ['sub', 'input'], ['accent', 'input'], ['star', 'input'],
    ['accent', 'accentDark'], ['text', 'accentDark'], // 選んだチップ、記録のある日、バッジ
    ['danger', 'dangerDark'], // 消すボタン、未来の日の知らせ
    ['onAccent', 'accent'], // 主なボタン、選んだ日
    ['onAccentDark', 'accentDark'], // 選んだチップ・切り替え、バッジ
    ['onDangerDark', 'dangerDark'], // エラーのバッジ、未来の日の知らせ
    ['danger', 'input'], // ダイアログの「外す」「消す」
    ['inverseAccent', 'text'], // スナックバーの「元に戻す」
    ['card', 'text'], // スナックバーの文（引っぱって同期の知らせ）
  ];
  for (const [fg, bg] of text) {
    test(`${fg} の文字 on ${bg} は 4.5:1 以上`, () => {
      expect(contrastRatio(colors[fg], colors[bg])).toBeGreaterThanOrEqual(4.5);
    });
  }

  // 文字でないもの：入力欄・チップの枠、使えないアイコン、前の週の棒
  test.each([
    ['outline', 'card'], ['outline', 'bg'], ['disabled', 'card'], ['accentMuted', 'input'],
  ] as [keyof Palette, keyof Palette][])('%s on %s は 3:1 以上', (fg, bg) => {
    expect(contrastRatio(colors[fg], colors[bg])).toBeGreaterThanOrEqual(3);
  });

});

describe.each(LOOK_SETS)('部位の色（グラフ）：%s', (_, { colors, parts }) => {
  test('カードの上で 3:1 以上', () => {
    for (const c of parts) expect(contrastRatio(c, colors.card)).toBeGreaterThanOrEqual(3);
  });
});

describe.each(LOOK_SETS)('レポートの調子の色：%s', (_, { colors, tones: toneColors, onToneSub, cautionBand }) => {
  const tones = Object.entries(toneColors);
  test.each(tones)('%s：ラベル・本文・補足の文字は、調子の面の上で 4.5:1 以上', (_, t) => {
    for (const fg of [t.accent, colors.text, onToneSub]) expect(contrastRatio(fg, t.container)).toBeGreaterThanOrEqual(4.5);
  });
  test.each(tones)('%s：調子の色（帯・ラベル・変化の文字）は、カードと画面の上で 4.5:1 以上', (_, t) => {
    for (const bg of [colors.card, colors.bg, colors.input]) expect(contrastRatio(t.accent, bg)).toBeGreaterThanOrEqual(4.5);
  });
  test.each(tones)('%s：調子のアイコンの丸（accent）の上の暗い印は 3:1 以上', (_, t) => {
    expect(contrastRatio(colors.onAccent, t.accent)).toBeGreaterThanOrEqual(3);
  });
  test('「直すこと」の帯：見出し・本文・補足の文字は、帯の地の上で 4.5:1 以上', () => {
    for (const fg of [toneColors.caution.accent, colors.text, onToneSub]) expect(contrastRatio(fg, cautionBand)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('ホームの計器の盤の色：HUD', () => {
  const [, colors, hudColors] = LOOKS[0];
  test('LOG のマスの文字（日付・部位の頭文字）は、塗りの上で 4.5:1 以上', () => {
    expect(contrastRatio(colors.text, hudColors.mint1)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.text, hudColors.empty)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.onAccent, hudColors.mint2)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.onAccent, hudColors.mint3)).toBeGreaterThanOrEqual(4.5);
  });
  test('いちばん薄い塗り（LOG の 1 段目・PFC の C）も、空のマスとカードの上で 3:1 以上（休みの日と見分ける）', () => {
    for (const bg of [hudColors.empty, colors.card]) expect(contrastRatio(hudColors.mint1, bg)).toBeGreaterThanOrEqual(3);
  });
});

// クラシックの直近 4 週は「クラシックの決まり」の墨の濃淡：1 段・2 段の上の文字は墨、3 段の上の文字は紙の色（components/homeHud.tsx の onCell）。
// 空のマスは紙に罫の枠、1 段は空のマスと色が近い（1.18:1）ので、罫の枠と部位の文字（胸・脚…）で見分ける
describe('ホームの計器の盤の色：クラシック', () => {
  const [, colors, hudColors] = LOOKS[1];
  test('直近 4 週のマスの文字（日付・部位の文字）は、空・1 段・2 段の上は墨、3 段の上は紙の色で 4.5:1 以上', () => {
    for (const bg of [hudColors.empty, hudColors.mint1, hudColors.mint2]) expect(contrastRatio(colors.text, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.bg, hudColors.mint3)).toBeGreaterThanOrEqual(4.5);
  });
  test('1 段から上のとなりの段どうしは 1.3:1 以上、3 段は 2 段と紙の上で 3:1 以上。空のマスと 1 段は 1.15:1 以上（罫の枠と文字でも見分ける）', () => {
    expect(contrastRatio(hudColors.mint2, hudColors.mint1)).toBeGreaterThanOrEqual(1.3);
    expect(contrastRatio(hudColors.mint3, hudColors.mint2)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(hudColors.mint3, colors.bg)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(hudColors.mint1, hudColors.empty)).toBeGreaterThanOrEqual(1.15);
  });
  test('控えめな文字（曜日・出典・メタ）は紙と一段上の面の上で 4.5:1 以上', () => {
    for (const bg of [colors.bg, colors.input]) expect(contrastRatio(paper.muted, bg)).toBeGreaterThanOrEqual(4.5);
  });
  test('意味の色（回復中の橙・黄土・ケガの赤）は、紙の上で文字として 4.5:1 以上', () => {
    for (const c of Object.values(CLASSIC_LOAD_PALETTE)) expect(contrastRatio(c, colors.bg)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('部位の量の色：HUD', () => {
  const { colors, volume } = SETS.HUD;
  const levels = [volume.empty, ...volume.steps];
  test('どの段も、カードの上で 3:1 以上', () => {
    for (const c of volume.steps) expect(contrastRatio(c, colors.card)).toBeGreaterThanOrEqual(3);
  });
  test('となりの段どうしは、色の差が 1.2:1 以上（見分けがつく。0 と 1 は色相でも分かれる）', () => {
    for (let i = 1; i < levels.length; i++) expect(contrastRatio(levels[i], levels[i - 1])).toBeGreaterThanOrEqual(1.2);
  });
  test('目安に近づいた差の文字は、カードの上で 4.5:1 以上', () => {
    expect(contrastRatio(volume.toward, colors.card)).toBeGreaterThanOrEqual(4.5);
  });
});

// クラシックの部位の量は 3D のつや消しの体と同じ段（石膏 → 青。theme/matte.ts）。薄い段は紙と近いので、見本には枠を付け、
// 部位の名前とセット数の文字でも見分ける。0 と 1 は色相（暖かい石膏と青）で分かれる
describe('部位の量の色：クラシック', () => {
  const { colors, volume } = SETS.クラシック;
  test('1 段から上のとなりの段どうしは、色の差が 1.2:1 以上', () => {
    for (let i = 1; i < volume.steps.length; i++) expect(contrastRatio(volume.steps[i], volume.steps[i - 1])).toBeGreaterThanOrEqual(1.2);
  });
  test('いちばん濃い 2 段は紙の上で 3:1 以上', () => {
    for (const c of volume.steps.slice(-2)) expect(contrastRatio(c, colors.card)).toBeGreaterThanOrEqual(3);
  });
  test('目安に近づいた差の文字は、カードの上で 4.5:1 以上', () => {
    expect(contrastRatio(volume.toward, colors.card)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('クラシックの共通の部品の色（components/ui・Field・MonthCalendar・Screen）', () => {
  const c = CLASSIC_COLORS;
  /** 紙の上に墨を a の濃さで重ねた色（rowOnFill の rgba(27,25,22,a) を、紙の上で見た色） */
  const inkOnPaper = (a: number) => {
    const p = [0xf5, 0xf2, 0xea], k = [0x1b, 0x19, 0x16];
    return `#${p.map((v, i) => Math.round(v * (1 - a) + k[i] * a).toString(16).padStart(2, '0')).join('')}`;
  };
  test('選んだ日（カレンダー）・選んだチップ・切り替えは、墨の地に紙の文字で 4.5:1 以上', () => {
    expect(contrastRatio(c.bg, c.text)).toBeGreaterThanOrEqual(4.5);
  });
  test('今日でない日の知らせ（塗らない）は、紙の上の墨・赤の文字で 4.5:1 以上', () => {
    expect(contrastRatio(c.text, c.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c.danger, c.bg)).toBeGreaterThanOrEqual(4.5);
  });
  test('記入欄の下の罫（outline）と記録のある日の緑の点は、紙の上で 3:1 以上（文字でない印）', () => {
    expect(contrastRatio(c.outline, c.bg)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(c.accent, c.bg)).toBeGreaterThanOrEqual(3);
  });
  test('完了したセットの行・着いた行の薄い墨の地（6%）の上で、本文と補足の文字は 4.5:1 以上', () => {
    for (const fg of [c.text, c.sub]) expect(contrastRatio(fg, inkOnPaper(0.06))).toBeGreaterThanOrEqual(4.5);
  });
  test('カレンダーの曜日（補足の色）は紙の上で 4.5:1 以上', () => {
    expect(contrastRatio(c.sub, c.bg)).toBeGreaterThanOrEqual(4.5);
  });
});
