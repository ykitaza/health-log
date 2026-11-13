// レポートの部品（一覧とホームのカード、中身の画面の帯・タイル・カード・本文）。デザインは Figma の「改善 1-3〜1-6」と
// コンポーネント（改善案）の ReportCard・LatestReportCard。調子は色だけでなく、アイコンとラベルでも伝える（WCAG 1.4.1）。
// 本文はモデルが書いた文なので、すべて文字として表示する（リンクや HTML を開く処理は入れない）
import { router } from 'expo-router';
import { ReactNode, useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSpring } from 'react-native-reanimated';
import { useFocusData } from '@/hooks/data';
import { todayKey } from '@/lib/date';
import {
  Area, AREA_LABELS, Block, dailyHighlightLabel, dailySectionTitle, deltaLook, formatCreated, formatDelta, formatMetricValue, formatPeriod, formatReportDate,
  Highlight, highlightsFor, KIND_LABELS, Metric, metricLabel, parseMarkdown, primaryMetrics, Report, reportCardLabel, ReportKind, Span, Tone,
  KIND_SHORT, TONE_LABELS, TONE_SHORT,
} from '@/lib/reports';
import { colors, onToneSub, radius, space, toneColors } from '@/theme';
import { duration, HOLD_MS, springs, staggerDelay } from '@/theme/motion';
import { REPORT_PANEL_BG2, ReportMicro, reportPanelStyle } from './report/panel';
import { REPORT_CHAT_LABEL, useChatChooser } from './ChatSheet';
import { CountUpText } from './charts';
import { Icon, IconName } from './Icon';
import { easeOut, PressableScale } from './motion';
import { T } from './Text';
import { Badge, Button } from './ui';

const TONE_ICON: Record<Tone, IconName> = { good: 'trendUp', steady: 'trendFlat', caution: 'caution' };
export const AREA_ICON: Record<Area, IconName> = { training: 'dumbbell', meals: 'meal', body: 'scale', sleep: 'moon' };
const ARROW_ICON = { up: 'arrowUp', down: 'arrowDown', flat: 'arrowFlat' } as const;
const qualityColor = (q: 'good' | 'bad' | 'neutral') =>
  q === 'good' ? toneColors.good.accent : q === 'bad' ? toneColors.caution.accent : colors.sub;

/** 開いたときに下から順に出す動き。i 番目は 40ms ずつ遅らせ、全体を 300ms ほどに収める。動きを減らす設定と web では出さない */
export function useEntering() {
  const reduced = useReducedMotion();
  // web（E2E で使うだけ）では動かさない（components/motion.tsx の useListMotion と同じ）
  if (reduced || Platform.OS === 'web') return () => undefined;
  return (index: number, extra = 0) =>
    FadeInDown.duration(duration.listItem).easing(easeOut).withInitialValues({ transform: [{ translateY: 12 }] })
      .delay(staggerDelay(index, false) + extra);
}

/** 調子のアイコン。開いたとき、帯が出たあと（80ms）に小さい大きさからポンと出る（はね返りは出るときだけ）。
 * 詳細画面の文法に合わせ、塗りの丸ではなく枠のある四角に調子の色のアイコンを置く */
