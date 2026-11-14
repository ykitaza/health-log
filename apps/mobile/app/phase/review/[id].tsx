import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { View } from 'react-native';
import { useChatChooser } from '@/components/ChatSheet';
import { LoadError } from '@/components/LoadError';
import { ActionRow, HudButton, PhaseFrame, TextButton } from '@/components/phase/parts';
import { MoreFold } from '@/components/report/ClosingBlocks';
import { GoalTrack, hud, Micro, Mono, Panel, PanelHead } from '@/components/report/hud';
import { T } from '@/components/Text';
import { useFocusData } from '@/hooks/data';
import { useToday } from '@/hooks/today';
import { daysBetween, formatMonthDay } from '@/lib/date';
import { loadGrowthData } from '@/lib/growthData';
import { DIRECTION_EN } from '@/lib/homeHero';
import { currentPhase, pauses, pausedDays, phaseLabel, successMetrics, SuccessMetric, weeksTotal } from '@/lib/phases';
import { achievement, achievementText, nextOptions, TIER_LABELS } from '@/lib/phaseReview';
import { endMeasuresFrom, orderMetrics, phaseLastDay } from '@/lib/phaseView';
import { formatCreated, Highlight } from '@/lib/reports';
import { fmt1, kgToUnit } from '@/lib/units';

