import { router } from 'expo-router';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { LoadError } from '@/components/LoadError';
import { Sheet } from '@/components/motion';
import { MealFields } from '@/components/phase/MealFields';
import { ActionRow, HudButton, HudChip, NumberField, PhaseFrame, Tag, TextField } from '@/components/phase/parts';
import { WeightChart } from '@/components/phase/WeightChart';
import { hud, HudFonts, Micro, Mono, Panel, PanelHead } from '@/components/report/hud';
import { T } from '@/components/Text';
import { ConfirmDialog } from '@/components/ui';
import { PhaseError } from '@/db/repositories/phases';
import { useBusy } from '@/hooks/busy';
import { useFocusData, useRepos } from '@/hooks/data';
import { useToday } from '@/hooks/today';
import { addDays, DateKey, formatMonthDay } from '@/lib/date';
import { loadGrowthData } from '@/lib/growthData';
import { DIRECTION_EN } from '@/lib/homeHero';
import {
  currentPhase, PACE_LABELS, Phase, PHASE_LIMITS, PhaseMealTargets, phaseLabel, phaseProgress, PhaseProgress, recoveryUntil,
  successMetrics, Weight,
} from '@/lib/phases';
import {
  MealDraft, mealDraftFromPhase, measuresFrom, metricNote, midDate, midWeek, offPaceStreak, orderMetrics, paceSentence, parseMealDraft,
  PhaseMeasures, planSlopePerWeek, projectedKg, recentSlopePerWeek, snapshotOf, STREAK_TITLES, SUCCESS_RULE, weightChart,
} from '@/lib/phaseView';
import { fmt1, kgToUnit, parseNumber, trimNumber, unitToKg, WeightUnit } from '@/lib/units';
import { colors } from '@/theme';

type Dialog = 'extend' | 'target' | 'rehab' | 'meals' | 'end' | 'abort' | 'endRehab' | null;

const two = (n: number) => String(n).padStart(2, '0');
const signed = (n: number, digits = 1) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n).toFixed(digits)}`;

/**
 * フェーズの進捗の詳細（Figma「スタディ：フェーズ」のセクション 3）。ホームのフェーズの 1 行と設定の「フェーズ」から開く。
 * 実施中：体重のグラフ、ペースの判定と理由、成功の指標、このあと（中間の見直し・食事の目標）、操作（延長・目標を変える・療養に入る・
 * 早めに終える・中断する）。2 週続けてペースが崩れたら直し方の提案、中間の週には中間の見直しを上に出す。
 * 療養中：療養の日数、止めているフェーズ、療養を終える（再開する／振り返って次へ）。
 * フェーズがなければ設定（/phase/new）へ移す。早めに終えたあとの振り返りの画面は次の版なので、終えたらホームへ戻す
 */
export default function PhaseScreen() {
  const today = useToday();
  const { data, error, reload, repos } = useFocusData(async (r) => {
    const [phases, growth] = await Promise.all([r.phases.list(), loadGrowthData(r, today)]);
    return { phases, growth };
  }, today);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [dismissed, setDismissed] = useState<{ streak?: boolean; mid?: boolean }>({});
  const [opError, setOpError] = useState<string | null>(null);
  const { busy, run } = useBusy();

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const home = () => (router.canDismiss() ? router.dismissTo('/') : router.replace('/'));

  const view = useMemo(() => {
    if (!data) return null;
    const weights: Weight[] = data.growth.weights.map((w) => ({ date: w.date, kg: w.weightKg }));
    const { current, paused } = currentPhase(data.phases, today);
    return { weights, current, paused, measures: measuresFrom(data.growth, today), unit: data.growth.weightUnit };
  }, [data, today]);

  // フェーズがない（終えた・中断した・別の端末で消した）ときは設定へ
  const none = view != null && view.current == null;
  useEffect(() => { if (none) router.replace('/phase/new'); }, [none]);

  if (error) return <PhaseFrame sys="HLOG // PHASE" onBack={close}><LoadError onRetry={reload} /></PhaseFrame>;

  /** 操作を実行して読み直す。断られたら理由を出す。leave があれば、そのあとでホームへ */
  const act = (task: () => Promise<void>, leave = false) => run(async (stayBusy) => {
    setOpError(null);
    try {
      await task();
    } catch (e) {
      if (e instanceof PhaseError) { setOpError(e.message); return; }
      throw e;
    }
    setDialog(null);
    if (leave) { stayBusy(); home(); return; }
    await reload();
  });

  if (!view || !view.current) return <PhaseFrame sys="HLOG // PHASE" onBack={close} testID="phase-progress"><View /></PhaseFrame>;
  const { current, paused, weights, measures, unit } = view;
  const phases = data!.phases;
  const u = (kg: number) => kgToUnit(kg, unit);
  const kg = (n: number) => `${fmt1(u(n))} ${unit}`;

  if (current.kind === 'rehab') {
    const progress = phaseProgress(current, phases, weights, today);
    const pp = paused ? phaseProgress(paused, phases, weights, today) : null;
    return (
      <PhaseFrame sys={`HLOG // REHAB · DAY ${two(progress.rehabDays)}`} onBack={close} testID="phase-progress">
        <Heading en={`REHAB · DAY ${two(progress.rehabDays)}`} sub={`${formatMonthDay(current.startDate)}から ・ ${progress.rehabDays}日目`} title={phaseLabel(current)} />
        <Panel style={{ paddingHorizontal: 14, paddingVertical: 12, gap: 8 }} testID="phase-rehab">
          <PanelHead en="REHAB // CLOCK STOPPED" title="療養中" right={`${progress.rehabDays}日目`} />
          <T size={13} color={hud.note} style={{ lineHeight: 20 }}>
            療養中は時計を止め、進み具合とペースは判定しません。見るのは睡眠・たんぱく質・ケガの振り返りです。体の状態の判断は、本人や専門家に任せます。
          </T>
        </Panel>
        {paused && pp ? (
          <Panel style={{ paddingHorizontal: 14, paddingVertical: 12, gap: 6 }} testID="phase-paused">
            <PanelHead en={`${DIRECTION_EN[paused.direction!]} // PAUSED`} title={`止めているフェーズ：${phaseLabel(paused)}`} right={`${two(pp.week)}/${two(pp.weeksTotal ?? pp.week)}W`} />
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
                <T size={13} color={hud.note} style={{ lineHeight: 20 }}>{`${phaseLabel(paused)}をどうしますか。`}</T>
                <HudButton label={`再開する（${phaseLabel(paused)}を続ける）`} busy={busy} onPress={() => act(() => repos.phases.endRehab(current.id, { resume: true }))} testID="phase-resume" />
                <HudButton variant="outline" label="振り返って次へ（フェーズも終える）" busy={busy} onPress={() => act(() => repos.phases.endRehab(current.id, { resume: false }), true)} testID="phase-rehab-finish" />
                <T size={11.5} color={hud.muted}>振り返りの画面は次の版で作ります。今は終えてホームに戻ります。</T>
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
      phase={current} phases={phases} weights={weights} measures={measures} unit={unit} today={today}
      dialog={dialog} setDialog={(d) => { setOpError(null); setDialog(d); }} dismissed={dismissed} setDismissed={setDismissed}
      act={act} busy={busy} opError={opError} onBack={close} repos={repos}
    />
  );
}

