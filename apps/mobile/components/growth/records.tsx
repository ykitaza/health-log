// 「成長を見る」画面の下の「成長の記録」（Figma 成長 11-2）：見出しと、6枚のカード。計算はどれも lib（growth.ts・growthRecords.ts・partBalance.ts）
import { router } from 'expo-router';
import { ReactNode, useMemo, useState } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import Animated, { AnimatedStyle } from 'react-native-reanimated';
import { Icon } from '@/components/Icon';
import { PressableScale } from '@/components/motion';
import { PartStackRadar } from '@/components/PartBalance';
import { T } from '@/components/Text';
import { DateKey, formatMonthDay } from '@/lib/date';
import { firstRecordDate, growthScore, GrowthScore, SCORE_MAX, scoreDetail, weeklyScores, WeekScore } from '@/lib/growth';
import type { GrowthData } from '@/lib/growthData';
import {
  big3CardLabel, big3Growth, bodyCardLabel, bodyChange, BodyChange, bodyDatesNote, carsCount, partsCardLabel, partsNote, pbRowText, pbTimeline,
  pctText, recordsSpan, scoreCardLabel, scoreDetailLines, signedText, totals, totalsCardLabel, volumeText, weekBarsEnds,
} from '@/lib/growthRecords';
import { GROWTH_SCORE_NOTE, scoreDiff } from '@/lib/home';
import { partBalance, partBalanceBetween } from '@/lib/partBalance';
import { fmt1, kgToUnit, trimNumber, WeightUnit } from '@/lib/units';
import { colors, growthColors, space } from '@/theme';
import { SatMark } from './player';

/** 見出しの高さ（dp）。成長を見る画面は、止まったときに①の頭をのぞかせるため、この分カードを上に寄せる */
export const RECORDS_HEADING_H = 56;
/** カードのあいだ（見出しと①のあいだも） */
const CARD_GAP = 10;
/** 見出しの上の端から①の上の端まで */
export const RECORDS_HEAD_OFFSET = RECORDS_HEADING_H + CARD_GAP;

/** カードの地（Figma：surface-high の 96%。後ろの暗くぼけた形がわずかに透ける） */
const CARD_BG = 'rgba(34,38,45,0.96)';
/** 週ごとの点数の棒（今週より前）・BIG3 の始めたときの棒の色 */
const PAST_BAR = 'rgba(110,117,128,0.55)';
const START_BAR = '#6E7580';
/** 棒の地 */
const TRACK = 'rgba(255,255,255,0.08)';

const openTrend = () => router.navigate({ pathname: '/training', params: { view: 'trend' } });

/**
 * 成長の記録：見出し（始めたとき → 今日・日数）と、カード①〜⑥。数字は動かさない（スクロールで何度も出入りするため）。
 * 記録が少なくても壊れない（0件・1件・体組成なし・BIG3 の割り当てなし）
 */
