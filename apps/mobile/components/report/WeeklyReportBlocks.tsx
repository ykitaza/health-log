// レポートの週次の中身のうち、アプリが端末の記録から組み立てるブロック（レポート再設計の週次ビュー）。
// - WeeklyRadarBlock：レポートの週の終わりを起点にした直近14日の部位のバランスのレーダー（lib/partBalance.ts のアンカー版。ホームのレーダーと同じ集計）
// - InjuryReviewBlock：その週のケガの振り返り（lib/injuryReport.ts の3分類。Report のスキーマには関わらない）
// 並びは週次の詳細で「週間平均のヒーロー → レーダー（このブロック）→ 数値の表 → INJURY REVIEW（このブロック）→ 来週の焦点」。
// 色はミント（colors.accent）＋モノクロだけ（ケガの画面の琥珀色も、調子の色も使わない）
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useEntrance } from '@/hooks/entrance';
import { useFocusData } from '@/hooks/data';
import type { DateKey } from '@/lib/date';
import { addDays, formatMonthDay } from '@/lib/date';
import { RESULTS } from '@/lib/injuries';
import {
  injuryPeriodInjuryCount, loadInjuryPeriodReport, type InjuryPeriodReport, type InjuryReportEntry,
} from '@/lib/injuryReport';
import { BALANCE_PARTS, partBalanceAnchored, partBalancePeriodLabel } from '@/lib/partBalance';
import { colors, space } from '@/theme';
import { PartStackRadar } from '../PartBalance';
import { ReportMicro, reportPanelStyle } from './panel';
import { useEntering } from '../reports';
import { T } from '../Text';

/** ブロックの見出し：英字のマイクロラベル＋日本語の題、右に期間。週次のほかのブロックと字の大きさをそろえる */
function BlockHead({ en, title, start, end }: { en: string; title: string; start: DateKey; end: DateKey }) {
  return (
    <View style={{ gap: 2 }}>
      <ReportMicro>{en}</ReportMicro>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.s }}>
        <T bold size={17} accessibilityRole="header">{title}</T>
        <T size={13} color={colors.sub}>{`${formatMonthDay(start)}〜${formatMonthDay(end)}`}</T>
      </View>
    </View>
  );
}

const cardStyle = { ...reportPanelStyle, padding: 12, gap: 10 } as const;

/**
 * 週次の部位のバランスのレーダー：レポートの週の終わりの日（end）を起点にした直近14日のセット数を、ホームの大きなレーダーと同じ描き方で。
 * 集計はホームと同じ直近14日（lib/partBalance.ts の partBalanceAnchored）。週の7日間だけでは記録が薄く形が読めないため、
 * 「その週の終わり時点のバランス」として14日で見る（ホームのレーダーと見比べもできる）
 */
export function WeeklyRadarBlock({ start, end, index = 0 }: { start: DateKey; end: DateKey; index?: number }) {
  const enter = useEntering();
  const spanStart = addDays(end, -13);
  const { data: balance } = useFocusData(async (r) => {
    const [rows, parts] = await Promise.all([r.workouts.allSetRows(), r.catalog.listBodyParts({ includeHidden: true })]);
    const names = new Map(parts.map((p) => [p.id, p.name]));
    return partBalanceAnchored(rows, (id) => names.get(id) ?? '', end);
  }, `${start}:${end}`);
  const [width, setWidth] = useState(0);
  const { token } = useEntrance(balance, balance ? balance.sets.join(',') : null);
  if (!balance) return null;
  const topIdx = balance.sets.indexOf(Math.max(...balance.sets));
  const note = balance.total === 0
    ? '直近14日間の記録はありません（胸・肩・背中・腕・脚・腹のセット数を数えます）'
    : `いちばん多いのは${BALANCE_PARTS[topIdx]}（${balance.sets[topIdx]}セット）`;
  return (
    <Animated.View entering={enter(index)} style={cardStyle} testID="report-weekly-radar">
      <BlockHead en="BODY PART BALANCE" title="部位のバランス" start={spanStart} end={end} />
      <View accessible accessibilityLabel={partBalancePeriodLabel(balance, spanStart, end)} style={{ gap: space.s }}>
        <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
          {width > 0 && (
            <PartStackRadar all={balance} recent={null} width={width} token={token} fillId="weeklyReportPartFill" testID="report-weekly-radar-chart" />
          )}
        </View>
        <T variant="labelS" bold={false} color={colors.sub}>{note}</T>
      </View>
    </Animated.View>
  );
}

/** 数値の表の1行：ラベル左・値右、上の罫線（hairline）。値は長ければ右寄せのまま折り返す */
function StatRow({ label, value, first = false }: { label: string; value: string; first?: boolean }) {
  return (
    <View style={[s.row, !first && s.rowLine]}>
      <T size={13} color={colors.sub} style={{ flexShrink: 0 }}>{label}</T>
      <T size={13} style={{ flex: 1, textAlign: 'right' }}>{value}</T>
    </View>
  );
}

/** 振り返りの結果の点（直せた＝ミントの塗り、まだ＝灰色の塗り、痛んだ＝輪だけ。色だけでなく形でも見分ける） */
function ReviewDot({ result }: { result: keyof typeof RESULTS }) {
  if (result === 'fixed') return <View style={[s.dot, { backgroundColor: colors.accent }]} />;
  if (result === 'not_yet') return <View style={[s.dot, { backgroundColor: colors.outline }]} />;
  return <View style={[s.dot, { borderWidth: 1.5, borderColor: colors.sub }]} />;
}

