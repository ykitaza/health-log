// ホームの「計器の盤」（刷新 A、Figma「スタディ：フェーズ」の 6）の部品：枠（角の切り欠き）、計器の段（BIG3・LOAD・SLEEP）、
// LOG（週ごとの方眼）、PARTS（部位のレーダー）、FUEL（今日の kcal と PFC）。集計は lib/homeHud.ts。
// 色はミント 1 色の濃淡が主役。回復中は暖色・ケガは赤（回復マップと同じ）。光・ぼかし・グラデーションの飾りは使わない
import { router } from 'expo-router';
import { ReactNode, useState } from 'react';
import { Pressable, StyleSheet, View, ViewStyle } from 'react-native';
import Svg, { Circle, Path, Polyline, Text as SvgText, TSpan } from 'react-native-svg';
import { DateKey, formatJpDate, WEEKDAY_EN, weekday } from '@/lib/date';
import { BIG3_LABELS } from '@/lib/exercises';
import { tonnes, formatSigned } from '@/lib/format';
import { formatHM } from '@/lib/health';
import {
  Big3Gauge, FuelGauge, LoadGauge, LogCell, logCellLabel, LogWeek, logWeekRange, PartState, PartsRadar, SleepGauge,
} from '@/lib/homeHud';
import { DAY_TYPE_LABELS } from '@/lib/meals';
import { BALANCE_PARTS } from '@/lib/partBalance';
import { INJURY_RED, LOAD_ORANGE } from '@/lib/recoveryMap';
import { fmt1, fmtInt, kgToUnit, WeightUnit } from '@/lib/units';
import { colors, fonts, hudColors, space } from '@/theme';
import { CountToText } from './charts';
import { Mono } from './injuries';
import { PressableScale } from './motion';
import { T } from './Text';

/** 角の切り欠きの長さ */
const BRACKET = 10;

/** 4 隅の切り欠き（ブラケット）。color を変えると強める（今週の行） */
export function Brackets({ color = hudColors.bracket, size = BRACKET }: { color?: string; size?: number }) {
  const b = { position: 'absolute', width: size, height: size, borderColor: color } as const;
  return (
    <>
      <View pointerEvents="none" style={[b, { left: 0, top: 0, borderLeftWidth: 1.5, borderTopWidth: 1.5 }]} />
      <View pointerEvents="none" style={[b, { right: 0, top: 0, borderRightWidth: 1.5, borderTopWidth: 1.5 }]} />
      <View pointerEvents="none" style={[b, { left: 0, bottom: 0, borderLeftWidth: 1.5, borderBottomWidth: 1.5 }]} />
      <View pointerEvents="none" style={[b, { right: 0, bottom: 0, borderRightWidth: 1.5, borderBottomWidth: 1.5 }]} />
    </>
  );
}

/** 計器の枠：暗い面と 4 隅の切り欠き。onPress があれば押せる（label は読み上げ） */
function Panel({ children, onPress, label, testID, style }: { children: ReactNode; onPress?: () => void; label?: string; testID?: string; style?: ViewStyle }) {
  if (!onPress) {
    return (
      <View style={[s.panel, style]} testID={testID} accessible={label != null} accessibilityLabel={label}>
        <Brackets />{children}
      </View>
    );
  }
  return (
    <PressableScale style={[s.panel, style]} testID={testID} accessibilityRole="button" accessibilityLabel={label} scaleTo={0.98} onPress={onPress}>
      <Brackets />{children}
    </PressableScale>
  );
}

/** 見出しの行：左に英字のラベル、右に小さな数字 */
function Head({ left, right, rightColor = colors.sub }: { left: string; right?: string | null; rightColor?: string }) {
  return (
    <View style={s.head}>
      <Mono color={colors.accent} size={11}>{left}</Mono>
      {right ? <Mono color={rightColor} size={11}>{right}</Mono> : null}
    </View>
  );
}

/** 大きな数字と単位（数字は数え上げる。読み込む前は「—」） */
function Big({ value, format, unit, testID }: { value: number | null; format: (v: number) => string; unit: string; testID?: string }) {
  return (
    <View style={s.big} testID={testID}>
      {value == null
        ? <T num bold size={22} style={s.bigText}>—</T>
        : <CountToText value={value} format={(v) => format(v ?? 0)} num bold size={22} style={s.bigText} />}
      <Mono size={11}>{unit}</Mono>
    </View>
  );
}