export function GrowthRecords({ data, headingStyle }: {
  data: GrowthData;
  /** 見出しの動き（成長を見る画面で、スクロールしてから見せる。止まったときにのぞくのは①の頭だけにするため） */
  headingStyle?: AnimatedStyle<ViewStyle>;
}) {
  const { today, weightUnit: unit } = data;
  const m = useMemo(() => {
    const start = firstRecordDate(data.days, today);
    const partName = (id: string) => data.partNames.get(id) ?? '';
    return {
      span: recordsSpan(start, today),
      start,
      score: start == null ? null : growthScore(data.days, today, data.weeklyTrainingGoal),
      detail: scoreDetail(data.days, today, data.weeklyTrainingGoal),
      weeks: weeklyScores(data.days, today, data.weeklyTrainingGoal),
      lifts: big3Growth(data.sets, data.big3, today),
      weight: bodyChange(data.weights.map((w) => ({ date: w.date, value: w.weightKg })), today),
      fat: bodyChange(data.bodyFats.map((f) => ({ date: f.date, value: f.pct })), today),
      totals: totals(data.sets, data.mealCount, today),
      allParts: partBalanceBetween(data.sets, partName, null, today),
      recentParts: partBalance(data.sets, partName, today),
      pbs: pbTimeline(data.sets, today),
    };
  }, [data, today]);

  return (
    // 見出しは止まったときタイムラプスの線に重なる（見えない）ので、指の操作は下へ通す
    <View style={s.root} pointerEvents="box-none" testID="growth-records">
      <Animated.View
        accessible accessibilityRole="header" accessibilityLabel={m.span?.label ?? '成長の記録'} style={[s.heading, headingStyle]}
        pointerEvents="none" testID="growth-records-heading"
      >
        <T size={20} bold style={{ lineHeight: 28 }}>成長の記録</T>
        <T variant="bodyS" color={colors.sub} numberOfLines={1}>{m.span?.text ?? '記録を始めると、ここに成長の記録がたまります'}</T>
      </Animated.View>
      <ScoreCard score={m.score} detail={m.detail} weeks={m.weeks} first={m.start} />
      <Big3Card lifts={m.lifts} assigned={Object.values(data.big3).some(Boolean)} unit={unit} />
      <BodyCard weight={m.weight} fat={m.fat} unit={unit} />
      <TotalsCard t={m.totals} unit={unit} />
      <PartsCard all={m.allParts} recent={m.recentParts} />
      <PbCard pbs={m.pbs} names={data.exerciseNames} unit={unit} />
    </View>
  );
}

/** カードの枠と、上の行（左に名前、右に添え書き） */
function Card({ title, right, label, testID, children, after }: {
  title: string; right?: string; label: string; testID: string; children: ReactNode; after?: ReactNode;
}) {
  return (
    <View style={s.card} testID={testID}>
      {/* 読み上げは中身をまとめて1つに（数字を含む名前）。押せるもの（after）は外に置き、別に選べるようにする */}
      <View accessible accessibilityRole="summary" accessibilityLabel={label} style={s.cardBody}>
        <View style={s.cardHead}>
          <T variant="labelS" color={colors.sub}>{title}</T>
          {right != null && <T variant="labelS" color={colors.sub}>{right}</T>}
        </View>
        {children}
      </View>
      {after}
    </View>
  );
}

const Note = ({ children }: { children: ReactNode }) => <T variant="labelS" bold={false} color={colors.sub}>{children}</T>;
const diffColor = (dir: 'up' | 'down' | 'flat') => (dir === 'up' ? colors.accent : colors.sub);

// ── ① 成長スコアの内訳 ──

function ScoreCard({ score, detail, weeks, first }: {
  score: GrowthScore | null; detail: ReturnType<typeof scoreDetail>; weeks: WeekScore[]; first: DateKey | null;
}) {
  const diff = score ? scoreDiff(score.diffFromLastWeek) : null;
  const lines = score ? scoreDetailLines(detail, score) : null;
  const ends = weekBarsEnds(weeks, first);
  return (
    <Card title="成長スコアの内訳" right="直近7日" label={scoreCardLabel(score, weeks)} testID="growth-card-score">
      <View style={s.rowBetween}>
        <View style={s.baseline}>
          <T num bold size={44} style={{ lineHeight: 52 }}>{score ? score.total : '—'}</T>
          <T variant="bodyS" color={colors.sub}>/ 100</T>
        </View>
        {diff && <T variant="bodyS" color={diffColor(diff.dir)}>{diff.text}　先週より</T>}
      </View>
      {score && lines ? (
        <>
          <Pillar kind="training" name="筋トレ" points={score.training.points} max={SCORE_MAX.training} line={lines.training} />
          <Pillar kind="food" name="食事" points={score.meal.points} max={SCORE_MAX.meal} line={lines.meal} />
          <Pillar kind="sleep" name="睡眠" points={score.sleep.points} max={SCORE_MAX.sleep} line={lines.sleep} />
          <View style={{ gap: space.s, marginTop: space.xs }}>
            <Note>週ごとの点数（今日で終わる7日を、7日ずつさかのぼって）</Note>
            <View style={[s.weekBars, { gap: weeks.length > 40 ? 1 : 4 }]} testID="growth-week-bars">
              {weeks.map((w, i) => (
                <View
                  key={w.end}
                  style={[s.weekBar, { height: 4 + (w.total / 100) * 36, backgroundColor: i === weeks.length - 1 ? colors.accent : PAST_BAR }]}
                />
              ))}
            </View>
            {ends && (
              <View style={s.rowBetween}>
                <Note>{ends.left}</Note>
                <T variant="labelS">{ends.right}</T>
              </View>
            )}
          </View>
        </>
      ) : <Note>まだ記録がありません</Note>}
      <Note>{GROWTH_SCORE_NOTE}</Note>
    </Card>
  );
}

