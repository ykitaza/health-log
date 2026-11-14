import { router } from 'expo-router';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { LoadError } from '@/components/LoadError';
import { Sheet } from '@/components/motion';
import { MealFields } from '@/components/phase/MealFields';
import {
  ActionRow, DateField, HudButton, ModeTabs, NumberField, PhaseFrame, RehabStartSheet, SheetBody, Tag, TextButton, TickBar, WeeksStepper,
} from '@/components/phase/parts';
import { WeightChart } from '@/components/phase/WeightChart';
import { hud, Micro, Mono, Panel, PanelHead, StatusRow } from '@/components/report/hud';
import { T } from '@/components/Text';
import { ConfirmDialog } from '@/components/ui';
import type { Injury, InjuryReview } from '@/db/repositories/injuries';
import { PhaseError } from '@/db/repositories/phases';
import { useBusy } from '@/hooks/busy';
import { useFocusData, useRepos } from '@/hooks/data';
import { useToday } from '@/hooks/today';
import { DateKey, daysBetween, formatJpDate, formatMonthDay, formatShortDate } from '@/lib/date';
import { GrowthData, loadGrowthData } from '@/lib/growthData';
import { DIRECTION_EN } from '@/lib/homeHero';
import { RESULTS, siteLabel } from '@/lib/injuries';
import { ChangeInput, changeError, CorrectInput, correctError, editRange, effectiveEndFor, planChanges } from '@/lib/phaseEdit';
import {
  currentPhase, PACE_LABELS, Phase, PHASE_LIMITS, PHASE_TICKS, PhaseMealTargets, phaseLabel, phaseProgress, PhaseProgress, recoveryUntil,
  successMetrics, Weight,
} from '@/lib/phases';
import { readyToEndRehab, rehabInjuries, RehabWatch, rehabWatch } from '@/lib/phaseReview';
import {
  endMeasuresFrom, MealDraft, mealDraftFromPhase, measuresFrom, metricNote, midDate, midWeek, offPaceStreak, orderMetrics, paceSentence, parseMealDraft,
  PhaseMeasures, planSlopePerWeek, projectedKg, recentSlopePerWeek, snapshotOf, STREAK_TITLES, SUCCESS_RULE, weightChart,
} from '@/lib/phaseView';
import { fmt1, kgToUnit, parseNumber, trimNumber, unitToKg, WeightUnit } from '@/lib/units';
import { colors } from '@/theme';

type Dialog = 'change' | 'correct' | 'rehab' | 'meals' | 'end' | 'abort' | 'endRehab' | null;

