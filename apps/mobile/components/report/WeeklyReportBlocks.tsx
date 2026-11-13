// 週のまとめの中身（モックの「今週」のタブ）のうち、アプリが端末の記録から組み立てるブロック。
// - WeeklyRadarBlock：レポートの週の終わりを起点にした直近14日の部位のバランス（lib/partBalance.ts のアンカー版。ホームのレーダーと同じ集計）
// - WeeklyStatusBlock：WEEKLY STATUS の表。今週の目標（lib/reports.ts の weeklyAchievementRows と連続）、週の平均の体重、合計負荷量、最近の部位。
//   目標の行の下に「達成」と連続、「目標を変える ›」（設定の今週の目標の欄へ）
// - InjuryReviewBlock：その週のケガの振り返り（lib/injuryReport.ts の3分類。数を表にし、ケガは1件ずつ2段の行で）
// - PrevTodoBlock：先週やることの振り返り（前の週のまとめの次の一歩と済んだか。見るだけ）
// - MetricTilesBlock：レポートの highlights の指標のタイル（2列）
// 色はミント（colors.accent）＋モノクロだけ（ケガの画面の琥珀色も、調子の色も使わない）
import { router } from 'expo-router';
import { ReactNode, useState } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Circle, Line, Polygon, Text as SvgText } from 'react-native-svg';
import { useFocusData, useGoalStreak, useWeeklyAchievement } from '@/hooks/data';
import { weekAverage } from '@/lib/body';
import type { DateKey } from '@/lib/date';
import { addDays, todayKey } from '@/lib/date';
import { tonnes } from '@/lib/format';
import { allGoalsReached, weekOf } from '@/lib/goals';
import { TodoWeek, todoAllDone, todoCount, WEEKLY_GOALS_SECTION, weekRangeLabel } from '@/lib/home';
import { RESULTS } from '@/lib/injuries';
import { injuryPeriodInjuryCount, loadInjuryPeriodReport, type InjuryReportEntry } from '@/lib/injuryReport';
import { BALANCE_PARTS, partBalanceAnchored, partBalancePeriodLabel } from '@/lib/partBalance';
import { achievementRowLabel, AREA_LABELS, deltaLook, formatDelta, formatMetricValue, Highlight, Metric, metricLabel, weeklyAchievementRows, weekStreakText } from '@/lib/reports';
import { periodPartSequence, periodVolumeKg, uniqueInjuryEntries } from '@/lib/reportView';
import { fmt1, kgToUnit } from '@/lib/units';
import { fonts } from '@/theme';
import { T } from '../Text';
import { dotMonthDay, hud, JaVal, Micro, Mono, Panel, PanelHead, StatusRow, TableHead, ValUnit } from './hud';

/** 6つの軸の向き（モックの並び：胸 左上・肩 右上・背中 右・腕 右下・脚 左下・腹 左） */
const AXIS_DEG = [-120, -60, 0, 60, 120, 180];
const CX = 110;
const CY = 95;
const R = 70;
const at = (i: number, r: number) => {
  const a = (AXIS_DEG[i] * Math.PI) / 180;
  return { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) };
};
const ring = (k: number) => AXIS_DEG.map((_, i) => at(i, R * k)).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

/**
 * 週の部位のバランスのレーダー：レポートの週の終わりの日（end）を起点にした直近14日のセット数。
 * 頂点の長さは partBalance の ratios（セット数の平方根を最大の軸で割ったもの）。軸の数値は出さない（モックと同じ）
 */