/** 柱の1つ。満点の長さは配点（40:30:30）に合わせ、筋トレを幅いっぱいにする */
function Pillar({ kind, name, points, max, line }: { kind: 'training' | 'food' | 'sleep'; name: string; points: number | null; max: number; line: string }) {
  const full = max / SCORE_MAX.training;
  return (
    <View style={{ gap: 4 }}>
      <View style={s.rowBetween}>
        <View style={s.rowCenter}>
          <SatMark kind={kind} size={10} />
          <T variant="labelM">{name}</T>
        </View>
        <T num bold size={18}>{points == null ? '—' : `${Math.round(points)} / ${max}`}</T>
      </View>
      <View style={[s.track, { width: `${full * 100}%`, backgroundColor: 'rgba(255,255,255,0.10)' }]}>
        {points != null && <View style={[s.fill, { width: `${(points / max) * 100}%`, backgroundColor: growthColors[kind] }]} />}
      </View>
      <Note>{line}</Note>
    </View>
  );
}

// ── ② 強くなった ──

function Big3Card({ lifts, assigned, unit }: { lifts: ReturnType<typeof big3Growth>; assigned: boolean; unit: WeightUnit }) {
  const w = (kg: number) => trimNumber(Math.round(kgToUnit(kg, unit) * 10) / 10);
  // 棒の目盛り：いちばん大きい今の値を、50 の倍数に切り上げた値まで
  const scale = Math.max(50, Math.ceil(Math.max(0, ...lifts.map((l) => l.nowKg)) / 50) * 50);
  return (
    <Card title="強くなった（BIG3 の推定1RM）" right="始めたとき → 今" label={big3CardLabel(lifts, unit)} testID="growth-card-big3">
      {lifts.length === 0 ? (
        <Note>{assigned ? 'BIG3 の記録がまだありません' : '筋トレの種目で BIG3 を決めると、ここに伸びが出ます'}</Note>
      ) : lifts.map((l) => {
        const pct = pctText(l.pct);
        return (
          <View key={l.role} style={{ gap: 4 }}>
            <View style={s.rowBetween}>
              <View>
                <T variant="labelM">{l.name}</T>
                <Note>始めたとき {formatMonthDay(l.startDate)}</Note>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <View style={s.baseline}>
                  <T num bold size={20} color={colors.sub}>{w(l.startKg)}</T>
                  <T variant="bodyS" color={colors.sub}>→</T>
                  <T num bold size={30} style={{ lineHeight: 34 }}>{w(l.nowKg)}</T>
                  <T variant="labelS" color={colors.sub}>{unit}</T>
                </View>
                {pct && <T variant="labelM" color={diffColor(pct.dir)}>{pct.text}</T>}
              </View>
            </View>
            <View style={[s.track, { backgroundColor: TRACK }]}>
              <View style={[s.fill, { width: `${(l.nowKg / scale) * 100}%`, backgroundColor: colors.accent }]} />
              <View style={[s.fill, { width: `${(l.startKg / scale) * 100}%`, backgroundColor: START_BAR }]} />
            </View>
          </View>
        );
      })}
      <Note>推定1RM ＝ 重量 ×（1 ＋ 回数 ÷ 30）。始めたとき＝その種目を最初に記録した日</Note>
    </Card>
  );
}

