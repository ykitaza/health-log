// レポート詳細のいちばん上のパネル（モックの .hero）。種類で中身を変える：
// - 日：その日の体重のリング（次の節目までの進み具合）、前の日との差、28日の傾向、28日の体重の折れ線、目標体重までの棒
// - 週：週の体重の平均（大きな数字）、最新の体重と平均の比べ、要約、目標体重までの棒
// - 月：目標への進み具合（大きな現在の値。MonthlyReportBlocks の目標と同じ bodyChange・weightGoalProgress）、節目、目標体重までの棒
// 目標体重までの棒は lib/reportView.ts の weightGoalProgress（増量は 0kg から目標まで、減量は初めの体重から目標まで）
// 上の段（種類と期間のマイクロラベル、期間、調子の札、題、STATUS の行）はどの種類も同じ。
// 数字はアプリの記録から出す（lib/body.ts・lib/goalBar.ts・lib/reports.ts の既存の計算）。体重の記録や目標がなければ、その部分を出さない
import { ReactNode } from 'react';
import { View } from 'react-native';
import { useFocusData } from '@/hooks/data';
import { weekAverage, weeklyPace } from '@/lib/body';
import { addDays, DateKey, formatMonthDay, todayKey } from '@/lib/date';
import { formatSigned } from '@/lib/format';
import { DAY_TYPE_LABELS } from '@/lib/meals';
import { weightGoalProgress } from '@/lib/reportView';
import { bodyChange, formatPeriod, Report, TONE_LABELS, Tone } from '@/lib/reports';
import { fmt1, kgToUnit, WeightUnit } from '@/lib/units';
import { T } from '../Text';
import { dotDate, dotMonthDay, GoalTrack, hud, kgLabel, pace2, Micro, Mono, NotchChip, OutlineTag, Panel, Ring, Spark } from './hud';

const TONE_EN: Record<Tone, string> = { good: 'GOOD', steady: 'STEADY', caution: 'CAUTION' };
const KIND_EN = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY', other: 'OTHER' } as const;

type Scope = { type: 'day'; date: DateKey } | { type: 'week'; date: DateKey } | { type: 'month'; start: DateKey; end: DateKey } | null;

/** 体重の材料（日ごとの体重・単位・目標体重） */
function useBody(key: string) {
  return useFocusData(async (r) => {
    const [daily, s] = await Promise.all([r.body.listDaily(), r.settings.get()]);
    return { daily, unit: s.weightUnit as WeightUnit, goal: s.goalWeightKg ?? null };
  }, key);
}

const weightsOf = (daily: { date: DateKey; weightKg: number | null }[]) =>
  daily.filter((d) => d.weightKg != null).map((d) => ({ date: d.date, value: d.weightKg! }));

export function ReportHero({ report, scope }: { report: Report; scope: Scope }) {
  const daily = scope?.type === 'day' ? scope.date : null;
  // 日のまとめのときだけ、その日の種類（筋トレの日・休みの日）を読む
  const { data: a } = useFocusData(async (r) => (daily ? r.achievements.day(daily) : null), daily ?? 'none');
  const period = formatPeriod(report);
  const kindMicro = `${KIND_EN[report.kind]} REPORT${report.periodStart ? ` // ${dotDate(report.periodStart)}${report.periodEnd && report.periodEnd !== report.periodStart ? `–${dotMonthDay(report.periodEnd)}` : ''}` : ''}`;
  const dayType = daily && a ? a.meals.dayType : null;
  const second = scope?.type === 'day' ? (dayType === 'training' ? 'TRAINING DAY' : 'RECOVERY DAY') : scope?.type === 'week' ? 'WEEKLY AVG' : scope?.type === 'month' ? 'GOAL PROGRESS' : KIND_EN[report.kind];
  const good = report.tone === 'good';
  return (
    <Panel style={{ paddingHorizontal: 14, paddingTop: 10, paddingBottom: 9 }} testID="report-band">
      <Micro>{kindMicro}</Micro>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginTop: 4 }}>
        <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap' }}>
          {period && <T bold size={12.5} color={hud.label}>{period}</T>}
          {dayType && <T bold size={12.5} color={hud.label}>{`・${DAY_TYPE_LABELS[dayType]}`}</T>}
        </View>
        <View accessible accessibilityLabel={`全体の調子、${TONE_LABELS[report.tone]}`}>
          <NotchChip fill={good ? hud.green : undefined} border={good ? undefined : hud.line} style={{ paddingHorizontal: 8, paddingVertical: 3 }}>
            <T bold size={11} color={good ? hud.onGreen : hud.ink}>{TONE_LABELS[report.tone]}</T>
          </NotchChip>
        </View>
      </View>
      <T bold size={15} color={hud.ink} style={{ marginTop: 5, letterSpacing: 0.6 }} accessibilityRole="header">{report.title}</T>
      <Mono size={9.5} spacing={1.7} color={hud.faint} style={{ marginTop: 2 }}>{`STATUS: ${TONE_EN[report.tone]} — ${second}`}</Mono>
      {scope?.type === 'day' && <DailyHeroBody date={scope.date} />}
      {scope?.type === 'week' && report.periodStart && report.periodEnd && <WeeklyHeroBody start={report.periodStart} end={report.periodEnd} note={report.headline} />}
      {scope?.type === 'month' && <MonthlyHeroBody start={scope.start} end={scope.end} />}
    </Panel>
  );
}

