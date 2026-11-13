// 日のまとめの中身（モックの「今日」のタブ）と、週のまとめと共用の部品。
// - DailyRingsBlock：kcal・たんぱく質・睡眠のリング（useDailyAchievement。lib/reports.ts の dailyAchievementRows の値と印）
// - WeekRhythmBlock：その週の月〜日の筋トレの日（WeeklyAchievement.days の trained）。日と週で使う
// - DailyChipsBlock：安静時心拍と体脂肪率の小さな札
// - DailyDetailsBlock：たたみ込める「くわしく — ステータス」。数値の表（記録から組み立てる）と、分野ごとの解釈（レポートの highlights）
// - ByFieldList：分野ごとの解釈の行（週・月は単独のパネルで出す）
import { ReactNode, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useDailyAchievement, useFocusData, useWeeklyAchievement } from '@/hooks/data';
import { weekAverage, weeklyPace } from '@/lib/body';
import { addDays, DateKey, todayKey, WEEKDAY_EN, weekday } from '@/lib/date';
import { formatSigned } from '@/lib/format';
import { weekOf } from '@/lib/goals';
import { formatClock, formatSteps } from '@/lib/health';
import { DAY_TYPE_LABELS, SLOT_LABELS, targetFor } from '@/lib/meals';
import {
  achievementRowLabel, AREA_LABELS, Area, dailyAchievementRows, dailyHighlightLabel, deltaLook, formatDelta, formatMetricValue,
  Highlight, KCAL_TOLERANCE, TONE_SHORT, Tone,
} from '@/lib/reports';
import { fmt1, fmtInt, kgToUnit } from '@/lib/units';
import { T } from '../Text';
import { hud, Micro, pace2, Mono, NotchChip, Panel, PanelHead, Ring, StatusRow, ValUnit } from './hud';

const AREA_EN: Record<Area, string> = { training: 'Training', meals: 'Meals', body: 'Body', sleep: 'Sleep' };
const TONE_MARK: Record<Tone, string> = { good: '↗', steady: '→', caution: '!' };

/**
 * 日のまとめのリング（モックの .rings）：kcal・たんぱく質・睡眠（昨夜）。
 * 印は dailyAchievementRows と同じ（kcal は目標の前後 10%、たんぱく質は目標以上、睡眠は目標以上で達成）。
 * 状態の文は、達成なら「✓ 達成」、届いていなければ残り（kcal が目標より多いときは「目標より +◯」）、記録がなければ「記録なし」
 */
export function DailyRingsBlock({ date }: { date: DateKey }) {
  const { data: a } = useDailyAchievement(date);
  const { data: extra } = useFocusData(async (r) => {
    const [list, s] = await Promise.all([r.catalog.listExercises({ includeHidden: true }), r.settings.get()]);
    return { names: new Map(list.map((e) => [e.id, e.name])), unit: s.weightUnit };
  });
  if (!a || !extra) return null;
  const rows = dailyAchievementRows(a, extra.names, extra.unit);
  const row = (k: string) => rows.find((r) => r.key === k)!;
  const m = a.meals;
  const kcalStatus = (): string => {
    const r = row('kcal');
    if (r.mark === 'none') return r.value === '記録なし' ? '記録なし' : '目標なし';
    if (r.mark === 'reached') return '✓ 達成';
    const diff = m.kcal - m.kcalTarget!;
    return diff > m.kcalTarget! * KCAL_TOLERANCE ? `目標より +${fmtInt(diff)}` : `あと${fmtInt(-diff)}`;
  };
  const proteinStatus = (): string => {
    const r = row('protein');
    if (r.mark === 'none') return r.value === '記録なし' ? '記録なし' : '目標なし';
    return r.mark === 'reached' ? '✓ 達成' : `あと${fmtInt(m.proteinTarget! - m.proteinG)}g`;
  };
  const sleepStatus = (): string => {
    const r = row('sleep');
    if (r.mark === 'none') return '記録なし';
    return r.mark === 'reached' ? '✓ 達成' : `あと${a.sleep.goalMin - a.sleep.asleepMin!}分`;
  };
  const cells = [
    { r: row('kcal'), name: 'kcal', en: 'Energy', status: kcalStatus() },
    { r: row('protein'), name: 'たんぱく質', en: 'Protein', status: proteinStatus() },
    { r: row('sleep'), name: '睡眠（昨夜）', en: 'Sleep', status: sleepStatus() },
  ];
  return (
    <Panel style={{ paddingHorizontal: 6, paddingTop: 8, paddingBottom: 7, flexDirection: 'row' }} testID="report-achievement">
      {cells.map(({ r, name, en, status }) => {
        const empty = r.value === '記録なし';
        return (
          <View key={r.key} style={{ flex: 1, alignItems: 'center' }} accessible accessibilityLabel={achievementRowLabel(r)}>
            <Ring size={72} stroke={5} ratio={r.ratio}>
              <Mono size={empty ? 13 : 19} color={empty ? hud.muted : hud.white}>{empty ? '—' : r.value}</Mono>
              {r.goal != null && <Mono size={10} color={hud.muted}>{`/ ${r.goal}${r.unit ? ` ${r.unit}` : ''}`}</Mono>}
            </Ring>
            <T bold size={12.5} color={hud.ink} style={{ marginTop: 4 }}>{name}</T>
            <Micro>{en}</Micro>
            <T bold size={11} color={r.mark === 'reached' ? hud.green : hud.muted} style={{ marginTop: 2 }}>{status}</T>
          </View>
        );
      })}
    </Panel>
  );
}

