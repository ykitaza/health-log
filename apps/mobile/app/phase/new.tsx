import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { BackHandler, View } from 'react-native';
import { MealFields } from '@/components/phase/MealFields';
import { ChoiceCard, HudButton, HudChip, NumberField, PhaseFrame, PhaseTitle, StepBars, TextButton, TextField } from '@/components/phase/parts';
import { hud, Micro, Mono, Panel, StatusRow } from '@/components/report/hud';
import { T } from '@/components/Text';
import { ConfirmDialog } from '@/components/ui';
import { PhaseError } from '@/db/repositories/phases';
import { useBusy } from '@/hooks/busy';
import { useRepos } from '@/hooks/data';
import { useToday } from '@/hooks/today';
import { formatMonthDay } from '@/lib/date';
import { BIG3_LABELS } from '@/lib/exercises';
import { loadGrowthData } from '@/lib/growthData';
import { NutritionGoal, TARGET_WEIGHT } from '@/lib/meals';
import { currentPhase, DIRECTION_LABELS, endDateFor, PHASE_LIMITS, PhaseDirection, PhaseMealTargets } from '@/lib/phases';
import {
  autoName, big3Sum, DEFAULT_WEEKS, DIRECTION_CHOICES, DIRECTIONS, initialTarget, MealDraft, mealDraftFromGoal, measuresFrom, parseMealDraft,
  PhaseMeasures, plannedWeeklyKg, snapshotOf, targetAgainstDirection, WEEK_OPTIONS,
} from '@/lib/phaseView';
import { fmt1, kgToUnit, parseNumber, trimNumber, unitToKg, WeightUnit } from '@/lib/units';
import { colors } from '@/theme';

type Ctx = { unit: WeightUnit; goalKg: number | null; goal: NutritionGoal | null; measures: PhaseMeasures };
const STEPS = 4;
const STEP_EN = ['01/04 DIRECTION', '02/04 GOAL', '03/04 FUEL', '04/04 BASELINE'];

/**
 * フェーズを始める（オンボーディング。Figma「スタディ：フェーズ」のセクション 2）。
 * 向き → 目標体重と週数（名前は任意）→ 食事の目標（今の目標を取り込んで直す。スキップできる）→ 開始時の記録の確認 → 始める。
 * 自動では始めない（本人が「この内容で始める」を押したときだけ）。「あとで」で何も保存せずに閉じ、様子見のまま戻る。
 * 実施中のフェーズ・療養があるときは、進捗の詳細へ移す
 */