/** 目標体重までの棒と、その下の2つの文（左は太字、右は枠の札） */
function GoalBlock({ ratio, tick, left, right, micro }: { ratio: number; tick: number | null; left: ReactNode; right: string | null; micro?: string }) {
  return (
    <View style={{ marginTop: 10 }}>
      {micro && <Micro green style={{ marginBottom: 5 }}>{micro}</Micro>}
      <GoalTrack ratio={ratio} tick={tick} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 7, flexWrap: 'wrap' }}>
        {left}
        {right && <OutlineTag><T bold size={11} color={hud.label}>{right}</T></OutlineTag>}
      </View>
    </View>
  );
}

/** 「目標80kgまで あと10.2kg」（届いていれば「目標80kgに届いています」） */
function GoalLabel({ goal, remaining, reached, unit }: { goal: number; remaining: number; reached: boolean; unit: string }) {
  if (reached) return <T bold size={12.5} color={hud.ink}>{`目標${kgLabel(goal)}${unit}に届いています`}</T>;
  return (
    <T bold size={12.5} color={hud.ink}>
      {`目標${kgLabel(goal)}${unit}まで `}<Mono size={12.5} color={hud.green}>{`あと${fmt1(remaining)}${unit}`}</Mono>
    </T>
  );
}

function DailyHeroBody({ date }: { date: DateKey }) {
  const { data } = useBody(date);
  if (!data) return null;
  const { unit } = data;
  const u = (kg: number) => kgToUnit(kg, unit);
  const day = data.daily.find((d) => d.date === date)?.weightKg ?? null;
  if (day == null) return null;
  const prev = data.daily.find((d) => d.date === addDays(date, -1))?.weightKg ?? null;
  const delta = prev != null ? u(day - prev) : null;
  const weights = weightsOf(data.daily);
  const pace = weeklyPace(weights.map((w) => ({ date: w.date, weightKg: w.value })), date);
  const spark = weights.filter((w) => w.date > addDays(date, -28) && w.date <= date).map((w) => u(w.value));
  const goal = data.goal;
  // 減量の棒の左端は、28日の窓の最初の体重
  const first28 = weights.find((w) => w.date > addDays(date, -28) && w.date <= date)?.value ?? day;
  const p = goal != null ? weightGoalProgress(day, goal, first28) : null;
  // 円は次の節目までの進み具合（増量なら 現在÷節目、減量なら 節目÷現在）
  const ringRatio = p && !p.reached ? (goal! > day ? day / p.milestoneKg : p.milestoneKg / day) : p ? 1 : null;
  const ringLabel = p
    ? p.reached ? `体重 ${fmt1(u(day))} ${unit}。目標に届いています` : `次の節目 ${fmt1(u(p.milestoneKg))} ${unit} までの進み具合。現在 ${fmt1(u(day))} ${unit}、あと ${fmt1(u(p.toMilestoneKg))} ${unit}`
    : `体重 ${fmt1(u(day))} ${unit}`;
  return (
    <View testID="report-hero-daily">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6 }}>
        <View accessible accessibilityLabel={ringLabel}>
          <Ring size={112} stroke={5} ratio={ringRatio}>
            <Micro>Body Mass</Micro>
            <T>
              <Mono size={29} color={hud.white}>{fmt1(u(day))}</Mono>
              <Mono size={14} color={hud.muted}>{unit}</Mono>
            </T>
            {p && !p.reached && <T bold size={10} color={hud.green} style={{ marginTop: 4 }} numberOfLines={1}>{`${kgLabel(u(p.milestoneKg))}${unit}まで あと${fmt1(u(p.toMilestoneKg))}${unit}`}</T>}
          </Ring>
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 8, alignItems: 'flex-start' }}>
          {delta != null && (
            <View style={{ borderWidth: 1, borderColor: hud.line, backgroundColor: hud.panel2, paddingHorizontal: 8, paddingVertical: 5 }} accessible accessibilityLabel={`前日より ${formatSigned(delta)} ${unit}`}>
              <Mono size={15} color={delta >= 0 ? hud.green : hud.muted}>{`${delta > 0 ? '↑' : delta < 0 ? '↓' : '→'} ${formatSigned(delta)}`}</Mono>
              <T size={10} color={hud.muted}>前日より</T>
            </View>
          )}
          {p && !p.reached && (
            <T size={12} color={hud.note} style={{ lineHeight: 19 }}>
              {'円は次の節目'}<T bold size={12} color={hud.note}>{`${kgLabel(u(p.milestoneKg))}${unit}`}</T>{'までの進み具合です。'}
            </T>
          )}
          {p && !p.reached && <Micro>{`Next: ${fmt1(u(p.milestoneKg))}${unit}`}</Micro>}
          {pace != null && (
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, borderWidth: 1, borderColor: hud.line, backgroundColor: hud.panel2, paddingHorizontal: 7, paddingVertical: 4 }}>
              <Mono size={9} spacing={1.3} color={hud.faint}>28D TREND</Mono>
              <Mono size={10} spacing={0.8} color={hud.label}>{`${pace2(u(pace))} ${unit.toUpperCase()}/W`}</Mono>
            </View>
          )}
        </View>
      </View>
      {spark.length >= 2 && <View style={{ marginTop: 6 }}><Spark values={spark} height={28} /></View>}
      {p && goal != null && (
        <GoalBlock
          micro={`Goal Progress — ${fmt1(u(goal))}${unit}`}
          ratio={p.ratio}
          tick={p.reached || p.milestoneKg === goal ? null : p.milestoneRatio}
          left={<GoalLabel goal={u(goal)} remaining={u(p.remainingKg)} reached={p.reached} unit={unit} />}
          right={p.reached || p.milestoneKg === goal ? null : `${kgLabel(u(p.milestoneKg))}${unit}まで あと${fmt1(u(p.toMilestoneKg))}${unit}`}
        />
      )}
    </View>
  );
}