// ── ③ 体の変化 ──

function BodyCard({ weight, fat, unit }: { weight: BodyChange | null; fat: BodyChange | null; unit: WeightUnit }) {
  const note = bodyDatesNote(weight, fat);
  return (
    <Card title="体の変化" right="始めたとき → 今" label={bodyCardLabel(weight, fat, unit)} testID="growth-card-body">
      {weight || fat ? (
        <View style={{ flexDirection: 'row' }}>
          {weight && (
            <BodyColumn
              name="体重" from={kgToUnit(weight.from.value, unit)} to={kgToUnit(weight.to.value, unit)} unit={unit}
              change={`始めたときから ${signedText(kgToUnit(weight.to.value, unit) - kgToUnit(weight.from.value, unit))} ${unit}`}
            />
          )}
          {weight && fat && <View style={s.divider} />}
          {fat && <BodyColumn name="体脂肪率" from={fat.from.value} to={fat.to.value} unit="%" change={`始めたときから ${signedText(fat.diff)} ポイント`} />}
        </View>
      ) : <Note>体重と体脂肪率の記録がまだありません</Note>}
      {note && <Note>{note}</Note>}
    </Card>
  );
}

/** 体重・体脂肪率の1列。良し悪しの色は付けない */
function BodyColumn({ name, from, to, unit, change }: { name: string; from: number; to: number; unit: string; change: string }) {
  return (
    <View style={{ flex: 1, gap: 4 }}>
      <T variant="labelM">{name}</T>
      <View style={s.baseline}>
        <T num bold size={20} color={colors.sub}>{fmt1(from)}</T>
        <T variant="bodyS" color={colors.sub}>→</T>
        <T num bold size={30} style={{ lineHeight: 34 }}>{fmt1(to)}</T>
        <T variant="labelS" color={colors.sub}>{unit}</T>
      </View>
      <Note>{change}</Note>
    </View>
  );
}

// ── ④ 積み重ね ──

function TotalsCard({ t, unit }: { t: ReturnType<typeof totals>; unit: WeightUnit }) {
  const v = volumeText(t.volumeKg, unit);
  return (
    <Card title="積み重ね（これまで）" label={totalsCardLabel(t, unit)} testID="growth-card-totals">
      <T variant="labelM">総負荷量</T>
      <View style={s.rowBetween}>
        <View style={s.baseline}>
          <T num bold size={40} style={{ lineHeight: 46 }}>{v.value}</T>
          <T variant="labelM" color={colors.sub}>{v.unit}</T>
        </View>
        {/* 乗用車（1台 1.5t。ホームの合計負荷量の車のたとえと同じ） */}
        <View style={s.rowCenter}>
          <Icon name="car" size={18} color={colors.accent} />
          <T variant="labelM" color={colors.accent}>× {carsCount(t.cars)} 台分</T>
        </View>
      </View>
      <View style={s.hr} />
      <View style={{ flexDirection: 'row' }}>
        <Stat name="筋トレした日" value={t.trainingDays} unit="日" />
        <Stat name="記録した食事" value={t.meals} unit="食" />
        <Stat name="いちばん長い連続" value={t.longestStreak} unit="日" />
      </View>
    </Card>
  );
}

function Stat({ name, value, unit }: { name: string; value: number; unit: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Note>{name}</Note>
      <View style={s.baseline}>
        <T num bold size={28} style={{ lineHeight: 34 }}>{value}</T>
        <T variant="labelS" color={colors.sub}>{unit}</T>
      </View>
    </View>
  );
}

// ── ⑤ 部位の積み重ね ──