/**
 * 今週のリズム（モックの .week）：月〜日の7マス。筋トレの日は ✓ のミントの塗り、基準の日（anchor）は枠だけ、
 * anchor より後の日は空の枠。anchor が null なら（過ぎた週）、すべての日を過ぎた日として出す。
 * 筋トレの日は記録（セットのある日）から。large は週のまとめの大きいマス
 */
export function WeekRhythmBlock({ date, anchor, large = false }: { date: DateKey; anchor: DateKey | null; large?: boolean }) {
  const { data: w } = useWeeklyAchievement(date);
  if (!w) return null;
  const trained = w.days.filter((d) => d.trained).length;
  const anchorName = anchor === todayKey() ? '今日' : 'この日';
  const dot = large ? 34 : 26;
  return (
    <Panel style={{ paddingHorizontal: 14, paddingTop: large ? 16 : 12, paddingBottom: large ? 12 : 10 }} testID="report-week-rhythm">
      <PanelHead
        en="Weekly Rhythm"
        title={weekOf(todayKey()).start === w.start ? '今週のリズム' : 'この週のリズム'}
        rightNode={<T size={11.5} color={hud.muted}>{'筋トレ '}<T size={11.5} color={large ? hud.green : hud.muted} bold={large}>{`${trained}日`}</T>{'済み'}</T>}
      />
      <View style={{ flexDirection: 'row', marginTop: 10 }}>
        {w.days.map((d) => {
          const isAnchor = d.date === anchor;
          const future = anchor != null && d.date > anchor;
          const cap = isAnchor ? `${anchorName}・${d.trained ? '筋トレ' : '休み'}` : future ? '' : d.trained ? '筋トレ' : '休み';
          const label = `${WEEKDAY_EN[weekday(d.date)]} ${future ? '' : d.trained ? '筋トレ' : '休み'}`;
          return (
            <View key={d.date} style={{ flex: 1, alignItems: 'center', gap: 5 }} accessible accessibilityLabel={`${d.date.slice(5).replace('-', '月')}日 ${isAnchor ? anchorName : ''} ${label}`}>
              <Mono size={10} color={hud.muted} style={{ fontWeight: '700' }}>{WEEKDAY_EN[weekday(d.date)]}</Mono>
              {d.trained ? (
                <NotchChip fill={hud.green} style={{ width: dot, height: dot }}><T bold size={large ? 14 : 11} color={hud.onGreen}>✓</T></NotchChip>
              ) : isAnchor ? (
                <NotchChip border={hud.green} style={{ width: dot, height: dot }}><T bold size={large ? 14 : 11} color={hud.green}>–</T></NotchChip>
              ) : (
                <NotchChip border={hud.line} style={{ width: dot, height: dot }} />
              )}
              <T size={9.5} color={hud.faint} numberOfLines={1}>{cap || ' '}</T>
            </View>
          );
        })}
      </View>
    </Panel>
  );
}

