// ホームのヒーローの RECOVERY・INJURY の体：web と 3D が描けないときは 2D の図（前と後ろ）。
// RECOVERY は回復の色（回復済みは緑、回復中は暖色、ケガは赤。からだのタブの回復マップと同じ lib/recoveryMap.ts）。3D はその日の体（DayBody）の
// recovery・injuries をそのまま使う（記録の画面の記録のない日と同じ光らせ方）。
// INJURY は直している途中のケガの赤の印と札（INJ-01 ▲・部位・直し中）。札と引き出し線は DayBody にないので、3D は HeroBody3D.native.tsx
import { StyleSheet, View } from 'react-native';
import type { Injury } from '@/db/repositories/injuries';
import { INJURY_RED, muscleFills, PartRecovery } from '@/lib/recoveryMap';
import { colors } from '@/theme';
import { DayBody } from './DayBody';
import type { DayBodyEntry } from './DayBody3D';
import { HeroBody3D } from './HeroBody3D';
import { HERO_TAG_H, HERO_TAG_W, HeroInjuryTag } from './heroInjuryTag';
import { MuscleFigure } from './MuscleFigure';

/** RECOVERY は種目の札も部位の光もない（描くたびに新しい配列を渡さない） */
const NO_ENTRIES: DayBodyEntry[] = [];
const NO_PARTS: string[] = [];

type Props = {
  kind: 'recovery' | 'injury';
  width: number;
  height: number;
  band: { top: number; bottom: number };
  /** 部位ごとの回復（RECOVERY の色） */
  list: PartRecovery[];
  /** 部品ごとの回復の明るさ（3D） */
  levels: Record<string, number>;
  /** 直している途中のケガ */
  injuries: Injury[];
  numbers: Map<string, string>;
  /** 回す操作を受ける体の列（INJURY。RECOVERY の DayBody は全面で受けるので、ヒーローが列の外に面を重ねる） */
  rotate: { left: number; width: number };
};

export function HeroBody({ kind, width, height, band, list, levels, injuries, numbers, rotate }: Props) {
  const fallback = <Figure2D kind={kind} width={width} band={band} list={list} injuries={injuries} numbers={numbers} />;
  if (kind === 'recovery') {
    return <DayBody width={width} height={height} entries={NO_ENTRIES} parts={NO_PARTS} band={band} recovery={levels} injuries={injuries} fallback={fallback} />;
  }
  if (!HeroBody3D) return fallback;
  return <HeroBody3D width={width} height={height} band={band} injuries={injuries} numbers={numbers} rotate={rotate} fallback={fallback} />;
}

const FIG_GAP = 8;

/** 2D の図（前と後ろ）。RECOVERY は回復の色で塗り、INJURY は札を左右に並べる（線は引かない） */
function Figure2D({ kind, width, band, list, injuries, numbers }: {
  kind: 'recovery' | 'injury'; width: number; band: { top: number; bottom: number }; list: PartRecovery[]; injuries: Injury[]; numbers: Map<string, string>;
}) {
  const figH = Math.min(200, band.bottom - band.top);
  const figW = figH / 2;
  const frontX = (width - (figW * 2 + FIG_GAP)) / 2;
  const marks = injuries.map((i) => ({ key: i.id, site: i.site, side: i.side, status: 'fixing' as const }));
  const fills = kind === 'recovery' ? muscleFills(list) : undefined;
  const tags = kind === 'injury' ? injuries.slice(0, 4) : [];
  const tagW = Math.min(HERO_TAG_W, Math.max(0, frontX - 4));
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" testID={`hero-${kind}-2d`}>
      {(['front', 'back'] as const).map((view, i) => (
        <View key={view} style={{ position: 'absolute', left: frontX + i * (figW + FIG_GAP), top: band.top }}>
          <MuscleFigure view={view} fills={fills} marks={marks} markColor={INJURY_RED} width={figW} height={figH} />
        </View>
      ))}
      {tags.map((inj, i) => {
        const side = i % 2 === 0 ? 'left' : 'right';
        return (
          <HeroInjuryTag key={inj.id} injury={inj} number={numbers.get(inj.id) ?? ''} align={side === 'left' ? 'right' : 'left'}
            style={{ position: 'absolute', [side]: 0, top: band.top + Math.floor(i / 2) * (HERO_TAG_H + 8) + 24, width: tagW, backgroundColor: colors.bg }} />
        );
      })}
    </View>
  );
}
