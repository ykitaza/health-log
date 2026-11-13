// ホームのヒーローの INJURY の札（3D と 2D で同じ見た目）：INJ-01 ▲（赤の英字）・部位・「● 直し中」
import { View, ViewStyle } from 'react-native';
import type { Injury } from '@/db/repositories/injuries';
import { siteLabel } from '@/lib/injuries';
import { INJURY_RED } from '@/lib/recoveryMap';
import { fonts } from '@/theme';
import { T } from './Text';

export const HERO_TAG_W = 92;
export const HERO_TAG_H = 50;

const mono = { fontFamily: fonts.num, fontSize: 11, lineHeight: 13, letterSpacing: 1.5 } as const;
/** 札は読み上げから隠す（ページの四隅と読み上げの文でケガの数と部位を読む） */
const hide = { 'aria-hidden': true, importantForAccessibility: 'no-hide-descendants', accessibilityElementsHidden: true, pointerEvents: 'none' } as const;

/** ケガの札：INJ-01 ▲（赤の英字）・部位・「● 直し中」。align は文字を寄せる側（図の左の札は右寄せ） */
export function HeroInjuryTag({ injury, number, align, style }: { injury: Injury; number: string; align: 'left' | 'right'; style: ViewStyle }) {
  return (
    <View {...hide} testID="hero-injury-tag" style={[{ height: HERO_TAG_H, justifyContent: 'center', alignItems: align === 'right' ? 'flex-end' : 'flex-start' }, style]}>
      <T style={[mono, { color: INJURY_RED }]}>{`${number} ▲`}</T>
      <T bold size={13} style={{ lineHeight: 17 }} numberOfLines={1} align={align}>{siteLabel(injury.site, injury.side)}</T>
      <T size={11} color={INJURY_RED} numberOfLines={1}>● 直し中</T>
    </View>
  );
}
