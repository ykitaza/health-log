import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityChoice, SexChoice } from '@/components/GoalProfile';
import { Icon } from '@/components/Icon';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { T } from '@/components/Text';
import { Button, Card, Chip, Header, Segmented } from '@/components/ui';
import { useBusy } from '@/hooks/busy';
import { useConfirmDiscard } from '@/hooks/confirmDiscard';
import { useRepos } from '@/hooks/data';
import type { Repositories } from '@/db';
import type { Profile, Settings } from '@/db/repositories/settings';
import {
  Activity, ACTIVITY_FACTORS, ACTIVITY_LABELS, BodyBasis, bodyBasis, calcGoal, GoalCalc, Missing, missingInputs, parseBirthYear,
  PROTEIN_PER_KG, Sex, TRAINING_KCAL, weightChanged,
} from '@/lib/autoGoal';
import { formatShortDate, todayKey } from '@/lib/date';
import { LIMITS, parseInRange } from '@/lib/limits';
import {
  DAY_TYPE_LABELS, EATING_STYLE_LABELS, EatingStyle, GoalDraft, NutritionGoal, parseGoal, Policy, POLICY_LABELS, targetFor,
} from '@/lib/meals';
import { fmt1, fmtInt, parseNumber, trimNumber } from '@/lib/units';
import { colors, fonts, radius, space } from '@/theme';

const t = (n: number | null | undefined) => (n == null ? '' : trimNumber(n));
const toDraft = (g: NutritionGoal | null): GoalDraft => ({
  policy: g?.policy ?? 'maintain', bodyWeight: t(g?.body_weight_kg), proteinPerKg: t(g?.protein_per_kg), targetWeight: t(g?.target_weight_kg),
  eatingStyle: g?.eating_style ?? null,
  training: { kcal: t(g?.targets?.training_day.kcal), fat_g: t(g?.targets?.training_day.fat_g), carbs_g: t(g?.targets?.training_day.carbs_g) },
  rest: { kcal: t(g?.targets?.rest_day.kcal), fat_g: t(g?.targets?.rest_day.fat_g), carbs_g: t(g?.targets?.rest_day.carbs_g) },
});

/** 自動で計算するのに使うもの（体重・体脂肪率の記録と、設定） */
type Ctx = { settings: Settings; profile: Profile; basis: BodyBasis | null; autoWeight: number | null };
type Auto = { calc: GoalCalc; basis: BodyBasis; activity: Activity; targetWeightKg: number | null };

async function loadCtx(repos: Repositories): Promise<Ctx> {
  const [settings, profile, daily, autoWeight] = await Promise.all([
    repos.settings.get(), repos.settings.profile(), repos.body.listDaily(), repos.settings.autoGoalWeight(),
  ]);
  return { settings, profile, basis: bodyBasis(daily, todayKey()), autoWeight };
}

