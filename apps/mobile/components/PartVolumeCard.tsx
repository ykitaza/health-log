import { router } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { Muscle } from '@/lib/muscleFigure';
import type { BalancePart } from '@/lib/partBalance';
import {
  perWeekText, PartVolume, PhaseVolume, phaseBandText, phaseVolumeLabel, PrevWord, volumeDeltaText, volumeLevel, volumeMuscleLevels, volumeRowText,
} from '@/lib/partVolume';
import { INJURY_RED } from '@/lib/recoveryMap';
import { colors, volumePalette } from '@/theme';
import { Panel } from './homeHud';
import { Mono } from './injuries';
import { MuscleFigure } from './MuscleFigure';
import { T } from './Text';

/** 段（0〜5）の色。0 は図の筋肉の地の灰色 */
export const volumeColor = (level: number) => (level <= 0 ? volumePalette.empty : volumePalette.steps[Math.min(level, volumePalette.steps.length) - 1]);

/** 図（前と後ろ）の 1 枚の大きさ（100×200 の体の縮小） */
const FIG_W = 46;
const FIG_H = 92;

/**
 * 部位の量の中身：前と後ろの 2D の図（筋肉を段の色で塗る）と、6 つの行（段の色の四角・部位・セット数と目安・前の期間との差）。
 * 凡例は付けない（行の四角が図の色と同じで、意味は行の文字が言う）。2D の図は全部のプラットフォームで使う（ホームには 3D の体が別にある）。
 * hurt の部位（ケガ）には赤の ▲。ink・muted は載せる面の文字の色（ホームとレポートで面が違う）
 */