const two = (n: number) => String(n).padStart(2, '0');
const signed = (n: number, digits = 1) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n).toFixed(digits)}`;

/**
 * フェーズの進捗の詳細（Figma「スタディ：フェーズ」のセクション 3）。ホームのフェーズの 1 行と設定の「フェーズ」から開く。
 * 実施中は、上から「見る → 気づく → 変える → 終える」の順：
 * - いまどこ（何週目・残りの日数・16 の目盛り・ペースの判定と理由）。目盛りはホームの輪と同じ数え方（期間に比例）
 * - 気づくこと（期間が終わった・2 週続けてペースが崩れた・中間の見直し）
 * - 体重のグラフ、成功の指標
 * - 計画（開始日・期間・目標体重と、編集の入口。「今日から計画を変える」と「開始日・最初の計画を直す」を分ける。PlanSheet）、食事の目標
 * - 操作（療養に入る・早めに終える・中断する）
 * 療養中：療養の日数、止めているフェーズ、療養を終える（再開する／振り返って次へ）。
 * 療養中のケガ（lib/phaseReview.ts の rehabInjuries）がすべて直せたになったら「療養を終えますか」を上に出す。
 * 早めに終える・期間が終わって終える・療養を終えて「振り返って次へ」は、振り返りの画面（/phase/review/[id]）へ移す。
 * フェーズがなければ設定（/phase/new）へ移す
 */
export default function PhaseScreen() {
  const today = useToday();
  const { data, error, reload, repos } = useFocusData(async (r) => {
    const [phases, growth, injuries] = await Promise.all([r.phases.list(), loadGrowthData(r, today), r.injuries.list()]);
    // 療養中なら、対象のケガとその振り返り（療養中に見るもの）
    const rehab = currentPhase(phases, today).current;
    const targets: Injury[] = rehab?.kind === 'rehab' ? rehabInjuries(injuries, rehab, today) : [];
    const reviews: InjuryReview[] = (await Promise.all(targets.map((i) => r.injuries.reviews(i.id)))).flat();
    return { phases, growth, injuries, targets, reviews };
  }, today);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [dismissed, setDismissed] = useState<{ streak?: boolean; mid?: boolean; ready?: boolean }>({});
  const [opError, setOpError] = useState<string | null>(null);
  const { busy, run } = useBusy();

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const home = () => (router.canDismiss() ? router.dismissTo('/') : router.replace('/'));

  const view = useMemo(() => {
    if (!data) return null;
    const weights: Weight[] = data.growth.weights.map((w) => ({ date: w.date, kg: w.weightKg }));
    const { current, paused } = currentPhase(data.phases, today);
    // 成功の指標の「今」は振り返りの after と同じ出し方（BIG3 はフェーズの最後の 28 日）
    const now = current?.kind === 'normal' ? endMeasuresFrom(data.growth, current.startDate, today) : null;
    return { weights, current, paused, measures: measuresFrom(data.growth, today), now, unit: data.growth.weightUnit };
  }, [data, today]);

  // フェーズがない（終えた・中断した・別の端末で消した）ときは設定へ
  const none = view != null && view.current == null;
  useEffect(() => { if (none) router.replace('/phase/new'); }, [none]);

  if (error) return <PhaseFrame sys="KARADA // PHASE" onBack={close}><LoadError onRetry={reload} /></PhaseFrame>;

  /** 操作を実行して読み直す。断られたら理由を出す。leave が true ならそのあとでホームへ、文字ならその画面へ（読み直さない） */
  const act = (task: () => Promise<void>, leave: boolean | string = false) => run(async (stayBusy) => {
    setOpError(null);
    try {
      await task();
    } catch (e) {
      if (e instanceof PhaseError) { setOpError(e.message); return; }
      throw e;
    }
    setDialog(null);
    if (typeof leave === 'string') { stayBusy(); router.replace(leave as `/phase/review/${string}`); return; }
    if (leave) { stayBusy(); home(); return; }
    await reload();
  });

  if (!view || !view.current) return <PhaseFrame sys="KARADA // PHASE" onBack={close} testID="phase-progress"><View /></PhaseFrame>;
  const { current, paused, weights, measures, now, unit } = view;
  const phases = data!.phases;
  const u = (kg: number) => kgToUnit(kg, unit);
  const kg = (n: number) => `${fmt1(u(n))} ${unit}`;

  if (current.kind === 'rehab') {
    const progress = phaseProgress(current, phases, weights, today);
    const pp = paused ? phaseProgress(paused, phases, weights, today) : null;
    const ready = readyToEndRehab(data!.injuries, current, today) && !dismissed.ready;
    const watch = rehabWatch(data!.growth.days, data!.reviews, current, today);
    const names = data!.targets.map((i) => siteLabel(i.site, i.side)).join('・');
    return (
      <PhaseFrame sys={`KARADA // REHAB · DAY ${two(progress.rehabDays)}`} onBack={close} testID="phase-progress">
        <Heading en={`REHAB · DAY ${two(progress.rehabDays)}`} sub={`${formatMonthDay(current.startDate)}から ・ ${progress.rehabDays}日目`} title={phaseLabel(current)} />
        {ready && (
          <Panel border={hud.green} bg="#0F1C15" style={{ paddingHorizontal: 14, paddingVertical: 12, gap: 8 }} testID="phase-rehab-ready">
            <PanelHead en="REHAB // ALL FIXED" title={`${names}が「直せた」になりました`} />
            <T size={13} color={hud.note}>療養を終えますか？ 続けてもかまいません。</T>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <HudButton label="療養を終える" onPress={() => { setOpError(null); setDialog('endRehab'); }} style={{ flex: 1 }} testID="phase-rehab-ready-end" />
              <HudButton variant="outline" label="まだ続ける" onPress={() => setDismissed({ ...dismissed, ready: true })} style={{ flex: 1 }} testID="phase-rehab-ready-keep" />
            </View>
          </Panel>
        )}
        <Panel style={{ paddingHorizontal: 14, paddingVertical: 12, gap: 8 }} testID="phase-rehab">
          <PanelHead en="REHAB // CLOCK STOPPED" title="療養中" right={`${progress.rehabDays}日目`} />
          <T size={13} color={hud.note} style={{ lineHeight: 20 }}>
            療養中は時計を止め、進み具合とペースは判定しません。見るのは睡眠・食事・ケガの振り返りです。体の状態の判断は、本人や専門家に任せます。
          </T>
        </Panel>
        <WatchPanel watch={watch} />
        {paused && pp ? (
          <Panel style={{ paddingHorizontal: 14, paddingVertical: 12, gap: 6 }} testID="phase-paused">
            <PanelHead en={`${DIRECTION_EN[paused.direction!]} // PAUSED`} title={`止めているフェーズ：${phaseLabel(paused)}`} right={`${two(pp.week)}/${two(pp.weeksTotal ?? pp.week)}W`} />
            <TickBar ticks={pp.ticks} paused testID="phase-paused-ticks" accessibilityLabel={`止めているフェーズの進み具合。16の目盛りのうち${pp.ticks?.done ?? 0}つが過ぎた`} />
            <T size={12.5} color={hud.muted} style={{ lineHeight: 19 }}>
              {`${pp.week}週目で止めています。終わりは療養の日数（${pp.rehabDays}日）だけ後ろにずれ、今は ${pp.effectiveEnd ? formatMonthDay(pp.effectiveEnd) : '—'} です。目標体重 ${paused.targetWeightKg == null ? '—' : kg(paused.targetWeightKg)}。`}
            </T>
          </Panel>
        ) : null}
        <Section en="ACTIONS" title="操作">
          <ActionRow title="療養を終える" sub={paused ? '止めているフェーズを再開するか、振り返って次へ進むかを選びます' : '様子見に戻ります'}
            onPress={() => setDialog('endRehab')} last testID="phase-end-rehab" />
        </Section>
        <Sheet visible={dialog === 'endRehab'} onClose={() => setDialog(null)}>
          <SheetBody title="療養を終える" error={opError}>
            {paused ? (
              <>
                <T size={13} color={hud.note} style={{ lineHeight: 20 }}>{`療養を終えて、${phaseLabel(paused)}をどうしますか。`}</T>
                <T size={12} color={hud.muted} style={{ lineHeight: 18 }}>
                  {`再開：${pp ? `${pp.week}週目から。` : ''}終わりの日は ${pp?.effectiveEnd ? formatMonthDay(pp.effectiveEnd) : '—'}。はじめの2週はペースを判定しません。`}
                </T>
                <HudButton label={`${phaseLabel(paused)}を再開する`} busy={busy} onPress={() => act(() => repos.phases.endRehab(current.id, { resume: true }))} testID="phase-resume" />
                <T size={12} color={hud.muted} style={{ lineHeight: 18 }}>{`振り返って次へ：${phaseLabel(paused)}を${pp ? `${pp.week}週目で` : ''}終え、振り返りの画面へ進みます。`}</T>
                <HudButton variant="outline" label="振り返って次へ" busy={busy}
                  onPress={() => act(() => repos.phases.endRehab(current.id, { resume: false }), `/phase/review/${paused.id}`)} testID="phase-rehab-finish" />
              </>
            ) : (
              <HudButton label="療養を終える" busy={busy} onPress={() => act(() => repos.phases.endRehab(current.id, { resume: false }), true)} testID="phase-rehab-finish" />
            )}
          </SheetBody>
        </Sheet>
      </PhaseFrame>
    );
  }

  return (
    <NormalPhase
      phase={current} phases={phases} weights={weights} measures={measures} now={now!} growth={data!.growth} unit={unit} today={today}
      dialog={dialog} setDialog={(d) => { setOpError(null); setDialog(d); }} dismissed={dismissed} setDismissed={setDismissed}
      act={act} busy={busy} opError={opError} onBack={close} repos={repos}
    />
  );
}

