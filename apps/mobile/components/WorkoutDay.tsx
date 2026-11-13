import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import Svg, { Circle, Line } from 'react-native-svg';
import { AiRecordButton } from './ChatSheet';
import { Big3Badge, PartBadge } from './ExerciseFields';
import { Icon } from './Icon';
import { PressableScale, useListMotion } from './motion';
import { DayBodyAttribution, DayBodyBox, useDayBody3D } from './DayBody';
import { FigurePress, loadRecovery, PartChips, pickAt, pickedPoint, pickMesh, RecoveryHero, trainedBy, usePicked } from './DayRecovery';
import { LoadError } from './LoadError';
import { MuscleFigure } from './MuscleFigure';
import { DailyHighlights } from './reports';
import { RestTimerBar } from './RestTimer';
import { T } from './Text';
import { Button, Card, ConfirmDialog, EmptyState, IconButton, SetNo } from './ui';
import type { Entry } from '@/db/repositories/workouts';
import { useBusy } from '@/hooks/busy';
import { useFocusData } from '@/hooks/data';
import { formatJpDate, todayKey } from '@/lib/date';
import { big3RoleById } from '@/lib/exercises';
import { formatSetLong, tonnes } from '@/lib/format';
import { TAB_AREAS } from '@/lib/reports';
import { entriesMissingBodyweight, MISSING_BODYWEIGHT_NOTE } from '@/lib/bodyweight';
import { dayBodyEntries } from '@/lib/dayBody';
import { calloutSet, dayFigureLabel, exerciseNumber, layoutCallouts, partAnchor, PlacedCallout } from '@/lib/dayCallouts';
import { MuscleView, musclesForParts } from '@/lib/muscleFigure';
import { bestSet, dayFocus, entryCardLabel, SetValues, totalVolume } from '@/lib/training';
import { fmt1, kgToUnit, WeightUnit } from '@/lib/units';
import { colors, fonts, space } from '@/theme';

/** 「種目を追加」のボタン（画面の下に固定する）。未来の日は押せない */
export function AddExerciseButton({ date }: { date: string }) {
  return <Button label="種目を追加" icon="plus" disabled={date > todayKey()} onPress={() => router.push({ pathname: '/workout/select', params: { date } })} style={{ flex: 1 }} />;
}

/**
 * 記録の画面の下：「AI で記録」（チャットを開く）と「種目を追加」を横に並べる。未来の日はどちらも押せない。
 * 休憩のタイマーが動いていれば、その上に帯を出す（記録の入力の画面と同じ1つのタイマー）
 */
export function WorkoutFooter({ date }: { date: string }) {
  const today = todayKey();
  return (
    <>
      <RestTimerBar />
      <View style={{ flexDirection: 'row', gap: space.s }}>
        <AiRecordButton prompt={{ kind: 'training', date, today }} disabled={date > today} style={{ flex: 1 }} />
        <AddExerciseButton date={date} />
      </View>
    </>
  );
}

/**
 * その日のトレーニングの中身（まとめ、種目の一覧、並べ替え、外す確認）。種目は実施した順に並ぶ。
 * 筋トレのタブの「記録」で使う
 */
