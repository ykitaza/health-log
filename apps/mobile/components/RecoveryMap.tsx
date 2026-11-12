// からだのタブの「回復マップ」（RECOVERY MAP // 7D）。筋トレの部位ごとに、最後に鍛えた日からの日数で 3D の体の部品を光らせる。
// Android は 3D（RecoveryMap3D.native.tsx）、描けないときと web（e2e）は 2D の図（前と後ろ）で、7日以内に鍛えた部位を塗る。
// 部位のボタン（48dp）でも選べる（読み上げは図の部品を選べないので、ボタンで同じことが分かるようにする）
import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';
import type { Injury } from '@/db/repositories/injuries';
import { siteOfPart } from '@/lib/bodyModel';
import { DateKey, formatMonthDay, relativeDays } from '@/lib/date';
import { siteLabel } from '@/lib/injuries';
import { musclesForParts } from '@/lib/muscleFigure';
import {
  fixingOn, injuriesForPart, partOfMesh, PartRecovery, partRecoveries, recoveryLevels, RECOVERY_DAYS,
} from '@/lib/recoveryMap';
import type { TrainingSetRow } from '@/lib/training';
import { colors, radius, space } from '@/theme';
import { Mono, ScanFrame } from './injuries';
import { INJURY_AMBER, MuscleFigure } from './MuscleFigure';
import { RecoveryMap3D } from './RecoveryMap3D';
import { T } from './Text';

export type RecoveryInput = {
  rows: TrainingSetRow[];
  /** 部位の ID → 名前（非表示の部位も） */
  partName: (bodyPartId: string) => string;
  /** 非表示でない部位の名前（並びのまま） */
  names: string[];
  /** 種目の ID → 部位の名前 */
  partOfExercise: (exerciseId: string) => string | null;
  injuries: Injury[];
};

/** 「3日前」「今日」。一度もなければ「まだ」 */
const agoText = (p: PartRecovery, date: DateKey) => (p.last == null ? 'まだ' : relativeDays(p.last, date));

/** 選んだもの：筋トレの部位か、どの部位にもあたらない部品（部位の名前を付け替えたときなど） */
type Selection = { part: string } | { mesh: string } | null;

/**
 * 回復マップのカード。見る日（からだのタブで選んだ日）までの記録で数える。どの部位も一度も鍛えていなければ出さない
 */