/** 安静時心拍と体脂肪率の札（モックの .chips）。どちらも記録がなければ出さない */
export function DailyChipsBlock({ date }: { date: DateKey }) {
  const { data } = useFocusData(async (r) => {
    const [daily, heart] = await Promise.all([r.body.listDaily(), r.health.heartRateDay(date)]);
    return { fat: daily.find((d) => d.date === date)?.bodyFatPct ?? null, hr: heart?.restingBpm ?? null };
  }, date);
  if (!data || (data.fat == null && data.hr == null)) return null;
  const chip = (name: string, value: string, unit: string) => (
    <Panel key={name} style={{ flex: 1, paddingHorizontal: 12, paddingVertical: 9, flexDirection: 'row', alignItems: 'baseline', gap: 6 }} accessibilityLabel={`${name} ${value} ${unit}`}>
      <T bold size={11} color={hud.muted}>{name}</T>
      <T style={{ marginLeft: 'auto' }}>
        <Mono size={20} color={hud.white}>{value}</Mono>
        <Mono size={11} color={hud.muted}>{unit}</Mono>
      </T>
    </Panel>
  );
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {data.hr != null && chip('安静時心拍', String(Math.round(data.hr)), 'bpm')}
      {data.fat != null && chip('体脂肪率', fmt1(data.fat), '%')}
    </View>
  );
}

/**
 * 分野ごとの解釈の行（モックの .f-row）：英字の分野＋和文、調子の札（印と言葉）、一文。
 * metricVs を渡すと、指標があれば値と変化を下に小さく出す（日のまとめ）
 */
