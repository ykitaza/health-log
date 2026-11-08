import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { T } from '@/components/Text';
import { Card, Header } from '@/components/ui';
import { useFocusData } from '@/hooks/data';
import { estimated1RM, rmTable } from '@/lib/training';
import { fmt1, parseNumber } from '@/lib/units';
import { colors, fonts } from '@/theme';

/** RM計算機。単位は設定のまま（計算は単位によらない） */
export default function RmScreen() {
  const { data } = useFocusData((r) => r.settings.get());
  const unit = data?.weightUnit ?? 'kg';
  const [weight, setWeight] = useState('');
  const [reps, setReps] = useState('');
  const w = parseNumber(weight);
  const r = parseNumber(reps);
  const oneRm = estimated1RM(w, r != null && Number.isInteger(r) ? r : null);

  return (
    <Screen>
      <Header title="RM計算機" onBack={() => router.back()} />
      <View style={{ flexDirection: 'row', gap: 12, marginTop: 10 }}>
        <Field label={`重量（${unit}）`} value={weight} onChange={setWeight} decimal />
        <Field label="回数" value={reps} onChange={setReps} />
      </View>
      <Card style={{ alignItems: 'center', marginTop: 16, gap: 4 }}>
        <T size={13} color={colors.sub}>推定1RM</T>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
          <T num bold size={60} color={oneRm > 0 ? colors.accent : colors.sub}>{oneRm > 0 ? fmt1(oneRm) : '—'}</T>
          <T size={16} color={colors.sub}>{unit}</T>
        </View>
        <T size={12} color={colors.sub}>計算式：重量 ×（1 ＋ 回数 ÷ 30）。1回なら重量そのもの</T>
      </Card>
      <Card style={{ marginTop: 14, padding: 0 }}>
        <View style={{ flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 10 }}>
          <T size={12} color={colors.sub} style={{ flex: 1 }}>割合</T>
          <T size={12} color={colors.sub} style={{ flex: 1 }}>重量</T>
          <T size={12} color={colors.sub} style={{ flex: 1 }}>回数の目安</T>
        </View>
        {rmTable(oneRm).map((row) => {
          const hit = r != null && row.reps === r;
          return (
            <View key={row.pct} style={{ flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.line }}>
              <T num bold size={16} style={{ flex: 1 }}>{row.pct}%</T>
              <T num bold size={16} style={{ flex: 1 }} color={hit ? colors.accent : colors.text}>{oneRm > 0 ? `${fmt1(row.weight)} ${unit}` : '—'}</T>
              <T num size={16} style={{ flex: 1 }} color={colors.sub}>{row.reps}回</T>
            </View>
          );
        })}
      </Card>
    </Screen>
  );
}

function Field({ label, value, onChange, decimal }: { label: string; value: string; onChange: (t: string) => void; decimal?: boolean }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ flex: 1, gap: 6 }}>
      <T size={13} color={colors.sub}>{label}</T>
      <Input
        value={value}
        onChangeText={onChange}
        keyboardType={decimal ? 'decimal-pad' : 'number-pad'}
        accessibilityLabel={label}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{ height: 52, borderRadius: 12, backgroundColor: colors.input, borderWidth: 1.5, borderColor: focused ? colors.accent : colors.input, color: colors.text, fontFamily: fonts.regular, fontSize: 17, paddingHorizontal: 14 }}
      />
    </View>
  );
}