export function RecoveryMapCard({ input, date }: { input: RecoveryInput; date: DateKey }) {
  const reduced = useReducedMotion();
  const list = useMemo(() => partRecoveries(input.rows, input.partName, input.names, date), [input, date]);
  const levels = useMemo(() => recoveryLevels(list), [list]);
  const injuries = useMemo(() => fixingOn(input.injuries, date), [input.injuries, date]);
  const [sel, setSel] = useState<Selection>(null);
  const part = sel && 'part' in sel ? list.find((p) => p.name === sel.part) ?? null : null;
  const mesh = sel && 'mesh' in sel ? sel.mesh : null;
  const selected = useMemo(() => (part ? part.meshes : mesh ? [mesh] : []), [part, mesh]);
  const onPick = useCallback((m: string | null) => {
    const p = m ? partOfMesh(m, list) : null;
    setSel(p ? { part: p.name } : m ? { mesh: m } : null);
  }, [list]);

  if (list.every((p) => p.last == null)) return null;
  const recent = list.filter((p) => p.level > 0);
  const spoken = [
    '回復マップ',
    recent.length > 0 ? `${RECOVERY_DAYS}日以内に鍛えた部位、${recent.map((p) => `${p.name} ${agoText(p, date)}`).join('、')}` : `${RECOVERY_DAYS}日以内に鍛えた部位はありません`,
    injuries.length > 0 ? `直している途中のケガ ${injuries.length}件` : '',
  ].filter(Boolean).join('。');
  const figure2D = <Recovery2D list={list} injuries={injuries} />;

  return (
    <ScanFrame strong style={{ marginTop: space.m, paddingHorizontal: space.l, paddingTop: space.l, paddingBottom: space.m }} testID="recovery-map">
      {/* 見出しと説明でまとめて読む。図は読み上げで選べないので、下の部位のボタンで同じことが分かる。出典のリンクは図の下（まとめて読む枠の外） */}
      <View accessible accessibilityLabel={spoken} style={{ gap: space.s }}>
        <View style={s.head}>
          <Mono color={colors.accent}>{`RECOVERY MAP // ${RECOVERY_DAYS}D`}</Mono>
          {injuries.length > 0 && <Mono color={INJURY_AMBER}>{`▲ ${injuries.length} ALERT`}</Mono>}
        </View>
        <T variant="bodyM" color={colors.sub}>明るいほど最近鍛えた部位（7日ほどで元に戻る）</T>
      </View>
      {RecoveryMap3D
        ? <RecoveryMap3D levels={levels} injuries={injuries} selected={selected} onPick={onPick} fallback={figure2D} />
        : figure2D}
      <View style={s.chips}>
        {list.map((p) => {
          const on = part?.name === p.name;
          const hurt = injuriesForPart(p, injuries, input.partOfExercise).length;
          return (
            <Pressable
              key={p.name} testID={`recovery-part-${p.name}`} accessibilityRole="button" accessibilityState={{ selected: on }}
              accessibilityLabel={[p.name, p.last ? agoText(p, date) : 'まだ鍛えていない', `2週間で ${p.sets}セット`, hurt > 0 ? `直している途中のケガ ${hurt}件` : ''].filter(Boolean).join('、')}
              onPress={() => setSel(on ? null : { part: p.name })}
              style={[s.chip, on && s.chipOn]}
            >
              {/* 光の強さ（色だけにしない：横に日数） */}
              <View style={[s.dot, { opacity: 0.25 + 0.75 * p.level }]} />
              <T variant="labelL">{p.name}</T>
              <T variant="bodyS" color={colors.sub}>{agoText(p, date)}</T>
              {hurt > 0 && <T variant="labelM" color={INJURY_AMBER}>▲</T>}
            </Pressable>
          );
        })}
      </View>
      {(part || mesh) && (
        <Animated.View
          key={part?.name ?? mesh!} entering={reduced ? undefined : FadeIn.duration(250)} style={s.pick} testID="recovery-select"
          accessible accessibilityLiveRegion="polite"
        >
          <View style={s.pickHead}>
            <Mono color={colors.accent}>SELECT //</Mono>
            <T variant="labelL">{part ? part.name : meshLabel(mesh!)}</T>
          </View>
          {part ? (
            <>
              <T variant="bodyM">
                {part.last ? `最後に鍛えた日 ${agoText(part, date)}（${formatMonthDay(part.last)}）` : 'まだ鍛えていません'}
              </T>
              <T variant="bodyM">{`2週間のセット数 ${part.sets}セット`}</T>
              {injuriesForPart(part, injuries, input.partOfExercise).map((i) => (
                <T key={i.id} variant="bodyM" color={INJURY_AMBER}>{`▲ ${siteLabel(i.site, i.side)}のケガを直している途中`}</T>
              ))}
            </>
          ) : (
            <T variant="bodyM" color={colors.sub}>この部分を鍛える部位はありません</T>
          )}
        </Animated.View>
      )}
    </ScanFrame>
  );
}

/** どの部位にもあたらない部品の名前（三角筋の中部は部位のコードがないので「肩」） */
function meshLabel(mesh: string): string {
  const s = siteOfPart(mesh);
  return s ? siteLabel(s.site, s.side) : '肩';
}

/** 2D の図（前と後ろ）。7日以内に鍛えた部位の筋肉を緑で塗り、直している途中のケガに琥珀色の印 */
function Recovery2D({ list, injuries }: { list: PartRecovery[]; injuries: Injury[] }) {
  const paint = musclesForParts(list.filter((p) => p.level > 0).map((p) => p.name));
  const marks = injuries.map((i) => ({ key: i.id, site: i.site, side: i.side, status: 'fixing' as const }));
  return (
    <View style={s.figures} testID="recovery-2d">
      {(['front', 'back'] as const).map((view) => (
        <View key={view} style={{ alignItems: 'center', gap: space.xs }}>
          <MuscleFigure view={view} paint={paint} marks={marks} width={100} height={200} />
          <Mono>{view === 'front' ? 'FRONT' : 'BACK'}</Mono>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  figures: { flexDirection: 'row', justifyContent: 'center', gap: space.xl, paddingTop: space.m, paddingBottom: space.s },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s, marginTop: space.m },
  chip: {
    minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: space.s, paddingHorizontal: space.m,
    borderRadius: radius.m, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.input,
  },
  chipOn: { borderColor: colors.accent },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
  pick: {
    marginTop: space.m, gap: 2, backgroundColor: 'rgba(14,16,19,0.8)', borderWidth: 1, borderColor: colors.accentMuted,
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: space.s,
  },
  pickHead: { flexDirection: 'row', alignItems: 'center', gap: space.s },
});