const signed = (n: number, digits = 1) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n).toFixed(digits)}`;
const two = (n: number) => String(n).padStart(2, '0');

/**
 * フェーズの振り返り（Figma「スタディ：フェーズ」のセクション 4）。終えたフェーズの before／after（開始時の記録と終わりの時点の値。
 * 数字はアプリで計算する：lib/phaseView.ts の endMeasuresFrom）、達成の度合い（lib/phaseReview.ts）、振り返りのレポート（kind phase）の文章。
 * レポートがなければ「チャットで振り返りを作る」。次のフェーズ（おすすめは維持 4 週）は /phase/new へ。
 * 入口：進捗の詳細の「早めに終える」・期間が終わったとき・療養を終えて「振り返って次へ」、設定の「これまでのフェーズ」、ホームの 1 行、/reports/[id] の kind phase
 */
export default function PhaseReviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const today = useToday();
  const chat = useChatChooser();
  const { data, error, reload } = useFocusData(async (r) => {
    const [phases, growth, report] = await Promise.all([r.phases.list(), loadGrowthData(r, today), r.reports.forPhase(id)]);
    return { phases, growth, report };
  }, `${id}:${today}`);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const home = () => (router.canDismiss() ? router.dismissTo('/') : router.replace('/'));

  const view = useMemo(() => {
    if (!data) return null;
    const phase = data.phases.find((p) => p.id === id && p.kind === 'normal' && p.direction != null) ?? null;
    if (!phase) return { phase: null } as const;
    const last = phaseLastDay(phase, today);
    const end = endMeasuresFrom(data.growth, phase.startDate, last);
    const { metrics } = successMetrics(phase, end);
    const spans = pauses(phase, data.phases, last);
    return {
      phase, last, metrics, achievement: achievement(phase.direction!, metrics, phase.targetWeightKg),
      rehabDays: pausedDays(spans), hasCurrent: currentPhase(data.phases, today).current != null,
    };
  }, [data, id, today]);

  if (error) return <PhaseFrame sys="KARADA // PHASE REVIEW" onBack={close}><LoadError onRetry={reload} /></PhaseFrame>;
  if (!data || !view) return <PhaseFrame sys="KARADA // PHASE REVIEW" onBack={close} testID="phase-review"><View /></PhaseFrame>;
  if (!view.phase) {
    return (
      <PhaseFrame sys="KARADA // PHASE REVIEW" onBack={close} testID="phase-review">
        <T bold size={18} color={hud.ink} accessibilityRole="header">フェーズが見つかりません</T>
        <T size={13} color={hud.muted}>消されたか、まだ届いていない記録です。</T>
      </PhaseFrame>
    );
  }

  const { phase, last, metrics, achievement: a, rehabDays, hasCurrent } = view;
  const dir = phase.direction!;
  const unit = data.growth.weightUnit;
  const u = (kg: number) => kgToUnit(kg, unit);
  const signedKg = (kg: number) => `${signed(u(kg))} ${unit}`;
  const report = data.report;
  const weeks = weeksTotal(phase);
  const doneWeeks = Math.max(1, Math.ceil((daysBetween(phase.startDate, last) + 1 - rehabDays) / 7));
  const finished = phase.status !== 'active';

  return (
    <PhaseFrame
      sys={`KARADA // PHASE REVIEW · ${DIRECTION_EN[dir]}`} onBack={close} testID="phase-review"
      footer={hasCurrent ? undefined : (
        <>
          <HudButton label="次のフェーズを始める" onPress={() => router.push('/phase/new')} testID="phase-review-next" />
          <TextButton label="今は様子見にする" onPress={home} testID="phase-review-later" />
        </>
      )}
    >
      <T bold size={20} color={hud.ink} accessibilityRole="header" style={{ marginTop: 2 }}>フェーズの振り返り</T>

      <Panel border={hud.green} bg="#0F1C15" style={{ paddingHorizontal: 14, paddingVertical: 12, gap: 6 }} testID="phase-review-hero">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Micro green>{`${DIRECTION_EN[dir]} // ${finished ? 'DONE' : 'IN PROGRESS'}`}</Micro>
          <T size={11.5} color={hud.muted}>
            {`${formatMonthDay(phase.startDate)}〜${formatMonthDay(last)} ・ ${finished && weeks != null && doneWeeks < weeks ? `${doneWeeks}／${weeks}週` : `${weeks ?? doneWeeks}週`}`}
          </T>
        </View>
        <T bold size={22} color={hud.ink} style={{ lineHeight: 30 }}>{phaseLabel(phase)}</T>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <T bold size={17} color={hud.green} testID="phase-review-tier">{a.tier ? TIER_LABELS[a.tier] : '判定できません'}</T>
          <T size={12} color={hud.note} style={{ flex: 1, minWidth: 180, lineHeight: 18 }} testID="phase-review-summary">
            {achievementText(dir, metrics, phase.targetWeightKg, signedKg)}
          </T>
        </View>
        {a.ratio != null && <GoalTrack ratio={a.ratio} tick={null} />}
        {!finished && <T size={11.5} color={hud.muted}>まだ実施中です。数字は今日までの値です。</T>}
        {rehabDays > 0 && <T size={11.5} color={hud.muted}>{`療養で止めた ${rehabDays}日は、週の数に入れていません。`}</T>}
      </Panel>

      <Panel style={{ paddingHorizontal: 14, paddingVertical: 12, gap: 2 }} testID="phase-review-before-after">
        <PanelHead en="BEFORE / AFTER" title="before／after" right="開始時 → 終了時" />
        {orderMetrics(dir, metrics).map((m, i, list) => (
          <MetricRow key={m.key} m={m} main={i === 0} last={i === list.length - 1} unit={unit} />
        ))}
        <T size={11} color={hud.muted} style={{ lineHeight: 16, marginTop: 4 }}>
          {`体重・体脂肪率は ${formatMonthDay(last)}までの7日の平均（なければ最新）。BIG3 の終了時は最後の28日の最高の推定1RM。`}
        </T>
      </Panel>

      {report ? (
        <Panel style={{ paddingHorizontal: 14, paddingVertical: 12, gap: 8 }} testID="phase-review-report">
          <PanelHead en="REVIEW // REPORT" title="振り返り" right={formatCreated(report.createdAt)} />
          {report.headline ? <T bold size={15} color={hud.ink} style={{ lineHeight: 22 }}>{report.headline}</T> : null}
          <NoteGroup label="良かった" items={report.highlights.filter((h) => h.tone === 'good')} />
          <NoteGroup label="課題" items={report.highlights.filter((h) => h.tone === 'caution')} />
          <NoteGroup label="ほか" items={report.highlights.filter((h) => h.tone === 'steady')} />
          {report.nextSteps.length > 0 && (
            <View style={{ gap: 4 }} testID="phase-review-handoff">
              <T bold size={12.5} color={hud.green}>申し送り</T>
              {report.nextSteps.map((s, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
                  <Mono size={12} color={hud.muted}>{two(i + 1)}</Mono>
                  <T size={13} color={hud.ink} style={{ flex: 1, lineHeight: 20 }}>{s}</T>
                </View>
              ))}
            </View>
          )}
          <MoreFold links={[]} review={null} body={report.body} />
          <TextButton label="チャットで作り直す" onPress={() => chat.record({ kind: 'phase-review', startDate: phase.startDate, today })} />
        </Panel>
      ) : (
        <Panel style={{ paddingHorizontal: 14, paddingVertical: 12, gap: 8 }} testID="phase-review-empty">
          <PanelHead en="REVIEW // NOT YET" title="振り返りの文章" />
          <T size={13} color={hud.note} style={{ lineHeight: 20 }}>
            うまくいったこと・課題・次のフェーズへの申し送りを、チャット（ChatGPT か Claude）で記録から書いてもらえます。保存して同期すると、ここに出ます。
          </T>
          <HudButton variant="outline" label="チャットで振り返りを作る" onPress={() => chat.record({ kind: 'phase-review', startDate: phase.startDate, today })} testID="phase-review-chat" />
        </Panel>
      )}

      {!hasCurrent && (
        <View style={{ gap: 4, marginTop: 6 }}>
          <Micro green>NEXT PHASE</Micro>
          <T bold size={13} color={hud.green} accessibilityRole="header">次のフェーズ</T>
          <Panel style={{ paddingHorizontal: 14, paddingVertical: 2 }} testID="phase-review-options">
            {nextOptions(dir).map((o, i, list) => (
              <ActionRow
                key={o.direction} title={o.title} sub={o.sub} right={o.recommended ? 'おすすめ' : undefined} last={i === list.length - 1}
                testID={`phase-review-option-${o.direction}`}
                onPress={() => router.push({ pathname: '/phase/new', params: { direction: o.direction, ...(o.weeks ? { weeks: String(o.weeks) } : {}) } })}
              />
            ))}
          </Panel>
        </View>
      )}
      {chat.sheet}
    </PhaseFrame>
  );
}

