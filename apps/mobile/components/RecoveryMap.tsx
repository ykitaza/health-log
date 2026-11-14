// からだのタブの「回復マップ」（RECOVERY MAP // LIVE）。筋トレの部位ごとに、最後に鍛えた日と部位ごとの回復の日数で 3D の体を色分けする。
// 色は、回復済みは緑、回復中は暖色（鍛えたばかりほど橙、回復が近いほど黄）、直している途中のケガは赤。空いている（回復済みの期限を過ぎた）・まだは灰色。
// Android は 3D（RecoveryMap3D.native.tsx。回復中とケガの部位に引き出し線つきの札）、描けないときと web（e2e）は 2D の図（前と後ろ）。
// 図の下は計器の読み出しのような一覧（1 部位 1 行、48dp。押すと SELECT //）。読み上げは図の部品を選べないので、一覧で同じことが分かる
import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';
import type { Injury } from '@/db/repositories/injuries';
import { siteOfPart } from '@/lib/bodyModel';
import { DateKey, formatMonthDay, relativeDays } from '@/lib/date';
import { siteLabel } from '@/lib/injuries';
import {
  fixingOn, idleMeshes, INJURY_RED, injuriesForPart, leadInjury, LOAD_ORANGE, muscleFills, partEnglish, partOfMesh, PartRecovery, partRecoveries,
  recoveryCalloutAnchor, recoveryColor, recoveryLevels, recoveryShortText, recoveryStatusText, restColor,
} from '@/lib/recoveryMap';
import type { TrainingSetRow } from '@/lib/training';
import { colors, recoveryPalette, space } from '@/theme';
import { Mono, ScanFrame } from './injuries';
import { MuscleFigure } from './MuscleFigure';
import { RecoveryCallout, RecoveryMap3D } from './RecoveryMap3D';
import { T } from './Text';

export type RecoveryInput = {
  rows: TrainingSetRow[];
  /** 部位の ID → 名前（非表示の部位も） */
  partName: (bodyPartId: string) => string;
  /** 非表示でない部位の名前（並びのまま） */
  names: string[];
  injuries: Injury[];
};

/** 「3日前」「今日」。一度もなければ「まだ」 */
const agoText = (p: PartRecovery, date: DateKey) => (p.last == null ? 'まだ' : relativeDays(p.last, date));

/** 部位の色：ケガがあれば赤、回復中は明るさの暖色、回復済みは緑、空いている・まだは灰色 */
const partColor = (p: PartRecovery, hurt: boolean) => (hurt ? INJURY_RED : p.level > 0 ? recoveryColor(p.level, recoveryPalette) : restColor(p, recoveryPalette));

/** 選んだもの：筋トレの部位か、どの部位にもあたらない部品（部位の名前を付け替えたときなど） */
type Selection = { part: string } | { mesh: string } | null;

/** 凡例：緑＝回復済み、暖色＝回復中、灰色＝空いている・まだ、赤＝ケガ（色の四角と文字。色だけにしない） */
const LEGEND = [
  { color: recoveryPalette.rest, label: '回復済み' },
  { color: LOAD_ORANGE, label: '回復中' },
  { color: recoveryPalette.idle, label: '空いている・まだ' },
  { color: INJURY_RED, label: 'ケガ' },
];

/**
 * 回復マップのカード（からだのタブのいちばん上。開いてすぐ見えるヒーロービュー）。見る日（からだのタブで選んだ日）までの記録で数える。
 * どの部位も一度も鍛えていなければ出さない。
 * 一覧は、はじめは回復中とケガの部位だけ（その下の体重・睡眠などの数字を押し下げないため。回復済み・空いている部位は図の緑・灰色で分かる）。
 * 「すべての部位」で全部を出す
 */