export default function PhaseNewScreen() {
  const repos = useRepos();
  const today = useToday();
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [step, setStep] = useState(1);
  const [direction, setDirection] = useState<PhaseDirection | null>(null);
  const [target, setTarget] = useState('');
  const [imported, setImported] = useState(false);
  const [targetTouched, setTargetTouched] = useState(false);
  const [weeks, setWeeks] = useState(16);
  const [otherWeeks, setOtherWeeks] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [meal, setMeal] = useState<MealDraft>({ training: '', rest: '', protein: '' });
  const [mealSkipped, setMealSkipped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const { busy, run } = useBusy();

  useEffect(() => {
    let alive = true;
    (async () => {
      const [phases, goal, growth] = await Promise.all([repos.phases.list(), repos.meals.getGoal(), loadGrowthData(repos, today)]);
      if (!alive) return;
      if (currentPhase(phases, today).current) { router.replace('/phase'); return; }
      setCtx({ unit: growth.weightUnit, goalKg: growth.goalWeightKg, goal, measures: measuresFrom(growth, today) });
      setMeal(mealDraftFromGoal(goal));
    })();
    return () => { alive = false; };
  }, [repos, today]);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const back = () => (step > 1 ? (setError(null), setStep(step - 1)) : close());
  // Android の戻るは、前のステップへ（最初のステップでは閉じる）
  useEffect(() => {
    if (step === 1) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { setStep((s) => Math.max(1, s - 1)); return true; });
    return () => sub.remove();
  }, [step]);

  const unit = ctx?.unit ?? 'kg';
  const nowKg = ctx?.measures.weightKg ?? null;
  const toUnit = (kg: number) => trimNumber(Math.round(kgToUnit(kg, unit) * 10) / 10);
  const fmtW = (kg: number) => `${fmt1(kgToUnit(kg, unit))} ${unit}`;

  const choose = (d: PhaseDirection) => {
    setDirection(d);
    setWeeks(DEFAULT_WEEKS[d]);
    setOtherWeeks(null);
  };
  /** 目標体重の初期値は、目標と週数のステップに入るときに入れる（向きと読み込んだ記録がそろってから。本人が直した値は変えない） */
  const prefillTarget = (d: PhaseDirection) => {
    if (targetTouched || !ctx) return;
    const t = initialTarget(d, ctx.goalKg, nowKg);
    setTarget(t.kg == null ? '' : toUnit(t.kg));
    setImported(t.imported);
  };
  const editTarget = (text: string) => { setTarget(text); setTargetTouched(true); setImported(false); };

  const targetNum = parseNumber(target);
  const targetKg = targetNum == null ? null : Math.round(unitToKg(targetNum, unit) * 100) / 100;
  const weeksNum = otherWeeks == null ? weeks : parseNumber(otherWeeks);
  const weeksOk = weeksNum != null && Number.isInteger(weeksNum) && weeksNum >= 1 && weeksNum <= PHASE_LIMITS.weeks;
  const endDate = weeksOk ? endDateFor(today, weeksNum) : null;
  const perWeek = weeksOk ? plannedWeeklyKg(nowKg, targetKg, weeksNum) : null;
  const meals = useMemo(() => parseMealDraft(meal), [meal]);

  const next = () => {
    setError(null);
    if (step === 1) {
      if (!direction) { setError('向きを選んでください'); return; }
      prefillTarget(direction);
    }
    if (step === 2) {
      if (targetKg == null) { setError('目標体重を入れてください'); return; }
      if (targetKg < TARGET_WEIGHT.min || targetKg > TARGET_WEIGHT.max) {
        setError(`目標体重は${TARGET_WEIGHT.min}〜${TARGET_WEIGHT.max}kg で入れてください`); return;
      }
      if (!weeksOk) { setError(`期間は1〜${PHASE_LIMITS.weeks}週で入れてください`); return; }
    }
    if (step === 3) {
      if ('error' in meals) { setError(meals.error); return; }
      setMealSkipped(false);
    }
    setStep(step + 1);
  };
  const skipMeals = () => { setMealSkipped(true); setError(null); setStep(4); };

  const start = () => run(async (stayBusy) => {
    if (!ctx || !direction || targetKg == null || !weeksOk) return;
    const mealTargets = mealSkipped || 'error' in meals ? null : meals.value;
    try {
      await repos.phases.start({
        direction, name, startDate: today, weeks: weeksNum, targetWeightKg: targetKg, mealTargets, snapshot: snapshotOf(ctx.measures),
      });
    } catch (e) {
      if (e instanceof PhaseError) { setError(e.message); return; }
      throw e;
    }
    stayBusy();
    close();
  });

  const later = <TextButton label="あとで" onPress={() => setLeaving(true)} testID="phase-later" />;
  const footer = (
    <>
      {error && <T size={13} color={colors.danger} align="center" accessibilityRole="alert">{error}</T>}
      {step === 3 && <TextButton label="スキップ（今の目標のまま）" onPress={skipMeals} testID="phase-skip-meals" />}
      {step < STEPS
        ? <HudButton label="次へ" onPress={next} disabled={!ctx} testID="phase-next" />
        : <HudButton label={busy ? '始めています…' : 'この内容で始める'} onPress={start} busy={busy} testID="phase-start" />}
    </>
  );

  return (
    <PhaseFrame sys={`HLOG // PHASE SETUP · ${STEP_EN[step - 1]}`} onBack={back} right={later} footer={footer} testID="phase-new">
      <T size={11.5} color={hud.muted}>{`${step}／${STEPS}`}</T>
      <T bold size={18} color={hud.ink} accessibilityRole="header">フェーズを始める</T>
      <StepBars step={step} total={STEPS} />

      {step === 1 && (
        <View style={{ gap: 8 }}>
          <PhaseTitle en="DIRECTION" title="次の数か月、体をどうしますか" note="向きで、ホームの輪と成功の指標、レポートの良し悪しの向きが決まります。" />
          <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
            {DIRECTIONS.map((d) => (
              <ChoiceCard key={d} {...DIRECTION_CHOICES[d]} selected={direction === d} onPress={() => choose(d)} testID={`phase-direction-${d}`} />
            ))}
          </View>
          <T size={12} color={hud.muted} style={{ lineHeight: 18 }}>
            ケガや体調不良のときの「療養」は、ここでは選びません。フェーズを始めたあと、進捗の詳細から入ります。
          </T>
        </View>
      )}

      {step === 2 && direction && (
        <View style={{ gap: 10 }}>
          <PhaseTitle en="GOAL // WEIGHT + WEEKS" title={`${DIRECTION_LABELS[direction]}の目標と期間`} />
          <NumberField label="目標体重" unit={unit} value={target} onChange={editTarget} testID="phase-target" />
          {imported && <T size={11.5} color={hud.muted}>アカウントの目標体重から取り込みました</T>}
          <Panel bg={hud.panel2} border={hud.line2} cut={6} style={{ paddingHorizontal: 12, paddingVertical: 8 }}>
            <T size={12.5} color={hud.note} style={{ lineHeight: 19 }}>
              {nowKg == null
                ? '体重の記録がまだありません。開始時の体重がないと、予定の線とペースは出せません（あとで目標を変えると、そのときの体重から線を引きます）。'
                : `今の体重（${ctx?.measures.weightBasis === 'week' ? '7日平均' : '最新'}）${fmtW(nowKg)}${targetKg != null ? ` から ${signed(kgToUnit(targetKg - nowKg, unit))} ${unit}` : ''}。体脂肪率は目標に入れず、参考として出します。`}
            </T>
          </Panel>
          {targetAgainstDirection(direction, nowKg, targetKg) && (
            <T size={12} color={hud.label} testID="phase-target-warning">
              {direction === 'maintain' ? '維持なのに、目標が今の体重から 1 kg より離れています。' : `${DIRECTION_LABELS[direction]}なのに、目標が今の体重と逆の向きです。`}
            </T>
          )}
          <Micro>期間（週）</Micro>
          <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 6 }}>
            {WEEK_OPTIONS.map((n) => (
              <HudChip key={n} label={`${n}週`} selected={otherWeeks == null && weeks === n} onPress={() => { setWeeks(n); setOtherWeeks(null); }} accessibilityLabel={`期間 ${n}週`} />
            ))}
            <HudChip label="ほか" selected={otherWeeks != null} onPress={() => setOtherWeeks(otherWeeks ?? String(weeks))} accessibilityLabel="期間 ほかの週数" />
          </View>
          {otherWeeks != null && (
            <NumberField label={`週数（1〜${PHASE_LIMITS.weeks}）`} unit="週" value={otherWeeks} onChange={setOtherWeeks} keyboardType="number-pad" maxLength={3} testID="phase-weeks" />
          )}
          <Panel style={{ paddingHorizontal: 12, paddingVertical: 2 }}>
            <StatusRow en="END" ja="終了日" value={endDate ? `${formatMonthDay(endDate)}。延長はあとで` : '—'} wide />
            <StatusRow en="PLAN" ja="予定のペース（直線）" value={perWeek == null ? '—' : `週 ${signed(kgToUnit(perWeek, unit), 2)} ${unit}`} last wide />
          </Panel>
          <TextField label="名前（なくてもよい）" value={name} onChange={setName} maxLength={PHASE_LIMITS.name} testID="phase-name"
            placeholder={weeksOk ? autoName(direction, weeksNum) : undefined} />
          {weeksOk && <T size={11.5} color={hud.muted}>{`空なら「${autoName(direction, weeksNum)}」にします`}</T>}
        </View>
      )}

      {step === 3 && direction && (
        <View style={{ gap: 10 }}>
          <PhaseTitle en="FUEL // MEAL TARGETS" title="食事の目標"
            note={ctx?.goal ? '今の食事の目標を取り込みました。直してからフェーズに持たせます。' : '食事の目標はまだありません。入れておくと、進捗の詳細に出ます。'} />
          <Panel style={{ paddingHorizontal: 12, paddingVertical: 2 }}>
            <StatusRow en="POLICY" ja="方針" value={`${DIRECTION_LABELS[direction]}（向きと同じ）`} last wide />
          </Panel>
          <MealFields draft={meal} onChange={setMeal} weightKg={nowKg} />
          <T size={12} color={hud.muted} style={{ lineHeight: 18 }}>
            自動の計算はしません。数字はあとで進捗の詳細から直せます。毎日の食事の記録の目標（食事の目標の画面）は変わりません。
          </T>
        </View>
      )}

      {step === 4 && ctx && (
        <View style={{ gap: 10 }}>
          <PhaseTitle en="BASELINE // AUTO" title="今日の記録を控えます" note="振り返りの before になります。入力はいりません。" />
          <Panel style={{ paddingHorizontal: 12, paddingVertical: 2 }} testID="phase-snapshot">
            <StatusRow en="WEIGHT" ja={ctx.measures.weightBasis === 'latest' ? '体重（最新）' : '体重（7日平均）'}
              value={<Val v={ctx.measures.weightKg == null ? null : fmt1(kgToUnit(ctx.measures.weightKg, unit))} unit={unit} />} />
            <StatusRow en="BODY FAT" ja="体脂肪率（参考）" value={<Val v={ctx.measures.bodyFatPct == null ? null : fmt1(ctx.measures.bodyFatPct)} unit="%" />} />
            <StatusRow en="BIG3" ja={`BIG3 推定1RM 合計${big3Detail(ctx.measures, unit)}`}
              value={<Val v={big3Sum(ctx.measures.big3) == null ? null : fmt1(kgToUnit(big3Sum(ctx.measures.big3)!, unit))} unit={unit} />} />
            <StatusRow en="SCORE" ja="成長スコア（直近7日）" value={<Val v={ctx.measures.growthScore == null ? null : String(ctx.measures.growthScore)} />} last />
          </Panel>
          <Panel bg={hud.panel2} border={hud.line2} cut={6} style={{ paddingHorizontal: 12, paddingVertical: 8, gap: 2 }}>
            <StatusRow en="PHASE" ja={name.trim() || autoName(direction!, weeksNum ?? weeks)}
              value={`${formatMonthDay(today)}〜${endDate ? formatMonthDay(endDate) : ''}`} wide />
            <StatusRow en="GOAL" ja="目標体重" value={targetKg == null ? '—' : fmtW(targetKg)} />
            <StatusRow en="FUEL" ja="食事の目標" value={mealSkipped || 'error' in meals || meals.value == null ? 'なし' : mealLine(meals.value)} last wide />
          </Panel>
          <T size={12} color={hud.muted} style={{ lineHeight: 18 }}>ない記録は空のまま始めます。写真は今は付けられません。</T>
        </View>
      )}

      <ConfirmDialog
        visible={leaving} title="フェーズを始めずに閉じますか？" danger={false}
        body={`様子見のまま${ctx?.goalKg != null ? `、今の目標体重 ${fmtW(ctx.goalKg)} で` : ''}記録を続けます。ホームの NO PHASE と設定から、いつでも始められます。`}
        confirmLabel="閉じる" cancelLabel="続ける" onCancel={() => setLeaving(false)} onConfirm={() => { setLeaving(false); close(); }}
      />
    </PhaseFrame>
  );
}

const signed = (n: number, digits = 1) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n).toFixed(digits)}`;

function big3Detail(m: PhaseMeasures, unit: WeightUnit): string {
  if (!m.big3) return '';
  const parts = (['bench', 'squat', 'deadlift'] as const).flatMap((r) => (m.big3![r] == null ? [] : [`${BIG3_LABELS[r]} ${fmt1(kgToUnit(m.big3![r]!, unit))}`]));
  return parts.length ? `\n${parts.join('・')}` : '';
}

function mealLine(t: PhaseMealTargets): string {
  const k = (n: number | null) => (n == null ? '—' : String(n));
  return `筋トレの日 ${k(t.training_day.kcal)}・休みの日 ${k(t.rest_day.kcal)} kcal・P ${k(t.training_day.protein_g)} g`;
}

/** 値と単位（ないときは「—」） */
function Val({ v, unit }: { v: string | null; unit?: string }) {
  return (
    <T style={{ textAlign: 'right' }}>
      <Mono size={16} color={v == null ? hud.faint : hud.white}>{v ?? '—'}</Mono>
      {unit && v != null ? <Mono size={10} color={hud.muted}>{` ${unit.toUpperCase()}`}</Mono> : null}
    </T>
  );
}