function WeeklyHeroBody({ start, end, note }: { start: DateKey; end: DateKey; note: string }) {
  const { data } = useBody(`${start}:${end}`);
  const noteText = note !== '' ? <T size={12} color={hud.note} style={{ marginTop: 4, lineHeight: 18 }}>{note}</T> : null;
  if (!data) return noteText;
  const { unit } = data;
  const u = (kg: number) => kgToUnit(kg, unit);
  const weights = weightsOf(data.daily);
  const avg = weekAverage(weights, start);
  const inWeek = weights.filter((w) => w.date >= start && w.date <= end).sort((a, b) => (a.date < b.date ? -1 : 1));
  const last = inWeek[inWeek.length - 1] ?? null;
  const goal = data.goal;
  const current = last?.value ?? null;
  const p = goal != null && current != null ? weightGoalProgress(current, goal, inWeek[0].value) : null;
  const lastName = last ? (last.date === todayKey() ? '今日' : formatMonthDay(last.date)) : '';
  const diff = last && avg != null ? last.value - avg : null;
  const cmp = diff == null ? '' : Math.abs(diff) < 0.05 ? '平均どおり' : diff > 0 ? '平均超え' : '平均より下';
  return (
    <View testID="report-hero-weekly">
      {avg != null && (
        <>
          <Micro style={{ marginTop: 8 }}>Weekly Avg // Body Mass</Micro>
          <T accessible accessibilityLabel={`週の平均の体重 ${fmt1(u(avg))} ${unit}`} style={{ marginTop: 4 }}>
            <Mono size={42} color={hud.white} style={{ lineHeight: 46 }}>{fmt1(u(avg))}</Mono>
            <Mono size={20} color={hud.muted}>{unit}</Mono>
          </T>
          {last && (
            <OutlineTag style={{ marginTop: 8, paddingHorizontal: 9, paddingVertical: 5, backgroundColor: hud.panel2 }}>
              <T bold size={12} color={hud.ink}>{`${lastName}は `}<Mono size={12} color={hud.ink}>{`${fmt1(u(last.value))}${unit}`}</Mono>{` で${cmp}`}</T>
            </OutlineTag>
          )}
        </>
      )}
      {noteText}
      {p && goal != null && (
        <GoalBlock
          ratio={p.ratio}
          tick={p.reached || p.milestoneKg === goal ? null : p.milestoneRatio}
          left={<GoalLabel goal={u(goal)} remaining={u(p.remainingKg)} reached={p.reached} unit={unit} />}
          right={p.reached || p.milestoneKg === goal ? null : `${kgLabel(u(p.milestoneKg))}${unit}まで あと${fmt1(u(p.toMilestoneKg))}${unit}`}
        />
      )}
    </View>
  );
}