type Repos = ReturnType<typeof useRepos>;

function NormalPhase({ phase, phases, weights, measures, unit, today, dialog, setDialog, dismissed, setDismissed, act, busy, opError, onBack, repos }: {
  phase: Phase; phases: Phase[]; weights: Weight[]; measures: PhaseMeasures; unit: WeightUnit; today: DateKey;
  dialog: Dialog; setDialog: (d: Dialog) => void; dismissed: { streak?: boolean; mid?: boolean }; setDismissed: (d: { streak?: boolean; mid?: boolean }) => void;
  act: (task: () => Promise<void>, leave?: boolean) => void; busy: boolean; opError: string | null; onBack: () => void; repos: Repos;
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
  const { metrics } = successMetrics(phase, measures);
  const weekAvg = pace.weekAvgKg ?? (measures.weightBasis === 'week' ? measures.weightKg : null);
  const end = progress.effectiveEnd;

  return (
    <PhaseFrame sys={`HLOG // PHASE · ${DIRECTION_EN[dir]} ${two(progress.week)}/${two(total)}`} onBack={onBack} testID="phase-progress">
      <Heading en={`${DIRECTION_EN[dir]} · W${two(progress.week)}/${two(total)}`}
        sub={`${formatMonthDay(phase.startDate)}〜${end ? formatMonthDay(end) : ''} ・ ${progress.week}／${total}週目`} title={phaseLabel(phase)} />

      {streak && streak !== 'on_track' && !dismissed.streak && (
        <Panel border={hud.green} style={{ paddingHorizontal: 14, paddingVertical: 12, gap: 8 }} testID="phase-streak">
          <PanelHead en="PACE // 2 WEEKS OFF" title={STREAK_TITLES[streak]} />
          {projection != null && <T size={12.5} color={hud.muted}>{`このままだと ${total}週目の見込みは ${kg(projection)} です。どれかを選べます。`}</T>}
          <ActionRow title="食事の目標を見直す" sub={mealSummary(phase.mealTargets)} onPress={() => setDialog('meals')} />
          <ActionRow title="延長する" sub={end ? `今の終わりは ${formatMonthDay(end)}` : undefined} onPress={() => setDialog('extend')} />
          <ActionRow title="目標を変える" sub={phase.targetWeightKg == null ? undefined : `今の目標 ${kg(phase.targetWeightKg)}`} onPress={() => setDialog('target')} />
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
            <HudButton variant="outline" label="目標や期間を直す" onPress={() => setDialog('target')} style={{ flex: 1 }} />
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

      <Panel style={{ paddingHorizontal: 14, paddingVertical: 12, gap: 8 }} testID="phase-pace">
        <PanelHead en="PACE" title="ペース" rightNode={<Mono size={11} color={hud.muted}>{`W${two(progress.week)}`}</Mono>} />
        <View style={{ flexDirection: 'row' }}><Tag testID="phase-pace-status">{pace.status ? PACE_LABELS[pace.status] : '判定なし'}</Tag></View>
        <T size={14} color={hud.insight} style={{ lineHeight: 22 }} testID="phase-pace-reason">
          {paceSentence(pace, recoveryUntil(phase, phases, today), kg, formatMonthDay)}
        </T>
        <View style={{ flexDirection: 'row', gap: 16, flexWrap: 'wrap' }}>
          <Micro>{`3W ${perWeek(recentSlopePerWeek(chart))}`}</Micro>
          <Micro>{`PLAN ${perWeek(planSlopePerWeek(chart))}`}</Micro>
        </View>
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

      <Section en="NEXT" title="このあと">
        {mid != null && progress.week < mid && (
          <ActionRow title="中間の見直し" sub={`${mid}週目（${formatMonthDay(midDate(phase, phases, today, mid))}〜）に、ここに出ます`} right={`あと${mid - progress.week}週`} />
        )}
        <ActionRow title="食事の目標" sub={mealSummary(phase.mealTargets)} onPress={() => setDialog('meals')} last testID="phase-meals" />
      </Section>

      <Section en="ACTIONS" title="操作">
        <ActionRow title="延長する" sub={`終わりを後ろにずらす（今は ${end ? formatMonthDay(end) : '—'}）`} onPress={() => setDialog('extend')} testID="phase-extend" />
        <ActionRow title="目標を変える" sub="変えた日から予定の線を引き直す。前の線は薄く残る" onPress={() => setDialog('target')} testID="phase-target-change" />
        <ActionRow title="療養に入る" sub="ケガや体調不良で。時計を止める" onPress={() => setDialog('rehab')} testID="phase-rehab-start" />
        <ActionRow title="早めに終える" sub="今日で終える（振り返りの画面は次の版）" onPress={() => setDialog('end')} testID="phase-end" />
        <ActionRow title="中断する" sub="振り返らずに様子見に戻す" onPress={() => setDialog('abort')} danger last testID="phase-abort" />
      </Section>

      <ExtendSheet visible={dialog === 'extend'} onClose={() => setDialog(null)} phase={phase} progress={progress} busy={busy} error={opError}
        onExtend={(w) => act(() => repos.phases.extend(phase.id, w))} />
      <TargetSheet visible={dialog === 'target'} onClose={() => setDialog(null)} phase={phase} progress={progress} unit={unit} weekAvg={weekAvg} busy={busy} error={opError}
        onSave={(t) => act(() => repos.phases.changeTarget(phase.id, t, weekAvg))} />
      <MealSheet visible={dialog === 'meals'} onClose={() => setDialog(null)} targets={phase.mealTargets} weightKg={measures.weightKg} busy={busy} error={opError}
        onSave={(t) => act(() => repos.phases.setMealTargets(phase.id, t))} />
      <RehabSheet visible={dialog === 'rehab'} onClose={() => setDialog(null)} label={phaseLabel(phase)} busy={busy} error={opError}
        onStart={(name) => act(() => repos.phases.startRehab({ name, startDate: today, snapshot: snapshotOf(measures) }).then(() => undefined))} />
      <ConfirmDialog visible={dialog === 'end'} title="フェーズを終えますか？" danger={false} busy={busy}
        body={`${phaseLabel(phase)}を今日で終えます。振り返りの画面は次の版で作ります。終えたらホームに戻り、次のフェーズを始められます。`}
        confirmLabel="終える" onCancel={() => setDialog(null)} onConfirm={() => act(() => repos.phases.end(phase.id), true)} />
      <ConfirmDialog visible={dialog === 'abort'} title="フェーズを中断しますか？" busy={busy}
        body="振り返らずに様子見に戻します。体重などの記録は消えません。" confirmLabel="中断する"
        onCancel={() => setDialog(null)} onConfirm={() => act(() => repos.phases.abort(phase.id), true)} />
    </PhaseFrame>
  );
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

/** シートの中身（hud の色で） */
function SheetBody({ title, error, children }: { title: string; error: string | null; children: ReactNode }) {
  return (
    <HudFonts>
      <View style={{ backgroundColor: hud.panel, padding: 16, gap: 12, borderTopWidth: 1, borderColor: hud.line }}>
        <T bold size={16} color={hud.ink} accessibilityRole="header">{title}</T>
        {children}
        {error && <T size={13} color={colors.danger} accessibilityRole="alert">{error}</T>}
      </View>
    </HudFonts>
  );
}

const EXTEND_OPTIONS = [2, 4, 8];

function ExtendSheet({ visible, onClose, phase, progress, busy, error, onExtend }: {
  visible: boolean; onClose: () => void; phase: Phase; progress: PhaseProgress; busy: boolean; error: string | null; onExtend: (weeks: number) => void;
}) {
  const [weeks, setWeeks] = useState(4);
  const total = progress.weeksTotal ?? 0;
  const ok = total + weeks <= PHASE_LIMITS.weeks;
  return (
    <Sheet visible={visible} onClose={onClose}>
      <SheetBody title="延長する" error={error ?? (ok ? null : `期間は${PHASE_LIMITS.weeks}週までです`)}>
        <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: 6 }}>
          {EXTEND_OPTIONS.map((n) => <HudChip key={n} label={`+${n}週`} selected={weeks === n} onPress={() => setWeeks(n)} accessibilityLabel={`${n}週 延長`} />)}
        </View>
        <T size={13} color={hud.note}>
          {`${phaseLabel(phase)}：${total}週 → ${total + weeks}週。終わり ${progress.effectiveEnd ? formatMonthDay(progress.effectiveEnd) : '—'} → ${progress.effectiveEnd ? formatMonthDay(addDays(progress.effectiveEnd, weeks * 7)) : '—'}。予定の線は今日から引き直します。`}
        </T>
        <HudButton label="延長する" busy={busy} disabled={!ok} onPress={() => onExtend(weeks)} testID="phase-extend-save" />
      </SheetBody>
    </Sheet>
  );
}

function TargetSheet({ visible, onClose, phase, progress, unit, weekAvg, busy, error, onSave }: {
  visible: boolean; onClose: () => void; phase: Phase; progress: PhaseProgress; unit: WeightUnit; weekAvg: number | null; busy: boolean;
  error: string | null; onSave: (kg: number) => void;
}) {
  const initial = phase.targetWeightKg == null ? '' : trimNumber(Math.round(kgToUnit(phase.targetWeightKg, unit) * 10) / 10);
  const [text, setText] = useState(initial);
  const n = parseNumber(text);
  const targetKg = n == null ? null : Math.round(unitToKg(n, unit) * 100) / 100;
  const weeksLeft = progress.remainingDays == null ? null : Math.max(1, progress.remainingDays / 7);
  const per = targetKg != null && weekAvg != null && weeksLeft != null ? (targetKg - weekAvg) / weeksLeft : null;
  return (
    <Sheet visible={visible} onClose={onClose}>
      <SheetBody title="目標を変える" error={error}>
        <NumberField label="目標体重" unit={unit} value={text} onChange={setText} testID="phase-target-input" />
        <T size={13} color={hud.note} style={{ lineHeight: 20 }}>
          {`今日から、${weekAvg == null ? '前の予定の線の今日の値' : `今の週平均 ${fmt1(kgToUnit(weekAvg, unit))} ${unit}`}から新しい目標へ線を引き直します。前の線は薄く残ります。` +
            (per == null ? '' : `予定のペースは 週 ${signed(kgToUnit(per, unit), 2)} ${unit}。`)}
        </T>
        <HudButton label="目標を変える" busy={busy} disabled={targetKg == null} onPress={() => targetKg != null && onSave(targetKg)} testID="phase-target-save" />
      </SheetBody>
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

function RehabSheet({ visible, onClose, label, busy, error, onStart }: {
  visible: boolean; onClose: () => void; label: string; busy: boolean; error: string | null; onStart: (name: string) => void;
}) {
  const [name, setName] = useState('');
  return (
    <Sheet visible={visible} onClose={onClose}>
      <SheetBody title="療養に入る" error={error}>
        <T size={13} color={hud.note} style={{ lineHeight: 20 }}>
          {`今日から療養に入り、${label}の時計を止めます。終わりは療養の日数だけ後ろにずれ、療養中と戻ってから2週間はペースを判定しません。`}
        </T>
        <TextField label="名前（なくてもよい。例：風邪）" value={name} onChange={setName} maxLength={PHASE_LIMITS.name} testID="phase-rehab-name" />
        <HudButton label="療養に入る" busy={busy} onPress={() => onStart(name)} testID="phase-rehab-save" />
      </SheetBody>
    </Sheet>
  );
}