export function WorkoutDayContent({ date }: { date: string }) {
  const today = todayKey();
  const { data, error, reload, repos } = useFocusData(async (r) => {
    const [entries, settings, exercises, bodyParts] = await Promise.all([
      r.workouts.getDay(date), r.settings.get(), r.catalog.listExercises({ includeHidden: true }), r.catalog.listBodyParts(),
    ]);
    // 空の日（今日と過去の日）は、その日の時点の回復マップ（からだのタブと同じ材料）と、その日より前の直近のトレーニングの日（前回）
    const empty = entries.length === 0 && date <= todayKey();
    const [previous, recovery] = empty ? await Promise.all([r.workouts.previousDay(date), loadRecovery(r)]) : [null, null];
    // 図から選べる部位（非表示でないもの。種目の選択の部位のチップと同じ ID）
    const pickParts = bodyParts.map((b) => ({ id: b.id, name: b.name }));
    return { entries, settings, big3: big3RoleById(exercises), previous, recovery, pickParts };
  }, date);
  const [removing, setRemoving] = useState<Entry | null>(null);
  const list = useListMotion(data != null);
  const unit = data?.settings.weightUnit ?? 'kg';
  const entries = data?.entries ?? [];
  const setCount = entries.reduce((a, e) => a + e.sets.length, 0);
  const volume = entries.reduce((a, e) => a + totalVolume(e.sets), 0);
  const parts = dayFocus(entries);

  const move = async (id: string, d: -1 | 1) => { await repos.workouts.moveEntry(id, d); reload(); };
  // 外すは1つずつ（確認の「外す」を続けて押しても2回消さない）。並べ替えは、続けて押した分だけ動かす
  const { busy, run } = useBusy();
  const remove = () => run(async () => {
    if (!removing) return;
    await repos.workouts.deleteEntry(removing.id);
    setRemoving(null);
    await reload();
  });
  // 前回のメニューを写す（2回押しても二重にしない：useBusy とリポジトリの確かめ）
  const [copyError, setCopyError] = useState<string | null>(null);
  const copyPrevious = () => run(async () => {
    if (!data?.previous) return;
    try {
      await repos.workouts.copyDay(data.previous.date, date);
      setCopyError(null);
    } catch (e) {
      setCopyError(e instanceof Error ? e.message : String(e));
    }
    await reload();
  });
  const previous = data?.previous;
  // 前回のメニューを写せるのは今日だけ（過去の空の日は、前回の日と部位を見せるだけ）
  const canCopy = date === today;
  const empty = data != null && entries.length === 0 && date <= today;
  const trained = data?.recovery ? trainedBy(data.recovery, date) : false;
  // 3D の体で光らせる前回の部位と、前回の種目の札
  const previousBody = useMemo(() => (previous ? dayBodyEntries(previous.entries, unit) : null), [previous, unit]);

  if (error) return <LoadError onRetry={reload} />;

  return (
    <>
      {/* 記録のない日：まだ記録がないことを1行と補足で → その日の時点の回復マップ（ヒーロー）→ 部位から記録 */}
      {empty && (
        <View style={{ marginTop: space.s }}>
          <EmptyState
            compact testID="no-workout"
            title={date === today ? 'まだ記録がありません' : 'この日の記録はありません'}
            body={!trained ? '部位を選んで、最初の記録をつけましょう' : date === today ? '回復済みの部位から選べます' : 'この日の時点の回復です'}
          />
        </View>
      )}
      {empty && data.recovery && (
        <RecoveryHero
          date={date} today={today} input={data.recovery} pickParts={data.pickParts} previous={previousBody}
          foot={previous ? (
            <View testID="previous-line" style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space.s }}>
              <T variant="bodyM" color={colors.sub} style={{ flexShrink: 1 }}>
                {`前回 ${formatJpDate(previous.date)} ${[...new Set(previous.entries.map((e) => e.bodyPartName.trim()).filter(Boolean))].join('・')}`}
              </T>
              {canCopy && (
                <Button
                  label={busy ? '写しています…' : '同じメニューで始める'} variant="text" small busy={busy} onPress={copyPrevious}
                  accessibilityLabel={`${formatJpDate(previous.date)}と同じメニューで始める`}
                  style={{ paddingLeft: 12, paddingRight: 12, marginRight: -12, marginLeft: 'auto' }}
                />
              )}
              {copyError && <T variant="bodyS" color={colors.danger} style={{ width: '100%' }}>{copyError}</T>}
            </View>
          ) : null}
        />
      )}
      {data && entries.length === 0 && <DailyHighlights date={date} areas={TAB_AREAS.training} />}
      {entries.length > 0 && (
        <>
          <Card style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: space.m, marginTop: space.s }}>
            <Stat label="種目" value={String(entries.length)} />
            {parts.text !== '' && <Stat label="部位" value={parts.text} spoken={parts.spoken} text center testID="day-parts" />}
            <Stat label="セット" value={String(setCount)} center />
            <Stat label="合計負荷量" value={`${tonnes(volume, unit)} ${unit === 'kg' ? 't' : 'k lb'}`} right />
          </Card>
          <DayPartsFigure testID="day-parts-figure" title="鍛えた部位の図" parts={parts.names} entries={entries} unit={unit} date={date} pickParts={data?.pickParts ?? []} />
          {entriesMissingBodyweight(entries) && (
            <T variant="bodyS" color={colors.sub} style={{ marginTop: space.xs }} testID="missing-bodyweight">{MISSING_BODYWEIGHT_NOTE}</T>
          )}
          <DailyHighlights date={date} areas={TAB_AREAS.training} />
          {/* 上の「レポートから」のカード（抜き出し）と分けて、ここからが記録そのものだと分かるように見出しを付ける */}
          <T variant="titleS" color={colors.sub} accessibilityRole="header" style={{ marginTop: space.l }}>記録した種目</T>
          <View style={{ gap: space.m, marginTop: space.s }}>
            {entries.map((e, i) => {
              const best = bestSet(e.sets);
              const big3 = data?.big3.has(e.exerciseId) ?? false;
              const e1rm = best ? `${fmt1(kgToUnit(best.e1rm, unit))}${unit}` : null;
              const hasPart = e.bodyPartName.trim() !== '';
              return (
                <Animated.View key={e.id} entering={list.entering(i)} exiting={list.exiting} layout={list.layout}>
                  <Card style={{ paddingTop: space.l, paddingBottom: space.s }}>
                    <PressableScale
                      accessibilityRole="button"
                      scaleTo={0.98}
                      accessibilityLabel={entryCardLabel({ name: e.exerciseName, part: e.bodyPartName, big3, e1rm })}
                      onPress={() => router.push({ pathname: '/workout/entry', params: { date, entryId: e.id } })}
                    >
                      {/* 1行目は順番・種目名・＞だけ。2行目（種目名の位置にそろえる）に部位・BIG3・推定1RM */}
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <SetNo n={i + 1} active />
                        <T variant="titleM" style={{ flex: 1 }} numberOfLines={2}>{e.exerciseName}</T>
                        <Icon name="chevron" size={24} color={colors.sub} />
                      </View>
                      {(hasPart || big3 || e1rm) && (
                        <View style={{ marginLeft: 32, marginTop: space.xs, flexDirection: 'row', alignItems: 'center', gap: space.s, flexWrap: 'wrap' }} testID="entry-tags">
                          <PartBadge name={e.bodyPartName} />
                          {big3 && <Big3Badge />}
                          {e1rm && <T variant="labelL" color={colors.accent}>推定1RM {e1rm}</T>}
                        </View>
                      )}
                      <View style={{ marginLeft: 32, marginTop: space.s, gap: space.s }}>
                        {e.sets.map((st, j) => (
                          <View key={st.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                            <SetNo n={j + 1} />
                            <T variant="titleM">{formatSetLong(st.weightKg, st.reps, unit)}</T>
                            {st.memo !== '' && (
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, flexShrink: 1 }}>
                                <Icon name="pencil" size={16} color={colors.sub} />
                                <T variant="bodyS" color={colors.sub} numberOfLines={1}>{st.memo}</T>
                              </View>
                            )}
                          </View>
                        ))}
                      </View>
                    </PressableScale>
                    {/* 上へ・下へは見た目 40・押せる範囲 48。端では使えない状態。外すは文字付きのボタン（押すと確認） */}
                    <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: space.s, marginTop: space.s }}>
                      <IconButton name="up" label="上へ" variant="tonal" onPress={() => move(e.id, -1)} disabled={i === 0} />
                      <IconButton name="down" label="下へ" variant="tonal" onPress={() => move(e.id, 1)} disabled={i === entries.length - 1} />
                      <Button label="外す" icon="trash" variant="danger" small accessibilityLabel={`${e.exerciseName}を外す`} onPress={() => setRemoving(e)} style={{ paddingLeft: 12, paddingRight: 12 }} />
                    </View>
                  </Card>
                </Animated.View>
              );
            })}
          </View>
          <T variant="bodyS" color={colors.sub} style={{ marginTop: space.m }}>並び順は ↑↓ で入れ替えられます。種目を押すと記録を直せます</T>
        </>
      )}
      <ConfirmDialog
        visible={removing != null}
        title="種目を外しますか？"
        body={`${removing?.exerciseName ?? ''}と、そのセット ${removing?.sets.length ?? 0} 件を${date === today ? '今日' : 'この日'}の記録から外します。メモも消えます。`}
        confirmLabel="外す"
        onCancel={() => setRemoving(null)}
        onConfirm={remove}
        busy={busy}
      />
    </>
  );
}

