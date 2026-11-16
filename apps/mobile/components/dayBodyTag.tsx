// その日の体の種目の札（3D と 2D で同じ見た目）：EX-01（緑の英字）・種目・いちばん重いセット。「+N」は出せなかった種目の番号。
// onPress を渡すと押せる（ホームの LATEST：その日の記録のその種目へ）。押せないときは読み上げから隠す
import { ReactNode } from 'react';
import { View, ViewStyle } from 'react-native';
import { exerciseNumber } from '@/lib/dayCallouts';
import { colors, fonts } from '@/theme';
import type { DayBodyEntry } from './DayBody3D';
import { PressableScale } from './motion';
import { T } from './Text';

export const DAY_TAG_W = 96;
/** 札の高さ（押せるときは、これが押せる高さ。44dp 以上） */
export const DAY_TAG_H = 46;
/** 部位の札（ホームのヒーロー。押せない）の高さ：2 行（「胸 週10.0」「目安内」）。4 つ積んでも四隅の間に収まる */
export const PART_TAG_H = 34;
/** 札の高さ：部位の札（kicker がある）なら PART_TAG_H */
export const tagHeight = (entries: DayBodyEntry[]) => (entries.some((e) => e.kicker) ? PART_TAG_H : DAY_TAG_H);

const mono = { fontFamily: fonts.num, fontSize: 11, lineHeight: 13, letterSpacing: 1.5 } as const;
/** 押せない札の文字は、図のまとめの読み上げ（種目の一覧）で読むので、札そのものは読み上げから隠す */
const hide = { 'aria-hidden': true, importantForAccessibility: 'no-hide-descendants', accessibilityElementsHidden: true, pointerEvents: 'none' } as const;

/** 札の枠：onPress があれば押せる（label は読み上げ）、なければ隠す */
function TagFrame({ testID, style, onPress, label, children }: { testID: string; style: ViewStyle[]; onPress?: () => void; label: string; children: ReactNode }) {
  if (!onPress) return <View {...hide} testID={testID} style={style}>{children}</View>;
  return (
    <PressableScale accessibilityRole="button" accessibilityLabel={label} scaleTo={0.96} onPress={onPress} testID={testID} style={style}>
      {children}
    </PressableScale>
  );
}

export function DayBodyTag({ e, align, style, onPress }: { e: DayBodyEntry; align: 'left' | 'right'; style: ViewStyle; onPress?: () => void }) {
  if (e.kicker) {
    // 部位の札：1 行目は部位（緑の英字の見出しと同じ書体）と中身、2 行目は目安との差
    return (
      <TagFrame testID="hero-body-tag" onPress={onPress} label={`${e.kicker} ${e.name} ${e.set}`}
        style={[{ height: PART_TAG_H, justifyContent: 'center', alignItems: align === 'right' ? 'flex-end' : 'flex-start' }, style]}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
          <T style={[mono, { color: colors.accent }]}>{e.kicker}</T>
          <T bold size={13} style={{ lineHeight: 17 }} numberOfLines={1}>{e.name}</T>
        </View>
        {e.set !== '' && <T style={[mono, { color: colors.sub }]} numberOfLines={1}>{e.set}</T>}
      </TagFrame>
    );
  }
  return (
    <TagFrame testID="day-body-tag" onPress={onPress} label={`${exerciseNumber(e.no)} ${e.name} ${e.set}。この種目の記録を開く`}
      style={[{ height: DAY_TAG_H, justifyContent: 'center', alignItems: align === 'right' ? 'flex-end' : 'flex-start' }, style]}>
      <T style={[mono, { color: colors.accent }]}>{exerciseNumber(e.no)}</T>
      <T bold size={13} style={{ lineHeight: 17 }} numberOfLines={1} align={align}>{e.name}</T>
      <T style={[mono, { color: colors.sub }]} numberOfLines={1}>{e.set}</T>
    </TagFrame>
  );
}

export function MoreTag({ nos, style, onPress }: { nos: number[]; style: ViewStyle; onPress?: () => void }) {
  return (
    <TagFrame testID="day-body-tag-more" onPress={onPress} label={`ほかの種目 ${nos.map(exerciseNumber).join('、')}。その日の記録を開く`}
      style={[{ width: DAY_TAG_W, height: DAY_TAG_H, justifyContent: 'center', alignItems: 'flex-end' }, style]}>
      <T style={[mono, { color: colors.accent }]}>{`+${nos.length}`}</T>
      <T style={[mono, { color: colors.sub }]} numberOfLines={2} align="right">{nos.map(exerciseNumber).join(' ')}</T>
    </TagFrame>
  );
}