export function RecoveryMapCard({ input, date }: { input: RecoveryInput; date: DateKey }) {
  const reduced = useReducedMotion();
  const list = useMemo(() => partRecoveries(input.rows, input.partName, input.names, date), [input, date]);
  const levels = useMemo(() => recoveryLevels(list), [list]);
  const idle = useMemo(() => idleMeshes(list), [list]);
  const injuries = useMemo(() => fixingOn(input.injuries, date), [input.injuries, date]);
  const hurtOf = useMemo(() => new Map(list.map((p) => [p.name, injuriesForPart(p, injuries)])), [list, injuries]);
  const callouts = useMemo<RecoveryCallout[]>(() => list.flatMap((p) => {
    const hurt = hurtOf.get(p.name) ?? [];
    const at = recoveryCalloutAnchor(p.name, hurt);
    const lead = leadInjury(hurt);
    if (!at || (p.level <= 0 && hurt.length === 0)) return [];
    return [{
      id: p.name, en: partEnglish(p.name), name: p.name, status: recoveryShortText(p),
      injury: lead ? `▲ ${siteLabel(lead.site, lead.side)}` : null, color: partColor(p, hurt.length > 0),
      anchor: at.anchor, facing: at.facing, hurt: hurt.length > 0, last: p.last ?? '',
    }];
  }), [list, hurtOf]);
  const [sel, setSel] = useState<Selection>(null);
  const [all, setAll] = useState(false);
  const part = sel && 'part' in sel ? list.find((p) => p.name === sel.part) ?? null : null;
  const mesh = sel && 'mesh' in sel ? sel.mesh : null;
  const selected = useMemo(() => (part ? part.meshes : mesh ? [mesh] : []), [part, mesh]);
  const onPick = useCallback((m: string | null) => {
    const p = m ? partOfMesh(m, list) : null;
    setSel(p ? { part: p.name } : m ? { mesh: m } : null);
  }, [list]);

  if (list.every((p) => p.last == null)) return null;
  const active = list.filter((p) => p.level > 0 || (hurtOf.get(p.name)?.length ?? 0) > 0);
  // 選んだ部位は、一覧をたたんでいても出す（図で押した部位の行が見えるように）
  const rows = all ? list : list.filter((p) => active.includes(p) || p.name === part?.name);
  const recovering = list.filter((p) => p.level > 0);
  const idleParts = list.filter((p) => p.idle);
  const spoken = [
    '回復マップ。緑は回復済み、暖色は回復中、灰色は空いている・まだ、赤はケガ',
    recovering.length > 0 ? `回復中の部位、${recovering.map((p) => `${p.name} あと${p.remaining}日`).join('、')}` : '回復中の部位はありません',
    idleParts.length > 0 ? `空いている部位、${idleParts.map((p) => `${p.name} ${recoveryStatusText(p)}`).join('、')}` : '',
    injuries.length > 0 ? `直している途中のケガ ${injuries.length}件` : '',
  ].filter(Boolean).join('。');
  const figure2D = <Recovery2D list={list} injuries={injuries} />;

  return (
    <ScanFrame strong style={{ marginTop: space.l, paddingHorizontal: space.l, paddingTop: space.m, paddingBottom: space.s }} testID="recovery-map">
      {/* 見出しと凡例（2行）でまとめて読む。出典のリンクは図の下（まとめて読む枠の外） */}
      <View accessible accessibilityLabel={spoken} style={{ gap: space.xs }}>
        <View style={s.head}>
          <Mono color={colors.accent}>RECOVERY MAP // LIVE</Mono>
          {injuries.length > 0 && <Mono color={INJURY_RED}>{`▲ ${injuries.length} ALERT`}</Mono>}
        </View>
        <View style={s.legend} testID="recovery-legend">
          {LEGEND.map((l) => (
            <View key={l.label} style={s.legendItem}>
              <View style={[s.swatch, { backgroundColor: l.color }]} />
              <T variant="bodyS" color={colors.sub}>{l.label}</T>
            </View>
          ))}
        </View>
      </View>
      {RecoveryMap3D
        ? <RecoveryMap3D levels={levels} idle={idle} injuries={injuries} selected={selected} onPick={onPick} callouts={callouts} fallback={figure2D} />
        : figure2D}

      <View style={s.readout} testID="recovery-list">
        {rows.length === 0 && <T variant="bodyM" color={colors.sub} style={s.empty}>いま回復中の部位はありません</T>}
        {rows.map((p) => {
          const on = part?.name === p.name;
          const hurt = hurtOf.get(p.name)?.length ?? 0;
          // 左の印と ▲ はケガの赤、残りのバーと状態は回復の色（ケガがあっても回復のぐあいが分かるように）。
          // 空いている・まだの英字は灰色の文字（印の灰色は文字には暗い）
          const color = partColor(p, hurt > 0);
          const load = partColor(p, false);
          const en = p.level > 0 || (p.last != null && !p.idle) ? load : colors.sub;
          return (
            <Pressable
              key={p.name} testID={`recovery-part-${p.name}`} accessibilityRole="button" accessibilityState={{ selected: on }}
              accessibilityLabel={[p.name, p.last ? agoText(p, date) : 'まだ鍛えていない', p.last ? recoveryStatusText(p) : '', `2週間で ${p.sets}セット`, hurt > 0 ? `直している途中のケガ ${hurt}件` : ''].filter(Boolean).join('、')}
              onPress={() => setSel(on ? null : { part: p.name })}
              style={({ pressed }) => [s.row, on && s.rowOn, pressed && s.rowPressed]}
            >
              <View style={[s.mark, { backgroundColor: color }]} />
              <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                <View style={s.rowTop}>
                  <View style={{ width: 84 }}><Mono color={en} size={11}>{partEnglish(p.name)}</Mono></View>
                  <T variant="labelL" numberOfLines={1} style={{ flexShrink: 1 }}>{p.name}</T>
                  {hurt > 0 && <T variant="labelM" color={INJURY_RED}>▲</T>}
                  {/* 一度もなければ下の状態に「まだ」と出すので、ここは出さない */}
                  {p.last && <T variant="bodyS" color={colors.sub} style={{ marginLeft: 'auto' }}>{agoText(p, date)}</T>}
                </View>
                <View style={s.rowBottom}>
                  {/* 回復の残り（回復済み・まだは空） */}
                  <View style={s.bar}><View style={[s.barFill, { width: `${Math.round(p.level * 100)}%`, backgroundColor: load }]} /></View>
                  <T variant="bodyS" color={p.level > 0 ? load : colors.sub} numberOfLines={1}>{recoveryStatusText(p)}</T>
                </View>
              </View>
            </Pressable>
          );
        })}
        {list.length > active.length && (
          <Pressable
            accessibilityRole="button" accessibilityState={{ expanded: all }} accessibilityLabel={all ? '回復中だけにする' : `すべての部位（${list.length}）`}
            onPress={() => setAll(!all)} style={s.more} testID="recovery-all"
          >
            <Mono color={colors.accent}>{all ? '▲ CLOSE' : '▼ ALL'}</Mono>
            <T variant="labelL" color={colors.accent}>{all ? '回復中だけにする' : `すべての部位（${list.length}）`}</T>
          </Pressable>
        )}
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
              {part.last && <T variant="bodyM">{`${recoveryStatusText(part)}（回復の目安 ${part.recoveryDays}日）`}</T>}
              <T variant="bodyM">{`2週間のセット数 ${part.sets}セット`}</T>
              {(hurtOf.get(part.name) ?? []).map((i) => (
                <T key={i.id} variant="bodyM" color={INJURY_RED}>{`▲ ${siteLabel(i.site, i.side)}のケガを直している途中`}</T>
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

/** 2D の図（前と後ろ）。回復済みの筋肉は控えめな緑、回復中の筋肉は明るさの暖色、空いている・まだの筋肉は灰色、直している途中のケガに赤の印 */
function Recovery2D({ list, injuries }: { list: PartRecovery[]; injuries: Injury[] }) {
  const fills = muscleFills(list, recoveryPalette);
  const marks = injuries.map((i) => ({ key: i.id, site: i.site, side: i.side, status: 'fixing' as const }));
  return (
    <View style={s.figures} testID="recovery-2d">
      {(['front', 'back'] as const).map((view) => (
        <View key={view} style={{ alignItems: 'center', gap: space.xs }}>
          <MuscleFigure view={view} fills={fills} marks={marks} markColor={INJURY_RED} width={100} height={200} />
          <Mono>{view === 'front' ? 'FRONT' : 'BACK'}</Mono>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  figures: { flexDirection: 'row', justifyContent: 'center', gap: space.xl, paddingTop: space.m, paddingBottom: space.s },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.m, rowGap: space.xs },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  swatch: { width: 10, height: 10, borderRadius: 2 },
  readout: { marginTop: space.s, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  row: {
    minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: space.s, paddingVertical: 6, paddingHorizontal: space.xs,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line,
  },
  rowOn: { backgroundColor: 'rgba(91,228,155,0.08)' },
  rowPressed: { backgroundColor: 'rgba(255,255,255,0.04)' },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  rowBottom: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  mark: { width: 4, alignSelf: 'stretch', borderRadius: 1 },
  bar: { flex: 1, height: 3, backgroundColor: colors.line, borderRadius: 2, overflow: 'hidden' },
  barFill: { height: 3 },
  empty: { paddingVertical: space.m },
  more: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.s },
  pick: {
    marginTop: space.s, gap: 2, backgroundColor: 'rgba(14,16,19,0.8)', borderWidth: 1, borderColor: colors.accentMuted,
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: space.s,
  },
  pickHead: { flexDirection: 'row', alignItems: 'center', gap: space.s },
});
