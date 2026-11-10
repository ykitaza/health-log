// レポートの部品（一覧とホームのカード、中身の画面の帯・タイル・カード・本文）。デザインは Figma の「改善 1-3〜1-6」と
// コンポーネント（改善案）の ReportCard・LatestReportCard。調子は色だけでなく、アイコンとラベルでも伝える（WCAG 1.4.1）。
// 本文はモデルが書いた文なので、すべて文字として表示する（リンクや HTML を開く処理は入れない）
import { router } from 'expo-router';
import { ReactNode, useEffect } from 'react';
import { Platform, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSpring } from 'react-native-reanimated';
import { useFocusData } from '@/hooks/data';
import { todayKey } from '@/lib/date';
import {
  Area, AREA_LABELS, Block, dailyHighlightLabel, dailySectionTitle, deltaLook, formatCreated, formatDelta, formatMetricValue, formatPeriod,
  Highlight, highlightsFor, KIND_LABELS, Metric, metricLabel, parseMarkdown, primaryMetrics, Report, reportCardLabel, ReportKind, Span, Tone,
  TONE_LABELS, TONE_SHORT,
} from '@/lib/reports';
import { colors, onToneSub, radius, space, toneColors } from '@/theme';
import { duration, HOLD_MS, springs, staggerDelay } from '@/theme/motion';
import { REPORT_CHAT_LABEL, useChatChooser } from './ChatSheet';
import { CountUpText } from './charts';
import { Icon, IconName } from './Icon';
import { easeOut, PressableScale } from './motion';
import { T } from './Text';
import { Button } from './ui';

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

/** 調子のアイコン。開いたとき、帯が出たあと（80ms）に小さい大きさからポンと出る（はね返りは出るときだけ） */
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
    <Animated.View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: toneColors[tone].accent, alignItems: 'center', justifyContent: 'center' }, anim]}>
      <Icon name={TONE_ICON[tone]} color={colors.onAccent} size={Math.round(size * 0.55)} />
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
      <T size={11} color={colors.sub}>{metric.label}</T>
      <T num bold size={17}>{formatMetricValue(metric.value)}</T>
      {metric.unit !== '' && <T size={11} color={colors.sub}>{metric.unit}</T>}
      <Delta metric={metric} size={12} />
    </View>
  );
}

/** レポートの種類のラベル（日のまとめ・週のまとめ・月のまとめ・その他）。Figma の KindBadge */
export function KindBadge({ kind }: { kind: ReportKind }) {
  return (
    <View style={{ backgroundColor: colors.input, borderRadius: radius.s, paddingHorizontal: space.s, paddingVertical: 2 }} testID="report-kind">
      <T variant="labelM" color={colors.sub}>{KIND_LABELS[kind]}</T>
    </View>
  );
}

/** 一覧とホームのカード：左に調子の色の帯、調子のアイコンとラベル、種類、作った日、題、要約、主な指標を2つまで */
export function ReportCard({ report, onPress }: { report: Report; onPress: () => void }) {
  const tone = toneColors[report.tone];
  const metrics = primaryMetrics(report);
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={[reportCardLabel(report), ...metrics.map(metricLabel)].join('、')}
      accessibilityHint="レポートを開く"
      scaleTo={0.98}
      onPress={onPress}
      testID={`report-${report.id}`}
      style={{ flexDirection: 'row', backgroundColor: colors.card, borderRadius: radius.card, overflow: 'hidden', minHeight: 72 }}
    >
      <View style={{ width: 6, backgroundColor: tone.accent }} />
      <View style={{ flex: 1, paddingVertical: 12, paddingLeft: 14, paddingRight: 8, gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name={TONE_ICON[report.tone]} size={18} color={tone.accent} />
          <T bold size={14} color={tone.accent} style={{ flex: 1 }}>{TONE_LABELS[report.tone]}</T>
          <KindBadge kind={report.kind} />
          <T size={12} color={colors.sub}>{formatCreated(report.createdAt)}</T>
        </View>
        <T bold size={16}>{report.title}</T>
        {report.headline !== '' && <T size={14} color={colors.sub}>{report.headline}</T>}
        {metrics.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {metrics.map((m, i) => <MetricChip key={i} metric={m} />)}
          </View>
        )}
      </View>
      <View style={{ justifyContent: 'center', paddingRight: 12 }}>
        <Icon name="chevron" size={20} color={colors.sub} />
      </View>
    </PressableScale>
  );
}

/**
 * ホームの「最新のレポート」。いちばん新しい1件と「すべて」（一覧へ）、その下に小さな「チャットで作る」。
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
            accessibilityLabel="すべてのレポート"
            onPress={() => router.push('/reports')}
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

/** 中身の画面の上の帯：調子の色の面、アイコン（ポンと出る）、ラベル、種類と作った日、題、要約、期間 */
export function ToneBand({ report }: { report: Report }) {
  const enter = useEntering();
  const tone = toneColors[report.tone];
  const period = formatPeriod(report);
  return (
    <Animated.View
      entering={enter(0)}
      style={{ backgroundColor: tone.container, borderRadius: 20, padding: 16, gap: 8 }}
      testID="report-band"
    >
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
      style={{ flexBasis: '47%', flexGrow: 1, backgroundColor: colors.card, borderRadius: radius.card, padding: 12, gap: 4 }}
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
      style={{ flexDirection: 'row', gap: 12, backgroundColor: colors.card, borderRadius: radius.card, padding: 12 }}
    >
      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.input, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={AREA_ICON[highlight.area]} size={22} color={colors.text} />
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <T size={12} color={colors.sub}>{AREA_LABELS[highlight.area]}</T>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: tone.container, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 }}>
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
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.card, borderRadius: radius.card, padding: 12 }}
    >
      <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.accentDark, alignItems: 'center', justifyContent: 'center' }}>
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
    <View style={{ backgroundColor: colors.card, borderRadius: radius.card, padding: 16, gap: 12 }} testID="report-body">
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

/** 中身の画面の小見出し */
export function ReportSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 8, marginTop: 8 }}>
      <T bold size={14} color={colors.sub} accessibilityRole="header">{title}</T>
      {children}
    </View>
  );
}


/**
 * 日のまとめの分野のカード（Figma の DailyHighlightCard）。分野のアイコンと名前、調子の印（アイコンと言葉）、一文、指標があれば値と変化。
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
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.card, borderRadius: radius.card, paddingVertical: 12, paddingLeft: 12, paddingRight: 8, minHeight: 48 }}
      >
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.input, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={AREA_ICON[highlight.area]} size={22} color={colors.text} />
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