export function ByFieldList({ highlights, metricVs }: { highlights: Highlight[]; metricVs?: string }) {
  return (
    <View>
      {highlights.map((h, i) => {
        const m = h.metric;
        const look = m ? deltaLook(m) : null;
        return (
          <View
            key={i}
            accessible
            accessibilityLabel={metricVs ? dailyHighlightLabel(h) : `${AREA_LABELS[h.area]}、${TONE_SHORT[h.tone]}。${h.text}`}
            style={{ paddingVertical: 9, borderBottomWidth: i === highlights.length - 1 ? 0 : 1, borderBottomColor: hud.rowLine }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
              <T bold size={12.5} color={hud.label}>
                <Mono size={9} spacing={1.3} color={hud.faint}>{`${AREA_EN[h.area].toUpperCase()}  `}</Mono>
                {AREA_LABELS[h.area]}
              </T>
              <View style={{ borderWidth: 1, borderColor: hud.line, paddingHorizontal: 6, paddingVertical: 2 }}>
                <T bold size={10} color={h.tone === 'good' ? hud.green : hud.muted}>{`${TONE_MARK[h.tone]} ${TONE_SHORT[h.tone]}`}</T>
              </View>
            </View>
            <T size={12.5} color={hud.note} style={{ marginTop: 4, lineHeight: 20 }}>{h.text}</T>
            {metricVs && m && (
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 2, flexWrap: 'wrap' }}>
                <T size={11} color={hud.muted}>{m.label}</T>
                <T><Mono size={13} color={hud.white}>{formatMetricValue(m.value)}</Mono>{m.unit ? <Mono size={10} color={hud.muted}>{` ${m.unit}`}</Mono> : null}</T>
                {m.delta != null && (
                  <>
                    <Mono size={12} color={look?.quality === 'good' ? hud.green : hud.muted}>{`${look?.arrow === 'up' ? '↑' : look?.arrow === 'down' ? '↓' : '→'} ${formatDelta(m.delta)}`}</Mono>
                    <T size={11} color={hud.muted}>{metricVs}</T>
                  </>
                )}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

/** 分野ごとの解釈の見出し（緑の「BY FIELD // 解釈」と右の日付） */
function FieldHead({ right }: { right: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: 9, paddingBottom: 4 }}>
      <T><Micro green>By Field // </Micro><T bold size={9} color={hud.microGreen}>解釈</T></T>
      <Micro>{right}</Micro>
    </View>
  );
}

/** 週・月の分野ごとの解釈のパネル */
export function ByFieldPanel({ highlights, right, metricVs }: { highlights: Highlight[]; right: string; metricVs?: string }) {
  if (highlights.length === 0) return null;
  return (
    <Panel style={{ paddingHorizontal: 14, paddingBottom: 6 }} testID="report-by-field">
      <FieldHead right={right} />
      <ByFieldList highlights={highlights} metricVs={metricVs} />
    </Panel>
  );
}

/**
 * 日のまとめの「くわしく — ステータス」（モックの details）。見出しを押すとたたむ・開く（初めは開いている）。
 * 中は、その日の記録から組み立てる数値の表（体重・体脂肪率は body.listDaily、週の平均と28日の傾向は lib/body.ts、
 * kcal・たんぱく質・睡眠は今日の達成と同じ値と目標、食事の内訳と休みの日の目標は meals.summaries と targetFor、
 * 就寝・起床・安静時心拍・歩数は health の日ごとのまとめ、筋トレは今日の達成の行）と、分野ごとの解釈。
 * 記録のない項目は「記録なし」か「—」で、行自体は消さない（並びを固定する）
 */
export function DailyDetailsBlock({ date, highlights }: { date: DateKey; highlights: Highlight[] }) {
  const [open, setOpen] = useState(true);
  const { data: a } = useDailyAchievement(date);
  const { data } = useFocusData(async (r) => {
    const [daily, settings, summaries, sleep, heart, steps, list] = await Promise.all([
      r.body.listDaily(), r.settings.get(), r.meals.summaries(date, date), r.health.sleepDay(date), r.health.heartRateDay(date), r.health.stepDay(date),
      r.catalog.listExercises({ includeHidden: true }),
    ]);
    return {
      daily, unit: settings.weightUnit, day: summaries.days[0] ?? null, goal: summaries.goal, sleep, heart, steps,
      names: new Map(list.map((e) => [e.id, e.name])),
    };
  }, date);
  if (!data || !a) return null;
  const { unit } = data;
  const U = unit.toUpperCase();
  const dayBody = data.daily.find((d) => d.date === date) ?? null;
  const prevBody = data.daily.find((d) => d.date === addDays(date, -1)) ?? null;
  const weights = data.daily.filter((d) => d.weightKg != null).map((d) => ({ date: d.date, value: d.weightKg! }));
  const weekAvg = weekAverage(weights, date);
  const pace = weeklyPace(weights.map((w) => ({ date: w.date, weightKg: w.value })), date);
  const prevDelta = dayBody?.weightKg != null && prevBody?.weightKg != null ? kgToUnit(dayBody.weightKg - prevBody.weightKg, unit) : null;
  const mealDay = data.day;
  const recorded = mealDay != null && mealDay.meals.length > 0;
  const slots = mealDay ? [...new Set(mealDay.meals.map((m) => SLOT_LABELS[m.slot]))].join('・') : '';
  const restTarget = data.goal ? targetFor(data.goal, 'rest') : null;
  const rows = dailyAchievementRows(a, data.names, unit);
  const row = (k: string) => rows.find((r) => r.key === k)!;
  const training = row('training');
  const none = <Mono size={12} color={hud.muted}>記録なし</Mono>;
  const dash = <Mono size={14} color={hud.muted}>—</Mono>;
  const kcal = row('kcal');
  const protein = row('protein');
  const sleepRow = row('sleep');
  const items: { en: string; ja: string; value: ReactNode; label: string; full?: boolean }[] = [
    { en: 'Weight', ja: '体重', value: dayBody?.weightKg != null ? <ValUnit value={fmt1(kgToUnit(dayBody.weightKg, unit))} unit={U} /> : none, label: dayBody?.weightKg != null ? `${fmt1(kgToUnit(dayBody.weightKg, unit))} ${unit}` : '記録なし' },
    { en: 'Body Fat', ja: '体脂肪率', value: dayBody?.bodyFatPct != null ? <ValUnit value={fmt1(dayBody.bodyFatPct)} unit="%" /> : none, label: dayBody?.bodyFatPct != null ? `${fmt1(dayBody.bodyFatPct)} %` : '記録なし' },
    { en: 'Week Avg', ja: '週間平均', value: weekAvg != null ? <ValUnit value={fmt1(kgToUnit(weekAvg, unit))} unit={U} /> : dash, label: weekAvg != null ? `${fmt1(kgToUnit(weekAvg, unit))} ${unit}` : '—' },
    { en: 'Vs Yesterday', ja: '前日比', value: prevDelta != null ? <ValUnit value={formatSigned(prevDelta)} unit={U} color={prevDelta > 0 ? hud.green : hud.white} /> : dash, label: prevDelta != null ? `${formatSigned(prevDelta)} ${unit}` : '—' },
    { en: 'Calories', ja: 'カロリー', value: kcal.value === '記録なし' ? none : <ValUnit value={kcal.value} dim={kcal.goal ?? undefined} unit="KCAL" />, label: achievementRowLabel(kcal), full: true },
    { en: 'Protein', ja: 'たんぱく質', value: protein.value === '記録なし' ? none : <ValUnit value={protein.value} dim={protein.goal ?? undefined} unit="G" />, label: achievementRowLabel(protein), full: true },
    { en: 'Sleep', ja: '睡眠', value: sleepRow.value === '記録なし' ? none : <ValUnit value={sleepRow.value} dim={sleepRow.goal ?? undefined} />, label: achievementRowLabel(sleepRow), full: true },
    { en: 'In Bed', ja: '就寝–起床', value: data.sleep ? `${formatClock(data.sleep.mainStartAt)}–${formatClock(data.sleep.mainEndAt)}` : dash, label: data.sleep ? `${formatClock(data.sleep.mainStartAt)}から${formatClock(data.sleep.mainEndAt)}` : '—' },
    { en: 'Resting HR', ja: '安静時心拍', value: data.heart?.restingBpm != null ? <ValUnit value={String(Math.round(data.heart.restingBpm))} unit="BPM" /> : none, label: data.heart?.restingBpm != null ? `${Math.round(data.heart.restingBpm)} 拍/分` : '記録なし' },
    { en: 'Steps', ja: '歩数', value: data.steps ? formatSteps(data.steps.steps) : none, label: data.steps ? `${formatSteps(data.steps.steps)} 歩` : '記録なし' },
    { en: 'Trend 28D', ja: '28日トレンド', value: pace != null ? <ValUnit value={pace2(kgToUnit(pace, unit))} unit={`${U} / 週`} color={hud.muted} /> : dash, label: pace != null ? `${formatSigned(kgToUnit(pace, unit))} ${unit}／週` : '—' },
    { en: 'Training', ja: training.label, value: training.value === '記録なし' ? none : <ValUnit value={training.value} unit={training.unit.toUpperCase()} />, label: achievementRowLabel(training), full: true },
    { en: 'Meals', ja: '食事', value: recorded ? <T bold size={12.5} color={hud.ink} style={{ textAlign: 'right' }}>{`${mealDay.meals.length}食（${slots}）・${DAY_TYPE_LABELS[mealDay.dayType]}`}</T> : none, label: recorded ? `${mealDay.meals.length}食（${slots}）・${DAY_TYPE_LABELS[mealDay.dayType]}` : '記録なし' },
    { en: 'Rest-Day Target', ja: '休みの日の目標', value: restTarget?.kcal != null ? <ValUnit value={fmtInt(restTarget.kcal)} unit="KCAL" dim={undefined} /> : dash, label: restTarget?.kcal != null ? `${fmtInt(restTarget.kcal)} kcal` : '—' },
  ];
  return (
    <Panel testID="report-daily-stats">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`くわしく、ステータス。${open ? 'たたむ' : '開く'}`}
        onPress={() => setOpen((o) => !o)}
        style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14 }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Mono size={9} spacing={1.6} color={hud.microGreen} style={{ fontWeight: '700' }}>DETAILS</Mono>
          <T bold size={13.5} color={hud.ink} accessibilityRole="header">くわしく — ステータス</T>
        </View>
        <T size={13} color={hud.green}>{open ? '▾' : '▸'}</T>
      </Pressable>
      {open && (
        <>
          <View style={{ borderTopWidth: 1, borderTopColor: hud.line2, paddingHorizontal: 14, paddingTop: 2, paddingBottom: 6 }}>
            {items.map((r, i) => (
              <StatusRow key={r.en} en={r.en} ja={r.ja} value={r.value} last={i === items.length - 1} accessibilityLabel={r.full ? r.label : `${r.ja}、${r.label}`} wide={r.en === 'Training'} />
            ))}
          </View>
          {highlights.length > 0 && (
            <View style={{ borderTopWidth: 1, borderTopColor: hud.line, paddingHorizontal: 14, paddingBottom: 8 }}>
              <FieldHead right={date.slice(5).replace('-', '.')} />
              <ByFieldList highlights={highlights} metricVs="前の日より" />
            </View>
          )}
        </>
      )}
    </Panel>
  );
}
