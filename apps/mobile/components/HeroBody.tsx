// ホームのヒーローの INJURY の体：web と 3D が描けないときは 2D の図（前と後ろ）。
// 直している途中のケガの赤の印と札（INJ-01 ▲・部位・直し中。押すとそのケガ）。3D は HeroBody3D.native.tsx。
// shield（体の列の外の横スワイプをページの切り替えに回す面）は、体と札のあいだに重ねる
import { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import type { Injury } from '@/db/repositories/injuries';
import { INJURY_RED } from '@/lib/recoveryMap';
import { stageColors } from '@/theme';
import { HeroBody3D } from './HeroBody3D';
import { HERO_TAG_H, HERO_TAG_W, HeroInjuryTag } from './heroInjuryTag';
import { MuscleFigure } from './MuscleFigure';

type Props = {
  width: number;
  height: number;
  band: { top: number; bottom: number };
  /** 直している途中のケガ */
  injuries: Injury[];
  numbers: Map<string, string>;
  /** 回す操作を受ける体の列 */
  rotate: { left: number; width: number };
  /** 体の列の外に重ねる面（体と札のあいだ） */
  shield: ReactNode;
  /** ケガの札を押した */
  onPressInjury: (id: string) => void;
};

export function HeroBody({ width, height, band, injuries, numbers, rotate, shield, onPressInjury }: Props) {
  const fallback = <Figure2D width={width} band={band} injuries={injuries} numbers={numbers} shield={shield} onPressInjury={onPressInjury} />;
  if (!HeroBody3D) return fallback;
  return <HeroBody3D width={width} height={height} band={band} injuries={injuries} numbers={numbers} rotate={rotate} fallback={fallback} shield={shield} onPressInjury={onPressInjury} />;
}

const FIG_GAP = 8;

/** 2D の図（前と後ろ）。札を左右に並べる（線は引かない） */
function Figure2D({ width, band, injuries, numbers, shield, onPressInjury }: {
  width: number; band: { top: number; bottom: number }; injuries: Injury[]; numbers: Map<string, string>;
  shield: ReactNode; onPressInjury: (id: string) => void;
}) {
  const figH = Math.min(200, band.bottom - band.top);
  const figW = figH / 2;
  const frontX = (width - (figW * 2 + FIG_GAP)) / 2;
  const marks = injuries.map((i) => ({ key: i.id, site: i.site, side: i.side, status: 'fixing' as const }));
  const tags = injuries.slice(0, 4);
  const tagW = Math.min(HERO_TAG_W, Math.max(0, frontX - 4));
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" testID="hero-injury-2d">
      {(['front', 'back'] as const).map((view, i) => (
        <View key={view} pointerEvents="none" style={{ position: 'absolute', left: frontX + i * (figW + FIG_GAP), top: band.top }}>
          <MuscleFigure view={view} marks={marks} markColor={INJURY_RED} width={figW} height={figH} />
        </View>
      ))}
      {shield}
      {tags.map((inj, i) => {
        const side = i % 2 === 0 ? 'left' : 'right';
        return (
          <HeroInjuryTag key={inj.id} injury={inj} number={numbers.get(inj.id) ?? ''} align={side === 'left' ? 'right' : 'left'}
            style={{ position: 'absolute', [side]: 0, top: band.top + Math.floor(i / 2) * (HERO_TAG_H + 8) + 24, width: tagW, backgroundColor: stageColors.bg }}
            onPress={() => onPressInjury(inj.id)} />
        );
      })}
    </View>
  );
}