type Repos = ReturnType<typeof useRepos>;

function NormalPhase({ phase, phases, weights, measures, now, growth, unit, today, dialog, setDialog, dismissed, setDismissed, act, busy, opError, onBack, repos }: {
  phase: Phase; phases: Phase[]; weights: Weight[]; measures: PhaseMeasures; now: PhaseMeasures; growth: GrowthData; unit: WeightUnit; today: DateKey;
  dialog: Dialog; setDialog: (d: Dialog) => void; dismissed: { streak?: boolean; mid?: boolean }; setDismissed: (d: { streak?: boolean; mid?: boolean }) => void;
  act: (task: () => Promise<void>, leave?: boolean | string) => void; busy: boolean; opError: string | null; onBack: () => void; repos: Repos;
}) {
  const dir = phase.direction!;
  const progress: PhaseProgress = phaseProgress(phase, phases, weights, today);
  const pace = progress.pace!;
  const chart = weightChart(phase, phases, weights, today);
  const total = progress.weeksTotal ?? progress.week;
  const u = (kg: number) => kgToUnit(kg, unit);
  const kg = (n: number) => `${fmt1(u(n))} ${unit}`;
  const perWeek = (n: number | null) => (n == null ? '—' : `${signed(u(n), 2)} ${unit}/週`);
  const streak = offPaceStreak(phase, phases, weights, today);
  const mid = midWeek(progress.weeksTotal);
  const showMid = mid != null && progress.week === mid && !dismissed.mid;
  const projection = projectedKg(chart);
  const { metrics } = successMetrics(phase, now);
  const weekAvg = pace.weekAvgKg ?? (measures.weightBasis === 'week' ? measures.weightKg : null);
  const end = progress.effectiveEnd;
  // 期間が終わっても、本人が終えるまでは実施中のまま（自動では終えない）
  const expired = end != null && today > end;
  const changes = planChanges(phase);
  const remaining = progress.remainingDays;

  return (
    <PhaseFrame sys={`KARADA // PHASE · ${DIRECTION_EN[dir]} ${two(progress.week)}/${two(total)}`} onBack={onBack} testID="phase-progress">
      <Heading en={`${DIRECTION_EN[dir]} · W${two(progress.week)}/${two(total)}`}
        sub={`${formatMonthDay(phase.startDate)}〜${end ? formatMonthDay(end) : ''}`} title={phaseLabel(phase)} />

      <Panel style={{ paddingHorizontal: 14, paddingVertical: 12, gap: 10 }} testID="phase-now">
        <PanelHead en="NOW // WHERE + PACE" title="いまどこ"
          rightNode={<Tag testID="phase-pace-status">{pace.status ? PACE_LABELS[pace.status] : '判定なし'}</Tag>} />
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}
          accessible accessibilityLabel={`${total}週のうち${progress.week}週目。${expired ? '期間は終わりました' : `残り${remaining ?? 0}日`}`}>
          <T>
            <Mono size={30} color={hud.white}>{`W${two(progress.week)}`}</Mono>
            <Mono size={13} color={hud.muted}>{` / ${two(total)}`}</Mono>
          </T>
          <T style={{ textAlign: 'right' }} testID="phase-remaining">
            <Mono size={11} color={hud.muted}>{expired ? 'COMPLETE ' : 'LEFT '}</Mono>
            <Mono size={20} color={hud.white}>{expired ? '0' : String(remaining ?? '—')}</Mono>
            <Mono size={11} color={hud.muted}>{' 日'}</Mono>
          </T>
        </View>
        <TickBar ticks={progress.ticks} testID="phase-ticks"
          accessibilityLabel={`進み具合。16の目盛りのうち${progress.ticks?.done ?? 0}つが過ぎた（1つは${tickSpan(total)}）`} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Micro>{`START ${phase.startDate.slice(5).replace('-', '/')}`}</Micro>
          <Micro>{`1 TICK = ${tickSpan(total)}`}</Micro>
          <Micro>{`END ${end ? end.slice(5).replace('-', '/') : '—'}`}</Micro>
        </View>
        <T size={14} color={hud.insight} style={{ lineHeight: 22 }} testID="phase-pace-reason">
          {paceSentence(pace, recoveryUntil(phase, phases, today), kg, formatMonthDay)}
        </T>
        <View style={{ flexDirection: 'row', gap: 16, flexWrap: 'wrap' }}>
          <Micro>{`3W ${perWeek(recentSlopePerWeek(chart))}`}</Micro>
          <Micro>{`PLAN ${perWeek(planSlopePerWeek(chart))}`}</Micro>
        </View>
      </Panel>

      {expired && (
        <Panel border={hud.green} bg="#0F1C15" style={{ paddingHorizontal: 14, paddingVertical: 12, gap: 8 }} testID="phase-expired">
          <PanelHead en="PHASE // COMPLETE" title="期間が終わりました" right={`${formatMonthDay(end!)}まで`} />
          <T size={13} color={hud.note} style={{ lineHeight: 20 }}>終えて振り返るか、続けるなら期間を延ばします。</T>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <HudButton label="終えて振り返る" busy={busy} onPress={() => act(() => repos.phases.end(phase.id), `/phase/review/${phase.id}`)} style={{ flex: 1 }} testID="phase-expired-review" />
            <HudButton variant="outline" label="期間を延ばす" onPress={() => setDialog('change')} style={{ flex: 1 }} />
          </View>
        </Panel>
      )}

      {streak && streak !== 'on_track' && !dismissed.streak && (
        <Panel border={hud.green} style={{ paddingHorizontal: 14, paddingVertical: 12, gap: 8 }} testID="phase-streak">
          <PanelHead en="PACE // 2 WEEKS OFF" title={STREAK_TITLES[streak]} />
          {projection != null && <T size={12.5} color={hud.muted}>{`このままだと ${total}週目の見込みは ${kg(projection)} です。どれかを選べます。`}</T>}
          <ActionRow title="食事の目標を見直す" sub={mealSummary(phase.mealTargets)} onPress={() => setDialog('meals')} />
          <ActionRow title="計画を変える" sub={`目標体重・期間を今日から変える（今は ${phase.targetWeightKg == null ? '—' : kg(phase.targetWeightKg)}・${total}週）`} onPress={() => setDialog('change')} />
          <ActionRow title="このまま続ける" onPress={() => setDismissed({ ...dismissed, streak: true })} last testID="phase-streak-keep" />
        </Panel>
      )}

      {showMid && (
        <Panel border={hud.green} bg="#0F1C15" style={{ paddingHorizontal: 14, paddingVertical: 12, gap: 8 }} testID="phase-mid">
          <PanelHead en="MID REVIEW" title="中間の見直し" right={`${mid}／${total}週`} />
          <MidRow label="体重" value={
            `${phase.snapshot?.weight_kg == null ? '—' : fmt1(u(phase.snapshot.weight_kg))} → ${weekAvg == null ? '—' : fmt1(u(weekAvg))} ${unit}` +
            (pace.planKg != null ? `（予定 ${fmt1(u(pace.planKg))}。${pace.status ? PACE_LABELS[pace.status] : '判定なし'}）` : '')} />
          {(() => {
            const m = metrics.find((x) => x.key === 'big3');
            return m && m.start != null && m.now != null ? <MidRow label="BIG3" value={`${fmt1(u(m.start))} → ${fmt1(u(m.now))} ${unit}（${signed(u(m.delta!))}）`} /> : null;
          })()}
          <MidRow label="見込み" value={projection == null ? '出せません（体重の週が足りない）' : `${total}週目に ${kg(projection)}`} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <HudButton label="このまま続ける" onPress={() => setDismissed({ ...dismissed, mid: true })} style={{ flex: 1 }} testID="phase-mid-keep" />
            <HudButton variant="outline" label="計画を変える" onPress={() => setDialog('change')} style={{ flex: 1 }} />
          </View>
        </Panel>
      )}

      <Panel style={{ paddingHorizontal: 14, paddingVertical: 12, gap: 8 }} testID="phase-weight">
        <PanelHead en="WEIGHT // WEEKLY AVG" title="体重（週平均）"
          rightNode={(
            <T style={{ textAlign: 'right' }}>
              <Mono size={18} color={hud.white}>{weekAvg == null ? '—' : fmt1(u(weekAvg))}</Mono>
              <Mono size={10} color={hud.muted}>{` / GOAL ${phase.targetWeightKg == null ? '—' : fmt1(u(phase.targetWeightKg))} ${unit.toUpperCase()}`}</Mono>
            </T>
          )} />
        <WeightChart chart={chart} unit={unit}
          accessibilityLabel={`体重の週平均のグラフ。${chart.points.length}週分の点。目標 ${phase.targetWeightKg == null ? 'なし' : kg(phase.targetWeightKg)}`} />
      </Panel>

      <Panel style={{ paddingHorizontal: 14, paddingVertical: 12, gap: 4 }} testID="phase-success">
        <PanelHead en="SUCCESS" title="成功の指標" right={SUCCESS_RULE[dir]} />
        {orderMetrics(dir, metrics).map((m, i, list) => {
          const isKg = m.key === 'weight' || m.key === 'big3';
          const f = (n: number) => (isKg ? fmt1(u(n)) : m.key === 'growth_score' ? String(Math.round(n)) : fmt1(n));
          const main = i === 0;
          return (
            <View key={m.key} style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingVertical: 8, borderBottomWidth: i === list.length - 1 ? 0 : 1, borderBottomColor: hud.rowLine }}
              accessible accessibilityLabel={`${m.label}${main ? '（主）' : ''}。${m.start == null ? '—' : f(m.start)}から${m.now == null ? '—' : f(m.now)}。${metricNote(m, dir, phase.targetWeightKg, kg)}`}>
              <View style={{ flex: 1, gap: 2 }}>
                <T bold size={13} color={m.reference ? hud.muted : hud.label}>{`${metricTitle(m.key)}${main ? '・主' : ''}${m.reference ? '（参考。判定には使わない）' : ''}`}</T>
                <T>
                  <Mono size={12} color={hud.muted}>{`${m.start == null ? '—' : f(m.start)} → `}</Mono>
                  <Mono size={16} color={m.reference ? hud.muted : hud.white}>{m.now == null ? '—' : f(m.now)}</Mono>
                  <Mono size={10} color={hud.muted}>{` ${isKg ? unit.toUpperCase() : m.key === 'body_fat' ? '%' : ''}`}</Mono>
                </T>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 2 }}>
                <Mono size={14} color={m.ok ? hud.green : m.reference ? hud.muted : hud.white}>{m.delta == null ? '—' : signed(isKg ? u(m.delta) : m.delta, m.key === 'growth_score' ? 0 : 1)}</Mono>
                <T size={11} color={hud.muted}>{metricNote(m, dir, phase.targetWeightKg, kg)}</T>
              </View>
            </View>
          );
        })}
      </Panel>

      <Section en="PLAN" title="計画">
        <View testID="phase-plan">
          <StatusRow en="START" ja="開始日" value={formatJpDate(phase.startDate)} wide />
          <StatusRow en="PERIOD" ja="期間" value={`${total}週・〜${end ? formatMonthDay(end) : '—'}`} wide />
          <StatusRow en="GOAL" ja="目標体重" value={phase.targetWeightKg == null ? '—' : kg(phase.targetWeightKg)} wide />
          {changes > 0 && <StatusRow en="CHANGES" ja="計画を変えた回数" value={`${changes}回`} wide />}
          {mid != null && progress.week < mid && (
            <StatusRow en="MID" ja="中間の見直し" value={`${mid}週目（${formatMonthDay(midDate(phase, phases, today, mid))}〜）`} wide />
          )}
        </View>
        <ActionRow title="計画を変える（今日から）" sub="目標体重を変える・期間を延ばす・縮める。今日から予定の線を引き直し、前の線は薄く残る"
          onPress={() => setDialog('change')} testID="phase-plan-change" />
        <ActionRow title="開始日・最初の計画を直す" sub="入れ間違い・始め忘れ。最初からこの計画だったことにして、開始日から線を引き直す"
          onPress={() => setDialog('correct')} testID="phase-plan-correct" />
        <ActionRow title="食事の目標" sub={mealSummary(phase.mealTargets)} onPress={() => setDialog('meals')} last testID="phase-meals" />
      </Section>

      <Section en="ACTIONS" title="操作">
        <ActionRow title="療養に入る" sub="ケガや体調不良で。時計を止める" onPress={() => setDialog('rehab')} testID="phase-rehab-start" />
        <ActionRow title={expired ? '終えて振り返る' : '早めに終える'} sub="今日で終え、振り返りの画面へ" onPress={() => setDialog('end')} testID="phase-end" />
        <ActionRow title="中断する" sub="振り返らずに様子見に戻す" onPress={() => setDialog('abort')} danger last testID="phase-abort" />
      </Section>

      <PlanSheet visible={dialog === 'change' || dialog === 'correct'} mode={dialog === 'correct' ? 'correct' : 'change'}
        onMode={(m) => setDialog(m)} onClose={() => setDialog(null)}
        phase={phase} phases={phases} today={today} unit={unit} weekAvg={weekAvg} growth={growth} busy={busy} error={opError}
        onChange={(input) => act(() => repos.phases.changePlan(phase.id, input))}
        onCorrect={(input) => act(() => repos.phases.correct(phase.id, input))} />
      <MealSheet visible={dialog === 'meals'} onClose={() => setDialog(null)} targets={phase.mealTargets} weightKg={measures.weightKg} busy={busy} error={opError}
        onSave={(t) => act(() => repos.phases.setMealTargets(phase.id, t))} />
      <RehabStartSheet visible={dialog === 'rehab'} onClose={() => setDialog(null)} title="療養に入る" paused={{ label: phaseLabel(phase), week: progress.week }}
        busy={busy} error={opError}
        onStart={(name) => act(() => repos.phases.startRehab({ name, startDate: today, snapshot: snapshotOf(measures) }).then(() => undefined))} />
      <ConfirmDialog visible={dialog === 'end'} title="フェーズを終えますか？" danger={false} busy={busy}
        body={`${phaseLabel(phase)}を今日で終えます。終えたら振り返りの画面に進み、次のフェーズを始められます。`}
        confirmLabel="終える" onCancel={() => setDialog(null)} onConfirm={() => act(() => repos.phases.end(phase.id), `/phase/review/${phase.id}`)} />
      <ConfirmDialog visible={dialog === 'abort'} title="フェーズを中断しますか？" busy={busy}
        body="振り返らずに様子見に戻します。体重などの記録は消えません。" confirmLabel="中断する"
        onCancel={() => setDialog(null)} onConfirm={() => act(() => repos.phases.abort(phase.id), true)} />
    </PhaseFrame>
  );
}