function MonthlyHeroBody({ start, end }: { start: DateKey; end: DateKey }) {
  const { data } = useBody(`${start}:${end}`);
  if (!data || data.goal == null) return null;
  const c = bodyChange(data.daily, data.goal, start, end);
  if (!c) return null;
  const { unit } = data;
  const u = (kg: number) => kgToUnit(kg, unit);
  const goal = data.goal;
  const p = weightGoalProgress(c.last.value, goal, c.first.value);
  return (
    <View testID="report-hero-monthly">
      <Micro style={{ marginTop: 8 }}>{`Goal Progress // ${fmt1(u(goal))}${unit}`}</Micro>
      <T style={{ marginTop: 4 }} accessible accessibilityLabel={`現在 ${fmt1(u(c.last.value))} ${unit}`}>
        <Mono size={42} color={hud.white} style={{ lineHeight: 46 }}>{fmt1(u(c.last.value))}</Mono>
        <Mono size={20} color={hud.muted}>{unit}</Mono>
      </T>
      <OutlineTag style={{ marginTop: 8, paddingHorizontal: 9, paddingVertical: 5, backgroundColor: hud.panel2 }}>
        {p.reached
          ? <T bold size={12} color={hud.ink}>目標に届いています</T>
          : <T bold size={12} color={hud.ink}>{'目標 '}<Mono size={12} color={hud.ink}>{`${kgLabel(u(goal))}${unit}`}</Mono>{' まで あと '}<Mono size={12} color={hud.ink}>{`${fmt1(u(p.remainingKg))}${unit}`}</Mono></T>}
      </OutlineTag>
      {!p.reached && p.milestoneKg !== goal && (
        <T size={12} color={hud.note} style={{ marginTop: 4, lineHeight: 18 }}>{`次の節目は${kgLabel(u(p.milestoneKg))}${unit}、あと${fmt1(u(p.toMilestoneKg))}${unit}です。`}</T>
      )}
      <GoalBlock
        ratio={p.ratio}
        tick={p.reached || p.milestoneKg === goal ? null : p.milestoneRatio}
        left={<T bold size={12.5} color={hud.ink}>{'現在 '}<Mono size={12.5} color={hud.green}>{`${fmt1(u(c.last.value))}${unit}`}</Mono></T>}
        right={`目標：${kgLabel(u(goal))}${unit}`}
      />
    </View>
  );
}
