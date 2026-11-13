// その日の体の種目の札（3D と 2D で同じ見た目）：EX-01（緑の英字）・種目・いちばん重いセット。「+N」は出せなかった種目の番号
import { View, ViewStyle } from 'react-native';
import { exerciseNumber } from '@/lib/dayCallouts';
import { colors, fonts } from '@/theme';
import type { DayBodyEntry } from './DayBody3D';
import { T } from './Text';

export const DAY_TAG_W = 96;
export const DAY_TAG_H = 46;

const mono = { fontFamily: fonts.num, fontSize: 11, lineHeight: 13, letterSpacing: 1.5 } as const;
/** 札の文字は、図のまとめの読み上げ（種目の一覧）で読むので、札そのものは読み上げから隠す */
const hide = { 'aria-hidden': true, importantForAccessibility: 'no-hide-descendants', accessibilityElementsHidden: true, pointerEvents: 'none' } as const;

export function DayBodyTag({ e, align, style }: { e: DayBodyEntry; align: 'left' | 'right'; style: ViewStyle }) {
  return (
    <View {...hide} testID="day-body-tag" style={[{ height: DAY_TAG_H, justifyContent: 'center', alignItems: align === 'right' ? 'flex-end' : 'flex-start' }, style]}>
      <T style={[mono, { color: colors.accent }]}>{exerciseNumber(e.no)}</T>
      <T bold size={13} style={{ lineHeight: 17 }} numberOfLines={1} align={align}>{e.name}</T>
      <T style={[mono, { color: colors.sub }]} numberOfLines={1}>{e.set}</T>
    </View>
  );
}

export function MoreTag({ nos, style }: { nos: number[]; style: ViewStyle }) {
  return (
    <View {...hide} testID="day-body-tag-more" style={[{ width: DAY_TAG_W, height: DAY_TAG_H, justifyContent: 'center', alignItems: 'flex-end' }, style]}>
      <T style={[mono, { color: colors.accent }]}>{`+${nos.length}`}</T>
      <T style={[mono, { color: colors.sub }]} numberOfLines={2} align="right">{nos.map(exerciseNumber).join(' ')}</T>
    </View>
  );
}
