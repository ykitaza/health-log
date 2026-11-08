export const colors = {
  bg: '#0E1013',
  card: '#181B20',
  input: '#22262D',
  line: '#2C313A',
  text: '#F3F5F7',
  sub: '#8C94A1',
  accent: '#5BE49B',
  accentDark: '#173A28',
  onAccent: '#08130D',
  danger: '#F2555A',
  dangerDark: '#3A1719',
  star: '#F5A524',
} as const;

/** 部位の色（グラフ用）。部位の並び順で選ぶ */
export const PART_COLORS = ['#5BE49B', '#6FA8FF', '#B98CFF', '#F5A524', '#FF8FB1', '#4DD4E6', '#E6D85B', '#FF7A59'];
export const partColor = (index: number) => PART_COLORS[((index % PART_COLORS.length) + PART_COLORS.length) % PART_COLORS.length];

export const fonts = {
  regular: 'NotoSansJP_400Regular',
  bold: 'NotoSansJP_700Bold',
  num: 'BarlowCondensed_600SemiBold',
  numBold: 'BarlowCondensed_700Bold',
} as const;

export const radius = { card: 16, input: 10, pill: 999 } as const;
export const space = { screen: 16 } as const;
