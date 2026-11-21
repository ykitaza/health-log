/**
 * ことばの見た目の値（Figma「ことば（試作）」の部品）。紙の地に墨の文字、アクセントは藍の1色だけ。
 *
 * 朱（seal）は「使えた」の落款のほかには使わない（docs/words-design.md の「動き」）。
 * 余白は 8px 刻み、押せるものは 48px 以上（KARADA の基本にそろえる）
 */
export const colors = {
  /** 紙の地 */
  paper: '#F6F3EC',
  /** 札・入力の地（紙より少し明るい） */
  card: '#FBFAF6',
  /** 墨（本文） */
  ink: '#24221F',
  /** 薄い墨（補足の文） */
  sub: '#6E6A62',
  /** 点線の枠・空いた枠だけに使う（紙の上で 3.3:1）。文字には使わない（文字・プレースホルダーは sub） */
  faint: '#8A857C',
  /** 罫線・枠 */
  line: '#E2DDD2',
  /** 選んだチップ・タブの地 */
  wash: '#E4E1DA',
  /** アクセント（藍） */
  accent: '#2B4570',
  /** 藍の上の文字 */
  onAccent: '#FFFFFF',
  /** 朱。落款だけに使う（ほかに使わない） */
  seal: '#B8432F',
  /** 墨のにじみ（保存の動き） */
  inkBleed: '#24221F',
  /** 断られた・失敗の文（朱は使わない。墨で書く） */
  danger: '#24221F',
  scrim: 'rgba(36, 34, 31, 0.35)',
} as const;

export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 32, xxxl: 48 } as const;
export const radius = { s: 8, m: 12, l: 16, pill: 999 } as const;
/** 押せるものの最小の大きさ */
export const TOUCH = 48;

/** 文字。表現（ことば）は明朝、画面の文字はゴシック */
export const fonts = {
  mincho: 'ShipporiMincho_400Regular',
  sans: 'NotoSansJP_400Regular',
  sansBold: 'NotoSansJP_700Bold',
} as const;