/** 目盛り 1 つの長さ（16 週なら「1W」、8 週なら「3.5D」、24 週なら「1.5W」） */
function tickSpan(weeks: number): string {
  const days = (weeks * 7) / PHASE_TICKS;
  if (Number.isInteger(days / 7)) return `${days / 7}W`;
  if (days > 7) return `${trimNumber(Math.round((days / 7) * 10) / 10)}W`;
  return `${trimNumber(Math.round(days * 10) / 10)}D`;
}

function metricTitle(key: string): string {
  return { weight: '体重（週平均）', big3: 'BIG3 推定1RM 合計', growth_score: '成長スコア', body_fat: '体脂肪率' }[key] ?? key;
}

function mealSummary(t: PhaseMealTargets | null): string {
  if (!t) return 'まだ決めていません';
  const k = (n: number | null) => (n == null ? '—' : n.toLocaleString('en-US'));
  return `筋トレの日 ${k(t.training_day.kcal)}・休みの日 ${k(t.rest_day.kcal)} kcal・たんぱく質 ${k(t.training_day.protein_g)} g`;
}

function Heading({ en, sub, title }: { en: string; sub: string; title: string }) {
  return (
    <View style={{ gap: 2, marginBottom: 4 }}>
      <Micro green>{en}</Micro>
      <T size={11.5} color={hud.muted}>{sub}</T>
      <T bold size={22} color={hud.ink} accessibilityRole="header" style={{ lineHeight: 30 }}>{title}</T>
    </View>
  );
}

