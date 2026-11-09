import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { T } from '@/components/Text';
import { Button, Card, Chip, Header, Segmented } from '@/components/ui';
import { useBusy } from '@/hooks/busy';
import { useConfirmDiscard } from '@/hooks/confirmDiscard';
import { useRepos } from '@/hooks/data';
import {
  DAY_TYPE_LABELS, EATING_STYLE_LABELS, EatingStyle, GoalDraft, NutritionGoal, parseGoal, Policy, POLICY_LABELS, targetFor,
} from '@/lib/meals';
import { fmt1, fmtInt, trimNumber } from '@/lib/units';
import { colors, fonts, radius } from '@/theme';

const t = (n: number | null | undefined) => (n == null ? '' : trimNumber(n));
const toDraft = (g: NutritionGoal | null): GoalDraft => ({
  policy: g?.policy ?? 'maintain', bodyWeight: t(g?.body_weight_kg), proteinPerKg: t(g?.protein_per_kg), targetWeight: t(g?.target_weight_kg),
  eatingStyle: g?.eating_style ?? null,
  training: { kcal: t(g?.targets?.training_day.kcal), fat_g: t(g?.targets?.training_day.fat_g), carbs_g: t(g?.targets?.training_day.carbs_g) },
  rest: { kcal: t(g?.targets?.rest_day.kcal), fat_g: t(g?.targets?.rest_day.fat_g), carbs_g: t(g?.targets?.rest_day.carbs_g) },
});

/**
 * 目標（kcal と PFC）の確認と設定。MCP の set_goals と同じく、数字をそのまま決める（必須は方針だけ）。
 * 体のデータから案を計算するのは、サーバー（MCP の goal_questions・suggest_goals）に任せる（docs/meals-design.md）
 */
export default function GoalScreen() {
  const repos = useRepos();
  const [goal, setGoal] = useState<NutritionGoal | null | undefined>(undefined);
  const [draft, setDraft] = useState<GoalDraft>(toDraft(null));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    repos.meals.getGoal().then((g) => { setGoal(g); setDraft(toDraft(g)); });
  }, [repos]);
  const dirty = goal !== undefined && JSON.stringify(draft) !== JSON.stringify(toDraft(goal));
  const { dialog, allowLeave } = useConfirmDiscard(dirty, '変えた目標は保存されません。');
  const { busy, run } = useBusy();

  const save = () => run(async (stayBusy) => {
    const p = parseGoal(draft);
    if ('error' in p) { setError(p.error); return; }
    setError(null);
    await repos.meals.saveGoal(p.value);
    stayBusy();
    allowLeave();
    router.back();
  });
  const set = (patch: Partial<GoalDraft>) => setDraft((d) => ({ ...d, ...patch }));

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
  box: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.input, borderRadius: radius.input, paddingRight: 8 },
  input: { flex: 1, minWidth: 0, height: 44, paddingHorizontal: 12, color: colors.text, fontFamily: fonts.numBold, fontSize: 20 },
});