export function WeeklyRadarBlock({ end }: { end: DateKey }) {
  const spanStart = addDays(end, -13);
  const { data: balance } = useFocusData(async (r) => {
    const [rows, parts] = await Promise.all([r.workouts.allSetRows(), r.catalog.listBodyParts({ includeHidden: true })]);
    const names = new Map(parts.map((p) => [p.id, p.name]));
    return partBalanceAnchored(rows, (id) => names.get(id) ?? '', end);
  }, end);
  const [width, setWidth] = useState(0);
  if (!balance) return null;
  const topIdx = balance.sets.indexOf(Math.max(...balance.sets));
  const note = balance.total === 0
    ? '直近14日間の記録はありません（胸・肩・背中・腕・脚・腹のセット数を数えます）'
    : `いちばん多いのは${BALANCE_PARTS[topIdx]}（${balance.sets[topIdx]}セット）`;
  const shape = balance.ratios.map((v, i) => at(i, R * v));
  const w = Math.min(212, width);
  const labelPos = [{ x: 62, y: 28 }, { x: 158, y: 28 }, { x: 196, y: 99 }, { x: 158, y: 172 }, { x: 62, y: 172 }, { x: 22, y: 99 }];
  return (
    <Panel style={{ paddingHorizontal: 14, paddingTop: 8, paddingBottom: 7 }} testID="report-weekly-radar">
      <PanelHead en="Body-Part Balance" title="部位のバランス" right={`${dotMonthDay(spanStart)}–${dotMonthDay(end)}`} />
      <View accessible accessibilityLabel={partBalancePeriodLabel(balance, spanStart, end)} style={{ marginTop: 2, alignItems: 'center' }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {w > 0 && (
          <Svg width={w} height={(w * 186) / 220} viewBox="0 0 220 186" testID="report-weekly-radar-chart">
            {[1 / 3, 2 / 3, 1].map((k) => <Polygon key={k} points={ring(k)} fill="none" stroke="#2A332D" strokeWidth={1} />)}
            {AXIS_DEG.map((_, i) => { const p = at(i, R); return <Line key={i} x1={CX} y1={CY} x2={p.x} y2={p.y} stroke={hud.line2} strokeWidth={1} />; })}
            {balance.total > 0 && (
              <>
                <Polygon points={shape.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} fill={hud.green} fillOpacity={0.16} stroke={hud.green} strokeWidth={1.6} strokeLinejoin="round" />
                {shape.map((p, i) => <Circle key={i} cx={p.x} cy={p.y} r={2.4} fill={hud.green} />)}
              </>
            )}
            {BALANCE_PARTS.map((name, i) => (
              <SvgText key={name} x={labelPos[i].x} y={labelPos[i].y} fontSize={11} fontWeight="700" fill={hud.label} textAnchor="middle" fontFamily={fonts.bold}>{name}</SvgText>
            ))}
          </Svg>
        )}
      </View>
      <T size={11.5} color={hud.muted} style={{ marginTop: 2, marginBottom: 2, lineHeight: 18 }}>{note}</T>
    </Panel>
  );
}

/** 設定の今週の目標の欄を開く（settings?section=weekly-goals。欄までスクロールする） */
const openGoalSettings = () => router.push({ pathname: '/settings', params: { section: WEEKLY_GOALS_SECTION } });

const GOAL_EN: Record<string, string> = { training: 'Training', meals: 'Meals Logged', protein: 'Protein Days', sleep: 'Sleep 7H+' };

/**
 * WEEKLY STATUS の表（モックの .week-table-card）。上から今週の目標の行（目標は設定の今の値。印と言葉で達成を伝える）、
 * 週の平均の体重、合計負荷量、最近の部位（週の筋トレの日ごとの主な部位）。目標の行の下に、設定の目標（筋トレ・食事の記録・睡眠）が
 * すべて届いたら「✓ 達成」とその週の時点の連続（weekStreakText）、右に「目標を変える ›」
 */
export function WeeklyStatusBlock({ start, end }: { start: DateKey; end: DateKey }) {
  const { data: w } = useWeeklyAchievement(start);
  const { data: streak } = useGoalStreak(start);
  const { data } = useFocusData(async (r) => {
    const [rows, parts, daily, s] = await Promise.all([
      r.workouts.allSetRows(), r.catalog.listBodyParts({ includeHidden: true }), r.body.listDaily(), r.settings.get(),
    ]);
    const names = new Map(parts.map((p) => [p.id, p.name]));
    const weights = daily.filter((d) => d.weightKg != null).map((d) => ({ date: d.date, value: d.weightKg! }));
    return {
      volumeKg: periodVolumeKg(rows, start, end), parts: periodPartSequence(rows, (id) => names.get(id) ?? '', start, end),
      avg: weekAverage(weights, start), unit: s.weightUnit,
    };
  }, `${start}:${end}`);
  if (!w || !data) return null;
  const { rows } = weeklyAchievementRows(w);
  const current = weekOf(todayKey()).start === w.start;
  const achieved = rows.length > 0 && allGoalsReached(w);
  const streakText = streak ? weekStreakText(streak, current) : null;
  const status = [achieved && '設定の目標をすべて達成', streakText].filter(Boolean).join('。');
  const U = data.unit.toUpperCase();
  return (
    <Panel testID="report-achievement">
      <TableHead left="Weekly Status" right={`${dotMonthDay(start)}–${dotMonthDay(end)}`} />
      <View style={{ paddingHorizontal: 14, paddingTop: 2, paddingBottom: 6 }}>
        {rows.map((r) => (
          <StatusRow
            key={r.key}
            en={GOAL_EN[r.key] ?? r.key}
            ja={r.label}
            accessibilityLabel={achievementRowLabel(r)}
            value={(
              <T style={{ textAlign: 'right' }}>
                {r.mark === 'reached' && <Mono size={13} color={hud.green}>{'✓ '}</Mono>}
                <Mono size={14} color={r.mark === 'reached' ? hud.green : hud.white}>{r.value}</Mono>
                <Mono size={12} color={hud.muted}>{` / ${r.goal}`}</Mono>
                <T size={10} color={hud.muted}>{` ${r.unit}`}</T>
              </T>
            )}
          />
        ))}
        <StatusRow en="Week Avg" ja="週間平均体重" value={data.avg != null ? <ValUnit value={fmt1(kgToUnit(data.avg, data.unit))} unit={U} /> : '—'} />
        <StatusRow en="Total Load" ja="合計負荷量" value={<ValUnit value={tonnes(data.volumeKg, data.unit)} unit={data.unit === 'kg' ? 'T' : 'K LB'} />} />
        <StatusRow en="Recent" ja="最近の部位" last wide value={data.parts.length > 0 ? <JaVal>{data.parts.join(' → ')}</JaVal> : <Mono size={12} color={hud.muted}>記録なし</Mono>} />
      </View>
      {rows.length > 0 && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, borderTopColor: hud.line2, paddingLeft: 14 }}>
          <View accessible={status !== ''} accessibilityLabel={status || undefined} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: 8 }}>
            {achieved && <T bold size={12.5} color={hud.green} testID="report-goals-achieved">✓ 達成</T>}
            {streakText && <T size={11.5} color={hud.muted} testID="report-goal-streak">{streakText}</T>}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="目標を変える" onPress={openGoalSettings} testID="report-goals-edit"
            style={{ minHeight: 44, paddingHorizontal: 14, justifyContent: 'center' }}>
            <T bold size={12} color={hud.green}>目標を変える ›</T>
          </Pressable>
        </View>
      )}
    </Panel>
  );
}