function Section({ en, title, children }: { en: string; title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 4, marginTop: 6 }}>
      <Micro green>{en}</Micro>
      <T bold size={13} color={hud.green} accessibilityRole="header">{title}</T>
      <Panel style={{ paddingHorizontal: 14, paddingVertical: 2 }}>{children}</Panel>
    </View>
  );
}

function MidRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 12 }}>
      <T bold size={12.5} color={hud.green} style={{ width: 52 }}>{label}</T>
      <T size={13} color={hud.ink} style={{ flex: 1, lineHeight: 19 }}>{value}</T>
    </View>
  );
}

type PlanMode = 'change' | 'correct';

/**
 * 計画の編集のシート。上で「今日から計画を変える」（変更）と「開始日・最初の計画を直す」（訂正）を選ぶ。予定の線の扱いが違う：
 * - 変更：目標体重と期間（全体の週数。延ばす・縮める）。今日から線を引き直し、前の線は薄く残る
 * - 訂正：開始日・期間・目標体重。最初からこの計画だったことにして、開始日から 1 本の線に引き直す。開始日を変えたら開始時の記録も
 *   新しい開始日までの記録から出し直す（今の snapshotOf と同じ出し方）
 * 範囲は lib/phaseEdit.ts（開始日は今日まで・前のフェーズと重ねない、終わりは今日より前にしない、期間は 1〜104 週）。開くたびに今の計画から始める
 */