const trendColor = (n: number) => (n > 0 ? colors.accent : n < 0 ? colors.danger : colors.sub);
const big3Short = { bench: 'B', squat: 'S', deadlift: 'D' } as const;

/** BIG3：今の合計（推定1RM）、差（フェーズ実施中は開始から Δ PHASE、ほかは 28 日前から）、B・S・D の棒、16 週の線（始まり・自己ベスト・今の点）。押すと筋トレの推移 */
export function Big3Panel({ gauge, unit, ready }: { gauge: Big3Gauge | null; unit: WeightUnit; ready: boolean }) {
  const [w, setW] = useState(0);
  const u = (kg: number) => kgToUnit(kg, unit);
  const max = gauge ? Math.max(...gauge.lifts.map((l) => l.kg ?? 0)) : 0;
  const deltaWord = gauge?.deltaBase === 'PHASE' ? 'フェーズの開始より' : gauge?.deltaBase === '28D' ? '28日前より' : '始めた日より';
  const label = !ready ? 'BIG3 推定1RM 合計'
    : !gauge ? 'BIG3 推定1RM 合計。BIG3 の記録がまだありません'
    : [
      `BIG3 推定1RM 合計 ${fmt1(u(gauge.totalKg))}${unit}`,
      gauge.deltaKg != null ? `${deltaWord} ${formatSigned(u(gauge.deltaKg))}${unit}` : '',
      gauge.lifts.map((l) => `${BIG3_LABELS[l.role]} ${l.kg == null ? 'まだ' : `${fmt1(u(l.kg))}${unit}`}`).join('、'),
    ].filter(Boolean).join('。');
  return (
    <Panel testID="home-big3" label={`${label}。筋トレの推移を開く`} style={s.gauge}
      onPress={() => router.navigate({ pathname: '/training', params: { view: 'trend' } })}>
      <Head left="BIG3" />
      <Big value={ready && gauge ? u(gauge.totalKg) : null} format={fmt1} unit={unit.toUpperCase()} />
      {gauge?.deltaKg != null
        ? <Mono size={11} color={trendColor(gauge.deltaKg)}>{`Δ ${gauge.deltaBase} ${formatSigned(u(gauge.deltaKg))}`}</Mono>
        : <Mono size={11}>{ready && !gauge ? 'NO DATA' : 'Δ —'}</Mono>}
      <View style={{ gap: 2, marginTop: 2 }}>
        {(gauge?.lifts ?? (['bench', 'squat', 'deadlift'] as const).map((role) => ({ role, kg: null }))).map((l) => (
          <View key={l.role} style={s.liftRow}>
            <Mono size={11}>{big3Short[l.role]}</Mono>
            <View style={s.track}><View style={[s.fill, { width: `${max > 0 && l.kg ? (l.kg / max) * 100 : 0}%` }]} /></View>
          </View>
        ))}
      </View>
      <View style={{ height: 18, marginTop: 'auto' }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
        {gauge && w > 0 && <Big3Line gauge={gauge} width={w} height={18} />}
      </View>
    </Panel>
  );
}

function Big3Line({ gauge, width, height }: { gauge: Big3Gauge; width: number; height: number }) {
  const pad = 3;
  const kgs = gauge.points.map((p) => p.kg);
  const lo = Math.min(...kgs), hi = Math.max(...kgs);
  const at = (i: number) => {
    const p = gauge.points[i];
    return { x: pad + p.x * (width - pad * 2), y: hi === lo ? height / 2 : pad + (1 - (p.kg - lo) / (hi - lo)) * (height - pad * 2) };
  };
  const pts = gauge.points.map((_, i) => at(i));
  const start = at(gauge.start), now = at(gauge.now), best = at(gauge.best);
  return (
    <Svg width={width} height={height}>
      <Path d={`M0 ${height - 0.5}H${width}`} stroke={colors.line} strokeWidth={1} />
      {pts.length > 1 && <Polyline points={pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={colors.accent} strokeWidth={1.5} />}
      <Circle cx={start.x} cy={start.y} r={2.5} fill={colors.card} stroke={colors.accent} strokeWidth={1} />
      {gauge.best !== gauge.now && <Circle cx={best.x} cy={best.y} r={2.5} fill={colors.text} />}
      <Circle cx={now.x} cy={now.y} r={3} fill={colors.accent} />
    </Svg>
  );
}

/** 曜日の頭文字（M T W T F S S）。今日は緑 */
function DayLetters({ dates, today }: { dates: DateKey[]; today: DateKey }) {
  return (
    <View style={s.letters}>
      {dates.map((d) => <View key={d} style={s.letterCell}><Mono size={11} color={d === today ? colors.accent : colors.sub}>{WEEKDAY_EN[weekday(d)][0]}</Mono></View>)}
    </View>
  );
}

const BAR_H = 34;

/** LOAD：今週の合計負荷量、今週 7 日の棒と、先週の日ごとの破線の枠、先週の同じ曜日までとの比。押すと筋トレの推移 */
export function LoadPanel({ gauge, dates, today, unit, ready }: { gauge: LoadGauge; dates: DateKey[]; today: DateKey; unit: WeightUnit; ready: boolean }) {
  const max = Math.max(1, ...gauge.lastWeek, ...gauge.thisWeek.map((v) => v ?? 0));
  const pct = gauge.vsLastWeekPct;
  const tUnit = unit === 'kg' ? 't' : 'k lb';
  const label = `今週の合計負荷量 ${tonnes(gauge.totalKg, unit)}${unit === 'kg' ? 'トン' : '千ポンド'}${pct != null ? `。先週の同じ曜日までより ${pct >= 0 ? `${pct}% 多い` : `${-pct}% 少ない`}` : ''}`;
  return (
    <Panel testID="volume-week" label={`${label}。筋トレの推移を開く`} style={s.gauge}
      onPress={() => router.navigate({ pathname: '/training', params: { view: 'trend' } })}>
      <Head left="LOAD" />
      <View style={s.big}>
        <CountToText value={ready ? gauge.totalKg : null} format={(v) => tonnes(v ?? 0, unit)} num bold size={22} style={s.bigText} />
        <Mono size={11}>{tUnit}</Mono>
      </View>
      <Mono size={11} color={pct != null ? trendColor(pct) : colors.sub}>{pct != null ? `vs LW ${pct >= 0 ? '+' : '−'}${Math.abs(pct)}%` : 'vs LW —'}</Mono>
      <View style={[s.bars, { marginTop: 'auto' }]}>
        {gauge.thisWeek.map((v, i) => (
          <View key={i} style={s.barCell}>
            {gauge.lastWeek[i] > 0 && <View style={[s.ghost, { height: Math.max(2, (gauge.lastWeek[i] / max) * BAR_H) }]} />}
            {v != null && v > 0 && <View style={[s.bar, { height: Math.max(2, (v / max) * BAR_H), backgroundColor: colors.accent }]} />}
          </View>
        ))}
      </View>
      <DayLetters dates={dates} today={today} />
    </Panel>
  );
}

/** SLEEP：昨夜、7 日の棒、7H の目標線、平均（Health Connect の睡眠）。押すと睡眠の推移 */
export function SleepPanel({ gauge, today }: { gauge: SleepGauge; today: DateKey }) {
  const max = Math.max(gauge.goalMin * 1.25, ...gauge.days.map((d) => d.min ?? 0));
  const goalY = (gauge.goalMin / max) * BAR_H;
  const label = `睡眠。昨夜 ${gauge.lastNightMin != null ? formatHM(gauge.lastNightMin) : '記録なし'}${gauge.averageMin != null ? `。7日の平均 ${formatHM(gauge.averageMin)}` : ''}。目標 7時間`;
  return (
    <Panel testID="home-sleep" label={`${label}。睡眠の推移を開く`} style={s.gauge}
      onPress={() => router.push({ pathname: '/health-trend', params: { kind: 'sleep' } })}>
      <Head left="SLEEP" />
      <View style={s.big}>
        <T num bold size={22} style={s.bigText}>{gauge.lastNightMin != null ? formatHM(gauge.lastNightMin) : '—'}</T>
        <Mono size={11}>H</Mono>
      </View>
      <Mono size={11}>{`AVG ${gauge.averageMin != null ? formatHM(gauge.averageMin) : '—'}`}</Mono>
      <View style={[s.bars, { marginTop: 'auto' }]}>
        <View pointerEvents="none" style={[s.goal, { bottom: goalY }]} />
        {gauge.days.map((d) => (
          <View key={d.date} style={s.barCell}>
            {d.min != null && d.min > 0 && (
              <View style={[s.bar, { height: Math.max(2, (d.min / max) * BAR_H), backgroundColor: d.min >= gauge.goalMin ? colors.accent : colors.accentMuted }]} />
            )}
          </View>
        ))}
      </View>
      <DayLetters dates={gauge.days.map((d) => d.date)} today={today} />
    </Panel>
  );
}

const CELL_BG = [hudColors.empty, hudColors.mint1, hudColors.mint2, hudColors.mint3];
const onCell = (level: number) => (level >= 2 ? colors.onAccent : colors.text);

/**
 * LOG：直近 4 週の方眼（月曜始まり、今週がいちばん下）。塗りの濃さは負荷量（3 段）、右下に部位の頭文字、下線は食事の目標を達成、
 * 右上の点は体重を測った、左下の赤の三角はケガ、左上は日付。今日のマスは枠と、まだならおすすめの部位。
 * マスを押すとその日を選ぶ（前のカレンダーと同じ。「記録する」と体調のカードがその日になる）
 */
export function LogPanel({ weeks, month, selected, unit, onPressDay }: {
  weeks: LogWeek[]; month: { month: string; days: number; volumeKg: number } | null; selected: DateKey; unit: WeightUnit; onPressDay: (d: DateKey) => void;
}) {
  return (
    <Panel testID="home-log" style={{ paddingHorizontal: space.m }}>
      <Head left={`LOG // ${logWeekRange(weeks.map((w) => w.label))}`} right={month ? `${month.month}  ${month.days}D · ${tonnes(month.volumeKg, unit)}${unit === 'kg' ? 'T' : 'K LB'}` : null} />
      <View style={[s.logRow, { marginTop: space.xs }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <View style={s.weekLabel} />
        {(weeks[0]?.cells ?? []).map((c) => <View key={c.date} style={s.logHead}><Mono size={11}>{WEEKDAY_EN[weekday(c.date)][0]}</Mono></View>)}
      </View>
      <View style={{ gap: 4 }}>
        {weeks.map((w) => (
          <View key={w.cells[0].date} style={[s.logRow, w.current && s.currentRow]} testID={w.current ? 'log-current-week' : undefined}>
            {w.current && <Brackets color={colors.accent} size={8} />}
            <View style={s.weekLabel}><Mono size={11} color={w.current ? colors.accent : colors.sub}>{w.label}</Mono></View>
            {w.cells.map((c) => <LogDay key={c.date} c={c} selected={c.date === selected} unit={unit} onPress={() => onPressDay(c.date)} />)}
          </View>
        ))}
      </View>
    </Panel>
  );
}

function LogDay({ c, selected, unit, onPress }: { c: LogCell; selected: boolean; unit: WeightUnit; onPress: () => void }) {
  const fg = onCell(c.level);
  const label = logCellLabel(c, formatJpDate(c.date), `${tonnes(c.volumeKg, unit)}${unit === 'kg' ? 'トン' : '千ポンド'}`);
  return (
    <Pressable
      testID={`log-${c.date}`} accessibilityRole="button" accessibilityLabel={label}
      aria-selected={selected} disabled={c.future} onPress={onPress}
      style={({ pressed }) => [
        s.cell, { backgroundColor: c.future ? 'transparent' : CELL_BG[c.level] },
        c.future && s.cellFuture, c.today && s.cellToday, selected && !c.today && s.cellSelected, pressed && { opacity: 0.7 },
      ]}
    >
      <T num size={11} color={c.future ? colors.disabled : fg} style={s.cellDay}>{String(c.day)}</T>
      {c.weighed && <View style={[s.weighDot, { backgroundColor: fg }]} testID={`log-weighed-${c.date}`} />}
      {c.initial && (
        <T bold size={11} color={c.suggested ? colors.accent : fg} style={s.cellPart} testID={c.suggested ? 'log-suggest' : undefined}>{c.initial}</T>
      )}
      {c.injury && <View style={s.injury} testID={`log-injury-${c.date}`} />}
      {c.mealGoal && <View style={[s.mealLine, { backgroundColor: c.level >= 2 ? colors.onAccent : colors.accent }]} testID={`log-meal-${c.date}`} />}
    </Pressable>
  );
}

/** レーダーの頂点の向き：胸がまうえ、60° ずつ時計回り（胸・肩・背中・腕・脚・腹） */
const ANGLE = BALANCE_PARTS.map((_, i) => ((-90 + 60 * i) * Math.PI) / 180);
const PREV_COLOR = 'rgba(243,245,247,0.6)';
const STATE_COLOR: Record<Exclude<PartState, null>, string> = { recovering: LOAD_ORANGE, injury: INJURY_RED };
const TREND_MARK = { up: '▲', down: '▼', flat: '-' } as const;

/**
 * PARTS：部位のレーダー。今の 28 日（実線と塗り）、前の 28 日（破線）、等分の六角形、頂点ごとのセット数と増減、
 * 回復中（暖色）・ケガ（赤）の点、右上に「LOW › 部位」。押すと筋トレの推移
 */
export function PartsPanel({ radar, states }: { radar: PartsRadar | null; states: PartState[] }) {
  const [w, setW] = useState(0);
  const has = radar != null && (radar.total > 0 || radar.prevSets.some((n) => n > 0));
  const label = radar == null ? '部位のバランス' : radar.total === 0 && !has ? '部位のバランス、直近28日のセット数。まだ記録がありません'
    : `部位のバランス、直近28日のセット数。${BALANCE_PARTS.map((p, i) => `${p} ${radar.sets[i]}（前の28日 ${radar.prevSets[i]}）${states[i] === 'injury' ? ' ケガ' : states[i] === 'recovering' ? ' 回復中' : ''}`).join('、')}${radar.low ? `。いちばん少ないのは${radar.low}` : ''}`;
  return (
    <Panel testID="home-parts" label={`${label}。筋トレの推移を開く`} style={s.half}
      onPress={() => router.navigate({ pathname: '/training', params: { view: 'trend', balance: '2w' } })}>
      <Head left="PARTS // 28D" right={radar?.low ? `LOW › ${radar.low}` : null} rightColor={colors.accent} />
      <View style={{ flex: 1, minHeight: 112 }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
        {w > 0 && <Radar width={w} radar={radar} states={states} />}
      </View>
      {radar != null && !has && <T size={11} color={colors.sub} align="center" testID="home-parts-empty">記録がたまると形になります</T>}
    </Panel>
  );
}

function Radar({ width, radar, states }: { width: number; radar: PartsRadar | null; states: PartState[] }) {
  const height = 112;
  // 左右の頂点の外に「背中 18 ▲」が入る幅を残す
  const R = Math.max(12, Math.min(44, (width - 96) / (2 * Math.cos(Math.PI / 6)), (height - 32) / 2));
  const cx = width / 2, cy = height / 2;
  const at = (i: number, r: number) => ({ x: cx + r * Math.cos(ANGLE[i]), y: cy + r * Math.sin(ANGLE[i]) });
  const poly = (ratios: number[]) => `${ratios.map((v, i) => { const p = at(i, R * v); return `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`; }).join('')}Z`;
  const ring = (k: number) => poly(BALANCE_PARTS.map(() => k));
  return (
    <Svg width={width} height={height}>
      {[1 / 3, 2 / 3, 1].map((k) => <Path key={k} d={ring(k)} fill="none" stroke={hudColors.ring} strokeWidth={1} />)}
      <Path d={BALANCE_PARTS.map((_, i) => { const p = at(i, R); return `M${cx},${cy}L${p.x},${p.y}`; }).join('')} stroke={hudColors.ring} strokeWidth={1} />
      {radar && radar.prevSets.some((n) => n > 0) && (
        <Path d={poly(radar.prevRatios)} fill="none" stroke={PREV_COLOR} strokeWidth={1} strokeDasharray="3 3" />
      )}
      {radar && radar.total > 0 && (
        <>
          <Path d={poly(radar.ratios)} fill={colors.accent} fillOpacity={0.22} stroke={colors.accent} strokeWidth={1.5} strokeLinejoin="round" />
          {radar.ratios.map((v, i) => { const p = at(i, R * v); return <Circle key={i} cx={p.x} cy={p.y} r={2} fill={colors.accent} />; })}
        </>
      )}
      {states.map((st, i) => {
        if (!st) return null;
        const p = at(i, R * (radar?.ratios[i] ?? 0));
        return <Circle key={`st-${i}`} cx={p.x} cy={p.y} r={4} fill={STATE_COLOR[st]} stroke={colors.card} strokeWidth={1} />;
      })}
      {BALANCE_PARTS.map((name, i) => {
        const p = at(i, R);
        const c = Math.cos(ANGLE[i]);
        const anchor = Math.abs(c) < 0.1 ? 'middle' : c < 0 ? 'end' : 'start';
        const dx = Math.abs(c) < 0.1 ? 0 : c < 0 ? -5 : 5;
        const dy = Math.sin(ANGLE[i]) < -0.9 ? -5 : Math.sin(ANGLE[i]) > 0.9 ? 13 : 4;
        const tr = radar?.trend[i] ?? 'flat';
        return (
          <SvgText key={name} x={p.x + dx} y={p.y + dy} fontSize={11} fontFamily={fonts.bold} fill={colors.text} textAnchor={anchor}>
            {`${name} ${radar?.sets[i] ?? 0} `}
            <TSpan fill={tr === 'up' ? colors.accent : tr === 'down' ? colors.danger : colors.sub}>{TREND_MARK[tr]}</TSpan>
          </SvgText>
        );
      })}
    </Svg>
  );
}

const PFC_COLORS = { P: hudColors.mint3, F: hudColors.mint2, C: hudColors.mint1 } as const;

/** FUEL：今日の kcal（摂った／目標）、日の種類、PFC の割合のドーナツ（ミントの濃淡）と、P・F・C のグラム／目標の棒。押すと食事のタブ */
export function FuelPanel({ fuel, date }: { fuel: FuelGauge | null; date: DateKey }) {
  const ratio = fuel?.ratio ?? null;
  const pct = (k: 'P' | 'F' | 'C') => (ratio ? Math.round(k === 'P' ? ratio.p : k === 'F' ? ratio.f : ratio.c) : null);
  const kcalRatio = fuel?.kcalTarget ? Math.min(1, fuel.kcal / fuel.kcalTarget) : 0;
  const label = fuel == null ? '今日の食事'
    : [
      `今日の食事 ${fmtInt(fuel.kcal)}kcal${fuel.kcalTarget != null ? `、目標 ${fmtInt(fuel.kcalTarget)}kcal` : ''}`,
      DAY_TYPE_LABELS[fuel.dayType],
      fuel.grams.map((g) => `${g.key === 'P' ? 'たんぱく質' : g.key === 'F' ? '脂質' : '炭水化物'} ${fmtInt(g.g)}g${g.target != null ? `／${fmtInt(g.target)}g` : ''}${pct(g.key) != null ? `（${pct(g.key)}%）` : ''}`).join('、'),
    ].join('。');
  return (
    <Panel testID="home-fuel" label={`${label}。食事のタブを開く`} style={s.half}
      onPress={() => router.navigate({ pathname: '/meals', params: { date } })}>
      <Head left="FUEL //" right={fuel ? (fuel.dayType === 'training' ? 'TRAIN DAY' : 'REST DAY') : null} />
      <View style={s.big}>
        <CountToText value={fuel ? fuel.kcal : null} format={(v) => fmtInt(v ?? 0)} num bold size={22} style={s.bigText} />
        <Mono size={11}>{fuel?.kcalTarget != null ? `/ ${fmtInt(fuel.kcalTarget)} KCAL` : 'KCAL'}</Mono>
      </View>
      <View style={s.bar1}><View style={[s.fill, { width: `${kcalRatio * 100}%` }]} /></View>
      <View style={s.fuelRow}>
        <Donut ratio={ratio} />
        <View style={{ flex: 1, gap: 4, minWidth: 0 }}>
          {(fuel?.grams ?? (['P', 'F', 'C'] as const).map((key) => ({ key, g: 0, target: null }))).map((g) => (
            <View key={g.key} style={{ gap: 1 }}>
              <View style={s.head}>
                <Mono size={11} color={colors.text}>{`${g.key} ${pct(g.key) ?? '—'}%`}</Mono>
                <Mono size={11}>{g.target != null ? `${fmtInt(g.g)}/${fmtInt(g.target)}G` : `${fmtInt(g.g)}G`}</Mono>
              </View>
              <View style={[s.bar1, { height: 3 }]}>
                <View style={[s.fill, { height: 3, backgroundColor: PFC_COLORS[g.key], width: `${g.target ? Math.min(1, g.g / g.target) * 100 : 0}%` }]} />
              </View>
            </View>
          ))}
        </View>
      </View>
    </Panel>
  );
}

function Donut({ ratio }: { ratio: { p: number; f: number; c: number } | null }) {
  const size = 52, r = 20, sw = 8, c = 2 * Math.PI * r;
  const parts = ratio ? [['P', ratio.p], ['F', ratio.f], ['C', ratio.c]] as const : [];
  let offset = 0;
  return (
    <Svg width={size} height={size}>
      <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={hudColors.empty} strokeWidth={sw} />
      {parts.map(([k, v]) => {
        const len = (v / 100) * c;
        const el = (
          <Circle key={k} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={PFC_COLORS[k]} strokeWidth={sw}
            strokeDasharray={`${Math.max(0, len - 1.5)} ${c}`} strokeDashoffset={-offset} rotation={-90} origin={`${size / 2}, ${size / 2}`} />
        );
        offset += len;
        return el;
      })}
      <SvgText x={size / 2} y={size / 2 + 4} fontSize={11} fontFamily={fonts.num} fill={colors.sub} textAnchor="middle">PFC</SvgText>
    </Svg>
  );
}

const s = StyleSheet.create({
  panel: { backgroundColor: colors.card, paddingHorizontal: 10, paddingVertical: 10, gap: 2 },
  gauge: { flex: 1, minHeight: 148, minWidth: 0 },
  half: { flex: 1, minWidth: 0, gap: 4 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 4 },
  big: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  bigText: { lineHeight: 26 },
  liftRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  track: { flex: 1, height: 4, backgroundColor: hudColors.empty, overflow: 'hidden' },
  /** 縦に並べる中の 1 本の棒（横いっぱい） */
  bar1: { alignSelf: 'stretch', height: 4, backgroundColor: hudColors.empty, overflow: 'hidden' },
  fill: { height: 4, backgroundColor: colors.accent },
  bars: { height: BAR_H, flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
  barCell: { flex: 1, height: BAR_H, justifyContent: 'flex-end', alignItems: 'center' },
  bar: { position: 'absolute', bottom: 0, width: '60%' },
  ghost: { position: 'absolute', bottom: 0, width: '100%', borderWidth: 1, borderStyle: 'dashed', borderColor: colors.outline },
  goal: { position: 'absolute', left: 0, right: 0, borderTopWidth: 1, borderStyle: 'dashed', borderColor: colors.text, opacity: 0.6 },
  letters: { flexDirection: 'row', gap: 3, marginTop: 2 },
  letterCell: { flex: 1, alignItems: 'center' },
  logRow: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  currentRow: { marginHorizontal: -6, paddingHorizontal: 6, paddingVertical: 3 },
  weekLabel: { width: 22 },
  logHead: { flex: 1, alignItems: 'center' },
  cell: { flex: 1, height: 44, borderRadius: 2, overflow: 'hidden' },
  cellFuture: { borderWidth: 1, borderColor: colors.line },
  cellToday: { borderWidth: 1.5, borderColor: colors.accent },
  cellSelected: { borderWidth: 1.5, borderColor: colors.text },
  cellDay: { position: 'absolute', left: 3, top: 2, lineHeight: 13 },
  cellPart: { position: 'absolute', right: 3, bottom: 4, lineHeight: 14 },
  weighDot: { position: 'absolute', right: 4, top: 4, width: 4, height: 4, borderRadius: 2 },
  injury: {
    position: 'absolute', left: 3, bottom: 5, width: 0, height: 0, borderLeftWidth: 5, borderRightWidth: 5, borderBottomWidth: 8,
    borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: INJURY_RED,
  },
  mealLine: { position: 'absolute', left: 3, right: 3, bottom: 1, height: 2 },
  fuelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
});