/** 振り返りの結果の点（直せた＝ミントの塗り、まだ＝灰色の塗り、痛んだ＝輪だけ。色だけでなく形でも見分ける） */
function ReviewDot({ result }: { result: keyof typeof RESULTS }) {
  const base = { width: 10, height: 10, borderRadius: 5 } as const;
  if (result === 'fixed') return <View style={[base, { backgroundColor: hud.green }]} />;
  if (result === 'not_yet') return <View style={[base, { backgroundColor: hud.muted }]} />;
  return <View style={[base, { borderWidth: 1.5, borderColor: hud.muted }]} />;
}

/** ケガ1件（モックの .inj-group）：番号と日付の頭、2段の行（部位・発生日・種目・場面・症状・原因・直し方・状態・振り返り） */
function InjuryGroup({ entry, showReviews }: { entry: InjuryReportEntry; showReviews: boolean }) {
  const long = (v: string) => <JaVal weight="regular" size={12.5}>{v}</JaVal>;
  const rows: { en: string; ja: string; value: ReactNode }[] = [
    { en: 'Site', ja: '部位', value: <JaVal>{entry.siteName}</JaVal> },
    { en: 'Date', ja: '発生日', value: dotMonthDay(entry.occurredOn) },
    { en: 'Exercise', ja: '種目', value: entry.exercise ? <JaVal>{entry.exercise}</JaVal> : <Mono size={12} color={hud.muted}>種目なし</Mono> },
    ...(entry.phase.trim() !== '' ? [{ en: 'Phase', ja: '場面', value: <JaVal>{entry.phase.trim()}</JaVal> }] : []),
    ...(entry.symptom.trim() !== '' ? [{ en: 'Symptom', ja: '症状', value: long(entry.symptom.trim()) }] : []),
    ...(entry.cause.trim() !== '' ? [{ en: 'Cause', ja: '原因', value: long(entry.cause.trim()) }] : []),
    ...(entry.fix.trim() !== '' ? [{ en: 'Fix', ja: '次の直し方', value: long(entry.fix.trim()) }] : []),
    {
      en: 'Status', ja: '状態', value: (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: entry.status === 'fixed' ? hud.green : hud.muted }} />
          <T bold size={12.5} color={entry.status === 'fixed' ? hud.green : hud.label}>{entry.statusLabel}</T>
        </View>
      ),
    },
    ...(entry.fixedOn != null ? [{ en: 'Fixed On', ja: '直せた日', value: dotMonthDay(entry.fixedOn) }] : []),
    {
      en: 'Reviews', ja: '振り返り', value: showReviews
        ? <T style={{ textAlign: 'right' }}><Mono size={14} color={hud.white}>{String(entry.periodReviewCount)}</Mono><T size={10} color={hud.muted}>{` 回（これまで${entry.reviewCount}回）`}</T></T>
        : <T style={{ textAlign: 'right' }}><Mono size={14} color={hud.white}>{String(entry.reviewCount)}</Mono><T size={10} color={hud.muted}> 回</T></T>,
    },
  ];
  const reviews = showReviews ? [...entry.periodReviews].reverse() : [];
  const reviewsLabel = reviews.map((r) => `${dotMonthDay(r.date)} ${RESULTS[r.result].mark}${r.resultLabel}`).join('、');
  const latestNote = entry.periodReviews[0]?.note.trim();
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: hud.line2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, paddingHorizontal: 14, paddingTop: 9, paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: hud.line2 }}>
        <Mono size={11} spacing={1.5} color={hud.green}>{entry.number}</Mono>
        <Mono size={12} color={hud.muted}>{dotMonthDay(entry.occurredOn)}</Mono>
      </View>
      <View style={{ paddingHorizontal: 14, paddingTop: 2, paddingBottom: 6 }}>
        {rows.map((r, i) => <StatusRow key={r.en} en={r.en} ja={r.ja} value={r.value} last={i === rows.length - 1 && reviews.length === 0} wide />)}
        {reviews.length > 0 && (
          <StatusRow en="Results" ja="振り返りの結果" last={!latestNote} accessibilityLabel={`振り返りの結果。${reviewsLabel}`} value={(
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 4 }} testID={`report-injury-dots-${entry.id}`}>
              {reviews.map((r) => <ReviewDot key={r.id} result={r.result} />)}
            </View>
          )} />
        )}
        {reviews.length > 0 && latestNote ? (
          <T size={12} color={hud.muted} style={{ paddingVertical: 6 }}>{`メモ（${dotMonthDay(entry.periodReviews[0].date)}）：${latestNote}`}</T>
        ) : null}
      </View>
    </View>
  );
}