const strs = (d: { kcal: number; fat_g: number; carbs_g: number }) => ({ kcal: String(d.kcal), fat_g: String(d.fat_g), carbs_g: String(d.carbs_g) });
const signed = (n: number, digits = 0) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${digits ? Math.abs(n).toFixed(digits) : fmtInt(Math.abs(n))}`;

/**
 * 目標（kcal と PFC）の確認と設定。MCP の set_goals と同じく、数字をそのまま決める（必須は方針だけ）。
 * 「自動で計算」は、体重・体脂肪率の記録と設定から、筋トレの日と休みの日の目標を入れる（lib/autoGoal.ts。保存は「目標を保存」で）。
 * MCP の suggest_goals と同じ計算（testdata/meals/auto_goal.json で、アプリとサーバーが同じ数字になることを確かめている）
 */
export default function GoalScreen() {
  const repos = useRepos();
  const [goal, setGoal] = useState<NutritionGoal | null | undefined>(undefined);
  const [draft, setDraft] = useState<GoalDraft>(toDraft(null));
  const [error, setError] = useState<string | null>(null);
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [auto, setAuto] = useState<Auto | null>(null);
  /** 自動で計算するのに足りない入力（入れてもらう欄を出す） */
  const [missing, setMissing] = useState<Missing[] | null>(null);

  useEffect(() => {
    repos.meals.getGoal().then((g) => { setGoal(g); setDraft(toDraft(g)); });
    loadCtx(repos).then(setCtx);
  }, [repos]);
  const dirty = goal !== undefined && JSON.stringify(draft) !== JSON.stringify(toDraft(goal));
  const { dialog, allowLeave } = useConfirmDiscard(dirty, '変えた目標は保存されません。');
  const { busy, run } = useBusy();

  const save = () => run(async (stayBusy) => {
    const p = parseGoal(draft);
    if ('error' in p) { setError(p.error); return; }
    setError(null);
    await repos.meals.saveGoal(p.value);
    if (auto) await repos.settings.setAutoGoalWeight(auto.calc.bodyWeightKg);
    stayBusy();
    allowLeave();
    router.back();
  });
  const set = (patch: Partial<GoalDraft>) => setDraft((d) => ({ ...d, ...patch }));

  /** 足りない入力があれば入れてもらい、そろっていれば計算して欄に入れる（保存はしない） */
  const calculate = useCallback((c: Ctx) => {
    const m = missingInputs({ basis: c.basis, heightCm: c.settings.heightCm, ...c.profile, activity: c.settings.activity });
    if (m.length > 0 || !c.basis || !c.settings.activity) { setMissing(m); return; }
    const year = Number(todayKey().slice(0, 4));
    const targetWeightKg = c.settings.goalWeightKg ?? parseNumber(draft.targetWeight);
    const calc = calcGoal({
      weightKg: c.basis.weightKg, bodyFatPct: c.basis.bodyFat?.pct ?? null, activity: c.settings.activity, targetWeightKg,
      heightCm: c.settings.heightCm, sex: c.profile.sex, age: c.profile.birthYear == null ? null : year - c.profile.birthYear,
    });
    if (!calc) { setMissing(m); return; }
    setMissing(null);
    setError(null);
    setAuto({ calc, basis: c.basis, activity: c.settings.activity, targetWeightKg });
    setDraft((d) => ({
      ...d, policy: calc.policy, bodyWeight: trimNumber(calc.bodyWeightKg), proteinPerKg: trimNumber(PROTEIN_PER_KG),
      targetWeight: targetWeightKg == null ? d.targetWeight : trimNumber(targetWeightKg),
      training: strs(calc.training), rest: strs(calc.rest),
    }));
  }, [draft.targetWeight]);
  const pressAuto = async () => { const c = await loadCtx(repos); setCtx(c); calculate(c); };
  const currentKg = ctx?.basis ? Math.round(ctx.basis.weightKg * 10) / 10 : null;
  const changed = goal != null && auto == null && weightChanged(ctx?.autoWeight ?? null, currentKg);

  return (
    <Screen footer={<>{error && <T size={13} color={colors.danger} align="center">{error}</T>}<Button label={busy ? '保存しています…' : '目標を保存'} onPress={save} disabled={goal === undefined} busy={busy} /></>}>
      <Header title="目標" onBack={() => router.back()} />
      {goal !== undefined && (
        <Card style={{ gap: 8 }}>
          <T bold size={15}>今の目標</T>
          {goal == null ? (
            <T size={13} color={colors.sub}>まだ決めていません。下で決めるか、Claude・ChatGPT に「目標を決めたい」と頼むと、体のデータから案を計算します。</T>
          ) : (
            <>
              <T size={13} color={colors.sub}>方針：{POLICY_LABELS[goal.policy]}{goal.target_weight_kg != null ? `　目標体重 ${fmt1(goal.target_weight_kg)}kg` : ''}</T>
              {(['training', 'rest'] as const).map((d) => {
                const x = targetFor(goal, d);
                return (
                  <View key={d} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <T size={13} bold>{DAY_TYPE_LABELS[d]}</T>
                    <T size={13} color={colors.sub}>
                      {x.kcal != null ? `${fmtInt(x.kcal)}kcal` : 'kcal 目標なし'}・P {x.protein_g != null ? `${fmt1(x.protein_g)}g` : '—'}・F {x.fat_g != null ? `${fmt1(x.fat_g)}g` : '—'}・C {x.carbs_g != null ? `${fmt1(x.carbs_g)}g` : '—'}
                    </T>
                  </View>
                );
              })}
              <T size={12} color={colors.sub}>たんぱく質は体重 × 体重1kgあたりの量で、日の種類によらず同じです。</T>
            </>
          )}
        </Card>
      )}

      <Card style={{ marginTop: 12, gap: space.m }}>
        <T variant="titleM">自動で計算</T>
        <T variant="bodyM" color={colors.sub}>体重・体脂肪率の記録と、アカウントの画面の身長・目標体重・活動の量などから、筋トレの日と休みの日の目標を入れます。入った値は直してから保存できます。</T>
        {changed && (
          <View style={s.notice} accessibilityRole="alert" testID="weight-changed">
            <Icon name="info" size={20} color={colors.onAccentDark} />
            <T variant="bodyM" color={colors.onAccentDark} style={{ flex: 1 }}>
              体重が変わりました（前回 {fmt1(ctx!.autoWeight!)}kg → 今 {fmt1(currentKg!)}kg）。計算し直しますか？
            </T>
          </View>
        )}
        <Button label={changed ? '計算し直す' : '自動で計算'} icon="calc" variant="tonal" small onPress={pressAuto} disabled={goal === undefined} />
        {missing && ctx && (
          <MissingInputs
            missing={missing}
            ctx={ctx}
            onCancel={() => setMissing(null)}
            onSaved={async () => { const c = await loadCtx(repos); setCtx(c); calculate(c); }}
          />
        )}
        {auto && <Basis auto={auto} />}
        <T variant="bodyS" color={colors.sub}>数字は一般的な目安で、医療のための計算ではありません。</T>
      </Card>

      <T bold size={13} color={colors.sub} style={{ marginTop: 18, marginBottom: 8 }}>目標を決める（必須は方針だけ。空の欄は目標なし）</T>
      <Card style={{ gap: 12 }}>
        <Segmented options={(['bulk', 'maintain', 'cut'] as Policy[]).map((k) => ({ key: k, label: POLICY_LABELS[k] }))} value={draft.policy} onChange={(policy) => set({ policy })} />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Num label="体重" unit="kg" value={draft.bodyWeight} onChange={(v) => set({ bodyWeight: v })} />
          <Num label="たんぱく質（体重1kgあたり）" unit="g" value={draft.proteinPerKg} onChange={(v) => set({ proteinPerKg: v })} />
        </View>
        <Num label="目標体重" unit="kg" value={draft.targetWeight} onChange={(v) => set({ targetWeight: v })} />
        <View style={{ gap: 6 }}>
          <T size={12} color={colors.sub}>食事の傾向</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(Object.keys(EATING_STYLE_LABELS) as EatingStyle[]).map((k) => (
              <Chip key={k} label={EATING_STYLE_LABELS[k]} active={draft.eatingStyle === k} onPress={() => set({ eatingStyle: draft.eatingStyle === k ? null : k })} />
            ))}
          </View>
        </View>
      </Card>

      {(['training', 'rest'] as const).map((d) => (
        <Card key={d} style={{ marginTop: 12, gap: 8 }}>
          <T bold size={15}>{DAY_TYPE_LABELS[d]}</T>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Num label="kcal" unit="kcal" value={draft[d].kcal} onChange={(v) => set({ [d]: { ...draft[d], kcal: v } })} a11y={`${DAY_TYPE_LABELS[d]}の kcal`} />
            <Num label="F 脂質" unit="g" value={draft[d].fat_g} onChange={(v) => set({ [d]: { ...draft[d], fat_g: v } })} a11y={`${DAY_TYPE_LABELS[d]}の脂質`} />
            <Num label="C 炭水化物" unit="g" value={draft[d].carbs_g} onChange={(v) => set({ [d]: { ...draft[d], carbs_g: v } })} a11y={`${DAY_TYPE_LABELS[d]}の炭水化物`} />
          </View>
        </Card>
      ))}
      <T size={12} color={colors.sub} style={{ marginTop: 10 }}>
        筋トレの日と休みの日の kcal・脂質・炭水化物は、全部入れるか、全部空にします。同じ値でもかまいません。
      </T>
      {dialog}
    </Screen>
  );
}

const MISSING_TEXT: Record<Missing, string> = {
  weight: '体重', height: '身長', sex: '性別', birthYear: '生まれた年', activity: 'ふだんの活動の量',
};

/** 自動で計算するのに足りない入力を、先に入れてもらう（保存先はアカウントの画面の体の情報と同じ。性別・生まれた年は端末だけ） */
function MissingInputs({ missing, ctx, onCancel, onSaved }: { missing: Missing[]; ctx: Ctx; onCancel: () => void; onSaved: () => void }) {
  const repos = useRepos();
  const [sex, setSex] = useState<Sex | null>(ctx.profile.sex);
  const [birthYear, setBirthYear] = useState('');
  const [height, setHeight] = useState('');
  const [activity, setActivity] = useState<Activity | null>(ctx.settings.activity);
  const [err, setErr] = useState<string | null>(null);
  const need = (k: Missing) => missing.includes(k);

  if (need('weight')) {
    return (
      <View style={s.panel} testID="auto-missing">
        <T variant="titleS">体重の記録がありません</T>
        <T variant="bodyM" color={colors.sub}>からだのタブで体重を記録してから、もう一度押してください。</T>
        <Button label="閉じる" variant="text" small onPress={onCancel} />
      </View>
    );
  }

  const submit = async () => {
    let year: number | null = null, heightCm: number | null = null;
    if (need('sex') && !sex) { setErr('性別を選んでください'); return; }
    if (need('birthYear')) {
      const p = parseBirthYear(birthYear, Number(todayKey().slice(0, 4)));
      if ('error' in p) { setErr(p.error); return; }
      if (p.value == null) { setErr('生まれた年を入れてください'); return; }
      year = p.value;
    }
    if (need('height')) {
      const p = parseInRange(height, LIMITS.height);
      if ('error' in p) { setErr(p.error); return; }
      if (p.value == null) { setErr('身長を入れてください'); return; }
      heightCm = p.value;
    }
    if (need('activity') && !activity) { setErr('ふだんの活動の量を選んでください'); return; }
    setErr(null);
    if (need('sex') || need('birthYear')) await repos.settings.setProfile({ ...(need('sex') ? { sex } : {}), ...(year != null ? { birthYear: year } : {}) });
    await repos.settings.update({ ...(heightCm != null ? { heightCm } : {}), ...(need('activity') && activity ? { activity } : {}) });
    onSaved();
  };

  return (
    <View style={s.panel} testID="auto-missing">
      <T variant="titleS">計算に使う項目を入れてください</T>
      <T variant="bodyM" color={colors.sub}>足りない項目：{missing.map((k) => MISSING_TEXT[k]).join('・')}。アカウントの画面の体の情報にも保存します。性別と生まれた年は、この端末の中だけに置きます。</T>
      {need('sex') && <SexChoice value={sex} onChange={setSex} />}
      {(need('birthYear') || need('height')) && (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {need('birthYear') && <Num label="生まれた年" unit="年" value={birthYear} onChange={setBirthYear} />}
          {need('height') && <Num label="身長" unit="cm" value={height} onChange={setHeight} />}
        </View>
      )}
      {need('activity') && <ActivityChoice value={activity} onChange={setActivity} />}
      {err && <T variant="bodyS" color={colors.danger}>{err}</T>}
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: space.s }}>
        <Button label="やめる" variant="text" small onPress={onCancel} />
        <Button label="保存して計算" small onPress={submit} />
      </View>
    </View>
  );
}

/** 計算のもと（計算に使った数字） */
function Basis({ auto }: { auto: Auto }) {
  const { calc, basis, activity, targetWeightKg } = auto;
  const days = (from: string, to: string, n: number) => (from === to ? formatShortDate(to) : `${formatShortDate(from)}〜${formatShortDate(to)} の ${n}日の平均`);
  const rows: [string, string][] = [
    ['体重', `${fmt1(calc.bodyWeightKg)}kg（${days(basis.weightFrom, basis.weightTo, basis.weightDays)}）`],
    ['体脂肪率', basis.bodyFat ? `${fmt1(basis.bodyFat.pct)}%（${days(basis.bodyFat.from, basis.bodyFat.to, basis.bodyFat.days)}）` : '直近7日の記録なし'],
    ['基礎代謝', `${fmtInt(calc.bmr)}kcal（${calc.bmrMethod === 'katch-mcardle' ? 'Katch-McArdle の式' : 'Mifflin-St Jeor の式'}）`],
    ['1日の消費', `休み ${fmtInt(calc.tdeeRest)}kcal・筋トレ ${fmtInt(calc.tdeeTraining)}kcal`],
    ['', `活動「${ACTIVITY_LABELS[activity]}」×${ACTIVITY_FACTORS[activity]}、筋トレの日は +${TRAINING_KCAL}kcal`],
    ['方針', `${POLICY_LABELS[calc.policy]}${targetWeightKg != null ? `（目標体重 ${fmt1(targetWeightKg)}kg）` : '（目標体重なし）'}`],
    ['週のペース', calc.weeklyKg === 0 ? '±0kg' : `${signed(calc.weeklyKg, 2)}kg`],
    ['1日あたりの差', `${signed(calc.dailyDelta)}kcal`],
    ['たんぱく質', `体重 × ${trimNumber(PROTEIN_PER_KG)}g ＝ ${calc.proteinG}g`],
  ];
  return (
    <View style={s.panel} testID="auto-basis">
      <T variant="titleS">計算のもと</T>
      {rows.map(([k, v], i) => (
        <View key={i} style={{ flexDirection: 'row', gap: space.s }}>
          <T variant="bodyM" color={colors.sub} style={{ width: 112 }}>{k}</T>
          <T variant="bodyM" style={{ flex: 1 }}>{v}</T>
        </View>
      ))}
      <T variant="bodyS" color={colors.sub}>脂質は kcal の 25%、炭水化物は残りです。{calc.floored ? '基礎代謝を下回らないように、kcal の目標を引き上げました。' : ''}</T>
    </View>
  );
}

function Num({ label, unit, value, onChange, a11y }: { label: string; unit: string; value: string; onChange: (v: string) => void; a11y?: string }) {
  return (
    <View style={{ flex: 1, gap: 4 }}>
      <T size={12} color={colors.sub}>{label}</T>
      <View style={s.box}>
        <Input value={value} onChangeText={onChange} keyboardType="decimal-pad" accessibilityLabel={a11y ?? label} placeholder="—" placeholderTextColor={colors.sub} style={s.input} />
        <T size={11} color={colors.sub}>{unit}</T>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: space.s, backgroundColor: colors.accentDark, borderRadius: radius.m, padding: space.m },
  panel: { gap: space.s, borderWidth: 1, borderColor: colors.line, borderRadius: radius.m, padding: space.m },
  box: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.input, borderRadius: radius.input, paddingRight: 8 },
  input: { flex: 1, minWidth: 0, height: 44, paddingHorizontal: 12, color: colors.text, fontFamily: fonts.numBold, fontSize: 20 },
});