/** 3D の体の高さ */
const STAGE_H = 320;
/** 部位の図の高さ（前と後ろ。幅は高さの半分） */
const PART_FIG_H = 132;
/** 前と後ろの図のあいだ（札の場所を空けるため狭く） */
const PART_FIG_GAP = space.s;
/** 図の下の「前・後ろ」の行 */
const PART_LABEL_H = 20;
/** 札の高さ（番号・種目・セットの 3 行）と、札のあいだ */
const CALLOUT_H = 48;
const CALLOUT_GAP = space.xs;
/**
 * 片側に出す札の数（「+N」も 1 つ）。図の段（152）に 3 つ入り、4 つで段が 52 伸びる。
 * 胸の日のように片側に寄る日（前の図に 4 種目）でも、5 種目まではすべてに札が付く
 */
const CALLOUTS_PER_SIDE = 4;
/** 札と図のあいだ */
const CALLOUT_INSET = space.xs;

/** 札にする種目 */
type FigureEntry = { id: string; exerciseName: string; bodyPartName: string; sets: SetValues[] };

/**
 * 体の図。Android は 3D のその日の体（components/DayBody.tsx。鍛えた部位がミントで光り、種目の札 EX-01〜 を引き出し線でつなぐ。
 * 体を押すと、その部位のチップが下の先頭に。出典は図の下）。web と 3D が描けないときは、次の 2D の図（前と後ろ）。
 * - 鍛えた部位の筋肉を緑で塗る（parts。まとめの「部位」と同じ主な部位。上腕三頭筋は後ろの図の三頭筋）
 * - 種目ごとに札（EX-01 の番号・種目・いちばん重いセット）を付け、その種目の部位の点へ引き出し線でつなぐ。
 *   前の図の点の札は左、後ろの図の点の札は右（並べ方は lib/dayCallouts.ts の layoutCallouts）
 * - 図の筋肉を押すと、押した所のまわりの部位を下のチップの先頭に出す（図が小さく、指 1 本で複数の筋肉にかかるので、48dp のチップで選ぶ）。
 *   チップを押すと、その部位で絞った種目の選択（記録のない日の回復マップの「背中の種目を選ぶ」と同じ道）。
 *   読み上げでは図を押せないので、チップの並び（部位から記録）が同じ入口。未来の日は出さない
 * 読み上げは title と番号・種目・部位
 */