/**
 * 週のケガの振り返り（INJURY REVIEW）：期間の3分類（痛めた・振り返った・直している途中。lib/injuryReport.ts、サーバーの period_overview と同じ決まり）の
 * 件数を表にし、その下にケガを1件ずつ（3分類のどれかに入るものを、重ねずに）。期間に振り返ったケガは、その期間の振り返りの結果も出す。
 * 期間にどの分類にも入るケガがなければ出さない
 */
export function InjuryReviewBlock({ start, end }: { start: DateKey; end: DateKey }) {
  const { data } = useFocusData((r) => loadInjuryPeriodReport(r, start, end), `${start}:${end}`);
  if (!data || injuryPeriodInjuryCount(data) === 0) return null;
  const counts = [
    { en: 'Occurred', ja: '期間内に痛めた', n: data.occurredTotal },
    { en: 'Reviewed', ja: '期間内に振り返った', n: data.reviewedTotal },
    { en: 'Fixing', ja: '直している途中', n: data.fixingTotal },
  ].filter((c) => c.n > 0);
  const entries = uniqueInjuryEntries(data);
  return (
    <Panel testID="report-injury-review" accessibilityLabel="ケガの振り返り">
      <TableHead left="Injury Review" right={`${dotMonthDay(start)}–${dotMonthDay(end)}`} />
      <View style={{ paddingHorizontal: 14, paddingTop: 2, paddingBottom: 6 }}>
        {counts.map((c, i) => (
          <StatusRow key={c.en} en={c.en} ja={c.ja} last={i === counts.length - 1} accessibilityLabel={`${c.ja} ${c.n}件`}
            value={<T style={{ textAlign: 'right' }}><Mono size={14} color={hud.white}>{String(c.n)}</Mono><T size={10} color={hud.muted}> 件</T></T>} />
        ))}
      </View>
      {entries.map(({ entry, reviewed }) => <InjuryGroup key={entry.id} entry={entry} showReviews={reviewed} />)}
    </Panel>
  );
}