function PlanSheet({ visible, mode, onMode, onClose, phase, phases, today, unit, weekAvg, growth, busy, error, onChange, onCorrect }: {
  visible: boolean; mode: PlanMode; onMode: (m: PlanMode) => void; onClose: () => void; phase: Phase; phases: Phase[]; today: DateKey; unit: WeightUnit;
  weekAvg: number | null; growth: GrowthData; busy: boolean; error: string | null;
  onChange: (input: ChangeInput) => void; onCorrect: (input: CorrectInput) => void;
}) {
  const weeksNow = phase.endDate ? Math.ceil((daysBetween(phase.startDate, phase.endDate) + 1) / 7) : 1;
  const targetText = phase.targetWeightKg == null ? '' : trimNumber(Math.round(kgToUnit(phase.targetWeightKg, unit) * 10) / 10);
  const range = editRange(phase, phases, today);
  // 期間が終わったあとに開いたときは、今日までを収める週数から（今の週数のままでは保存できないため）
  const weeksInitial = Math.max(weeksNow, range.minWeeks);
  const [start, setStart] = useState(phase.startDate);
  const [weeks, setWeeks] = useState(String(weeksInitial));
  const [target, setTarget] = useState(targetText);
  // 開くたび・訂正と変更を切り替えるたびに、今の計画から始める（前に開いたときの入力や、保存した前の値を残さない）
  useEffect(() => {
    if (!visible) return;
    setStart(phase.startDate); setWeeks(String(weeksInitial)); setTarget(targetText);
  }, [visible, mode, phase.startDate, weeksInitial, targetText]);

  const correct = mode === 'correct';
  const startDate = correct ? start : phase.startDate;
  const minWeeks = correct ? range.minWeeksFrom(startDate) : range.minWeeks;
  const n = parseNumber(target);
  // 目標の欄を触っていなければ、今の目標をそのまま使う（表示の丸めや lb への換算で、期間だけの変更が目標の変更にならないように）
  const targetKg = target === targetText ? phase.targetWeightKg : n == null ? null : Math.round(unitToKg(n, unit) * 100) / 100;
  const w = Number(weeks);
  const weeksNum = weeks.trim() !== '' && Number.isInteger(w) ? w : null;
  const moved = startDate !== phase.startDate;
  const snapshot = useMemo(() => (moved ? snapshotOf(measuresFrom(growth, startDate)) : phase.snapshot), [moved, growth, startDate, phase.snapshot]);
  const changed = moved || weeksNum !== weeksNow || (targetKg != null && Math.abs(targetKg - (phase.targetWeightKg ?? 0)) >= 0.005);

  let problem: string | null = null;
  if (targetKg == null) problem = '目標体重を入れてください';
  else if (weeksNum == null) problem = '期間を週の数で入れてください';
  else if (correct) problem = correctError(phase, phases, today, { startDate, weeks: weeksNum, targetWeightKg: targetKg, snapshot });
  else problem = changeError(phase, phases, today, { weeks: weeksNum, targetWeightKg: targetKg, weekAvgKg: weekAvg });

  const endNow = effectiveEndFor(phase, phases, today, phase.startDate, weeksNow);
  const endNext = weeksNum != null && weeksNum >= 1 && weeksNum <= PHASE_LIMITS.weeks ? effectiveEndFor(phase, phases, today, startDate, weeksNum) : null;
  const fmtW = (kg: number) => `${fmt1(kgToUnit(kg, unit))} ${unit}`;
  const changes = planChanges(phase);
  const lineFrom = correct
    ? (snapshot?.weight_kg == null ? null : snapshot.weight_kg)
    : (targetKg != null && phase.targetWeightKg != null && Math.abs(targetKg - phase.targetWeightKg) >= 0.005 ? weekAvg : null);
  const save = () => {
    if (problem || targetKg == null || weeksNum == null) return;
    if (correct) onCorrect({ startDate, weeks: weeksNum, targetWeightKg: targetKg, snapshot });
    else onChange({ weeks: weeksNum, targetWeightKg: targetKg, weekAvgKg: weekAvg });
  };

  return (
    <Sheet visible={visible} onClose={onClose}>
      <ScrollView keyboardShouldPersistTaps="handled" style={{ backgroundColor: hud.panel }} testID="phase-plan-sheet">
        <SheetBody title="計画を編集" error={error}>
          <ModeTabs<PlanMode> value={mode} onChange={onMode} options={[
            { key: 'change', title: '今日から計画を変える', sub: '途中で目標や期間を変える' },
            { key: 'correct', title: '開始日・最初の計画を直す', sub: '入れ間違い・始め忘れ' },
          ]} />
          <T size={12.5} color={hud.note} style={{ lineHeight: 19 }}>
            {correct
              ? '最初からこの計画だったことにして、開始日から予定の線を 1 本に引き直します。開始日を変えると、開始時の記録（体重・体脂肪率・BIG3）もその日までの記録から出し直します。'
              : '今日から新しい予定の線を引きます。今日までの線は薄く残ります。期間は開始日からの全体の週数です（延ばす・縮める）。'}
          </T>
          {correct && (
            <DateField label="開始日（今日まで。前のフェーズと重ねない）" value={start} onChange={setStart} min={range.minStart} max={today} testID="phase-edit-start" />
          )}
          <WeeksStepper value={weeks} onChange={setWeeks} min={minWeeks} max={PHASE_LIMITS.weeks} testID="phase-edit-weeks" />
          <NumberField label="目標体重" unit={unit} value={target} onChange={setTarget} testID="phase-edit-target" />
          <Panel bg={hud.panel2} border={hud.line2} cut={6} style={{ paddingHorizontal: 12, paddingVertical: 2 }} testID="phase-edit-preview">
            {correct && moved && <StatusRow en="START" ja="開始日" value={`${formatShortDate(phase.startDate)} → ${formatShortDate(startDate)}`} wide />}
            <StatusRow en="END" ja="終わり" value={endNext == null ? '—' : endNext === endNow ? formatMonthDay(endNow) : `${formatShortDate(endNow)} → ${formatShortDate(endNext)}`} wide />
            {correct && moved && (
              <StatusRow en="BASELINE" ja="開始時の体重" value={snapshot?.weight_kg == null ? 'なし（線は引けません）' : `${fmtW(snapshot.weight_kg)}`} wide />
            )}
            <StatusRow en="LINE" ja="予定の線" last wide value={
              correct
                ? `${formatShortDate(startDate)}から${lineFrom == null ? '' : ` ${fmtW(lineFrom)} →`} ${targetKg == null ? '—' : fmtW(targetKg)}`
                : `今日から${lineFrom == null ? '' : ` ${fmtW(lineFrom)} →`} ${targetKg == null ? '—' : fmtW(targetKg)}`} />
          </Panel>
          {correct && changes > 0 && (
            <T size={12} color={hud.label} style={{ lineHeight: 18 }} testID="phase-edit-warning">
              {`今までに計画を変えた ${changes} 回分の線は消え、最初からこの計画だったことになります。`}
            </T>
          )}
          {problem && changed && <T size={12.5} color={colors.danger} accessibilityRole="alert" testID="phase-edit-problem">{problem}</T>}
          <HudButton label={correct ? 'この内容に直す' : '今日から変える'} busy={busy} disabled={!changed || problem != null} onPress={save} testID="phase-edit-save" />
          <TextButton label="やめる" onPress={onClose} />
        </SheetBody>
      </ScrollView>
    </Sheet>
  );
}

