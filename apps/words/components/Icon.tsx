import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors } from '@/theme';

/** 線のアイコン（24 の枠、細い線。Figma の部品と同じ形） */
type Shape = { p?: string[]; c?: [number, number, number][]; r?: [number, number, number, number, number][]; fill?: boolean };

const SHAPES = {
  pencil: { p: ['M12 20h9', 'M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z'] },
  book: { p: ['M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z', 'M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z'] },
  cards: { r: [[8, 8, 14, 14, 2]], p: ['M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2'] },
  rotate: { p: ['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5'] },
  search: { c: [[11, 11, 8]], p: ['m21 21-4.3-4.3'] },
  star: { p: ['M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'], fill: true },
  starOutline: { p: ['M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'] },
  moreV: { c: [[12, 5, 1], [12, 12, 1], [12, 19, 1]], fill: true },
  moreH: { c: [[5, 12, 1], [12, 12, 1], [19, 12, 1]], fill: true },
  back: { p: ['m12 19-7-7 7-7', 'M19 12H5'] },
  chevronRight: { p: ['m9 18 6-6-6-6'] },
  chevronDown: { p: ['m6 9 6 6 6-6'] },
  chevronUp: { p: ['m18 15-6-6-6 6'] },
  plus: { p: ['M5 12h14', 'M12 5v14'] },
  close: { p: ['M18 6 6 18', 'm6 6 12 12'] },
  chat: { p: ['M7.9 20A9 9 0 1 0 4 16.1L2 22Z'] },
  external: { p: ['M7 7h10v10', 'M7 17 17 7'] },
  copy: { r: [[8, 8, 14, 14, 2]], p: ['M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2'] },
  wifiOff: { p: ['M12 20h.01', 'M8.5 16.429a5 5 0 0 1 7 0', 'M5 12.859a10 10 0 0 1 5.17-2.69', 'M19 12.859a10 10 0 0 0-2.007-1.523', 'M2 8.82a15 15 0 0 1 4.177-2.643', 'M22 8.82a15 15 0 0 0-11.288-3.764', 'm2 2 20 20'] },
  user: { p: ['M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2'], c: [[12, 7, 4]] },
  grip: { c: [[9, 5, 1], [9, 12, 1], [9, 19, 1], [15, 5, 1], [15, 12, 1], [15, 19, 1]], fill: true },
  arrowUp: { p: ['m5 12 7-7 7 7', 'M12 19V5'] },
  arrowDown: { p: ['M12 5v14', 'm19 12-7 7-7-7'] },
  bell: { p: ['M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9', 'M10.3 21a1.94 1.94 0 0 0 3.4 0'] },
  play: { p: ['M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5Z'], fill: true },
  pause: { r: [[6, 4, 4, 16, 1], [14, 4, 4, 16, 1]], fill: true },
  skipNext: { p: ['M5 4.5v15a1 1 0 0 0 1.5.86l10-7.5a1 1 0 0 0 0-1.72l-10-7.5A1 1 0 0 0 5 4.5Z', 'M19 4v16'], fill: true },
  skipPrev: { p: ['M19 4.5v15a1 1 0 0 1-1.5.86l-10-7.5a1 1 0 0 1 0-1.72l10-7.5A1 1 0 0 1 19 4.5Z', 'M5 4v16'], fill: true },
  chart: { p: ['M3 3v18h18', 'M8 17v-5', 'M13 17V8', 'M18 17v-9'] },
  // 出会った場所のアイコン（source.icon_key）
  headphones: { p: ['M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3'] },
  tablet: { r: [[5, 2, 14, 20, 2]], p: ['M12 18h.01'] },
  people: { p: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'], c: [[9, 7, 4]] },
  film: { r: [[2, 2, 20, 20, 2.18]], p: ['M7 2v20', 'M17 2v20', 'M2 12h20', 'M2 7h5', 'M2 17h5', 'M17 17h5', 'M17 7h5'] },
  podcast: { c: [[12, 12, 2]], p: ['M16.24 7.76a6 6 0 0 1 0 8.49', 'M7.76 16.24a6 6 0 0 1 0-8.49', 'M19.07 4.93a10 10 0 0 1 0 14.14', 'M4.93 19.07a10 10 0 0 1 0-14.14'] },
  newspaper: { p: ['M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2', 'M18 14h-8', 'M15 18h-5', 'M10 6h8v4h-8V6Z'] },
  presentation: { p: ['M2 3h20', 'M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3', 'm7 21 5-5 5 5'] },
} satisfies Record<string, Shape>;

export type IconName = keyof typeof SHAPES;

/** source.icon_key → アイコン（知らない名前は other） */
export const SOURCE_ICONS: Record<string, IconName> = {
  headphones: 'headphones', tablet: 'tablet', book: 'book', chat: 'people', film: 'film', podcast: 'podcast', note: 'newspaper', other: 'presentation',
};

export function Icon({ name, size = 24, color = colors.ink, strokeWidth = 1.6 }: { name: IconName; size?: number; color?: string; strokeWidth?: number }) {
  const s: Shape = SHAPES[name];
  const fill = s.fill ? color : 'none';
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {s.p?.map((d, i) => <Path key={`p${i}`} d={d} fill={fill} />)}
      {s.c?.map(([cx, cy, r], i) => <Circle key={`c${i}`} cx={cx} cy={cy} r={r} fill={fill} />)}
      {s.r?.map(([x, y, w, h, rx], i) => <Rect key={`r${i}`} x={x} y={y} width={w} height={h} rx={rx} fill={fill} />)}
    </Svg>
  );
}