export function PartVolumeBody({ volume, hurt = new Set(), ink = colors.text, muted = colors.sub, prev = '先週', testID = 'part-volume' }: {
  volume: PartVolume; hurt?: ReadonlySet<BalancePart>; ink?: string; muted?: string; prev?: PrevWord; testID?: string;
}) {
  const fills = useMemo(() => {
    const levels = volumeMuscleLevels(volume);
    return Object.fromEntries(Object.entries(levels).map(([m, l]) => [m, volumeColor(l!)])) as Partial<Record<Muscle, string>>;
  }, [volume]);
  const banded = volume.band != null;
  return (
    <View style={s.body} testID={testID}>
      <View style={s.figures}>
        {(['front', 'back'] as const).map((view) => (
          <MuscleFigure key={view} view={view} fills={fills} width={FIG_W} height={FIG_H} testID={`${testID}-figure-${view}`} />
        ))}
      </View>
      <View style={s.rows}>
        {volume.parts.map((p) => {
          const level = volumeLevel(p.sets);
          return (
            <View key={p.part} style={s.row} testID={`${testID}-row-${p.part}`}>
              <View style={[s.swatch, { backgroundColor: volumeColor(level) }]} testID={`${testID}-swatch-${p.part}`} />
              <View style={s.name}>
                <T size={13} bold color={ink} numberOfLines={1}>{p.part}</T>
                {hurt.has(p.part) && <View style={s.injury} testID={`${testID}-injury-${p.part}`} />}
              </View>
              <T size={12} color={ink} numberOfLines={1} style={s.count}>{volumeRowText(p)}</T>
              <T size={12} color={p.trend === 'toward' ? volumePalette.toward : muted} numberOfLines={1} style={s.delta}>{volumeDeltaText(p, banded, prev)}</T>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/** カードの見出しの右：期間（11/2–11/8） */
const md = (k: string) => `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}`;
export const volumeRange = (v: PartVolume) => `${md(v.from)}–${md(v.to)}`;

/**
 * ホームの「部位の量」の中身：前と後ろの 2D の図（筋肉を 1 週間あたりの段の色で塗る）と、6 つの行
 * （段の色の四角・部位・「16セット」・「週 8.0」・目安との差）。凡例は付けない。hurt の部位（ケガ）には赤の ▲
 */
function PhaseVolumeBody({ volume, hurt, testID }: { volume: PhaseVolume; hurt: ReadonlySet<BalancePart>; testID: string }) {
  const fills = useMemo(() => {
    const levels = volumeMuscleLevels(volume);
    return Object.fromEntries(Object.entries(levels).map(([m, l]) => [m, volumeColor(l!)])) as Partial<Record<Muscle, string>>;
  }, [volume]);
  return (
    <View style={s.body} testID={testID}>
      <View style={s.figures}>
        {(['front', 'back'] as const).map((view) => (
          <MuscleFigure key={view} view={view} fills={fills} width={FIG_W} height={FIG_H} testID={`${testID}-figure-${view}`} />
        ))}
      </View>
      <View style={s.rows}>
        {volume.parts.map((p) => (
          <View key={p.part} style={s.row} testID={`${testID}-row-${p.part}`}>
            <View style={[s.swatch, { backgroundColor: volumeColor(p.level) }]} testID={`${testID}-swatch-${p.part}`} />
            <View style={s.name}>
              <T size={13} bold color={colors.text} numberOfLines={1}>{p.part}</T>
              {hurt.has(p.part) && <View style={s.injury} testID={`${testID}-injury-${p.part}`} />}
            </View>
            <T size={12} color={colors.text} numberOfLines={1} style={s.sets}>{`${p.total}セット`}</T>
            <T size={12} color={colors.sub} numberOfLines={1} style={s.week}>{`週 ${perWeekText(p.perWeek)}`}</T>
            <T size={12} color={p.short > 0 || p.over > 0 ? colors.text : colors.sub} numberOfLines={1} style={s.band}>{phaseBandText(p)}</T>
          </View>
        ))}
      </View>
    </View>
  );
}

/** 期間の文字（11/8–11/16） */
export const phaseRange = (v: PhaseVolume) => `${md(v.from)}–${md(v.to)}`;

/**
 * ホームの「部位の量」：宣言したフェーズ（なければ直近 4 週）の、部位ごとのセット数と 1 週間あたり、1 週間 10〜20 セットの目安との差
 * （lib/partVolume.ts の phasePartVolume。体の「部位の量」の色と同じ数字）。見出しは「増量 8週の部位」と期間。
 * 押すと筋トレの推移の部位のバランス（覚えている期間のまま）
 */
export function PhaseVolumeCard({ volume, hurt }: { volume: PhaseVolume | null; hurt: ReadonlySet<BalancePart> }) {
  const label = volume ? phaseVolumeLabel(volume, hurt) : '部位の量';
  return (
    <Panel testID="home-parts" label={`${label}。筋トレの推移を開く`} style={s.card}
      onPress={() => router.navigate({ pathname: '/training', params: { view: 'trend', focus: 'parts' } })}>
      <View style={s.head}>
        <T size={13} bold color={colors.text} accessibilityRole="header" numberOfLines={1} style={s.title}>{volume?.title ?? '部位の量'}</T>
        {volume && <Mono size={11}>{phaseRange(volume)}</Mono>}
      </View>
      {volume && <PhaseVolumeBody volume={volume} hurt={hurt} testID="home-parts-body" />}
    </Panel>
  );
}

const s = StyleSheet.create({
  card: { flex: 1, minWidth: 0, gap: 6 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 4 },
  title: { flexShrink: 1, minWidth: 0 },
  body: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  figures: { flexDirection: 'row', gap: 2 },
  rows: { flex: 1, minWidth: 0, gap: 5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 20 },
  swatch: { width: 12, height: 12, borderRadius: 2 },
  name: { minWidth: 34, flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 3 },
  count: { flex: 1, minWidth: 0 },
  delta: { textAlign: 'right' },
  sets: { flexShrink: 0, minWidth: 40 },
  week: { flexShrink: 0, minWidth: 40 },
  band: { flex: 1, minWidth: 0, textAlign: 'right' },
  injury: {
    width: 0, height: 0, borderLeftWidth: 4, borderRightWidth: 4, borderBottomWidth: 7,
    borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: INJURY_RED,
  },
});