function metricTitle(key: SuccessMetric['key']): string {
  return { weight: '体重（週平均）', big3: 'BIG3 推定1RM 合計', growth_score: '成長スコア', body_fat: '体脂肪率' }[key];
}

/** before／after の 1 行（進捗の詳細の成功の指標と同じ並び。体脂肪率は参考） */
function MetricRow({ m, main, last, unit }: { m: SuccessMetric; main: boolean; last: boolean; unit: 'kg' | 'lb' }) {
  const isKg = m.key === 'weight' || m.key === 'big3';
  const f = (n: number) => (isKg ? fmt1(kgToUnit(n, unit)) : m.key === 'growth_score' ? String(Math.round(n)) : fmt1(n));
  const title = `${metricTitle(m.key)}${main ? '・主' : ''}${m.reference ? '（参考）' : ''}`;
  const delta = m.delta == null ? '—' : signed(isKg ? kgToUnit(m.delta, unit) : m.delta, m.key === 'growth_score' ? 0 : 1);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderBottomWidth: last ? 0 : 1, borderBottomColor: hud.rowLine }}
      accessible accessibilityLabel={`${title}。${m.start == null ? '—' : f(m.start)}から${m.now == null ? '—' : f(m.now)}。${delta}`}>
      <T bold size={13} color={m.reference ? hud.muted : hud.label} style={{ flex: 1 }}>{title}</T>
      <T style={{ textAlign: 'right' }}>
        <Mono size={12} color={hud.muted}>{`${m.start == null ? '—' : f(m.start)} → `}</Mono>
        <Mono size={17} color={m.reference ? hud.muted : hud.white}>{m.now == null ? '—' : f(m.now)}</Mono>
        <Mono size={10} color={hud.muted}>{` ${isKg ? unit.toUpperCase() : m.key === 'body_fat' ? '%' : ''}`}</Mono>
      </T>
      <Mono size={13} color={m.ok ? hud.green : hud.muted} style={{ width: 52, textAlign: 'right' }}>{delta}</Mono>
    </View>
  );
}

/** 「良かった」「課題」などの見出しと文（レポートの highlights。本人の記録から AI が書いたもの） */
function NoteGroup({ label, items }: { label: string; items: Highlight[] }) {
  if (items.length === 0) return null;
  return (
    <View style={{ flexDirection: 'row', gap: 12 }}>
      <T bold size={12.5} color={hud.green} style={{ width: 56 }}>{label}</T>
      <View style={{ flex: 1, gap: 4 }}>
        {items.map((h, i) => <T key={i} size={13} color={hud.ink} style={{ lineHeight: 20 }}>{h.text}</T>)}
      </View>
    </View>
  );
}
