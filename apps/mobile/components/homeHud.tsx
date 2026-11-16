// ホームの「計器の盤」（刷新 A、Figma「スタディ：フェーズ」の 6）の部品：枠（角の切り欠き）、計器の段（BIG3・LOAD・SLEEP）、
// LOG（週ごとの方眼）、FUEL（今日の kcal と PFC）。集計は lib/homeHud.ts。
// 色はミント 1 色の濃淡が主役。回復中は暖色・ケガは赤（回復マップと同じ）。光・ぼかし・グラデーションの飾りは使わない。
// クラシック（Figma「ホーム（unslop 案）」）は、切り欠きをやめて細い枠と丸い角にし、見出しは日本語、小さなグラフは灰色にする（deco・lbl）
import { router } from 'expo-router';
import { ReactNode, useState } from 'react';
import { Pressable, StyleSheet, View, ViewStyle } from 'react-native';
import Svg, { Circle, Path, Polyline, Text as SvgText } from 'react-native-svg';
import { DateKey, formatJpDate, WEEKDAY_EN, WEEKDAY_JA, weekday } from '@/lib/date';
import { BIG3_LABELS } from '@/lib/exercises';
import { tonnes, formatSigned, isFlat } from '@/lib/format';
import { formatHM } from '@/lib/health';
import {
  Big3Gauge, FuelGauge, LoadGauge, LogCell, logCellLabel, LogWeek, logWeekRange, SleepGauge,
} from '@/lib/homeHud';
import { DAY_TYPE_LABELS } from '@/lib/meals';
import { INJURY_RED } from '@/lib/recoveryMap';
import { fmt1, fmtInt, kgToUnit, WeightUnit } from '@/lib/units';
import { colors, deco, fonts, hairline, hudColors, isHud, lbl, radius, space } from '@/theme';
import { CountToText } from './charts';
import { Mono } from './injuries';
import { PressableScale } from './motion';
import { T } from './Text';

/** 角の切り欠きの長さ */
const BRACKET = 10;