function PartsCard({ all, recent }: { all: ReturnType<typeof partBalance>; recent: ReturnType<typeof partBalance> }) {
  const [width, setWidth] = useState(0);
  const note = partsNote(all, recent);
  return (
    <Card title="部位の積み重ね" right="セット数" label={partsCardLabel(all, recent)} testID="growth-card-parts">
      {all.total === 0 ? <Note>筋トレを記録すると、部位ごとの形になります</Note> : (
        <>
          <View style={s.rowCenter}>
            <View style={[s.legendLine, { borderColor: colors.accent, borderStyle: 'solid' }]} />
            <T variant="labelS" bold={false}>これまで</T>
            <View style={[s.legendLine, { borderColor: colors.text, borderStyle: 'dashed', marginLeft: space.l }]} />
            <T variant="labelS" bold={false}>直近2週</T>
          </View>
          <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
            {width > 0 && <PartStackRadar all={all} recent={recent} width={width} />}
          </View>
          {note && <Note>{note}</Note>}
        </>
      )}
    </Card>
  );
}

// ── ⑥ 自己ベストの年表 ──

function PbCard({ pbs, names, unit }: { pbs: ReturnType<typeof pbTimeline>; names: ReadonlyMap<string, string>; unit: WeightUnit }) {
  const rows = pbs.map((e) => ({ e, name: names.get(e.exerciseId) ?? '種目', text: pbRowText(e, names.get(e.exerciseId) ?? '種目', unit) }));
  const label = rows.length === 0 ? '自己ベストの年表。まだ自己ベストの更新がありません'
    : `自己ベストの年表、更新した日を新しい順に${rows.length}件。${rows.map((r) => r.text.label).join('。')}`;
  return (
    <Card
      title="自己ベストの年表" right="新しい順" label={label} testID="growth-card-pb"
      after={rows.length > 0 && (
        // 自己ベストの一覧は筋トレの推移にある
        <PressableScale accessibilityRole="button" accessibilityLabel="自己ベストをすべて見る。筋トレの推移を開く" onPress={openTrend} style={s.more} testID="growth-pb-more">
          <T variant="labelM" color={colors.accent}>すべて見る ›</T>
        </PressableScale>
      )}
    >
      {rows.length === 0 ? <Note>同じ種目で前の記録を超えると、ここに並びます</Note> : (
        <View>
          <View style={s.timeline} />
          {rows.map((r, i) => (
            <View key={`${r.e.date}-${r.e.exerciseId}`} style={s.pbRow}>
              <View style={[s.pbDot, i === 0 ? { backgroundColor: colors.accent } : { backgroundColor: CARD_BG, borderWidth: 2, borderColor: colors.accent }]} />
              <View style={{ flex: 1 }}>
                <Note>{formatMonthDay(r.e.date)}</Note>
                <T variant="labelL">{r.name}</T>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Note>{r.text.e1rm}</Note>
                <T num bold size={20}>{r.text.set}</T>
              </View>
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}

const s = StyleSheet.create({
  root: { paddingHorizontal: space.screen, gap: CARD_GAP },
  heading: { height: RECORDS_HEADING_H, justifyContent: 'center', gap: space.xs, paddingHorizontal: space.s },
  card: { backgroundColor: CARD_BG, borderRadius: 12, paddingHorizontal: space.l, paddingVertical: 14 },
  cardBody: { gap: space.s },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.s },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.s },
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  baseline: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 2 },
  // 週が少ないときも棒を太くしない（Figma の 23週で幅 11）。両はしの棒を、下の両はしの文字にそろえる
  weekBars: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 44 },
  weekBar: { flex: 1, maxWidth: 12, borderRadius: 2 },
  divider: { width: 1, backgroundColor: TRACK, marginHorizontal: space.l },
  hr: { height: 1, backgroundColor: TRACK, marginVertical: 2 },
  legendLine: { width: 20, height: 0, borderTopWidth: 2 },
  timeline: { position: 'absolute', left: 4, top: 10, bottom: 18, width: 2, backgroundColor: 'rgba(110,117,128,0.6)' },
  pbRow: { flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 48, paddingVertical: 4 },
  pbDot: { width: 10, height: 10, borderRadius: 5 },
  more: { minHeight: 48, alignItems: 'flex-end', justifyContent: 'center', borderTopWidth: 1, borderTopColor: TRACK, marginTop: space.s },
});