// 日を変えたら、押した所を消す（3D の体は作り直さない）
function DayPartsFigure({ title, parts, entries, unit, date, pickParts, testID }: {
  title: string; parts: string[]; entries: FigureEntry[]; unit: WeightUnit; date: string; pickParts: { id: string; name: string }[]; testID: string;
}) {
  const [width, setWidth] = useState(0);
  const [picked, setPicked] = usePicked(date);
  const body3D = useDayBody3D();
  const canPick = date <= todayKey() && pickParts.length > 0;
  // 3D の札の番号は、下の種目のカードの番号と同じ（セットのない種目も数える）
  const tags = useMemo(() => entries.map((e, i) => ({ key: e.id, no: i + 1, name: e.exerciseName, set: calloutSet(e.sets, unit), part: e.bodyPartName })), [entries, unit]);
  const onPick = useCallback((mesh: string | null) => setPicked(pickMesh(mesh, pickParts)), [setPicked, pickParts]);
  const tone = colors.accent;
  const paint = musclesForParts(parts);
  const layout = layoutCallouts(entries.map((e, i) => ({ key: e.id, no: i + 1, part: e.bodyPartName })), {
    figureHeight: PART_FIG_H, minHeight: PART_FIG_H + PART_LABEL_H, slot: CALLOUT_H, gap: CALLOUT_GAP, perSide: CALLOUTS_PER_SIDE,
  });
  const byId = new Map(entries.map((e) => [e.id, e]));
  const figW = PART_FIG_H / 2;
  const frontX = Math.max(0, (width - (figW * 2 + PART_FIG_GAP)) / 2);
  const backX = frontX + figW + PART_FIG_GAP;
  const calloutW = Math.max(0, frontX - CALLOUT_INSET);
  const scale = PART_FIG_H / 200;
  const toScreen = (view: MuscleView, p: { x: number; y: number }) => ({ x: (view === 'front' ? frontX : backX) + p.x * scale, y: p.y * scale });
  const at = (c: PlacedCallout) => (c.kind === 'entry' && c.anchor ? toScreen(c.anchor.view, c.anchor.point) : null);
  // 点は札を出せなかった種目の部位にも置く（鍛えた場所）。同じ点は 1 つ
  const dots = [...new Map(entries.flatMap((e) => {
    const a = partAnchor(e.bodyPartName);
    return a ? [[`${a.view}-${a.muscle}`, toScreen(a.view, a.point)] as const] : [];
  })).entries()];
  const lines = [
    ...layout.left.map((c) => ({ c, x: calloutW })),
    ...layout.right.map((c) => ({ c, x: width - calloutW })),
  ].flatMap(({ c, x }) => { const to = at(c); return to ? [{ key: `${c.kind === 'entry' ? c.key : 'more'}`, x1: x, y1: c.top + CALLOUT_H / 2, ...to }] : []; });
  const pick = (view: MuscleView, point: { x: number; y: number }) => setPicked(pickAt(view, point, pickParts));
  const point = pickedPoint(picked);
  const mark = point ? toScreen(point.view, point.point) : null;

  return (
    <Card style={{ marginTop: space.s, paddingVertical: space.m, gap: space.s }}>
      <View accessible accessibilityLabel={dayFigureLabel(title, entries.map((e) => ({ name: e.exerciseName, part: e.bodyPartName })))} testID={testID}>
        {body3D.on ? (
          <DayBodyBox
            height={STAGE_H} entries={tags} parts={parts} onPick={canPick ? onPick : undefined} onFail={body3D.fail}
            style={{ marginHorizontal: -space.s }}
          />
        ) : (
          <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height: layout.height }}>
            {width > 0 && (
              <>
                {(['front', 'back'] as const).map((view) => (
                  <View key={view} style={{ position: 'absolute', left: view === 'front' ? frontX : backX, top: 0, width: figW, alignItems: 'center' }}>
                    <MuscleFigure view={view} paint={paint} paintColor={tone} width={figW} height={PART_FIG_H} />
                    <View style={{ height: PART_LABEL_H, justifyContent: 'flex-end' }}>
                      <T variant="labelS" color={colors.sub}>{view === 'front' ? '前' : '後ろ'}</T>
                    </View>
                  </View>
                ))}
                {/* 引き出し線と、その種目の部位の点。押した所は輪 */}
                <Svg width={width} height={layout.height} style={{ position: 'absolute', left: 0, top: 0 }} pointerEvents="none">
                  {lines.map((l) => <Line key={l.key} x1={l.x1} y1={l.y1} x2={l.x} y2={l.y} stroke={colors.sub} strokeWidth={1} strokeOpacity={0.7} />)}
                  {dots.map(([k, p]) => <Circle key={k} cx={p.x} cy={p.y} r={3} fill={tone} stroke={colors.card} strokeWidth={1.5} />)}
                  {mark && <Circle cx={mark.x} cy={mark.y} r={8} fill="none" stroke={colors.text} strokeWidth={1.5} />}
                </Svg>
                {/* 図を押す所（読み上げでは下のチップを使う）。押した点は、図の左上からの位置を図の座標に直す */}
                {canPick && (['front', 'back'] as const).map((view) => (
                  <FigurePress key={view} testID={`${testID}-press-${view}`} scale={scale} onPick={(p) => pick(view, p)}
                    style={{ position: 'absolute', left: view === 'front' ? frontX : backX, top: 0, width: figW, height: PART_FIG_H }} />
                ))}
                {(['left', 'right'] as const).flatMap((side) => layout[side].map((c) => (
                  <DayCallout key={c.kind === 'entry' ? c.key : `more-${side}`} callout={c} entry={c.kind === 'entry' ? byId.get(c.key) : undefined} unit={unit}
                    align={side === 'left' ? 'right' : 'left'} style={{ [side]: 0, top: c.top, width: calloutW }} />
                )))}
              </>
            )}
          </View>
        )}
      </View>
      {body3D.on && DayBodyAttribution && <DayBodyAttribution />}
      {canPick && <PartChips date={date} pickParts={pickParts} picked={picked} testID={`${testID}-parts`} />}
    </Card>
  );
}