/** ケガ1件の表：番号・部位・状態の見出し行＋ラベル左/値右の行。periodReviews があれば結果の点の列も */
function InjuryEntryRows({ entry, showReviews }: { entry: InjuryReportEntry; showReviews: boolean }) {
  const where = [entry.exercise, entry.phase].filter(Boolean).join('・');
  const textRows: { label: string; value: string }[] = [
    { label: '痛めた日', value: formatMonthDay(entry.occurredOn) },
    { label: '種目・場面', value: where !== '' ? where : '種目なし' },
    { label: '状態', value: entry.statusLabel },
    ...(entry.fixedOn != null ? [{ label: '直せた日', value: formatMonthDay(entry.fixedOn) }] : []),
    ...(entry.symptom.trim() !== '' ? [{ label: '何が起きたか', value: entry.symptom.trim() }] : []),
    ...(entry.cause.trim() !== '' ? [{ label: '原因', value: entry.cause.trim() }] : []),
    ...(entry.fix.trim() !== '' ? [{ label: '次の直し方', value: entry.fix.trim() }] : []),
    {
      label: '振り返り',
      value: showReviews ? `${entry.periodReviewCount}回（これまで${entry.reviewCount}回）` : `${entry.reviewCount}回`,
    },
  ];
  // 点は古い順（左から時系列）。データは新しい順なので反転する。読み上げは日付と結果を並べる
  const reviews = showReviews ? [...entry.periodReviews].reverse() : [];
  const reviewsLabel = reviews.map((r) => `${formatMonthDay(r.date)} ${RESULTS[r.result].mark}${r.resultLabel}`).join('、');
  const latestNote = entry.periodReviews[0]?.note.trim();
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, paddingBottom: space.s }}>
        <T num bold size={13} color={colors.accent}>{entry.number}</T>
        <T bold size={15} style={{ flex: 1 }} numberOfLines={1}>{entry.siteName}</T>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={entry.status === 'fixed'
            ? { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent }
            : { width: 8, height: 8, borderRadius: 4, borderWidth: 1.5, borderColor: colors.outline }}
          />
          <T size={12} color={entry.status === 'fixed' ? colors.accent : colors.sub}>{entry.statusLabel}</T>
        </View>
      </View>
      {textRows.map((r, i) => <StatRow key={r.label} label={r.label} value={r.value} first={i === 0} />)}
      {reviews.length > 0 && (
        <>
          <View style={[s.row, s.rowLine]} accessible accessibilityLabel={`振り返りの結果。${reviewsLabel}`}>
            <T size={13} color={colors.sub}>振り返りの結果</T>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} testID={`report-injury-dots-${entry.id}`}>
              {reviews.map((r) => <ReviewDot key={r.id} result={r.result} />)}
            </View>
          </View>
          {latestNote ? (
            <T size={12} color={colors.sub} style={{ paddingTop: space.s }}>
              {`メモ（${formatMonthDay(entry.periodReviews[0].date)}）：${latestNote}`}
            </T>
          ) : null}
        </>
      )}
    </View>
  );
}

const GROUPS: { key: 'occurred' | 'reviewed' | 'fixing'; title: string; en: string }[] = [
  { key: 'occurred', title: 'この期間に痛めた', en: 'OCCURRED' },
  { key: 'reviewed', title: 'この期間に振り返った', en: 'REVIEWED' },
  { key: 'fixing', title: '直している途中', en: 'FIXING' },
];

/**
 * 週次のケガの振り返り（INJURY REVIEW）：期間のケガを occurred / reviewed / fixing の3分類で、数値の表の文法で出す。
 * 分類は lib/injuryReport.ts（サーバーの period_overview と同じ決まり）。期間にどの分類にも入るケガがなければ出さない。
 * 1件のケガが複数の分類に入ることがある（期間に痛めて、振り返って、まだ直している途中 など）。そのときは分類ごとに出る
 */
export function InjuryReviewBlock({ start, end, index = 0 }: { start: DateKey; end: DateKey; index?: number }) {
  const enter = useEntering();
  const { data } = useFocusData((r) => loadInjuryPeriodReport(r, start, end), `${start}:${end}`);
  if (!data || injuryPeriodInjuryCount(data) === 0) return null;
  const report: InjuryPeriodReport = data;
  const summary = [
    report.occurredTotal > 0 ? `痛めた ${report.occurredTotal}件` : null,
    report.reviewedTotal > 0 ? `振り返り ${report.reviewedTotal}件` : null,
    report.fixingTotal > 0 ? `直している途中 ${report.fixingTotal}件` : null,
  ].filter(Boolean).join(' ・ ');
  return (
    <Animated.View entering={enter(index)} style={cardStyle} testID="report-injury-review">
      <BlockHead en="INJURY REVIEW" title="ケガの振り返り" start={start} end={end} />
      {summary !== '' && <T size={12} color={colors.sub}>{summary}</T>}
      {GROUPS.map((g) => {
        const entries = report[g.key];
        if (entries.length === 0) return null;
        return (
          <View key={g.key} style={{ gap: space.m }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.s }}>
              <T variant="labelM" color={colors.sub} accessibilityRole="header">{g.title}</T>
              <ReportMicro>{`${g.en} · ${entries.length}`}</ReportMicro>
            </View>
            {entries.map((e, i) => (
              <View key={e.id} style={i > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, paddingTop: space.m } : undefined}>
                <InjuryEntryRows entry={e} showReviews={g.key === 'reviewed'} />
              </View>
            ))}
          </View>
        );
      })}
    </Animated.View>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'flex-start', gap: space.l, paddingVertical: 7,
  },
  rowLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