/** 先週やることの振り返り：前の週のまとめの次の一歩と、済んだか（見るだけ。チェックはホームとその週の詳細で） */
export function PrevTodoBlock({ week }: { week: TodoWeek }) {
  const count = todoCount(week.steps, week.done);
  return (
    <Panel>
      <View style={{ paddingHorizontal: 14, paddingTop: 10 }}>
        <PanelHead en="Last Week Review" title="先週やることの振り返り" />
      </View>
      <View testID="report-prev-todo" style={{ paddingHorizontal: 14, paddingBottom: 6, marginTop: 6, borderTopWidth: 1, borderTopColor: hud.line2 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: 8, paddingBottom: 2 }}>
          <T bold size={12.5} color={hud.label} accessibilityRole="header">{`${weekRangeLabel(week.start)}にやること`}</T>
          <T size={12} color={todoAllDone(week.steps, week.done) ? hud.green : hud.muted} accessibilityLabel={`${week.steps.length}つのうち${count}つ済み`}>{`${count}／${week.steps.length}`}</T>
        </View>
        {week.steps.map((step, i) => {
          const done = week.done.includes(i);
          return (
            <StatusRow key={i} en={`Focus ${String(i + 1).padStart(2, '0')}`} ja={step} last={i === week.steps.length - 1} wide
              accessibilityLabel={`${step}、${done ? '済み' : 'まだ'}`}
              value={<T bold size={12} color={done ? hud.green : hud.muted}>{done ? '✓ 済み' : 'まだ'}</T>} />
          );
        })}
      </View>
    </Panel>
  );
}

const AREA_EN = { training: 'Training', meals: 'Meals', body: 'Body', sleep: 'Sleep' } as const;

/** 指標のタイル（モックの .tile、2列）：英字の分野、値、名前と変化 */
export function MetricTilesBlock({ tiles, vs }: { tiles: (Highlight & { metric: Metric })[]; vs: string }) {
  if (tiles.length === 0) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} testID="report-tiles">
      {tiles.map((h, i) => {
        const m = h.metric;
        const look = deltaLook(m);
        return (
          <Panel key={i} style={{ flexBasis: '45%', flexGrow: 1, paddingHorizontal: 12, paddingVertical: 10 }} accessible accessibilityLabel={`${AREA_LABELS[h.area]}、${metricLabel(m)}`}>
            <Micro green={look?.quality === 'good'}>{AREA_EN[h.area]}</Micro>
            <T style={{ marginTop: 4 }}>
              <Mono size={24} color={look?.quality === 'good' ? hud.green : hud.white}>{formatMetricValue(m.value)}</Mono>
              {m.unit !== '' && <T size={12} color={hud.muted}>{m.unit}</T>}
            </T>
            <T size={11} color={hud.muted} style={{ marginTop: 3 }}>
              {m.delta != null ? `${m.label} ・ ${look?.arrow === 'up' ? '↑' : look?.arrow === 'down' ? '↓' : '→'} ${formatDelta(m.delta)}${m.unit ? ` ${m.unit}` : ''} ${vs}` : m.label}
            </T>
          </Panel>
        );
      })}
    </View>
  );
}
