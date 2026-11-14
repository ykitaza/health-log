// ホームのヒーローの INJURY の札（3D と 2D で同じ見た目）：INJ-01 ▲（赤の英字）・部位・「● 直し中」。押すとそのケガの画面
import { ViewStyle } from 'react-native';
import type { Injury } from '@/db/repositories/injuries';
import { siteLabel } from '@/lib/injuries';
import { INJURY_RED } from '@/lib/recoveryMap';
import { fonts } from '@/theme';
import { PressableScale } from './motion';
import { T } from './Text';

export const HERO_TAG_W = 92;
/** 札の高さ（押せる高さ。44dp 以上） */
export const HERO_TAG_H = 50;

const mono = { fontFamily: fonts.num, fontSize: 11, lineHeight: 13, letterSpacing: 1.5 } as const;

/** ケガの札：INJ-01 ▲（赤の英字）・部位・「● 直し中」。align は文字を寄せる側（図の左の札は右寄せ） */
export function HeroInjuryTag({ injury, number, align, style, onPress }: {
  injury: Injury; number: string; align: 'left' | 'right'; style: ViewStyle; onPress: () => void;
}) {
  const site = siteLabel(injury.site, injury.side);
  return (
    <PressableScale
      accessibilityRole="button" accessibilityLabel={`${number} ${site}、直している途中。このケガを開く`} scaleTo={0.96} onPress={onPress}
      testID="hero-injury-tag" style={[{ height: HERO_TAG_H, justifyContent: 'center', alignItems: align === 'right' ? 'flex-end' : 'flex-start' }, style]}
    >
      <T style={[mono, { color: INJURY_RED }]}>{`${number} ▲`}</T>
      <T bold size={13} style={{ lineHeight: 17 }} numberOfLines={1} align={align}>{site}</T>
      <T size={11} color={INJURY_RED} numberOfLines={1}>● 直し中</T>
    </PressableScale>
  );
}