function TonePop({ tone, size }: { tone: Tone; size: number }) {
  const reduced = useReducedMotion();
  const still = reduced || Platform.OS === 'web';
  const scale = useSharedValue(still ? 1 : 0.4);
  useEffect(() => {
    if (still) return;
    scale.set(withDelay(HOLD_MS, withSpring(1, springs.pop)));
  }, [still, scale]);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  return (
    <Animated.View style={[{ width: size, height: size, borderRadius: 2, backgroundColor: REPORT_PANEL_BG2, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' }, anim]}>
      <Icon name={TONE_ICON[tone]} color={toneColors[tone].accent} size={Math.round(size * 0.55)} />
    </Animated.View>
  );
}

/** 変化の矢印と数（良い向きは緑、悪い向きは琥珀色、どちらでもなければ灰色） */
export function Delta({ metric, size = 13, suffix }: { metric: Metric; size?: number; suffix?: string }) {
  const look = deltaLook(metric);
  if (!look || metric.delta == null) return null;
  const color = qualityColor(look.quality);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
      <Icon name={ARROW_ICON[look.arrow]} size={size + 1} color={color} />
      <T size={size} bold color={color}>{formatDelta(metric.delta)}{suffix ?? ''}</T>
    </View>
  );
}

/** 一覧とホームのカードの、小さな指標 */
function MetricChip({ metric }: { metric: Metric }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4, backgroundColor: colors.input, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
      <T size={11} color={colors.sub} numberOfLines={1} style={{ flexShrink: 1 }}>{metric.label}</T>
      <T num bold size={17} numberOfLines={1}>{formatMetricValue(metric.value)}</T>
      {metric.unit !== '' && <T size={11} color={colors.sub} numberOfLines={1}>{metric.unit}</T>}
      <Delta metric={metric} size={12} />
    </View>
  );
}

/** 指標のないカードで、指標の段の高さだけを取るための見えない札 */
const PLACEHOLDER_METRIC: Metric = { label: '\u00A0', value: 0, unit: '', delta: 0, deltaGood: null };

/**
 * カードの指標の段。1段に収め、入らない札は出さない（並べて幅を測り、はみ出す2つ目からを消す）。先頭の札はいつも出し、
 * 1つだけになったときは縮めて（名前を「…」で）収める。指標がなくても、見えない札で同じ高さを取る（カードの高さをそろえる）。
 * 高さは文字の行で決まるので、文字の大きさの設定に合わせて伸びる
 */
function MetricRow({ metrics }: { metrics: Metric[] }) {
  const [width, setWidth] = useState(0);
  const [ends, setEnds] = useState<Record<number, number>>({});
  if (metrics.length === 0) {
    return (
      <View style={{ flexDirection: 'row', opacity: 0 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID="report-metrics-empty">
        <MetricChip metric={PLACEHOLDER_METRIC} />
      </View>
    );
  }
  const fits = metrics.map((_, i) => i === 0 || width === 0 || ends[i] == null || ends[i] <= width + 0.5);
  const alone = fits.every((f, i) => i === 0 || !f);
  return (
    <View style={{ flexDirection: 'row', gap: 8, overflow: 'hidden' }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {metrics.map((m, i) => (
        <View
          key={i}
          // 2つ目からが並んでいるあいだは、先頭を縮めない（縮めると、はみ出す札も入って見えてしまう）
          // 2つ目からは、幅を測り終えるまで見せない（はみ出す札が一瞬見えないように）
          style={{ flexShrink: i === 0 && alone ? 1 : 0, display: fits[i] ? 'flex' : 'none', opacity: i > 0 && (width === 0 || ends[i] == null) ? 0 : 1 }}
          onLayout={(e) => { const x = e.nativeEvent.layout.x + e.nativeEvent.layout.width; setEnds((prev) => (prev[i] === x ? prev : { ...prev, [i]: x })); }}
          testID="report-metric"
        >
          <MetricChip metric={m} />
        </View>
      ))}
    </View>
  );
}

/**
 * カードの左上の、レポートの種類の四角（28dp の角丸に「日」「週」「月」「他」の1文字）。色ではなく文字で分ける。
 * 読み上げはカード全体の名前（reportCardLabel）に「週のまとめ」などの名前で入れる
 */
function KindSquare({ kind }: { kind: ReportKind }) {
  return (
    <View
      style={{ width: 28, height: 28, borderRadius: radius.s, backgroundColor: colors.input, alignItems: 'center', justifyContent: 'center' }}
      accessibilityLabel={KIND_LABELS[kind]}
      testID="report-kind"
    >
      <T bold size={14}>{KIND_SHORT[kind]}</T>
    </View>
  );
}

/**
 * 一覧とホームのカード：上の行に種類の四角、調子のアイコンとラベル（調子は色の帯ではなく、アイコンと言葉で伝える）、日付（一覧の並びと同じ、期間の日付）。
 * その下に題、要約、主な指標を2つまで。
 * 高さをそろえるため、題と要約は1行ずつ（長ければ「…」）、指標は1段（入らない分は出さない。指標がなくても同じ高さ）。
 * 高さは固定の数字ではなく行の数で決める（文字の大きさの設定を大きくしても、文字が切れて読めなくならない）。
 * unread（まだ開いていない）なら、題の横に「新着」の札（読み上げにも入れる）
 */
export function ReportCard({ report, onPress, unread = false }: { report: Report; onPress: () => void; unread?: boolean }) {
  const tone = toneColors[report.tone];
  const metrics = primaryMetrics(report);
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={[reportCardLabel(report, unread), ...metrics.map(metricLabel)].join('、')}
      accessibilityHint="レポートを開く"
      scaleTo={0.98}
      onPress={onPress}
      testID={`report-${report.id}`}
      style={{ flexDirection: 'row', backgroundColor: colors.card, borderRadius: radius.card, overflow: 'hidden', minHeight: 72 }}
    >
      <View style={{ flex: 1, paddingVertical: 12, paddingLeft: 16, paddingRight: 8, gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <KindSquare kind={report.kind} />
          <Icon name={TONE_ICON[report.tone]} size={18} color={tone.accent} />
          <T bold size={14} color={tone.accent} style={{ flex: 1 }} numberOfLines={1}>{TONE_LABELS[report.tone]}</T>
          <T size={12} color={colors.sub} numberOfLines={1}>{formatReportDate(report)}</T>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {/* 行の高さは「新着」の札（24）と同じにする（札のあるカードとないカードで高さを変えない） */}
          <T bold size={16} numberOfLines={1} style={{ flexShrink: 1, lineHeight: 24 }}>{report.title}</T>
          {unread && <Badge label="新着" tone="solid" />}
        </View>
        {/* 要約がなくても1行ぶんを取る（ふつうの空白だと web で高さがなくなるので、詰めない空白） */}
        <T size={14} color={colors.sub} numberOfLines={1}>{report.headline || '\u00A0'}</T>
        <MetricRow metrics={metrics} />
      </View>
      <View style={{ justifyContent: 'center', paddingRight: 12 }}>
        <Icon name="chevron" size={20} color={colors.sub} />
      </View>
    </PressableScale>
  );
}

/**
 * ホームの「最新のレポート」。いちばん新しい1件と「すべて」、その下に小さな「チャットで作る」。
 * 「すべて」は一覧がなくなったので、いちばん新しいレポートの詳細を直接開く（日・週・月は詳細の上の期間タブで切り替える。
 * レポートのタブを通すと、タブが裏に残るため2回目以降は詳細に着かない）。
 * まだないときは、チャットで頼む方法を短く書き、「チャットで作る」のボタンを出す
 */
export function LatestReportCard() {
  const { data } = useFocusData((r) => r.reports.latest());
  const chat = useChatChooser();
  return (
    <View style={{ marginTop: 16 }} testID="latest-report">
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 }}>
        <T bold size={17} accessibilityRole="header">最新のレポート</T>
        {data && (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="すべてのレポート。最新のレポートを開き、日・週・月のタブで切り替えます"
            onPress={() => router.push({ pathname: '/reports/[id]', params: { id: data.id } })}
            style={{ minHeight: 48, minWidth: 48, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' }}
          >
            <T bold size={14} color={colors.accent}>すべて</T>
          </PressableScale>
        )}
      </View>
      {data ? (
        <>
          <ReportCard report={data} onPress={() => router.push({ pathname: '/reports/[id]', params: { id: data.id } })} />
          <Button label="チャットで作る" icon="chat" variant="text" small accessibilityLabel={REPORT_CHAT_LABEL} onPress={chat.report}
            style={{ alignSelf: 'flex-end', paddingLeft: 12, paddingRight: 12, marginRight: -12 }} testID="report-chat" />
        </>
      ) : (
        <View style={{ backgroundColor: colors.card, borderRadius: radius.card, padding: 16, gap: 12 }}>
          <T size={14} color={colors.sub}>まだありません。チャット（Claude・ChatGPT）で「今週のまとめを作って」と頼むと、ここに出ます。</T>
          <Button label="チャットで作る" icon="chat" variant="tonal" small accessibilityLabel={REPORT_CHAT_LABEL} onPress={chat.report} testID="report-chat" />
        </View>
      )}
      {chat.sheet}
    </View>
  );
}

const BAND_MICRO: Record<ReportKind, string> = { daily: 'DAILY REPORT', weekly: 'WEEKLY REPORT', monthly: 'MONTHLY REPORT', other: 'REPORT' };

/**
 * 中身の画面の上の帯：フラットなパネル（近黒＋枠）に、調子はアイコンとラベルの色だけで伝える（面に調子の色は塗らない）。
 * マイクロラベル、アイコン（ポンと出る）、ラベル、種類と作った日、題、要約、期間
 */
export function ToneBand({ report }: { report: Report }) {
  const enter = useEntering();
  const tone = toneColors[report.tone];
  const period = formatPeriod(report);
  return (
    <Animated.View
      entering={enter(0)}
      style={[reportPanelStyle, { padding: 12, gap: 8 }]}
      testID="report-band"
    >
      <ReportMicro>{BAND_MICRO[report.kind]}</ReportMicro>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <TonePop tone={report.tone} size={44} />
        <View style={{ flex: 1 }} accessible accessibilityLabel={`全体の調子、${TONE_LABELS[report.tone]}`}>
          <T bold size={16} color={tone.accent}>{TONE_LABELS[report.tone]}</T>
          <T size={12} color={onToneSub}>{KIND_LABELS[report.kind]} ・ {formatCreated(report.createdAt)}に作成</T>
        </View>
      </View>
      <T bold size={14} color={onToneSub}>{report.title}</T>
      {report.headline !== '' && <T bold size={22} style={{ lineHeight: 30 }} accessibilityRole="header">{report.headline}</T>}
      {period && <T size={14} color={onToneSub}>{period}</T>}
    </Animated.View>
  );
}

/** 指標のタイル（2列で並べる）。値は数え上げ、変化の矢印は少し遅れて出す */
export function MetricTile({ highlight, index, vs, animKey }: { highlight: Highlight & { metric: Metric }; index: number; vs: string; animKey: string }) {
  const enter = useEntering();
  const reduced = useReducedMotion();
  const m = highlight.metric;
  const delay = staggerDelay(index, false);
  return (
    <Animated.View
      entering={enter(index)}
      accessible
      accessibilityLabel={`${AREA_LABELS[highlight.area]}、${metricLabel(m)}`}
      style={{ flexBasis: '47%', flexGrow: 1, ...reportPanelStyle, padding: 10, gap: 4 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon name={AREA_ICON[highlight.area]} size={16} color={colors.sub} />
        <T size={12} color={colors.sub} style={{ flex: 1 }} numberOfLines={1}>{m.label}</T>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
        <CountUpText num bold size={32} value={m.value} format={formatMetricValue} animKey={animKey} />
        {m.unit !== '' && <T size={12} color={colors.sub}>{m.unit}</T>}
      </View>
      {m.delta != null && (
        <Animated.View
          entering={reduced || Platform.OS === 'web' ? undefined : FadeIn.duration(duration.text).delay(delay + duration.listItem + HOLD_MS)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
        >
          <Delta metric={m} size={14} suffix={m.unit ? ` ${m.unit}` : ''} />
          <T size={11} color={colors.sub}>{vs}</T>
        </Animated.View>
      )}
    </Animated.View>
  );
}

/**
 * 分野ごとのカード：分野のアイコン、分野の名前と調子の印（アイコンと言葉）、一文。
 * metricVs を渡すと、指標があれば値と変化を下に小さく出す（日のまとめは指標のタイルを出さないので、前の形の指標をここで見せる）
 */
export function HighlightCard({ highlight, index, metricVs }: { highlight: Highlight; index: number; metricVs?: string }) {
  const enter = useEntering();
  const tone = toneColors[highlight.tone];
  const m = metricVs ? highlight.metric : null;
  return (
    <Animated.View
      entering={enter(index)}
      accessible
      accessibilityLabel={metricVs ? dailyHighlightLabel(highlight) : `${AREA_LABELS[highlight.area]}、${TONE_SHORT[highlight.tone]}。${highlight.text}`}
      style={{ flexDirection: 'row', gap: 12, ...reportPanelStyle, padding: 12 }}
    >
      <View style={{ width: 40, height: 40, borderRadius: 2, backgroundColor: REPORT_PANEL_BG2, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={AREA_ICON[highlight.area]} size={22} color={colors.text} />
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <T size={12} color={colors.sub}>{AREA_LABELS[highlight.area]}</T>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: tone.accent, borderRadius: 2, paddingHorizontal: 8, paddingVertical: 2 }}>
            <Icon name={TONE_ICON[highlight.tone]} size={14} color={tone.accent} />
            <T size={11} bold color={tone.accent}>{TONE_SHORT[highlight.tone]}</T>
          </View>
        </View>
        <T size={16} style={{ lineHeight: 24 }}>{highlight.text}</T>
        {m && <MetricLine metric={m} vs={metricVs!} />}
      </View>
    </Animated.View>
  );
}

/** 指標の小さな1行（名前・値・単位・変化と比べた相手） */
function MetricLine({ metric: m, vs }: { metric: Metric; vs: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
      <T variant="labelS" bold={false} color={colors.sub}>{m.label}</T>
      <T variant="numS">{formatMetricValue(m.value)}</T>
      {m.unit !== '' && <T variant="labelS" bold={false} color={colors.sub}>{m.unit}</T>}
      {m.delta != null && (
        <>
          <Delta metric={m} size={12} />
          <T variant="labelS" bold={false} color={colors.sub}>{vs}</T>
        </>
      )}
    </View>
  );
}

/** 次の一歩：番号つきの短いカード */
export function NextStepCard({ n, text, index }: { n: number; text: string; index: number }) {
  const enter = useEntering();
  return (
    <Animated.View
      entering={enter(index)}
      accessible
      accessibilityLabel={`${n}、${text}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, ...reportPanelStyle, padding: 12 }}
    >
      <View style={{ width: 28, height: 28, borderRadius: 2, backgroundColor: REPORT_PANEL_BG2, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' }}>
        <T bold size={14} color={colors.accent}>{n}</T>
      </View>
      <T size={16} style={{ flex: 1, lineHeight: 24 }}>{text}</T>
    </Animated.View>
  );
}

function Spans({ spans }: { spans: Span[] }) {
  return <>{spans.map((s, i) => (s.bold ? <T key={i} bold size={16}>{s.text}</T> : s.text))}</>;
}

/**
 * 本文（Markdown）。見出し・箇条書き・太字・段落だけを整え、ほかはすべて書かれた文字のまま出す。
 * リンクを押せるようにはしない（Text にリンクの処理を付けない）。文字は選んでコピーできる
 */
export function MarkdownBody({ body }: { body: string }) {
  const blocks = parseMarkdown(body);
  if (blocks.length === 0) return null;
  return (
    <View style={{ ...reportPanelStyle, padding: 12, gap: 10 }} testID="report-body">
      {blocks.map((b, i) => <MarkdownBlock key={i} block={b} />)}
    </View>
  );
}

function MarkdownBlock({ block }: { block: Block }) {
  if (block.type === 'heading') {
    const size = block.level <= 1 ? 18 : block.level === 2 ? 16 : 15;
    return <T bold size={size} selectable accessibilityRole="header"><Spans spans={block.spans} /></T>;
  }
  if (block.type === 'bullet') {
    return (
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <T size={16} color={colors.sub} style={{ minWidth: 12, lineHeight: 24 }}>{block.marker}</T>
        <T size={16} selectable style={{ flex: 1, lineHeight: 24 }}><Spans spans={block.spans} /></T>
      </View>
    );
  }
  return <T size={16} selectable style={{ lineHeight: 24 }}><Spans spans={block.spans} /></T>;
}

/** 中身の画面の小見出し。en を渡すと、題の上に英字のマイクロラベルを出す */
export function ReportSection({ title, en, children }: { title: string; en?: string; children: ReactNode }) {
  return (
    <View style={{ gap: 6, marginTop: 6 }}>
      {en ? <ReportMicro>{en}</ReportMicro> : null}
      <T bold size={14} color={colors.sub} accessibilityRole="header">{title}</T>
      {children}
    </View>
  );
}


/**
 * 日のまとめの分野のカード（Figma の DailyHighlightCard）。書類のアイコン（レポートから抜き出したもの）、分野の名前、調子の印（アイコンと言葉）、
 * 一文、指標があれば値と変化。記録のカード（塗りのカード）と見分けられるよう、塗りをなくして点線の枠にする。
 * 全体が1つのボタンで、押すと日のまとめの中身を開く
 */
export function DailyHighlightCard({ highlight, index, onPress }: { highlight: Highlight; index: number; onPress: () => void }) {
  const enter = useEntering();
  const tone = toneColors[highlight.tone];
  const m = highlight.metric;
  return (
    <Animated.View entering={enter(index)}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={dailyHighlightLabel(highlight)}
        accessibilityHint="日のまとめを開く"
        scaleTo={0.98}
        onPress={onPress}
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.outline, borderRadius: radius.card,
          paddingVertical: 12, paddingLeft: 12, paddingRight: 8, minHeight: 48,
        }}
        testID="daily-highlight"
      >
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.input, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="report" size={22} color={colors.text} />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <T variant="labelM" color={colors.sub}>{AREA_LABELS[highlight.area]}</T>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: tone.container, borderRadius: radius.pill, paddingLeft: 6, paddingRight: 8, paddingVertical: 2 }}>
              <Icon name={TONE_ICON[highlight.tone]} size={14} color={tone.accent} />
              <T variant="labelS" color={tone.accent}>{TONE_SHORT[highlight.tone]}</T>
            </View>
          </View>
          <T variant="bodyM">{highlight.text}</T>
          {m && <MetricLine metric={m} vs="前の日より" />}
        </View>
        <Icon name="chevron" size={20} color={colors.sub} />
      </PressableScale>
    </Animated.View>
  );
}

/**
 * 各タブの、その日の日のまとめのうち、その分野のもの（筋トレ・食事・からだのタブに1行で差し込む）。
 * その日の日のまとめがない、またはその分野がないときは、何も出さない（場所も取らない）
 */
export function DailyHighlights({ date, areas }: { date: string; areas: readonly Area[] }) {
  const { data } = useFocusData(async (r) => ({ date, report: await r.reports.dailyFor(date) }), date);
  // 日を変えた直後は、前の日のまとめを出さない
  const report = data?.date === date ? data.report : null;
  const list = highlightsFor(report, areas);
  if (!report || list.length === 0) return null;
  const title = dailySectionTitle(date, todayKey());
  return (
    <View style={{ gap: space.s, marginTop: space.l }} testID="daily-highlights">
      <T variant="titleS" color={colors.sub} accessibilityRole="header">{title}</T>
      {list.map((h, i) => (
        <DailyHighlightCard key={i} highlight={h} index={i}
          onPress={() => router.push({ pathname: '/reports/[id]', params: { id: report.id } })} />
      ))}
    </View>
  );
}