function MealSheet({ visible, onClose, targets, weightKg, busy, error, onSave }: {
  visible: boolean; onClose: () => void; targets: PhaseMealTargets | null; weightKg: number | null; busy: boolean; error: string | null;
  onSave: (t: PhaseMealTargets | null) => void;
}) {
  const [draft, setDraft] = useState<MealDraft>(() => mealDraftFromPhase(targets));
  const [local, setLocal] = useState<string | null>(null);
  const save = () => {
    const p = parseMealDraft(draft);
    if ('error' in p) { setLocal(p.error); return; }
    setLocal(null);
    onSave(p.value);
  };
  return (
    <Sheet visible={visible} onClose={onClose}>
      <SheetBody title="食事の目標" error={local ?? error}>
        <MealFields draft={draft} onChange={setDraft} weightKg={weightKg} />
        <T size={11.5} color={hud.muted}>フェーズに持たせる目標です。毎日の食事の記録の目標（食事の目標の画面）は変わりません。</T>
        <HudButton label="保存" busy={busy} onPress={save} testID="phase-meals-save" />
      </SheetBody>
    </Sheet>
  );
}

const hm = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;

/** 療養中に見るもの（Figma の療養 3）：睡眠の平均・食事の目標に届いた日・ケガの振り返り。数字は記録から出せるものだけ */
function WatchPanel({ watch }: { watch: RehabWatch }) {
  const latest = watch.latestReview;
  return (
    <Panel style={{ paddingHorizontal: 14, paddingVertical: 12, gap: 2 }} testID="phase-rehab-watch">
      <PanelHead en="REHAB // WATCH" title="療養中に見るもの" />
      <WatchRow title="睡眠（平均）" sub={`療養に入ってから・${watch.sleepDays}日分`} value={watch.sleepAvgMin == null ? '—' : hm(watch.sleepAvgMin)} unit="時間" />
      <WatchRow title="食事の目標に届いた日" sub="カロリーとたんぱく質" value={String(watch.mealReached)} unit={`／${watch.mealDays}日`} />
      <WatchRow title="ケガの振り返り" sub={latest ? `最新：${latest.date.slice(5).replace('-', '/')} ${RESULTS[latest.result].mark}${RESULTS[latest.result].label}` : 'まだありません'}
        value={String(watch.reviews)} unit="回" last />
    </Panel>
  );
}

function WatchRow({ title, sub, value, unit, last }: { title: string; sub: string; value: string; unit: string; last?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, borderBottomWidth: last ? 0 : 1, borderBottomColor: hud.rowLine }}
      accessible accessibilityLabel={`${title}。${value}${unit}。${sub}`}>
      <View style={{ flex: 1, gap: 2 }}>
        <T bold size={13} color={hud.label}>{title}</T>
        <T size={11} color={hud.muted}>{sub}</T>
      </View>
      <T>
        <Mono size={18} color={hud.white}>{value}</Mono>
        <Mono size={10} color={hud.muted}>{` ${unit}`}</Mono>
      </T>
    </View>
  );
}