/** 4 隅の切り欠き（ブラケット）。color を変えると強める（今週の行） */
export function Brackets({ color = hudColors.bracket, size = BRACKET }: { color?: string; size?: number }) {
  if (!deco.brackets) return null;
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
export function Panel({ children, onPress, label, testID, style }: { children: ReactNode; onPress?: () => void; label?: string; testID?: string; style?: ViewStyle }) {
  if (!onPress) {
    return (
      <View style={[s.panel, PANEL_LOOK, style]} testID={testID} accessible={label != null} accessibilityLabel={label}>
        <Brackets />{children}
      </View>
    );
  }
  return (
    <PressableScale style={[s.panel, PANEL_LOOK, style]} testID={testID} accessibilityRole="button" accessibilityLabel={label} scaleTo={0.98} onPress={onPress}>
      <Brackets />{children}
    </PressableScale>
  );
}

/** クラシックの枠：切り欠きの代わりに、細い線（theme の hairline）と丸い角。先週比は Figma のとおり、増えても減っても補足の色 */
const PANEL_LOOK: ViewStyle | null = isHud ? null : { borderWidth: 1, borderColor: hairline, borderRadius: radius.card, padding: space.m };

/**
 * 見出しの行：左に英字のラベル、右に小さな数字。クラシックは日本語のラベル（ja）を、strong なら本文の色の太字で、ほかは補足の色で
 */
function Head({ left, ja, strong = false, right, rightColor = colors.sub }: { left: string; ja: string; strong?: boolean; right?: string | null; rightColor?: string }) {
  if (!deco.enLabels) {
    return (
      <View style={s.head}>
        {strong ? <T variant="labelL">{ja}</T> : <T size={12} color={colors.sub}>{ja}</T>}
        {right ? <T size={12} color={colors.sub} numberOfLines={1} style={{ flexShrink: 1 }}>{right}</T> : null}
      </View>
    );
  }
  return (
    <View style={s.head}>
      <Mono color={colors.accent} size={11}>{left}</Mono>
      {right ? <Mono color={rightColor} size={11}>{right}</Mono> : null}
    </View>
  );
}

/** 数字のあとの小さな単位。クラシックは補足の色の 12 */
function Unit({ children }: { children: string }) {
  if (!deco.enLabels) return <T size={12} color={colors.sub}>{children}</T>;
  return <Mono size={11}>{children}</Mono>;
}

/** 計器の補足の 1 行（差・比・平均） */
function Note({ children, color = colors.sub }: { children: string; color?: string }) {
  if (!deco.enLabels) return <T size={12} color={color} numberOfLines={1}>{children}</T>;
  return <Mono size={11} color={color}>{children}</Mono>;
}

/** 大きな数字と単位（数字は数え上げる。読み込む前は「—」） */
function Big({ value, format, unit, testID }: { value: number | null; format: (v: number) => string; unit: string; testID?: string }) {
  return (
    <View style={s.big} testID={testID}>
      {value == null
        ? <T num bold size={BIG} style={s.bigText}>—</T>
        : <CountToText value={value} format={(v) => format(v ?? 0)} num bold size={BIG} style={s.bigText} />}
      <Unit>{unit}</Unit>
    </View>
  );
}

/** 計器の大きな数字の大きさ（クラシックは Figma の 24） */
const BIG = isHud ? 22 : 24;

const trendColor = (n: number) => (isFlat(n) ? colors.sub : n > 0 ? colors.accent : colors.danger);
const big3Short = { bench: 'B', squat: 'S', deadlift: 'D' } as const;
/** クラシックの BIG3 の差の言い方（Figma「開始から +2.5」） */
const DELTA_JA = { PHASE: '開始から', '28D': '28日前から', START: '始めた日から' } as const;
/** クラシックの小さなグラフは灰色の一段（Figma の棒と線は colors.outline） */
const CHART = isHud ? colors.accent : colors.outline;

/** 行き先の画面（筋トレの推移・睡眠の推移・食事のタブ）にも同じ計器を置く。そのときは link を false にして押せなくし、testID をほかにする（ほかのタブも DOM に残るため） */
type Placement = { link?: boolean; testID?: string };

/** BIG3：今の合計（推定1RM）、差（フェーズ実施中は開始から Δ PHASE、ほかは 28 日前から）、B・S・D の棒、16 週の線（始まり・自己ベスト・今の点）。押すと筋トレの推移の、同じカードと BIG3 のグラフ */
export function Big3Panel({ gauge, unit, ready, link = true, testID = 'home-big3' }: { gauge: Big3Gauge | null; unit: WeightUnit; ready: boolean } & Placement) {
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
    <Panel testID={testID} label={link ? `${label}。筋トレの推移を開く` : label} style={s.gauge}
      onPress={link ? () => router.navigate({ pathname: '/training', params: { view: 'trend', focus: 'big3' } }) : undefined}>
      <Head left="BIG3" ja="BIG3" />
      <Big value={ready && gauge ? u(gauge.totalKg) : null} format={fmt1} unit={lbl(unit.toUpperCase(), unit)} />
      {gauge?.deltaKg != null
        ? <Note color={trendColor(gauge.deltaKg)}>{lbl(`Δ ${gauge.deltaBase} ${formatSigned(u(gauge.deltaKg))}`, `${DELTA_JA[gauge.deltaBase]} ${formatSigned(u(gauge.deltaKg))}`)}</Note>
        : <Note>{ready && !gauge ? lbl('NO DATA', '記録なし') : lbl('Δ —', '—')}</Note>}
      <View style={{ gap: 2, marginTop: 2 }}>
        {(gauge?.lifts ?? (['bench', 'squat', 'deadlift'] as const).map((role) => ({ role, kg: null }))).map((l) => (
          <View key={l.role} style={s.liftRow}>
            <Mono size={11}>{big3Short[l.role]}</Mono>
            <View style={s.track}><View style={[s.fill, { backgroundColor: CHART, width: `${max > 0 && l.kg ? (l.kg / max) * 100 : 0}%` }]} /></View>
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
      {pts.length > 1 && <Polyline points={pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={CHART} strokeWidth={1.5} />}
      <Circle cx={start.x} cy={start.y} r={2.5} fill={colors.card} stroke={CHART} strokeWidth={1} />
      {gauge.best !== gauge.now && <Circle cx={best.x} cy={best.y} r={2.5} fill={colors.text} />}
      <Circle cx={now.x} cy={now.y} r={3} fill={isHud ? colors.accent : colors.text} />
    </Svg>
  );
}

/** 曜日の頭文字（M T W T F S S）。今日は緑。クラシックは日本語の曜日で、今日は本文の色の太字 */
function DayLetters({ dates, today }: { dates: DateKey[]; today: DateKey }) {
  if (!deco.enLabels) {
    return (
      <View style={s.letters}>
        {dates.map((d) => <View key={d} style={s.letterCell}><T size={11} bold={d === today} color={d === today ? colors.text : colors.sub}>{WEEKDAY_JA[weekday(d)]}</T></View>)}
      </View>
    );
  }
  return (
    <View style={s.letters}>
      {dates.map((d) => <View key={d} style={s.letterCell}><Mono size={11} color={d === today ? colors.accent : colors.sub}>{WEEKDAY_EN[weekday(d)][0]}</Mono></View>)}
    </View>
  );
}

const BAR_H = 34;
/** 睡眠の棒の色（目標に届かない・届いた）。クラシックは灰色の濃淡 */
const SLEEP_BAR = isHud ? [colors.accentMuted, colors.accent] : [colors.outline, colors.text];

/** LOAD：今週の合計負荷量、今週 7 日の棒と、先週の日ごとの破線の枠、先週の同じ曜日までとの比。押すと筋トレの推移の、同じカードと総負荷量を日ごとで */
export function LoadPanel({ gauge, dates, today, unit, ready, link = true, testID = 'volume-week' }: {
  gauge: LoadGauge; dates: DateKey[]; today: DateKey; unit: WeightUnit; ready: boolean;
} & Placement) {
  const max = Math.max(1, ...gauge.lastWeek, ...gauge.thisWeek.map((v) => v ?? 0));
  const pct = gauge.vsLastWeekPct;
  const tUnit = unit === 'kg' ? 't' : 'k lb';
  const label = `今週の合計負荷量 ${tonnes(gauge.totalKg, unit)}${unit === 'kg' ? 'トン' : '千ポンド'}${pct != null ? `。先週の同じ曜日までより ${pct >= 0 ? `${pct}% 多い` : `${-pct}% 少ない`}` : ''}`;
  return (
    <Panel testID={testID} label={link ? `${label}。筋トレの推移を開く` : label} style={s.gauge}
      onPress={link ? () => router.navigate({ pathname: '/training', params: { view: 'trend', focus: 'load' } }) : undefined}>
      <Head left="LOAD" ja="今週の負荷量" />
      <View style={s.big}>
        <CountToText value={ready ? gauge.totalKg : null} format={(v) => tonnes(v ?? 0, unit)} num bold size={BIG} style={s.bigText} />
        <Unit>{tUnit}</Unit>
      </View>
      <Note color={pct != null && isHud ? trendColor(pct) : colors.sub}>{`${lbl('vs LW', '先週比')} ${pct != null ? `${pct >= 0 ? '+' : '−'}${Math.abs(pct)}%` : '—'}`}</Note>
      <View style={[s.bars, { marginTop: 'auto' }]}>
        {gauge.thisWeek.map((v, i) => (
          <View key={i} style={s.barCell}>
            {gauge.lastWeek[i] > 0 && <View style={[s.ghost, { height: Math.max(2, (gauge.lastWeek[i] / max) * BAR_H) }]} />}
            {v != null && v > 0 && <View style={[s.bar, { height: Math.max(2, (v / max) * BAR_H), backgroundColor: isHud ? colors.accent : colors.text }]} />}
          </View>
        ))}
      </View>
      <DayLetters dates={dates} today={today} />
    </Panel>
  );
}

/** SLEEP：昨夜、7 日の棒、7H の目標線、平均（Health Connect の睡眠）。押すと睡眠の推移（いちばん上に同じカード） */
export function SleepPanel({ gauge, today, link = true, testID = 'home-sleep' }: { gauge: SleepGauge; today: DateKey } & Placement) {
  const max = Math.max(gauge.goalMin * 1.25, ...gauge.days.map((d) => d.min ?? 0));
  const goalY = (gauge.goalMin / max) * BAR_H;
  const label = `睡眠。昨夜 ${gauge.lastNightMin != null ? formatHM(gauge.lastNightMin) : '記録なし'}${gauge.averageMin != null ? `。7日の平均 ${formatHM(gauge.averageMin)}` : ''}。目標 7時間`;
  return (
    <Panel testID={testID} label={link ? `${label}。睡眠の推移を開く` : label} style={s.gauge}
      onPress={link ? () => router.push({ pathname: '/health-trend', params: { kind: 'sleep' } }) : undefined}>
      <Head left="SLEEP" ja="昨夜の睡眠" />
      <View style={s.big}>
        <T num bold size={BIG} style={s.bigText}>{gauge.lastNightMin != null ? formatHM(gauge.lastNightMin) : '—'}</T>
        <Unit>{lbl('H', '時間')}</Unit>
      </View>
      <Note>{`${lbl('AVG', '平均')} ${gauge.averageMin != null ? formatHM(gauge.averageMin) : '—'}`}</Note>
      <View style={[s.bars, { marginTop: 'auto' }]}>
        <View pointerEvents="none" style={[s.goal, { bottom: goalY }]} />
        {gauge.days.map((d) => (
          <View key={d.date} style={s.barCell}>
            {d.min != null && d.min > 0 && (
              <View style={[s.bar, { height: Math.max(2, (d.min / max) * BAR_H), backgroundColor: SLEEP_BAR[d.min >= gauge.goalMin ? 1 : 0] }]} />
            )}
          </View>
        ))}
      </View>
      <DayLetters dates={gauge.days.map((d) => d.date)} today={today} />
    </Panel>
  );
}

/**
 * BODY：計器の段の下の細い 1 行。その日の体重と、目標体重まで（「目標まで あと 3.4 kg」。目標がないときは出さない）。
 * 体重がなければ「—」。押すとからだのタブ（その日）。睡眠・安静時心拍は出さない（睡眠は SLEEP だけ）
 */
export function BodyPanel({ weightKg, goal, unit, label, onPress, testID = 'home-body' }: {
  weightKg: number | null; goal: string | null; unit: WeightUnit; label: string; onPress: () => void; testID?: string;
}) {
  const value = weightKg != null ? fmt1(kgToUnit(weightKg, unit)) : '—';
  const spoken = weightKg != null ? `体重 ${value} ${unit}${goal ? `。${goal}` : ''}` : '体重 記録なし';
  return (
    <Panel testID={testID} label={`${spoken}。からだのタブを開く`} onPress={onPress} style={s.bodyPanel}>
      {deco.enLabels ? <Mono color={colors.accent} size={11}>{label}</Mono> : <T size={13} color={colors.sub}>{label}</T>}
      <View style={s.big}>
        <T num bold size={isHud ? 18 : 24} style={{ lineHeight: isHud ? 22 : 28 }}>{value}</T>
        <Unit>{lbl(unit.toUpperCase(), unit)}</Unit>
      </View>
      {goal ? <T size={12} color={colors.sub} numberOfLines={1} style={s.bodyGoal}>{goal}</T> : null}
    </Panel>
  );
}

const CELL_BG = [hudColors.empty, hudColors.mint1, hudColors.mint2, hudColors.mint3];
/** マスの上の文字の色。クラシックの塗りは落ち着いた濃淡なので、どの段でも本文の色 */
const onCell = (level: number) => (isHud && level >= 2 ? colors.onAccent : colors.text);

/**
 * LOG：直近 4 週の方眼（月曜始まり、今週がいちばん下）。塗りの濃さは負荷量（3 段）、右下に部位の頭文字、下線は食事の目標を達成、
 * 右上の点は体重を測った、左下の赤の三角はケガ、左上は日付。今日のマスは枠と、まだならおすすめの部位。
 * マスを押すとその日を選ぶ（前のカレンダーと同じ。「記録する」と体調のカードがその日になる）
 */
export function LogPanel({ weeks, month, selected, unit, onPressDay }: {
  weeks: LogWeek[]; month: { month: string; monthJa: string; days: number; volumeKg: number } | null; selected: DateKey; unit: WeightUnit; onPressDay: (d: DateKey) => void;
}) {
  return (
    <Panel testID="home-log" style={{ paddingHorizontal: space.m }}>
      <Head left={`LOG // ${logWeekRange(weeks.map((w) => w.label))}`} ja="直近4週" strong
        right={month ? lbl(`${month.month}  ${month.days}D · ${tonnes(month.volumeKg, unit)}${unit === 'kg' ? 'T' : 'K LB'}`, `${month.monthJa} 筋トレ ${month.days}日 · ${tonnes(month.volumeKg, unit)} ${unit === 'kg' ? 't' : 'k lb'}`) : null} />
      <View style={[s.logRow, { marginTop: space.xs }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <View style={s.weekLabel} />
        {(weeks[0]?.cells ?? []).map((c) => (
          <View key={c.date} style={s.logHead}>
            {deco.enLabels ? <Mono size={11}>{WEEKDAY_EN[weekday(c.date)][0]}</Mono> : <T size={11} color={colors.sub}>{WEEKDAY_JA[weekday(c.date)]}</T>}
          </View>
        ))}
      </View>
      <View style={{ gap: 4 }}>
        {weeks.map((w) => (
          <View key={w.cells[0].date} style={[s.logRow, w.current && s.currentRow]} testID={w.current ? 'log-current-week' : undefined}>
            {w.current && <Brackets color={colors.accent} size={8} />}
            <View style={s.weekLabel}>
              {deco.enLabels
                ? <Mono size={11} color={w.current ? colors.accent : colors.sub}>{w.label}</Mono>
                : <T size={11} bold={w.current} color={w.current ? colors.text : colors.sub}>{weekLabelJa(w.label)}</T>}
            </View>
            {w.cells.map((c) => <LogDay key={c.date} c={c} selected={c.date === selected} unit={unit} onPress={() => onPressDay(c.date)} />)}
          </View>
        ))}
      </View>
    </Panel>
  );
}

/** クラシックの週の名前：「W2」→「2週」 */
const weekLabelJa = (label: string) => (label.startsWith('W') ? `${label.slice(1)}週` : label);

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
      {c.injury && <View style={isHud ? s.injury : s.injuryDot} testID={`log-injury-${c.date}`} />}
      {c.mealGoal && <View style={[s.mealLine, { backgroundColor: isHud ? (c.level >= 2 ? colors.onAccent : colors.accent) : colors.text }]} testID={`log-meal-${c.date}`} />}
    </Pressable>
  );
}

const PFC_COLORS = { P: hudColors.mint3, F: hudColors.mint2, C: hudColors.mint1 } as const;

/**
 * FUEL：今日の kcal（摂った／目標）、日の種類、PFC の割合のドーナツ（ミントの濃淡）と、P・F・C のグラム／目標の棒。押すと食事のタブ（同じカードまでスクロール）。
 * dayLabel は読み上げの日（食事のタブでは選んだ日）
 */
export function FuelPanel({ fuel, date, dayLabel = '今日', link = true, testID = 'home-fuel' }: { fuel: FuelGauge | null; date: DateKey; dayLabel?: string } & Placement) {
  const ratio = fuel?.ratio ?? null;
  const pct = (k: 'P' | 'F' | 'C') => (ratio ? Math.round(k === 'P' ? ratio.p : k === 'F' ? ratio.f : ratio.c) : null);
  const kcalRatio = fuel?.kcalTarget ? Math.min(1, fuel.kcal / fuel.kcalTarget) : 0;
  const label = fuel == null ? `${dayLabel}の食事`
    : [
      `${dayLabel}の食事 ${fmtInt(fuel.kcal)}kcal${fuel.kcalTarget != null ? `、目標 ${fmtInt(fuel.kcalTarget)}kcal` : ''}`,
      DAY_TYPE_LABELS[fuel.dayType],
      fuel.grams.map((g) => `${g.key === 'P' ? 'たんぱく質' : g.key === 'F' ? '脂質' : '炭水化物'} ${fmtInt(g.g)}g${g.target != null ? `／${fmtInt(g.target)}g` : ''}${pct(g.key) != null ? `（${pct(g.key)}%）` : ''}`).join('、'),
    ].join('。');
  const onPress = link ? () => router.navigate({ pathname: '/meals', params: { date, focus: 'fuel' } }) : undefined;
  if (!isHud) return <FuelPanelClassic fuel={fuel} label={link ? `${label}。食事のタブを開く` : label} kcalRatio={kcalRatio} pct={pct} onPress={onPress} testID={testID} />;
  return (
    <Panel testID={testID} label={link ? `${label}。食事のタブを開く` : label} style={s.half}
      onPress={onPress}>
      <Head left="FUEL //" ja="今日の食事" right={fuel ? (fuel.dayType === 'training' ? 'TRAIN DAY' : 'REST DAY') : null} />
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

const PFC_NAMES = { P: 'たんぱく質', F: '脂質', C: '炭水化物' } as const;

/**
 * クラシックの FUEL（Figma「ホーム（unslop 案）」の今日の食事）：見出しと日の種類、摂った kcal と目標、補足に「あと N kcal」、
 * kcal の棒（ミント）と、PFC の 3 行（名前・割合・グラム／目標と灰色の棒）。ドーナツは使わない
 */
function FuelPanelClassic({ fuel, label, kcalRatio, pct, onPress, testID }: {
  fuel: FuelGauge | null; label: string; kcalRatio: number; pct: (k: 'P' | 'F' | 'C') => number | null; onPress?: () => void; testID: string;
}) {
  const left = fuel?.kcalTarget != null ? fuel.kcalTarget - fuel.kcal : null;
  return (
    <Panel testID={testID} label={label} style={{ ...s.half, ...s.fuelClassic }} onPress={onPress}>
      <Head left="FUEL //" ja="今日の食事" strong right={fuel ? DAY_TYPE_LABELS[fuel.dayType] : null} />
      <View style={[s.head, { alignItems: 'baseline', marginTop: space.s }]}>
        <View style={s.big}>
          <CountToText value={fuel ? fuel.kcal : null} format={(v) => fmtInt(v ?? 0)} num bold size={32} style={{ lineHeight: 38 }} />
          <T size={14} color={colors.sub}>{fuel?.kcalTarget != null ? `/ ${fmtInt(fuel.kcalTarget)} kcal` : 'kcal'}</T>
        </View>
        {left != null ? <T size={13} color={colors.sub} numberOfLines={1} style={{ flexShrink: 1 }}>{left >= 0 ? `あと ${fmtInt(left)} kcal` : `${fmtInt(-left)} kcal 多い`}</T> : null}
      </View>
      <View style={[s.bar1, s.round, { marginTop: space.s }]}><View style={[s.fill, s.round, { width: `${kcalRatio * 100}%` }]} /></View>
      <View style={{ gap: space.s, marginTop: space.m }}>
        {(fuel?.grams ?? (['P', 'F', 'C'] as const).map((key) => ({ key, g: 0, target: null }))).map((g) => (
          <View key={g.key} style={{ gap: space.xs }}>
            <View style={[s.head, { alignItems: 'baseline' }]}>
              <T size={12} numberOfLines={1} style={{ flexShrink: 1 }}>
                {PFC_NAMES[g.key]}<T num size={14} color={colors.sub}>{`  ${pct(g.key) ?? '—'}%`}</T>
              </T>
              <T num size={14} color={colors.sub}>{g.target != null ? `${fmtInt(g.g)} / ${fmtInt(g.target)} g` : `${fmtInt(g.g)} g`}</T>
            </View>
            <View style={[s.bar1, s.round]}>
              <View style={[s.fill, s.round, { backgroundColor: colors.outline, width: `${g.target ? Math.min(1, g.g / g.target) * 100 : 0}%` }]} />
            </View>
          </View>
        ))}
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
  // BODY：ラベル・体重・目標までを 1 行に（ガジェットの行より低い）
  bodyPanel: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingVertical: 8 },
  bodyGoal: { flex: 1, minWidth: 0, textAlign: 'right' },
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
  // 先週の同じ曜日。クラシックは破線の枠ではなく、地より一段明るい塗り（Figma）
  ghost: isHud
    ? { position: 'absolute', bottom: 0, width: '100%', borderWidth: 1, borderStyle: 'dashed', borderColor: colors.outline }
    : { position: 'absolute', bottom: 0, width: '100%', borderRadius: 2, backgroundColor: colors.line },
  goal: { position: 'absolute', left: 0, right: 0, borderTopWidth: 1, borderStyle: 'dashed', borderColor: colors.text, opacity: 0.6 },
  letters: { flexDirection: 'row', gap: 3, marginTop: 2 },
  letterCell: { flex: 1, alignItems: 'center' },
  logRow: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  currentRow: { marginHorizontal: -6, paddingHorizontal: 6, paddingVertical: 3 },
  weekLabel: { width: 22 },
  logHead: { flex: 1, alignItems: 'center' },
  cell: { flex: 1, height: 44, borderRadius: isHud ? 2 : 6, overflow: 'hidden' },
  cellFuture: { borderWidth: 1, borderColor: colors.line },
  cellToday: { borderWidth: 1.5, borderColor: colors.accent },
  cellSelected: { borderWidth: 1.5, borderColor: colors.text },
  cellDay: { position: 'absolute', left: 3, top: 2, lineHeight: 13 },
  cellPart: { position: 'absolute', right: 3, bottom: 4, lineHeight: 14 },
  weighDot: { position: 'absolute', right: 4, top: 4, width: 4, height: 4, borderRadius: 2 },
  injuryDot: { position: 'absolute', left: 4, bottom: 6, width: 6, height: 6, borderRadius: 3, backgroundColor: INJURY_RED },
  fuelClassic: { paddingHorizontal: space.l + space.xs, paddingVertical: space.l },
  round: { borderRadius: 2 },
  injury: {
    position: 'absolute', left: 3, bottom: 5, width: 0, height: 0, borderLeftWidth: 5, borderRightWidth: 5, borderBottomWidth: 8,
    borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: INJURY_RED,
  },
  mealLine: { position: 'absolute', left: 3, right: 3, bottom: 1, height: 2 },
  fuelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
});