/** 英字の小さな見出しの字体（数字の字体で字間を空ける。ケガの画面の INJ-01 と同じ） */
const monoStyle = { fontFamily: fonts.num, fontSize: 11, lineHeight: 14, letterSpacing: 1.5 } as const;

/**
 * 図の横の札：EX-01（種目のカードの番号の緑）・種目・いちばん重いセット。「+N」は出せなかった種目の番号。
 * align は文字を寄せる側（図の左の札は図の側の右に寄せる）。名前は 1 行で、長ければ省く（下のカードと読み上げは全部）
 */
function DayCallout({ callout, entry, unit, align, style }: {
  callout: PlacedCallout; entry?: FigureEntry; unit: WeightUnit; align: 'left' | 'right'; style: object;
}) {
  const numColor = colors.accent;
  // 札の文字は図の読み上げ（番号・種目・部位）で読むので、札そのものは読み上げから隠す（二重に読まない）
  const hide = { 'aria-hidden': true, importantForAccessibility: 'no-hide-descendants', accessibilityElementsHidden: true } as const;
  const box = [{ position: 'absolute', height: CALLOUT_H, justifyContent: 'center', alignItems: align === 'right' ? 'flex-end' : 'flex-start' } as const, style];
  if (callout.kind === 'more') {
    return (
      <View style={box} testID="day-callout-more" {...hide}>
        <T style={[monoStyle, { color: numColor }]}>{`+${callout.nos.length}`}</T>
        <T style={[monoStyle, { color: colors.sub }]} numberOfLines={2} align={align}>{callout.nos.map((n) => exerciseNumber(n)).join(' ')}</T>
      </View>
    );
  }
  return (
    <View style={box} testID="day-callout" {...hide}>
      <T style={[monoStyle, { color: numColor }]}>{exerciseNumber(callout.no)}</T>
      <T variant="labelM" numberOfLines={1} align={align}>{entry?.exerciseName ?? ''}</T>
      <T size={11} style={{ lineHeight: 16 }} color={colors.sub} numberOfLines={1} align={align}>{entry ? calloutSet(entry.sets, unit) : ''}</T>
    </View>
  );
}

/**
 * まとめの1つの欄（見出しと値）。text は値が文字（部位の名前）のとき：数字の欄と同じ行の高さで、1行に収める（縮められる欄にする）。
 * spoken を渡すと、見出しと値をまとめて読み上げる（値を短くした欄で、読み上げではすべてを言う）
 */
function Stat({ label, value, center, right, text, spoken, testID }: {
  label: string; value: string; center?: boolean; right?: boolean; text?: boolean; spoken?: string; testID?: string;
}) {
  return (
    <View
      style={{ alignItems: center ? 'center' : right ? 'flex-end' : 'flex-start', flexShrink: text ? 1 : 0, minWidth: 0 }}
      accessible={spoken != null} accessibilityLabel={spoken != null ? `${label} ${spoken}` : undefined} testID={testID}
    >
      <T variant="labelM" color={colors.sub}>{label}</T>
      {text
        ? <T variant="titleM" style={{ lineHeight: 28 }} numberOfLines={1}>{value}</T>
        : <T variant="numM" bold>{value}</T>}
    </View>
  );
}
