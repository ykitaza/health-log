// クラシック（紙の記録帳）のホームの帳の行（Figma「クラシック（大胆版）」のホーム 251:15958 の「数字の帳」と「今日の食事」）。
// BIG3・今週の負荷量・昨夜の睡眠・体重は同じ高さの行：左に名前と補足、中に色のない小さなグラフ、右に大きな数字と単位。
// 押せる行の読み上げと行き先は HUD の計器（components/homeHud.tsx）と同じ。集計は lib/homeHud.ts
import { ReactNode, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';
import { DateKey, WEEKDAY_JA, weekday } from '@/lib/date';
import type { Big3Gauge, FuelGauge } from '@/lib/homeHud';
import { DAY_TYPE_LABELS } from '@/lib/meals';
import { fmtInt } from '@/lib/units';
import { colors, paper, space } from '@/theme';
import { CountToText } from './charts';
import { PressableScale } from './motion';
import { T } from './Text';

/** 小さなグラフの幅と高さ（Figma の 96 × 44） */
export const MINI_W = 96;
const MINI_H = 44;
/** 小さなグラフの棒の高さ（曜日の文字の上） */
const BAR_H = 24;

/** 帳の 1 行：名前と補足・小さなグラフ・大きな数字と単位。onPress があれば押せる */
export function LedgerRow({ name, note, noteColor = colors.sub, chart, value, unit, label, onPress, testID }: {
  name: string; note?: string | null; noteColor?: string; chart?: ReactNode; value: ReactNode; unit: string;
  label: string; onPress?: () => void; testID?: string;
}) {
  const body = (
    <>
      <View style={s.name}>
        <T size={14} numberOfLines={1}>{name}</T>
        {note ? <T size={12} color={noteColor} numberOfLines={1}>{note}</T> : null}
      </View>
      <View style={s.chart}>{chart}</View>
      <View style={s.value}>
        {value}
        <T size={12} color={colors.sub}>{unit}</T>
      </View>
    </>
  );
  if (!onPress) return <View style={s.row} testID={testID} accessible accessibilityLabel={label}>{body}</View>;
  return (
    <PressableScale style={s.row} testID={testID} accessibilityRole="button" accessibilityLabel={label} scaleTo={0.99} onPress={onPress}>
      {body}
    </PressableScale>
  );
}

/** 帳の大きな数字（32、そろえ数字）。value が null なら「—」 */
export function LedgerValue({ value, format, text }: { value?: number | null; format?: (v: number) => string; text?: string }) {
  if (text != null || value == null || !format) return <T num bold size={32} style={s.big}>{text ?? '—'}</T>;
  return <CountToText value={value} format={(v) => format(v ?? 0)} num bold size={32} style={s.big} />;
}

/** 段の見出し：墨の 1px の罫と 13 の名前（右に補足）。「クラシックの決まり」 */
export function LedgerHead({ title, right, testID }: { title: string; right?: string | null; testID?: string }) {
  return (
    <View style={s.head} testID={testID}>
      <T size={13} bold accessibilityRole="header">{title}</T>
      {right ? <T size={12} color={colors.sub} numberOfLines={1} style={{ flexShrink: 1 }}>{right}</T> : null}
    </View>
  );
}

/** BIG3 の小さなグラフ：B・S・D の横棒（いちばん重い種目の長さを 1 として）と、16 週の線（始まりの点と今の点） */
export function Big3Mini({ gauge }: { gauge: Big3Gauge | null }) {
  const lifts = gauge?.lifts ?? (['bench', 'squat', 'deadlift'] as const).map((role) => ({ role, kg: null }));
  const max = Math.max(1, ...lifts.map((l) => l.kg ?? 0));
  const short = { bench: 'B', squat: 'S', deadlift: 'D' } as const;
  const lx = 12, lw = MINI_W - lx - 6;
  const pts = gauge?.points ?? [];
  const kgs = pts.map((p) => p.kg);
  const lo = Math.min(...kgs), hi = Math.max(...kgs);
  const at = (i: number) => ({ x: lx + pts[i].x * (lw - 4), y: hi === lo ? 37 : 42 - ((pts[i].kg - lo) / (hi - lo)) * 10 });
  return (
    <View style={{ width: MINI_W, height: MINI_H }}>
      {lifts.map((l, i) => (
        <View key={l.role} style={[s.liftRow, { top: i * 9 }]}>
          <T size={11} color={paper.muted} style={s.liftLabel}>{short[l.role]}</T>
          <View style={{ height: 2, width: l.kg ? Math.max(2, (l.kg / max) * lw) : 0, backgroundColor: colors.outline }} />
        </View>
      ))}
      {gauge && pts.length > 1 && (
        <Svg width={MINI_W} height={MINI_H} style={StyleSheet.absoluteFill}>
          <Polyline points={pts.map((_, i) => `${at(i).x},${at(i).y}`).join(' ')} fill="none" stroke={colors.outline} strokeWidth={1} />
          <Circle cx={at(gauge.start).x} cy={at(gauge.start).y} r={2} fill={colors.outline} />
          <Circle cx={at(gauge.now).x} cy={at(gauge.now).y} r={2.5} fill={colors.text} />
        </Svg>
      )}
    </View>
  );
}

/**
 * 7 日の小さな棒（今週の負荷量・昨夜の睡眠）：値のある日は枠の灰色の棒、ない日は罫の 1px、今日（mark）の棒と曜日は墨。
 * dashed を渡すと、その高さ（値と同じ単位）に補足の色の破線（先週の 1 日の平均）
 */
export function WeekMini({ dates, values, today, mark, dashed }: {
  dates: DateKey[]; values: (number | null)[]; today: DateKey; mark?: DateKey; dashed?: number | null;
}) {
  const max = Math.max(1, ...values.map((v) => v ?? 0), dashed ?? 0);
  const step = 13;
  return (
    <View style={{ width: MINI_W, height: MINI_H }}>
      <Svg width={MINI_W} height={BAR_H + 4}>
        {values.map((v, i) => {
          const x = 2 + i * step;
          const on = mark != null && dates[i] === mark;
          if (v == null || v <= 0) return <Line key={i} x1={x} x2={x + 8} y1={BAR_H + 3.5} y2={BAR_H + 3.5} stroke={colors.line} strokeWidth={1} />;
          const hh = Math.max(2, (v / max) * BAR_H);
          return <Line key={i} x1={x + 4} x2={x + 4} y1={BAR_H + 4} y2={BAR_H + 4 - hh} stroke={on ? colors.text : colors.outline} strokeWidth={8} />;
        })}
        {dashed != null && dashed > 0 && (
          <Line x1={0} x2={92} y1={BAR_H + 4 - (dashed / max) * BAR_H} y2={BAR_H + 4 - (dashed / max) * BAR_H} stroke={colors.sub} strokeWidth={1} strokeDasharray="3 2" />
        )}
      </Svg>
      <View style={s.days}>
        {dates.map((d, i) => (
          <T key={d} size={11} color={d === today ? colors.text : paper.muted} style={{ position: 'absolute', left: 1 + i * step, width: 11, textAlign: 'center' }}>{WEEKDAY_JA[weekday(d)]}</T>
        ))}
      </View>
    </View>
  );
}

const PFC_NAMES = { P: 'たんぱく質', F: '脂質', C: '炭水化物' } as const;

/**
 * 今日の食事（Figma のホームの「今日の食事」）：墨の罫の見出しと日の種類、摂った kcal（56）と目標、右に「あと N kcal」、緑の進みの棒、
 * PFC の 3 行（名前・割合・灰色の棒・グラム／目標）。行は罫で区切る
 */
export function FuelLedger({ fuel, label, kcalRatio, pct, onPress, testID }: {
  fuel: FuelGauge | null; label: string; kcalRatio: number; pct: (k: 'P' | 'F' | 'C') => number | null; onPress?: () => void; testID: string;
}) {
  const left = fuel?.kcalTarget != null ? fuel.kcalTarget - fuel.kcal : null;
  const [w, setW] = useState(0);
  const body = (
    <View style={{ flex: 1 }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      <LedgerHead title="今日の食事" right={fuel ? DAY_TYPE_LABELS[fuel.dayType] : null} />
      <View style={s.kcal}>
        <View style={s.kcalBig}>
          <CountToText value={fuel ? fuel.kcal : null} format={(v) => fmtInt(v ?? 0)} num bold size={w > 0 && w < 340 ? 48 : 56} style={{ lineHeight: 62 }} />
          <T size={14} color={colors.sub}>{fuel?.kcalTarget != null ? `/ ${fmtInt(fuel.kcalTarget)} kcal` : 'kcal'}</T>
        </View>
        {left != null ? <T size={13} color={colors.sub} numberOfLines={1} style={{ flexShrink: 1 }}>{left >= 0 ? `あと ${fmtInt(left)} kcal` : `${fmtInt(-left)} kcal 多い`}</T> : null}
      </View>
      <View style={s.track}><View style={[s.fill, { width: `${kcalRatio * 100}%` }]} /></View>
      <View style={{ marginTop: space.m }}>
        {(fuel?.grams ?? (['P', 'F', 'C'] as const).map((key) => ({ key, g: 0, target: null }))).map((g, i) => (
          <View key={g.key} style={[s.pfcRow, i > 0 && s.rule]}>
            <T size={14} numberOfLines={1} style={s.pfcName}>{PFC_NAMES[g.key]}</T>
            <T num size={12} color={colors.sub} style={s.pfcPct}>{`${pct(g.key) ?? '—'}%`}</T>
            <View style={s.pfcTrack}>
              <View style={{ height: 2, backgroundColor: colors.outline, width: `${g.target ? Math.min(1, g.g / g.target) * 100 : 0}%` }} />
            </View>
            <T num bold size={18} style={s.pfcValue} numberOfLines={1}>{g.target != null ? `${fmtInt(g.g)} / ${fmtInt(g.target)} g` : `${fmtInt(g.g)} g`}</T>
          </View>
        ))}
      </View>
    </View>
  );
  if (!onPress) return <View testID={testID} accessible accessibilityLabel={label} style={s.fuel}>{body}</View>;
  return (
    <PressableScale testID={testID} accessibilityRole="button" accessibilityLabel={label} scaleTo={0.99} onPress={onPress} style={s.fuel}>{body}</PressableScale>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 76, gap: space.l, borderTopWidth: 1, borderTopColor: colors.line, paddingVertical: space.m },
  name: { width: 120, gap: 2 },
  chart: { flex: 1, minWidth: 0, alignItems: 'flex-start' },
  value: { flexDirection: 'row', alignItems: 'baseline', gap: 4, marginLeft: 'auto' },
  big: { lineHeight: 36 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.s, borderTopWidth: 1, borderTopColor: colors.text, paddingTop: space.m, paddingBottom: space.s },
  liftRow: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'center', height: 10 },
  liftLabel: { width: 12, lineHeight: 10 },
  days: { height: 14, marginTop: 2 },
  fuel: { width: '100%' },
  kcal: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.s, marginTop: space.s },
  kcalBig: { flexDirection: 'row', alignItems: 'baseline', gap: space.s, flexShrink: 1 },
  track: { height: 3, backgroundColor: colors.line, marginTop: space.s, overflow: 'hidden' },
  fill: { height: 3, backgroundColor: colors.accent },
  pfcRow: { flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: space.s },
  rule: { borderTopWidth: 1, borderTopColor: colors.line },
  pfcName: { width: 72 },
  pfcPct: { width: 32 },
  pfcTrack: { flex: 1, height: 2, backgroundColor: colors.line, overflow: 'hidden', marginRight: space.s },
  pfcValue: { marginLeft: 'auto' },
});
